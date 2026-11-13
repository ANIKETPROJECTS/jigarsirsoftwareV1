const router            = require('express').Router();
const requireAuth       = require('../middleware/auth');
const connectionManager = require('../config/connectionManager');

router.use(requireAuth);

const ADMIN_ROLES = ['BHW_ADMIN', 'VLCO_ADMIN'];

// Safe query wrapper — returns rows or null, never throws.
async function sq(db, sql, replacements) {
  try {
    const [rows] = await db.query(sql, { replacements: replacements || [] });
    return rows;
  } catch (e) {
    console.error('[dashboard] query error:', e.message.slice(0, 300));
    return null;
  }
}

function n(v) { return Number(v) || 0; }

// ── SQL templates ─────────────────────────────────────────────────────────────

const STATS_SQL = `
  SELECT
    COUNT(DISTINCT CASE WHEN s.TransType IN ('ARV','RET','IN')   AND s.TransDt = ? THEN s.pfkLotID END) AS todayArvCnt,
    COALESCE(SUM(CASE WHEN s.TransType IN ('ARV','RET','IN')   AND s.TransDt = ? THEN ABS(s.TransQty) ELSE 0 END),0) AS todayArvQty,
    ROUND(COALESCE(SUM(CASE WHEN s.TransType IN ('ARV','RET','IN') AND s.TransDt = ? THEN ABS(s.TransQty) * s.PackWght ELSE 0 END),0) / 1000, 2) AS todayArvTons,
    COUNT(DISTINCT CASE WHEN s.TransType IN ('DESP','TRF','OUT') AND s.TransDt = ? THEN s.pfkLotID END) AS todayDspCnt,
    COALESCE(SUM(CASE WHEN s.TransType IN ('DESP','TRF','OUT') AND s.TransDt = ? THEN ABS(s.TransQty) ELSE 0 END),0) AS todayDspQty,
    ROUND(COALESCE(SUM(CASE WHEN s.TransType IN ('DESP','TRF','OUT') AND s.TransDt = ? THEN ABS(s.TransQty) * COALESCE(a.PackWght, 0) ELSE 0 END),0) / 1000, 2) AS todayDspTons,
    COUNT(DISTINCT CASE WHEN s.TransType IN ('ARV','RET','IN')   THEN s.pfkLotID END) AS monthArvCnt,
    COALESCE(SUM(CASE WHEN s.TransType IN ('ARV','RET','IN')   THEN ABS(s.TransQty) ELSE 0 END),0) AS monthArvQty,
    ROUND(COALESCE(SUM(CASE WHEN s.TransType IN ('ARV','RET','IN')   THEN s.GrossWght ELSE 0 END),0) / 1000, 3) AS monthArvTons,
    COUNT(DISTINCT CASE WHEN s.TransType IN ('DESP','TRF','OUT') THEN s.pfkLotID END) AS monthDspCnt,
    COALESCE(SUM(CASE WHEN s.TransType IN ('DESP','TRF','OUT') THEN ABS(s.TransQty) ELSE 0 END),0) AS monthDspQty,
    ROUND(COALESCE(SUM(CASE WHEN s.TransType IN ('DESP','TRF','OUT') THEN s.GrossWght ELSE 0 END),0) / 1000, 3) AS monthDspTons
  FROM tStockEntry s
  LEFT JOIN (
    SELECT pfkLotID, MAX(PackWght) AS PackWght
    FROM tStockEntry
    WHERE TransType IN ('ARV','RET','IN')
    GROUP BY pfkLotID
  ) a ON a.pfkLotID = s.pfkOriLotID
  WHERE s.TransDt >= ?`;

