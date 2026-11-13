// balanceReport.js — /api/reports/balance-report
// VB6 origin: frmReport.frm (class: frmBalReport)
//
// Endpoints:
//   GET  /filters            — Q1: parties, items, godowns, party groups for filter panels
//   POST /balances           — Q3: main balance grid (lot-level with godown breakdown)
//   GET  /lot-detail/:lotId  — Q4: lot ledger with opening balance UNION ALL transactions
//   POST /report             — Crystal Report placeholder (4 report types)
//
// Authorization: all routes require BAL_REP / CanView permission.
//
// Crystal Report mapping (VB6 → web placeholders):
//   drsPartyBalDetail → reportType = 'party-bal-detail'
//   drsPartyBal       → reportType = 'party-bal'
//   drsLotDetail      → reportType = 'lot-wise'
//   drsGodownBal      → reportType = 'godown-bal'
//
// SQL notes:
//   vStkTransQty   — confirmed view (views.sql): GodownQty = +ve for ARV, -ve for DESP
//   vLotArv_1      — confirmed view (views.sql): latest + earliest ARV per lot side by side
//   tStockEntry    — base arrivals/dispatch table; fkCompID required for multi-company filter
//   Opening balance — SUM(TransQty) WHERE TransDt < startDate for the lot (all trans types)

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePerm       = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');

router.use(requireAuth);

// ── GET /filters ───────────────────────────────────────────────────────────────
// Returns party groups, parties, items, and godowns for the 4 filter panels.
// VB6: udfGeneralTab_Load — fills 4 MSHFlexGrid combo panels.
//
// Party Group & Party Name: cross-DB UNION ALL via `dbName`.mParty (same pattern
//   as /api/masters/parties/vam) — runs through req.db, no per-company connections.
//   No fkBranchID filter: parties may be registered under a different branch.
// Item Name & Godown No: current company only (mItem/mGodown use fkCompID).
router.get('/filters', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  try {
    const db             = req.db;
    const { groupID, compID } = req.user;
    const groupCompanies = connectionManager.getGroupCompanyDetails(groupID);

    let partyGroupRows = [];
    let rawParties     = [];

    if (groupCompanies.length > 1) {
      // Cross-DB UNION ALL — mirrors party.js /vam pattern
      const pgParts = groupCompanies.map(({ dbName, pkCompID, CompAlias }) =>
        `SELECT DISTINCT pGroup, '${pkCompID}' AS cID, '${(CompAlias || '').replace(/'/g, "''")}' AS compAlias ` +
        `FROM \`${dbName}\`.mParty WHERE Active='Y' AND pGroup IS NOT NULL AND pGroup <> ''`
      );
      const pParts = groupCompanies.map(({ dbName }) =>
        `SELECT pkPartyID, pName, pCode, pGroup, fkCompID FROM \`${dbName}\`.mParty WHERE Active='Y'`
      );

      const [pgRaw] = await db.query(pgParts.join(' UNION ALL '));
      const [pRaw]  = await db.query(
        `SELECT * FROM (${pParts.join(' UNION ALL ')}) _p ORDER BY pName`
      );

      const seenGroups = new Set();
      partyGroupRows = pgRaw
        .sort((a, b) => a.pGroup.localeCompare(b.pGroup))
        .filter((r) => { if (seenGroups.has(r.pGroup)) return false; seenGroups.add(r.pGroup); return true; })
        .map((r) => ({ pkGrpID: r.pGroup, GrpName: r.pGroup, compAlias: r.compAlias }));
      rawParties = pRaw;
    } else {
      const [pgRaw] = await db.query(
        `SELECT DISTINCT pGroup FROM mParty WHERE Active='Y' AND pGroup IS NOT NULL AND pGroup <> '' ORDER BY pGroup`
      );
      const [pRaw] = await db.query(
        `SELECT pkPartyID, pName, pCode, pGroup, fkCompID FROM mParty WHERE Active='Y' ORDER BY pName`
      );
      partyGroupRows = pgRaw.map((r) => ({ pkGrpID: r.pGroup, GrpName: r.pGroup, compAlias: '' }));
      rawParties = pRaw;
    }

    const [[itemRows], [godownRows]] = await Promise.all([
      db.query(
        `SELECT pkItemID, iName FROM mItem WHERE fkCompID=? AND Active='Y' ORDER BY iName`,
        { replacements: [compID] }
      ),
      db.query(
        `SELECT pkGodownID, gNum FROM mGodown WHERE fkCompID=? AND Active='Y' ORDER BY CAST(gNum AS UNSIGNED), gNum`,
        { replacements: [compID] }
      ),
    ]);

    res.json({ partyGroups: partyGroupRows, parties: rawParties, items: itemRows, godowns: godownRows });
  } catch (err) {
    console.error('[BalanceRep /filters]', err.message);
    res.status(500).json({ error: `Failed to load filter data: ${err.message}` });
  }
});


// ── balanceQueryAllCompanies ───────────────────────────────────────────────────
// Hybrid cross-company balance query:
//
// Step 1 — cross-DB UNION ALL via `dbName`.tStockEntry through a SINGLE db
//           connection (req.db).  Plain table references are fast cross-DB.
//
// Step 2 — per-company, using each company's OWN Sequelize connection.
//           Replaces the vLotArv_1 view with an inline derived table that
//           pre-filters tStockEntry to only the needed lot IDs BEFORE applying
//           the window function — avoids full-table materialisation.
//
// Returns raw DB rows (one row per lot × godown) — caller collapses into lot map.
async function balanceQueryAllCompanies(db, branchID, fyStartMinus1, endDate, groupCompanies, partyIds, partyGroups, itemIds, godownIds) {
  const pGroupPhs = partyGroups.map(() => '?').join(',');

  // ── Step 1: candidate pfkOriLotID values (cross-DB UNION ALL) ────────────────
  const s1Parts  = [];
  const s1Params = [];

  for (const { dbName, pkCompID } of groupCompanies) {
    const cParams = [pkCompID, fyStartMinus1, endDate];
    const cExtra  = [];

    const compPids = partyIds.filter((pid) => pid.split('!')[0] === pkCompID);
    if (partyIds.length > 0) {
      if (compPids.length === 0) continue;
      cExtra.push(`fkPartyID IN (${compPids.map(() => '?').join(',')})`);
      cParams.push(...compPids);
    } else if (partyGroups.length > 0) {
      cExtra.push(`fkPartyID IN (SELECT pkPartyID FROM \`${dbName}\`.mParty WHERE Active='Y' AND pGroup IN (${pGroupPhs}))`);
      cParams.push(...partyGroups);
    }
    if (itemIds.length > 0) {
      cExtra.push(`fkItemID IN (${itemIds.map(() => '?').join(',')})`);
      cParams.push(...itemIds);
    }
    if (godownIds.length > 0) {
      cExtra.push(`pfkOriLotID IN (SELECT pfkOriLotID FROM \`${dbName}\`.vStkTransQty WHERE fkCompID=? AND fkGodownID IN (${godownIds.map(() => '?').join(',')}) GROUP BY pfkOriLotID HAVING SUM(GodownQty)>0)`);
      cParams.push(pkCompID, ...godownIds);
    }

    s1Parts.push(
      `(SELECT DISTINCT pfkOriLotID, fkCompID FROM \`${dbName}\`.tStockEntry
        WHERE fkCompID=? AND DATE(TransDt)>=? AND DATE(TransDt)<=? AND TransType='ARV'
          AND fkItemID NOT IN (SELECT pkItemID FROM \`${dbName}\`.mItem WHERE iType='SPC')
        ${cExtra.length ? 'AND ' + cExtra.join(' AND ') : ''})`
    );
    s1Params.push(...cParams);
  }

  if (s1Parts.length === 0) return [];

  const [s1Rows] = await db.query(s1Parts.join(' UNION ALL '), { replacements: s1Params });
  if (s1Rows.length === 0) return [];

  // Split lot IDs by owning company
  const lotsByComp = new Map();
  for (const { pfkOriLotID, fkCompID } of s1Rows) {
    if (!lotsByComp.has(fkCompID)) lotsByComp.set(fkCompID, []);
    lotsByComp.get(fkCompID).push(pfkOriLotID);
  }

  // ── Step 2: per-company, using each company's own connection ─────────────────
  // vLotArv_1 is a CTE + window function over ALL of tStockEntry — MySQL must
  // materialise the entire CTE before filtering, causing a full-table scan even
  // on a local connection.  We replace it with an inline derived table that
  // pre-filters tStockEntry to only the lot IDs we need BEFORE the window
  // function runs, so the window function only processes N lots' ARV rows.
  const allRawRows = [];

  for (const { pkCompID } of groupCompanies) {
    const lotIds = lotsByComp.get(pkCompID);
    if (!lotIds || lotIds.length === 0) continue;

    const cdb = connectionManager.getDB(pkCompID);
    if (!cdb) continue;

    const inPh = lotIds.map(() => '?').join(',');
    // cParams order: lotIds (inner subquery IN), pkCompID, branchID, endDate, lotIds (outer WHERE), ...party cond
    const cParams = [...lotIds, pkCompID, branchID, endDate, ...lotIds];
    let s2PartyCond = '';

    const compPids = partyIds.filter((pid) => pid.split('!')[0] === pkCompID);
    if (partyIds.length > 0 && compPids.length > 0) {
      s2PartyCond = `AND vtq.fkPartyID IN (${compPids.map(() => '?').join(',')})`;
      cParams.push(...compPids);
    } else if (partyGroups.length > 0) {
      s2PartyCond = `AND vtq.fkPartyID IN (SELECT pkPartyID FROM mParty WHERE fkCompID=? AND Active='Y' AND pGroup IN (${pGroupPhs}))`;
      cParams.push(pkCompID, ...partyGroups);
    }

    console.log('[BalanceRep Step2]', pkCompID, 'lots=', lotIds.length, 'params=', cParams.length);
    const [rows] = await cdb.query(
      `SELECT vtq.pfkOriLotID, la.LotNum_Let, vtq.fkPartyID, vtq.fkItemID,
              SUM(vtq.GodownQty) AS BalQty,
              la.ItemExtDesc_Let, la.TransDt_Ori, la.Packing_Let, la.TransQty_Ori,
              la.PackWght, la.RentRate_Let, la.ActualWght, la.VehiNum, la.BENum,
              la.DoNum_Ori, gm.gNum, im.iName, pm.pName, pm.pEmail, pm.pGroup,
              vtq.fkCompID, la.OriTransDt, la.OriTransQty, la.GrossWght, la.PackingType,
              la.PackingColour, la.TransExtDetail, la.BatchNum, la.DelivOpt, la.TransRemark,
              la.pkTransID, la.TransNote, la.UserID, la.HamaliRecd, la.HamaliCode, la.OwnTransFlg
       FROM vStkTransQty AS vtq
       LEFT JOIN (
         SELECT
           pfkOriLotID,
           MAX(CASE WHEN rn_max=1 THEN LotNum        END) AS LotNum_Let,
           MAX(CASE WHEN rn_min=1 THEN TransDt       END) AS TransDt_Ori,
           MAX(CASE WHEN rn_min=1 THEN TransQty      END) AS TransQty_Ori,
           MAX(CASE WHEN rn_max=1 THEN Packing       END) AS Packing_Let,
           MAX(CASE WHEN rn_min=1 THEN PackWght      END) AS PackWght,
           MAX(CASE WHEN rn_max=1 THEN RentRate      END) AS RentRate_Let,
           MAX(CASE WHEN rn_min=1 THEN ActualWght    END) AS ActualWght,
           MAX(CASE WHEN rn_min=1 THEN VehiNum       END) AS VehiNum,
           MAX(CASE WHEN rn_min=1 THEN BENum         END) AS BENum,
           MAX(CASE WHEN rn_min=1 THEN DoNum         END) AS DoNum_Ori,
           MAX(CASE WHEN rn_max=1 THEN OriTransDt    END) AS OriTransDt,
           MAX(CASE WHEN rn_max=1 THEN OriTransQty   END) AS OriTransQty,
           MAX(CASE WHEN rn_min=1 THEN GrossWght     END) AS GrossWght,
           MAX(CASE WHEN rn_min=1 THEN PackingType   END) AS PackingType,
           MAX(CASE WHEN rn_min=1 THEN PackingColour END) AS PackingColour,
           MAX(CASE WHEN rn_min=1 THEN TransExtDetail END) AS TransExtDetail,
           MAX(CASE WHEN rn_min=1 THEN BatchNum      END) AS BatchNum,
           MAX(CASE WHEN rn_min=1 THEN DelivOpt      END) AS DelivOpt,
           MAX(CASE WHEN rn_min=1 THEN TransRemark   END) AS TransRemark,
           MAX(CASE WHEN rn_min=1 THEN pkTransID     END) AS pkTransID,
           MAX(CASE WHEN rn_min=1 THEN TransNote     END) AS TransNote,
           MAX(CASE WHEN rn_max=1 THEN UserID        END) AS UserID,
           MAX(CASE WHEN rn_max=1 THEN HamaliRecd    END) AS HamaliRecd,
           MAX(CASE WHEN rn_max=1 THEN HamaliCode    END) AS HamaliCode,
           MAX(CASE WHEN rn_min=1 THEN OwnTransFlg   END) AS OwnTransFlg,
           MAX(CASE WHEN rn_max=1 THEN ItemExtDesc   END) AS ItemExtDesc_Let,
           MAX(CASE WHEN rn_max=1 THEN fkItemID      END) AS fkItemID_Let
         FROM (
           SELECT *,
             ROW_NUMBER() OVER (PARTITION BY pfkOriLotID ORDER BY TransDt DESC, FaYear DESC) AS rn_max,
             ROW_NUMBER() OVER (PARTITION BY pfkOriLotID ORDER BY TransDt ASC,  FaYear ASC)  AS rn_min
           FROM tStockEntry
           WHERE TransType = 'ARV' AND pfkOriLotID IN (${inPh})
         ) _arv
         GROUP BY pfkOriLotID
       ) la ON la.pfkOriLotID = vtq.pfkOriLotID
       LEFT JOIN mParty  AS pm ON vtq.fkPartyID   = pm.pkPartyID
       LEFT JOIN mItem   AS im ON la.fkItemID_Let = im.pkItemID
       LEFT JOIN mGodown AS gm ON vtq.fkGodownID  = gm.pkGodownID
       WHERE vtq.fkCompID=? AND vtq.fkBranchID=? AND vtq.OpFlg='N'
         AND DATE(vtq.TransDt)<=? AND vtq.pfkOriLotID IN (${inPh})
         ${s2PartyCond}
       GROUP BY vtq.pfkOriLotID, la.LotNum_Let, vtq.fkPartyID, vtq.fkItemID,
         la.ItemExtDesc_Let, la.TransDt_Ori, la.Packing_Let, la.TransQty_Ori, la.PackWght,
         la.RentRate_Let, la.ActualWght, la.VehiNum, la.BENum, la.DoNum_Ori,
         pm.pName, pm.pEmail, pm.pGroup, im.iName, gm.gNum, vtq.fkCompID,
         la.OriTransDt, la.OriTransQty, la.GrossWght, la.PackingType, la.PackingColour,
         la.TransExtDetail, la.BatchNum, la.DelivOpt, la.TransRemark,
         la.pkTransID, la.TransNote, la.UserID, la.HamaliRecd, la.HamaliCode, la.OwnTransFlg`,
      { replacements: cParams }
    );
    console.log('[BalanceRep Step2]', pkCompID, 'rows=', rows.length);
    allRawRows.push(...rows);
  }

  return allRawRows;
}