const AGING_SQL = `
  SELECT ageBucket, COUNT(*) AS lotCount, SUM(balQty) AS totalQty,
         ROUND(SUM(balQty * packWght) / 1000, 2) AS totalTons
  FROM (
    SELECT s.pfkOriLotID,
      SUM(IF(s.TransType IN ('ARV','RET','IN','DESPRET'), ABS(s.TransQty), -ABS(s.TransQty))) AS balQty,
      MAX(IF(s.TransType = 'ARV', s.PackWght, 0)) AS packWght,
      CASE
        WHEN DATEDIFF(CURDATE(), MIN(IF(s.TransType = 'ARV', s.TransDt, NULL))) <= 30  THEN '0-30d'
        WHEN DATEDIFF(CURDATE(), MIN(IF(s.TransType = 'ARV', s.TransDt, NULL))) <= 60  THEN '31-60d'
        WHEN DATEDIFF(CURDATE(), MIN(IF(s.TransType = 'ARV', s.TransDt, NULL))) <= 90  THEN '61-90d'
        WHEN DATEDIFF(CURDATE(), MIN(IF(s.TransType = 'ARV', s.TransDt, NULL))) <= 180 THEN '90-180d'
        ELSE '180+d'
      END AS ageBucket
    FROM tStockEntry s
    JOIN mParty p ON p.pkPartyID = s.fkPartyID AND p.Active = 'Y'
    JOIN mItem  i ON i.pkItemID  = s.fkItemID  AND i.iType  = 'ITM'
    WHERE s.OpFlg = 'N'
    GROUP BY s.pfkOriLotID
    HAVING SUM(IF(s.TransType IN ('ARV','RET','IN','DESPRET'), ABS(s.TransQty), -ABS(s.TransQty))) > 0.001
  ) _lots
  GROUP BY ageBucket`;

const OUTSTANDING_SQL = `
  SELECT p.pName,
         SUM(c.billCount)        AS billCount,
         ROUND(SUM(c.outAmt), 2) AS outstandingAmt
  FROM (
    -- Godown Rent + Hamali + General only; Transport (TRSP) excluded
    -- BillStatus='N' = Normal bills only (excludes cancelled/draft)
    SELECT b.fkPartyID,
           COUNT(CASE WHEN (IFNULL(b.NetAmt, b.GrossAmt) - COALESCE(r.paidAmt, 0)) > 0.01 THEN 1 END) AS billCount,
           SUM(IFNULL(b.NetAmt, b.GrossAmt) - COALESCE(r.paidAmt, 0)) AS outAmt
    FROM tBillTrHmGen1 b
    LEFT JOIN (
      SELECT fkBillID, BillType, SUM(RecptAmt + TDSAmt) AS paidAmt
      FROM tRecpt2 GROUP BY fkBillID, BillType
    ) r ON r.fkBillID = b.pkBillID AND r.BillType = b.BillType
    WHERE b.BillType IN ('HMLI', 'GEN') AND b.BillStatus = 'N'
    GROUP BY b.fkPartyID
    UNION ALL
    SELECT b.fkPartyID,
           COUNT(CASE WHEN (IFNULL(b.NetAmt, b.GrossAmt) - COALESCE(r.paidAmt, 0)) > 0.01 THEN 1 END) AS billCount,
           SUM(IFNULL(b.NetAmt, b.GrossAmt) - COALESCE(r.paidAmt, 0)) AS outAmt
    FROM tBill1 b
    LEFT JOIN (
      SELECT fkBillID, SUM(RecptAmt + TDSAmt) AS paidAmt
      FROM tRecpt2 WHERE BillType = 'GODRENT' GROUP BY fkBillID
    ) r ON r.fkBillID = b.pkBillID
    WHERE b.BillStatus = 'N'
    GROUP BY b.fkPartyID
  ) c
  JOIN mParty p ON p.pkPartyID = c.fkPartyID AND p.Active = 'Y'
  GROUP BY c.fkPartyID, p.pName
  HAVING outstandingAmt > 0.01
  ORDER BY outstandingAmt DESC LIMIT 10`;