// ── POST /balances ─────────────────────────────────────────────────────────────
// Go button: build main balance grid.
// VB6: udfOpDetailResultset → udfPopupBalRep
//
// Body:
//   startDate?     : 'yyyy-mm-dd'   (optional)
//   endDate        : 'yyyy-mm-dd'   (required)
//   partyIds?      : string[]       (pkPartyID values — may span multiple company DBs)
//   partyGroups?   : string[]       (pGroup names)
//   itemIds?       : string[]
//   godownIds?     : string[]
//   sortBy?        : 'LotNum' | 'pName' | 'iName'
//
// Cross-company: uses balanceQueryAllCompanies — cross-DB UNION ALL via `dbName`.tableName
// through a single req.db connection.  pkPartyID = 'CompID!BranchID!N' is used to
// route partyIds to the correct company's Step 1/Step 2 partition.
router.post('/balances', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;

    const {
      endDate,
      partyIds    = [],
      partyGroups = [],
      itemIds     = [],
      godownIds   = [],
      sortBy      = 'LotNum',
    } = req.body;

    if (!endDate) return res.status(400).json({ error: 'endDate is required' });

    // FY start date (April 1) → step back one day to capture March 31 opening-balance ARVs
    const fyStartMinus1 = (() => {
      const ref  = new Date(endDate);
      const year = ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1;
      return new Date(year, 3, 0).toISOString().slice(0, 10); // March 31
    })();

    // All group companies (BHW → [ADS, TEST], MUM → [VLCO, TEST1], etc.)
    const groupCompanies = connectionManager.getGroupCompanyDetails(groupID);
    console.log('[BalanceRep /balances] groupID=', groupID, 'companies=', groupCompanies.map(c => `${c.pkCompID}→${c.dbName}`));

    // Cross-DB UNION ALL — single req.db connection, `dbName`.tableName references
    const allRawRows = await balanceQueryAllCompanies(
      req.db, branchID, fyStartMinus1, endDate,
      groupCompanies, partyIds, partyGroups, itemIds, godownIds
    );

    // ── Collapse per-godown rows → one lot row (VB6 grid-fill loop) ───────────
    // Step 2 returns N rows per lot (one per godown); accumulate balance + godQty.
    const lotMap = new Map();

    for (const row of allRawRows) {
      const id  = row.pfkOriLotID;
      const qty = parseFloat(row.BalQty) || 0;

      if (!lotMap.has(id)) {
        lotMap.set(id, {
          pfkOriLotID:    id,
          LotNum:         row.LotNum_Let      || '',
          pName:          row.pName           || '',
          pEmail:         row.pEmail          || '',
          pGroup:         row.pGroup          || '',
          iName:          row.iName           || '',
          fkPartyID:      row.fkPartyID,
          fkItemID:       row.fkItemID,
          fkCompID:       row.fkCompID,
          pkTransID:      row.pkTransID,
          ItemExtDesc:    row.ItemExtDesc_Let || '',
          OriTransDt:     row.OriTransDt,
          Packing:        row.Packing_Let     || '',
          OriTransQty:    row.OriTransQty,
          PackWght:       row.PackWght,
          RentRate:       row.RentRate_Let,
          ActualWght:     row.ActualWght,
          VehiNum:        row.VehiNum,
          BENum:          row.BENum,
          DoNum:          row.DoNum_Ori       || '',
          GrossWght:      row.GrossWght,
          PackingType:    row.PackingType,
          PackingColour:  row.PackingColour,
          TransExtDetail: row.TransExtDetail,
          BatchNum:       row.BatchNum,
          DelivOpt:       row.DelivOpt,
          TransRemark:    row.TransRemark,
          TransNote:      row.TransNote,
          UserID:         row.UserID,
          HamaliRecd:     row.HamaliRecd,
          HamaliCode:     row.HamaliCode,
          OwnTransFlg:    row.OwnTransFlg,
          balance:        0,
          _godParts:      [],
        });
      }

      const lot = lotMap.get(id);
      lot.balance += qty;
      if (row.gNum) lot._godParts.push(`${row.gNum} ~ ${parseFloat(qty.toFixed(4))}`);
    }

    const SORT_KEY = { LotNum: 'LotNum', pName: 'pName', iName: 'iName' };
    const sk = SORT_KEY[sortBy] || 'LotNum';

    const mainRows = [...lotMap.values()]
      .map(({ _godParts, ...rest }) => ({ ...rest, godQty: _godParts.join(', ') }))
      .sort((a, b) => String(a[sk] || '').localeCompare(String(b[sk] || '')));

    res.json({
      rows:  mainRows,
      empty: mainRows.length === 0,
    });
  } catch (err) {
    console.error('[BalanceRep /balances]', err.message);
    res.status(500).json({ error: `Failed to load balance data: ${err.message}` });
  }
});