const OUTSTANDING_BILL_SQL = `
  SELECT
    ROUND(SUM(CASE WHEN vra.BillType = 'GODRENT' THEN vra.BalanceAmt ELSE 0 END), 2) AS godrentAmt,
    ROUND(SUM(CASE WHEN vra.BillType = 'HMLI'    THEN vra.BalanceAmt ELSE 0 END), 2) AS hamaliAmt,
    ROUND(SUM(CASE WHEN vra.BillType = 'GEN'     THEN vra.BalanceAmt ELSE 0 END), 2) AS genAmt,
    ROUND(SUM(vra.BalanceAmt), 2)                                                     AS totalAmt,
    COUNT(*)                                                                           AS billCount
  FROM vInvoice_Recpt_Amt vra
  JOIN mParty p ON p.pkPartyID = vra.fkPartyID AND p.Active = 'Y'
  WHERE vra.BillStatus = 'N'
    AND vra.BalanceAmt > 0.001
    AND vra.BillType IN ('GODRENT', 'HMLI', 'GEN')`;

const MONTH_BILL_SQL = `
  SELECT SUM(cnt) AS billCount, ROUND(SUM(amt), 2) AS billAmt
  FROM (
    SELECT COUNT(*) AS cnt, COALESCE(SUM(IFNULL(NetAmt, GrossAmt)), 0) AS amt
    FROM tBillTrHmGen1 WHERE BillDt >= ?
    UNION ALL
    SELECT COUNT(*) AS cnt, COALESCE(SUM(IFNULL(NetAmt, GrossAmt)), 0) AS amt
    FROM tBill1 WHERE BillDt >= ?
  ) _b`;

const MONTH_RCPT_SQL = `
  SELECT COUNT(*) AS rcptCount, COALESCE(SUM(RecptAmt), 0) AS rcptAmt
  FROM tRecpt1 WHERE RecptDt >= ?`;

const AGREEMENTS_SQL = `
  SELECT d.pkDocID, d.DocType, d.DocDiscrption, d.FromDt, d.ToDt, d.Note,
         p.pName AS PartyName, g.gNum AS GodownNum,
         DATEDIFF(d.ToDt, CURDATE()) AS daysLeft
  FROM DocumentsFile d
  LEFT JOIN mParty  p ON p.pkPartyID  = d.fkPartyID
  LEFT JOIN mGodown g ON g.pkGodownID = d.fkGodownID
  WHERE d.Active = 'Y' AND LOWER(d.DocType) LIKE '%agreement%'
  ORDER BY d.ToDt ASC LIMIT 30`;

const PACK_TREND_SQL = `
  SELECT
    DATE_FORMAT(s.TransDt, '%Y-%m-%d') AS TransDt,
    CASE WHEN s.TransType IN ('ARV','IN','DESPRET') THEN 'ARV' ELSE 'DSP' END AS TransGroup,
    COALESCE(
      NULLIF(TRIM(
        CASE WHEN s.TransType = 'ARV' THEN s.Packing
             ELSE COALESCE(NULLIF(s.Packing, ''), a.Packing) END
      ), ''),
      'Unassigned'
    ) AS Packing,
    ROUND(SUM(
      ABS(s.TransQty) *
      CASE WHEN s.TransType = 'ARV' THEN COALESCE(s.PackWght, 0)
           ELSE COALESCE(a.PackWght, 0) END
    ) / 1000, 2) AS tons
  FROM tStockEntry s
  LEFT JOIN (
    SELECT pfkLotID, MAX(PackWght) AS PackWght, MAX(Packing) AS Packing
    FROM tStockEntry
    WHERE TransType = 'ARV' AND OpFlg = 'N'
    GROUP BY pfkLotID
  ) a ON a.pfkLotID = s.pfkOriLotID
  WHERE s.TransType IN ('ARV','IN','DESPRET','DESP','OUT')
    AND s.TransDt >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
  GROUP BY
    DATE_FORMAT(s.TransDt, '%Y-%m-%d'),
    CASE WHEN s.TransType IN ('ARV','IN','DESPRET') THEN 'ARV' ELSE 'DSP' END,
    COALESCE(
      NULLIF(TRIM(
        CASE WHEN s.TransType = 'ARV' THEN s.Packing
             ELSE COALESCE(NULLIF(s.Packing, ''), a.Packing) END
      ), ''),
      'Unassigned'
    )
  ORDER BY TransDt, TransGroup, Packing`;