// ── GET /batch-location/:lotId ────────────────────────────────────────────────
// Batch × Location balance panel: SUM(tstockentry_locbatch.Qty) per BatchNum +
// fkGodownID + fkLocationID for the given lot.
// ARV rows = positive qty, DESP/OUT rows = negative qty — SUM gives current balance.
// Query param: lotCompID (optional) — for cross-company lots.
router.get('/batch-location/:lotId', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  try {
    const lotId   = req.params.lotId;
    const { lotCompID } = req.query;
    const compID  = lotCompID || req.user.compID;
    const db      = (lotCompID && lotCompID !== req.user.compID)
      ? connectionManager.getDB(lotCompID)
      : req.db;

    const [rows] = await db.query(
      `SELECT lb.BatchNum,
              lb.fkGodownID,
              g.gNum          AS GodownNum,
              lb.fkLocationID,
              ml.LocationCode,
              ml.LocationName,
              SUM(lb.Qty)     AS BalQty
       FROM tstockentry_locbatch lb
       JOIN vatstockentry ts
         ON lb.cpkTransID COLLATE utf8mb4_unicode_ci = ts.pkTransID COLLATE utf8mb4_unicode_ci
       LEFT JOIN mGodown g
         ON lb.fkGodownID COLLATE utf8mb4_unicode_ci = g.pkGodownID COLLATE utf8mb4_unicode_ci
       LEFT JOIN mLocation ml
         ON lb.fkLocationID COLLATE utf8mb4_unicode_ci = ml.pkLocationID COLLATE utf8mb4_unicode_ci
       WHERE ts.pfkOriLotID COLLATE utf8mb4_unicode_ci = ?
         AND ts.fkCompID = ?
         AND ts.OpFlg = 'N'
       GROUP BY lb.BatchNum, lb.fkGodownID, g.gNum, lb.fkLocationID, ml.LocationCode, ml.LocationName
       HAVING BalQty <> 0
       ORDER BY lb.BatchNum, g.gNum, ml.LocationCode`,
      { replacements: [lotId, compID] }
    );

    res.json({ rows });
  } catch (err) {
    console.error('[BalanceRep /batch-location]', err.message);
    res.status(500).json({ error: `Failed to load batch/location data: ${err.message}` });
  }
});