const PACK_MONTH_SQL = `
  SELECT
    DATE_FORMAT(s.TransDt, '%Y-%m') AS TransMon,
    CASE WHEN s.TransType IN ('ARV','IN','DESPRET') THEN 'ARV' ELSE 'DSP' END AS TransGroup,
    COALESCE(
      NULLIF(TRIM(
        CASE WHEN s.TransType = 'ARV' THEN s.Packing
             ELSE COALESCE(NULLIF(s.Packing, ''), a.Packing) END
      ), ''),
      'Unassigned'
    ) AS Packing,
    ROUND(SUM(
      ABS(s.TransQty) *
      CASE WHEN s.TransType = 'ARV' THEN COALESCE(s.PackWght, 0)
           ELSE COALESCE(a.PackWght, 0) END
    ) / 1000, 2) AS tons
  FROM tStockEntry s
  LEFT JOIN (
    SELECT pfkLotID, MAX(PackWght) AS PackWght, MAX(Packing) AS Packing
    FROM tStockEntry
    WHERE TransType = 'ARV' AND OpFlg = 'N'
    GROUP BY pfkLotID
  ) a ON a.pfkLotID = s.pfkOriLotID
  WHERE s.TransType IN ('ARV','IN','DESPRET','DESP','OUT')
    AND s.TransDt >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
  GROUP BY
    DATE_FORMAT(s.TransDt, '%Y-%m'),
    CASE WHEN s.TransType IN ('ARV','IN','DESPRET') THEN 'ARV' ELSE 'DSP' END,
    COALESCE(
      NULLIF(TRIM(
        CASE WHEN s.TransType = 'ARV' THEN s.Packing
             ELSE COALESCE(NULLIF(s.Packing, ''), a.Packing) END
      ), ''),
      'Unassigned'
    )
  ORDER BY TransMon, TransGroup, Packing`;

const RECENT_ARV_SQL = `
  SELECT s.TransDt, s.TransTm, s.LotNum, p.pName, i.iName AS ItemName,
         s.ItemExtDesc, s.TransQty, s.Packing, s.TransType
  FROM tStockEntry s
  LEFT JOIN mParty p ON p.pkPartyID = s.fkPartyID
  LEFT JOIN mItem  i ON i.pkItemID  = s.fkItemID
  WHERE s.TransType IN ('ARV','IN','DESPRET')
  ORDER BY s.TransDt DESC, s.TransTm DESC LIMIT 8`;

const RECENT_DSP_SQL = `
  SELECT s.TransDt, s.TransTm, s.LotNum, s.GatePass, p.pName, i.iName AS ItemName,
         s.ItemExtDesc, s.TransQty, s.Packing, s.TransType
  FROM tStockEntry s
  LEFT JOIN mParty p ON p.pkPartyID = s.fkPartyID
  LEFT JOIN mItem  i ON i.pkItemID  = s.fkItemID
  WHERE s.TransType IN ('DESP','TRF','OUT')
  ORDER BY s.TransDt DESC, s.TransTm DESC LIMIT 8`;

// Run all full-dashboard queries for one company DB in parallel.
async function queryOneDB(db, today, monthStart) {
  const [stats, aging, outstanding, outBill, monthBill, monthRcpt, agreements, recentArv, recentDsp, packTrend, packMonth]
    = await Promise.all([
      sq(db, STATS_SQL,            [today, today, today, today, today, today, today, monthStart]),
      sq(db, AGING_SQL,            []),
      sq(db, OUTSTANDING_SQL,      []),
      sq(db, OUTSTANDING_BILL_SQL, []),
      sq(db, MONTH_BILL_SQL,       [monthStart, monthStart]),
      sq(db, MONTH_RCPT_SQL,       [monthStart]),
      sq(db, AGREEMENTS_SQL,       []),
      sq(db, RECENT_ARV_SQL,       []),
      sq(db, RECENT_DSP_SQL,       []),
      sq(db, PACK_TREND_SQL,       []),
      sq(db, PACK_MONTH_SQL,       []),
    ]);
  return { stats, aging, outstanding, outBill, monthBill, monthRcpt, agreements, recentArv, recentDsp, packTrend, packMonth };
}