// ── GET /lot-detail/:lotId ─────────────────────────────────────────────────────
// Row click: lot ledger (all movements) + optional opening balance row.
// VB6: udfOpDetailResultset1 → udfPopupBalRep1
//
// Query params:
//   startDate? : 'yyyy-mm-dd'  (if present, prepend opening-balance row SortOrd=1)
//   endDate    : 'yyyy-mm-dd'  (required)
//
// Running balance is computed in the frontend (VB6: udfPopupBalRep1 loop).
router.get('/lot-detail/:lotId', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  try {
    const lotId   = req.params.lotId;
    const { startDate, endDate, lotCompID } = req.query;

    // When the balance grid shows a cross-company lot (user in CompA views a CompB
    // party's lot), the frontend passes lotCompID = the lot's own fkCompID so we
    // query the correct company's DB instead of the logged-in user's DB.
    const compID = lotCompID || req.user.compID;
    const db     = (lotCompID && lotCompID !== req.user.compID)
      ? connectionManager.getDB(lotCompID)
      : req.db;

    if (!endDate) return res.status(400).json({ error: 'endDate query param is required' });

    const rows = [];

    // Opening balance row: SUM of all transactions before startDate
    if (startDate) {
      const [obRows] = await db.query(
        `SELECT COALESCE(SUM(ts.TransQty), 0) AS obQty
         FROM tStockEntry ts
         WHERE ts.pfkOriLotID = ? AND ts.fkCompID = ? AND ts.OpFlg = 'N'
           AND ts.TransDt < ?`,
        { replacements: [lotId, compID, startDate] }
      );
      const obQty = parseFloat(obRows[0]?.obQty || 0);
      rows.push({
        sortOrd: 1,
        TransDt: startDate,
        TransTm: null,
        TransQty: obQty,
        DoNum: null,
        gNum: null,
        GatePass: null,
        VehiNum: null,
        TransExtDetail: 'Opening Balance',
        DelivOpt: null,
        BatchNum: null,
        HamaliRecd: null,
        HamaliCode: null,
        OwnTransFlg: null,
        PickupBy: null,
        ActualWght: null,
        TransType: 'OB',
        pkTransID: null,
        TransNote: null,
        UserID: null,
        FaYear: null,
      });
    }

    // Ledger transactions in the period
    const dateFrom = startDate || '1900-01-01';
    const [txRows] = await db.query(
      `SELECT
         2 AS sortOrd,
         ts.TransDt,
         ts.TransTm,
         ts.TransQty,
         ts.DoNum,
         g.gNum,
         ts.GatePass,
         ts.VehiNum,
         ts.TransExtDetail,
         ts.DelivOpt,
         ts.BatchNum,
         ts.HamaliRecd,
         ts.HamaliCode,
         ts.OwnTransFlg,
         ts.PickupBy,
         ts.ActualWght,
         ts.TransType,
         ts.pkTransID,
         ts.TransNote,
         ts.UserID,
         ts.FaYear
       FROM tStockEntry ts
       LEFT JOIN mGodown g ON ts.fkGodownID1 = g.pkGodownID
       WHERE ts.pfkOriLotID = ? AND ts.fkCompID = ? AND ts.OpFlg = 'N'
         AND ts.TransDt BETWEEN ? AND ?
       ORDER BY ts.TransDt,
                CASE ts.TransType
                  WHEN 'ARV'     THEN 0   -- arrival first
                  WHEN 'IN'      THEN 1   -- transfer-in / return (additive)
                  WHEN 'DESPRET' THEN 1   -- despatch return      (additive)
                  ELSE                2   -- dispatches last
                END,
                ts.TransTm`,
      { replacements: [lotId, compID, dateFrom, endDate] }
    );

    rows.push(...txRows);
    res.json({ rows, empty: rows.length === 0 });
  } catch (err) {
    console.error('[BalanceRep /lot-detail]', err.message);
    res.status(500).json({ error: `Failed to load lot detail: ${err.message}` });
  }
});