// Aggregate results from multiple company DBs into one dashboard payload.
function aggregate(compResults) {
  const valid = compResults.filter(Boolean);

  // Sum stats
  const st = valid.reduce((acc, c) => {
    const s = c.stats?.[0] || {};
    return {
      todayArvCnt:  acc.todayArvCnt  + n(s.todayArvCnt),
      todayArvQty:  acc.todayArvQty  + n(s.todayArvQty),
      todayArvTons: acc.todayArvTons + n(s.todayArvTons),
      todayDspCnt:  acc.todayDspCnt  + n(s.todayDspCnt),
      todayDspTons: acc.todayDspTons + n(s.todayDspTons),
      todayDspQty: acc.todayDspQty + n(s.todayDspQty),
      monthArvCnt: acc.monthArvCnt + n(s.monthArvCnt),
      monthArvQty: acc.monthArvQty + n(s.monthArvQty),
      monthArvTons: acc.monthArvTons + n(s.monthArvTons),
      monthDspCnt: acc.monthDspCnt + n(s.monthDspCnt),
      monthDspQty: acc.monthDspQty + n(s.monthDspQty),
      monthDspTons: acc.monthDspTons + n(s.monthDspTons),
    };
  }, { todayArvCnt:0, todayArvQty:0, todayArvTons:0, todayDspCnt:0, todayDspQty:0, todayDspTons:0,
       monthArvCnt:0, monthArvQty:0, monthArvTons:0,
       monthDspCnt:0, monthDspQty:0, monthDspTons:0 });

  // Merge aging buckets
  const agingMap = {};
  for (const c of valid) {
    for (const r of (c.aging || [])) {
      if (!agingMap[r.ageBucket])
        agingMap[r.ageBucket] = { lotCount: 0, totalQty: 0, totalTons: 0 };
      agingMap[r.ageBucket].lotCount  += n(r.lotCount);
      agingMap[r.ageBucket].totalQty  += n(r.totalQty);
      agingMap[r.ageBucket].totalTons += n(r.totalTons);
    }
  }
  const agingRows = Object.entries(agingMap)
    .map(([ageBucket, v]) => ({ ageBucket, lotCount: v.lotCount, totalQty: v.totalQty, totalTons: v.totalTons }));

  // Merge outstanding by party name (same party can appear in multiple company DBs)
  const outMap = {};
  for (const c of valid) {
    for (const r of (c.outstanding || [])) {
      const key = r.pName || '?';
      if (!outMap[key]) outMap[key] = { pName: key, billCount: 0, outstandingAmt: 0 };
      outMap[key].billCount    += n(r.billCount);
      outMap[key].outstandingAmt = Math.round((outMap[key].outstandingAmt + n(r.outstandingAmt)) * 100) / 100;
    }
  }
  const outstanding = Object.values(outMap)
    .filter(r => r.outstandingAmt > 0.01)
    .sort((a, b) => b.outstandingAmt - a.outstandingAmt)
    .slice(0, 10);

  // Sum monthly billing / receipts
  const monthBill = valid.reduce((acc, c) => ({
    billCount: acc.billCount + n(c.monthBill?.[0]?.billCount),
    billAmt:   Math.round((acc.billAmt + n(c.monthBill?.[0]?.billAmt)) * 100) / 100,
  }), { billCount: 0, billAmt: 0 });

  const monthRcpt = valid.reduce((acc, c) => ({
    rcptCount: acc.rcptCount + n(c.monthRcpt?.[0]?.rcptCount),
    rcptAmt:   Math.round((acc.rcptAmt + n(c.monthRcpt?.[0]?.rcptAmt)) * 100) / 100,
  }), { rcptCount: 0, rcptAmt: 0 });

  const outBill = valid.reduce((acc, c) => ({
    godrentAmt: Math.round((acc.godrentAmt + n(c.outBill?.[0]?.godrentAmt)) * 100) / 100,
    hamaliAmt:  Math.round((acc.hamaliAmt  + n(c.outBill?.[0]?.hamaliAmt))  * 100) / 100,
    genAmt:     Math.round((acc.genAmt     + n(c.outBill?.[0]?.genAmt))     * 100) / 100,
    totalAmt:   Math.round((acc.totalAmt   + n(c.outBill?.[0]?.totalAmt))   * 100) / 100,
    billCount:  acc.billCount + n(c.outBill?.[0]?.billCount),
  }), { godrentAmt: 0, hamaliAmt: 0, genAmt: 0, totalAmt: 0, billCount: 0 });

  // Merge agreements, keep sorted by expiry
  const agreements = valid
    .flatMap(c => c.agreements || [])
    .sort((a, b) => new Date(a.ToDt) - new Date(b.ToDt))
    .slice(0, 30);

  // Merge recent arrivals/dispatches, sort by time descending, keep top 8
  const recentArv = valid
    .flatMap(c => c.recentArv || [])
    .sort((a, b) => new Date(b.TransTm || 0) - new Date(a.TransTm || 0))
    .slice(0, 8);

  const recentDsp = valid
    .flatMap(c => c.recentDsp || [])
    .sort((a, b) => new Date(b.TransTm || 0) - new Date(a.TransTm || 0))
    .slice(0, 8);

  // Merge 7-day packing trend: keys are 'arv_Bags', 'dsp_Drums', etc.
  const packMap = {}; // { 'YYYY-MM-DD': { 'arv_Bags': tons, 'dsp_Drums': tons, ... } }
  const arvPacks = new Set();
  const dspPacks = new Set();
  for (const c of valid) {
    for (const r of (c.packTrend || [])) {
      const dt    = r.TransDt || '';
      const pack  = r.Packing || '';
      const grp   = r.TransGroup || '';
      if (!dt || !pack || !grp) continue;
      const key = `${grp.toLowerCase()}_${pack}`;
      if (!packMap[dt]) packMap[dt] = {};
      packMap[dt][key] = Math.round(((packMap[dt][key] || 0) + n(r.tons)) * 100) / 100;
      if (grp === 'ARV') arvPacks.add(pack);
      else               dspPacks.add(pack);
    }
  }
  // Build full 7-day series (fill missing dates with 0)
  const allPacks = new Set([...arvPacks, ...dspPacks]);
  const packTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = { date: dt };
    for (const p of allPacks) {
      entry[`arv_${p}`] = packMap[dt]?.[`arv_${p}`] || 0;
      entry[`dsp_${p}`] = packMap[dt]?.[`dsp_${p}`] || 0;
    }
    packTrend.push(entry);
  }

  const arvPackNames = [...arvPacks].sort();
  const dspPackNames = [...dspPacks].sort();

  // Merge 6-month packing trend
  const packMonthMap = {};
  const arvMonthPacks = new Set();
  const dspMonthPacks = new Set();
  for (const c of valid) {
    for (const r of (c.packMonth || [])) {
      const mo   = r.TransMon || '';
      const pack = r.Packing  || '';
      const grp  = r.TransGroup || '';
      if (!mo || !pack || !grp) continue;
      const key = `${grp.toLowerCase()}_${pack}`;
      if (!packMonthMap[mo]) packMonthMap[mo] = {};
      packMonthMap[mo][key] = Math.round(((packMonthMap[mo][key] || 0) + n(r.tons)) * 100) / 100;
      if (grp === 'ARV') arvMonthPacks.add(pack);
      else               dspMonthPacks.add(pack);
    }
  }
  const allMonthPacks = new Set([...arvMonthPacks, ...dspMonthPacks]);
  const packMonthTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = { month: mo };
    for (const p of allMonthPacks) {
      entry[`arv_${p}`] = packMonthMap[mo]?.[`arv_${p}`] || 0;
      entry[`dsp_${p}`] = packMonthMap[mo]?.[`dsp_${p}`] || 0;
    }
    packMonthTrend.push(entry);
  }

  return {
    st, agingRows, outstanding, outBill, monthBill, monthRcpt, agreements, recentArv, recentDsp,
    packTrend,
    arvPackNames,
    dspPackNames,
    packMonthTrend,
    arvPackNamesMonth: [...arvMonthPacks].sort(),
    dspPackNamesMonth: [...dspMonthPacks].sort(),
  };
}