// ── POST /report ───────────────────────────────────────────────────────────────
// View button: Crystal Report placeholder — 4 report types.
// VB6: udfShowRep → Crystal Report data queries
//
// Body:
//   reportType   : 'party-bal-detail' | 'party-bal' | 'lot-wise' | 'godown-bal'
//   startDate?   : 'yyyy-mm-dd'
//   endDate      : 'yyyy-mm-dd'
//   selectedLotIds : string[]   (pfkOriLotIDs of checked rows in main grid)
//   partyIds?    : string[]
//   itemIds?     : string[]
//   godownIds?   : string[]
//
// Note: VB6 Crystal Reports (drsPartyBalDetail, drsPartyBal, drsLotDetail, drsGodownBal)
// are not yet converted. Each reportType here runs the equivalent SQL and returns JSON.
// The frontend renders the data in a print window.
router.post('/report', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;
    const {
      reportType,
      startDate,
      endDate,
      selectedLotIds = [],
      partyIds       = [],
      itemIds        = [],
      godownIds      = [],
      includeZero    = false,
    } = req.body;

    if (!endDate)     return res.status(400).json({ error: 'endDate is required' });
    if (!reportType)  return res.status(400).json({ error: 'reportType is required' });

    const VALID_TYPES = ['party-bal-detail', 'party-bal', 'lot-wise', 'godown-bal'];
    if (!VALID_TYPES.includes(reportType)) {
      return res.status(400).json({ error: `Invalid reportType. Use: ${VALID_TYPES.join(' | ')}` });
    }

    // Group selected lots by owning company (pfkOriLotID = 'CompID!BranchID!N').
    // Each company's lots are queried against that company's own DB, then merged.
    // When no lots are selected, fall back to the logged-in company with no lot filter.
    const companyGroups = new Map(); // Map<compID, lotId[]>
    if (selectedLotIds.length > 0) {
      for (const lotId of selectedLotIds) {
        const cid = lotId.split('!')[0];
        if (!companyGroups.has(cid)) companyGroups.set(cid, []);
        companyGroups.get(cid).push(lotId);
      }
    } else {
      companyGroups.set(req.user.compID, []);
    }

    const txDateFrom = startDate || '1900-01-01';

    // Letterhead company name: always use the group's primary company, not whichever
    // company's lots happen to appear first in the loop (avoids "TEST1" on the header).
    const _primaryCompID  = connectionManager.getPrimaryCompID(groupID);
    const _primaryDetails = _primaryCompID
      ? connectionManager.getCompanyInfo(_primaryCompID)
      : connectionManager.getGroupCompanyDetails(groupID)[0];
    const groupCompName = _primaryDetails?.CompName || '';

    // ── Party Balance Detail Report (drsPartyBalDetail) ───────────────────────
    if (reportType === 'party-bal-detail') {
      const allLots  = [];
      const compName = groupCompName;

      for (const [compID, cLotIds] of companyGroups) {
        const db = connectionManager.getDB(compID) || req.db;

        const lotCond   = cLotIds.length > 0 ? `AND ts.pfkOriLotID IN (${cLotIds.map(() => '?').join(',')})` : '';
        const lotParams = cLotIds;

        const [lotHeaderRows] = await db.query(
          `SELECT
             p.pName, p.pEmail, p.pGroup,
             ts.pfkOriLotID, ts.LotNum, i.iName, ts.ItemExtDesc,
             ts.TransDt AS ArvDt, ts.OriTransQty AS ArvQty,
             SUM(vtq.GodownQty) AS balance,
             ts.Packing, ts.PackWght, ts.DoNum, ts.BENum,
             ts.ItemRate, ts.TransRemark, ts.TransExtDetail
           FROM tStockEntry ts
           JOIN mParty p ON ts.fkPartyID = p.pkPartyID
           JOIN mItem  i ON ts.fkItemID  = i.pkItemID
           JOIN vStkTransQty vtq ON vtq.pfkOriLotID = ts.pfkOriLotID
                                 AND vtq.fkCompID   = ts.fkCompID
                                 AND vtq.fkBranchID = ?
                                 AND vtq.OpFlg      = 'N'
                                 AND DATE(vtq.TransDt) <= ?
           WHERE ts.fkCompID = ? AND ts.TransType = 'ARV' AND ts.OpFlg = 'N'
             AND ts.TransDt <= ? AND i.iType <> 'SPC'
             ${lotCond}
           GROUP BY p.pName, p.pEmail, p.pGroup, ts.pfkOriLotID, ts.LotNum, i.iName, ts.ItemExtDesc,
                    ts.TransDt, ts.OriTransQty, ts.Packing, ts.PackWght,
                    ts.DoNum, ts.BENum, ts.ItemRate, ts.TransRemark, ts.TransExtDetail
           ${includeZero ? '' : `HAVING SUM(vtq.GodownQty) <> 0
             OR ts.pfkOriLotID IN (
               SELECT DISTINCT pfkOriLotID FROM tStockEntry
               WHERE fkCompID = ? AND OpFlg = 'N'
                 AND TransType <> 'ARV'
                 AND TransDt BETWEEN ? AND ?
             )`}
           ORDER BY p.pName, ts.LotNum`,
          { replacements: [branchID, endDate, compID, endDate, ...lotParams, ...(includeZero ? [] : [compID, txDateFrom, endDate])] }
        );

        if (lotHeaderRows.length === 0) continue;

        const lotIds = lotHeaderRows.map((r) => r.pfkOriLotID);
        const inPh   = lotIds.map(() => '?').join(',');

        // Opening balance = all activity before startDate + ARV within the period
        // (matches VB6: TransDt < start OR (TransDt >= start AND TransType = 'ARV'))
        const obMap = {};
        if (startDate) {
          const [obRows] = await db.query(
            `SELECT pfkOriLotID, COALESCE(SUM(TransQty), 0) AS obQty
             FROM tStockEntry
             WHERE fkCompID = ? AND OpFlg = 'N'
               AND pfkOriLotID IN (${inPh})
               AND (TransDt < ? OR (TransDt >= ? AND TransType = 'ARV'))
             GROUP BY pfkOriLotID`,
            { replacements: [compID, ...lotIds, startDate, startDate] }
          );
          for (const r of obRows) obMap[r.pfkOriLotID] = parseFloat(r.obQty) || 0;
        }

        // Dispatch rows: non-ARV only when period filter active (ARV is already in opening)
        const [txRows] = await db.query(
          `SELECT ts.pfkOriLotID, ts.TransDt, ts.TransTm, ts.TransQty,
                  ts.DoNum, ts.VehiNum, ts.TransExtDetail, ts.PickupBy,
                  ts.TransNote, ts.BatchNum, ts.GatePass, g.gNum,
                  ts.TransType, ts.ActualWght, ts.DelivOpt
           FROM tStockEntry ts
           LEFT JOIN mGodown g ON ts.fkGodownID1 = g.pkGodownID
           WHERE ts.fkCompID = ? AND ts.OpFlg = 'N'
             AND ts.pfkOriLotID IN (${inPh})
             AND ts.TransDt BETWEEN ? AND ?
             ${startDate ? "AND ts.TransType <> 'ARV'" : ''}
           ORDER BY ts.pfkOriLotID, ts.TransDt,
                    CASE ts.TransType
                      WHEN 'IN' THEN 1 WHEN 'DESPRET' THEN 1 ELSE 2
                    END, ts.TransTm`,
          { replacements: [compID, ...lotIds, txDateFrom, endDate] }
        );

        const txMap = {};
        for (const tx of txRows) {
          if (!txMap[tx.pfkOriLotID]) txMap[tx.pfkOriLotID] = [];
          txMap[tx.pfkOriLotID].push(tx);
        }

        for (const r of lotHeaderRows) {
          allLots.push({
            ...r,
            obQty: startDate ? (obMap[r.pfkOriLotID] ?? null) : null,
            txns:  txMap[r.pfkOriLotID] || [],
          });
        }
      }

      allLots.sort((a, b) =>
        String(a.pName || '').localeCompare(String(b.pName || '')) ||
        String(a.LotNum || '').localeCompare(String(b.LotNum || ''))
      );
      return res.json({ lots: allLots, reportType, startDate, endDate, compName, empty: allLots.length === 0 });
    }

    // ── Party Balance Report (drsPartyBal) ────────────────────────────────────
    if (reportType === 'party-bal') {
      const allRows  = [];
      const compName = groupCompName;

      for (const [compID, cLotIds] of companyGroups) {
        const db = connectionManager.getDB(compID) || req.db;

        const lotCond   = cLotIds.length > 0 ? `AND ts.pfkOriLotID IN (${cLotIds.map(() => '?').join(',')})` : '';
        const lotParams = cLotIds;

        const [rows] = await db.query(
          `SELECT
             p.pName, ts.pfkOriLotID, ts.LotNum, i.iName, ts.ItemExtDesc,
             ts.TransDt AS ArvDt, ts.OriTransQty AS ArvQty,
             SUM(vtq.GodownQty) AS balance,
             ts.Packing, ts.PackWght, ts.DoNum, ts.BENum,
             ts.ItemRate, ts.TransRemark, ts.TransExtDetail
           FROM tStockEntry ts
           JOIN mParty p  ON ts.fkPartyID = p.pkPartyID
           JOIN mItem  i  ON ts.fkItemID  = i.pkItemID
           JOIN vStkTransQty vtq ON vtq.pfkOriLotID = ts.pfkOriLotID
                                 AND vtq.fkCompID   = ts.fkCompID
                                 AND vtq.fkBranchID = ?
                                 AND vtq.OpFlg      = 'N'
                                 AND DATE(vtq.TransDt) <= ?
           WHERE ts.fkCompID = ? AND ts.TransType = 'ARV' AND ts.OpFlg = 'N'
             AND ts.TransDt <= ? AND i.iType <> 'SPC'
             ${lotCond}
           GROUP BY p.pName, ts.pfkOriLotID, ts.LotNum, i.iName, ts.ItemExtDesc,
                    ts.TransDt, ts.OriTransQty, ts.Packing, ts.PackWght,
                    ts.DoNum, ts.BENum, ts.ItemRate, ts.TransRemark, ts.TransExtDetail
           HAVING SUM(vtq.GodownQty) <> 0
           ORDER BY p.pName, ts.LotNum`,
          { replacements: [branchID, endDate, compID, endDate, ...lotParams] }
        );
        allRows.push(...rows);
      }

      allRows.sort((a, b) =>
        String(a.pName || '').localeCompare(String(b.pName || '')) ||
        String(a.LotNum || '').localeCompare(String(b.LotNum || ''))
      );
      return res.json({ rows: allRows, reportType, startDate, endDate, compName, empty: allRows.length === 0 });
    }

    // ── Lot Wise Report (drsLotDetail) ────────────────────────────────────────
    if (reportType === 'lot-wise') {
      const allLots  = [];
      const compName = groupCompName;

      for (const [compID, cLotIds] of companyGroups) {
        const db = connectionManager.getDB(compID) || req.db;

        const lotCond   = cLotIds.length > 0 ? `AND ts.pfkOriLotID IN (${cLotIds.map(() => '?').join(',')})` : '';
        const lotParams = cLotIds;

        const [lotHeaderRows] = await db.query(
          `SELECT ts.pfkOriLotID, ts.LotNum, p.pName, i.iName,
                  ts.TransDt AS ArvDt, ts.OriTransQty AS ArvQty,
                  ts.Packing, ts.PackWght, ts.DoNum AS ArvDoNum,
                  ts.TransExtDetail AS DocNo, ts.TransRemark
           FROM tStockEntry ts
           JOIN mParty p ON ts.fkPartyID = p.pkPartyID
           JOIN mItem  i ON ts.fkItemID  = i.pkItemID
           WHERE ts.fkCompID = ? AND ts.TransType = 'ARV' AND ts.OpFlg = 'N'
             AND i.iType <> 'SPC'
             ${lotCond}
           ORDER BY ts.LotNum`,
          { replacements: [compID, ...lotParams] }
        );

        if (lotHeaderRows.length === 0) continue;

        const lotIds = lotHeaderRows.map((r) => r.pfkOriLotID);
        const inPh   = lotIds.map(() => '?').join(',');

        const obMap = {};
        if (startDate) {
          const [obRows] = await db.query(
            `SELECT pfkOriLotID, COALESCE(SUM(TransQty), 0) AS obQty
             FROM tStockEntry
             WHERE fkCompID = ? AND OpFlg = 'N'
               AND pfkOriLotID IN (${inPh}) AND TransDt < ?
             GROUP BY pfkOriLotID`,
            { replacements: [compID, ...lotIds, startDate] }
          );
          for (const r of obRows) obMap[r.pfkOriLotID] = parseFloat(r.obQty) || 0;
        }

        const [txRows] = await db.query(
          `SELECT ts.pfkOriLotID, ts.TransDt, ts.TransTm, ts.TransQty,
                  ts.DoNum, ts.VehiNum, ts.TransExtDetail, ts.PickupBy,
                  ts.TransNote, ts.BatchNum, ts.GatePass, g.gNum,
                  ts.TransType, ts.ActualWght, ts.DelivOpt
           FROM tStockEntry ts
           LEFT JOIN mGodown g ON ts.fkGodownID1 = g.pkGodownID
           WHERE ts.fkCompID = ? AND ts.OpFlg = 'N'
             AND ts.pfkOriLotID IN (${inPh})
             AND ts.TransDt BETWEEN ? AND ?
           ORDER BY ts.pfkOriLotID, ts.TransDt,
                    CASE ts.TransType
                      WHEN 'ARV' THEN 0 WHEN 'IN' THEN 1 WHEN 'DESPRET' THEN 1 ELSE 2
                    END, ts.TransTm`,
          { replacements: [compID, ...lotIds, txDateFrom, endDate] }
        );

        const txMap = {};
        for (const tx of txRows) {
          if (!txMap[tx.pfkOriLotID]) txMap[tx.pfkOriLotID] = [];
          txMap[tx.pfkOriLotID].push(tx);
        }

        for (const r of lotHeaderRows) {
          allLots.push({
            ...r,
            obQty: obMap[r.pfkOriLotID] || 0,
            txns:  txMap[r.pfkOriLotID] || [],
          });
        }
      }

      allLots.sort((a, b) => String(a.LotNum || '').localeCompare(String(b.LotNum || '')));
      return res.json({ lots: allLots, reportType, startDate, endDate, compName, empty: allLots.length === 0 });
    }

    // ── Godown Balance Report (drsGodownBal) ──────────────────────────────────
    if (reportType === 'godown-bal') {
      const allRows = [];

      for (const [compID, cLotIds] of companyGroups) {
        const db        = connectionManager.getDB(compID) || req.db;
        const lotCond   = cLotIds.length > 0 ? `AND ts.pfkOriLotID IN (${cLotIds.map(() => '?').join(',')})` : '';
        const lotParams = cLotIds;

        const [rows] = await db.query(
          `SELECT
             g.gNum, i.iName, p.pName, ts.pfkOriLotID, ts.LotNum,
             ts.TransDt AS ArvDt, ts.OriTransQty AS ArvQty,
             SUM(vtq.GodownQty) AS balance,
             ts.Packing, ts.PackWght, ts.GrossWght, ts.BatchNum,
             ts.TransExtDetail, ts.ItemExtDesc, ts.BENum, ts.DoNum,
             ts.ItemRate, ts.TransRemark, ts.PackingType, ts.PackingColour
           FROM tStockEntry ts
           JOIN mParty p  ON ts.fkPartyID = p.pkPartyID
           JOIN mItem  i  ON ts.fkItemID  = i.pkItemID
           JOIN vStkTransQty vtq ON vtq.pfkOriLotID = ts.pfkOriLotID
                                 AND vtq.fkCompID   = ts.fkCompID
                                 AND vtq.fkBranchID = ?
                                 AND vtq.OpFlg      = 'N'
                                 AND DATE(vtq.TransDt) <= ?
           LEFT JOIN mGodown g ON vtq.fkGodownID = g.pkGodownID
           WHERE ts.fkCompID = ? AND ts.TransType = 'ARV' AND ts.OpFlg = 'N'
             AND ts.TransDt <= ? AND i.iType <> 'SPC'
             ${lotCond}
           GROUP BY g.gNum, i.iName, p.pName, ts.pfkOriLotID, ts.LotNum,
                    ts.TransDt, ts.OriTransQty, ts.Packing, ts.PackWght, ts.GrossWght,
                    ts.BatchNum, ts.TransExtDetail, ts.ItemExtDesc, ts.BENum, ts.DoNum,
                    ts.ItemRate, ts.TransRemark, ts.PackingType, ts.PackingColour
           HAVING SUM(vtq.GodownQty) <> 0
           ORDER BY CAST(g.gNum AS UNSIGNED), i.iName, ts.ItemExtDesc, ts.LotNum`,
          { replacements: [branchID, endDate, compID, endDate, ...lotParams] }
        );
        allRows.push(...rows);
      }

      allRows.sort((a, b) =>
        ((parseInt(a.gNum) || 0) - (parseInt(b.gNum) || 0)) ||
        String(a.iName || '').localeCompare(String(b.iName || '')) ||
        String(a.ItemExtDesc || '').localeCompare(String(b.ItemExtDesc || '')) ||
        String(a.LotNum || '').localeCompare(String(b.LotNum || ''))
      );
      return res.json({ rows: allRows, reportType, startDate, endDate, empty: allRows.length === 0 });
    }

  } catch (err) {
    console.error('[BalanceRep /report]', err.message);
    res.status(500).json({ error: `Failed to generate report: ${err.message}` });
  }
});

// ── POST /send-emails ──────────────────────────────────────────────────────────
// Each item in partiesData is one PDF + one email.
// The frontend builds the HTML (via buildReportHTML, same as View Report) so that
// the selected report format and all checkbox filters are already applied.
// Puppeteer converts that HTML to a PDF attachment.
//
// SMTP: always uses the default SMTP transporter (Bhiwandi@adityaservices.co.in).
// Body: { partiesData: [{ partyName, email, html }], subject, compName, startDate, endDate }
router.post('/send-emails', requirePerm('BAL_REP', 'CanView'), async (req, res) => {
  const { sendMail }          = require('../../utils/mailer');
  const { resolveEmailGroup } = require('../../utils/resolveEmailGroup');
  const puppeteer    = require('puppeteer-core');

  const {
    partiesData = [],
    subject,
    compName    = '',
    startDate,
    endDate     = '',
  } = req.body;

  if (!partiesData.length) return res.status(400).json({ error: 'No party data provided' });

  const fmtD = (s) => {
    if (!s) return '';
    const d = s.slice(0, 10);
    return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  };

  const greetingHtml = (label) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:13px">
<p>Dear Sir/Madam,<br>Greetings from <b><span style="color:#3065cf">${compName}</span></b></p>
<p>Enclosed herewith Balance statement for <span style="font-weight:bold">M/s ${label}</span> as on ${fmtD(endDate)}</p>
<p>Any query about stock Statement please feel free to contact us.</p>
<p>This is a computer generated report subject to physical verification.</p>
<p>Thanks &amp; Regards,<br>&mdash;<br><span style="color:#181266">${compName}</span></p>
<table style="width:100%;border-collapse:collapse;margin-top:10px">
  <tr style="background-color:orange"><td style="padding:5px"></td></tr>
  <tr style="background-color:#181266"><td style="padding:5px"></td></tr>
  <tr style="background-color:#3065cf"><td style="padding:5px"></td></tr>
</table></body></html>`;

  const subjectLine = subject || `Statement: Balance stock as on ${fmtD(endDate)}`;
  const dateStamp   = fmtD(endDate).replace(/-/g, '');
  const results     = [];

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    for (const item of partiesData) {
      if (!item.email || !item.html) {
        results.push({ partyName: item.partyName, email: item.email || '', status: 'skipped', error: 'No email or no report data' });
        continue;
      }
      try {
        const page = await browser.newPage();
        await page.setContent(item.html, { waitUntil: 'load' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await page.close();

        const safeName = item.partyName.replace(/[^a-zA-Z0-9]/g, '_');
        await sendMail({
          to:      item.email,
          subject: subjectLine,
          html:    greetingHtml(item.greetingName || item.partyName),
          attachments: [{ filename: `BalanceStatement_${safeName}_${dateStamp}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
          group:   resolveEmailGroup(req.user.groupID, 'ops'),
        });
        results.push({ partyName: item.partyName, email: item.email, status: 'sent' });
      } catch (mailErr) {
        console.error(`[send-emails] ${item.email}:`, mailErr.message);
        results.push({ partyName: item.partyName, email: item.email, status: 'failed', error: mailErr.message });
      }
    }
  } catch (err) {
    console.error('[send-emails]', err.message);
    return res.status(500).json({ error: `Failed to send emails: ${err.message}` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  res.json({
    results,
    sentCount:   results.filter((r) => r.status === 'sent').length,
    failedCount: results.filter((r) => r.status !== 'sent').length,
  });
});

module.exports = router;