// ── GET /api/dashboard ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { roleID, groupID } = req.user;
    const _now       = new Date();
    const today      = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
    const monthStart = today.slice(0, 7) + '-01';
    const isAdmin    = ADMIN_ROLES.includes(roleID);

    // ── NON-ADMIN: return only today's arrival & dispatch entries ─────────────
    if (!isAdmin) {
      const db = req.db;
      const [todayArv, todayDsp] = await Promise.all([
        sq(db, `
          SELECT s.TransDt, s.LotNum, p.pName, i.iName AS ItemName,
                 s.ItemExtDesc, s.TransQty, s.Packing, s.TransType
          FROM tStockEntry s
          LEFT JOIN mParty p ON p.pkPartyID = s.fkPartyID
          LEFT JOIN mItem  i ON i.pkItemID  = s.fkItemID
          WHERE s.TransType IN ('ARV','IN','DESPRET') AND s.TransDt = ?
          ORDER BY s.TransTm ASC
        `, [today]),
        sq(db, `
          SELECT s.TransDt, s.LotNum, s.GatePass, p.pName, i.iName AS ItemName,
                 s.ItemExtDesc, s.TransQty, s.Packing, s.TransType
          FROM tStockEntry s
          LEFT JOIN mParty p ON p.pkPartyID = s.fkPartyID
          LEFT JOIN mItem  i ON i.pkItemID  = s.fkItemID
          WHERE s.TransType IN ('DESP','TRF','OUT') AND s.TransDt = ?
          ORDER BY s.TransTm ASC
        `, [today]),
      ]);

      return res.json({
        mode:    'simple',
        todayArv: todayArv || [],
        todayDsp: todayDsp || [],
      });
    }

    // ── ADMIN: aggregate data from ALL group companies in parallel ────────────
    const groupComps = connectionManager.getGroupCompanyDetails(groupID);

    const compResults = await Promise.all(
      groupComps.map(async (comp) => {
        const db = connectionManager.getDB(comp.pkCompID);
        if (!db) return null;
        return queryOneDB(db, today, monthStart);
      })
    );

    const {
      st, agingRows, outstanding, outBill, monthBill, monthRcpt, agreements, recentArv, recentDsp,
      packTrend, arvPackNames, dspPackNames,
      packMonthTrend, arvPackNamesMonth, dspPackNamesMonth,
    } = aggregate(compResults);

    const stockSummary = agingRows.reduce(
      (acc, r) => ({
        totalLots: acc.totalLots + r.lotCount,
        totalQty:  acc.totalQty  + r.totalQty,
        totalTons: Math.round((acc.totalTons + n(r.totalTons)) * 100) / 100,
      }),
      { totalLots: 0, totalQty: 0, totalTons: 0 }
    );

    return res.json({
      mode:         'full',
      todayArv:     { cnt: n(st.todayArvCnt), totalQty: n(st.todayArvQty), totalTons: n(st.todayArvTons) },
      todayDsp:     { cnt: n(st.todayDspCnt), totalQty: n(st.todayDspQty), totalTons: n(st.todayDspTons) },
      monthArv:     { cnt: n(st.monthArvCnt), totalQty: n(st.monthArvQty), totalTons: n(st.monthArvTons) },
      monthDsp:     { cnt: n(st.monthDspCnt), totalQty: n(st.monthDspQty), totalTons: n(st.monthDspTons) },
      stockSummary,
      lotAging:     agingRows,
      outstanding,
      outstandingBill: outBill,
      monthBill,
      monthRcpt,
      agreements,
      recentArv,
      recentDsp,
      packTrend,
      arvPackNames,
      dspPackNames,
      packMonthTrend,
      arvPackNamesMonth,
      dspPackNamesMonth,
    });

  } catch (err) {
    console.error('[dashboard] fatal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
