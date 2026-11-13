// TRANSACTION — Stock Entry (Dispatch / Transfer / Out)
// /api/transactions/dispatches
//
// TransTypes: DESP (Despatch), TRF (Transfer), OUT (Out)
//
// pkTransID  : generated via gudfGenSerialID → 'CompID!BranchID!N'
// pfkLotID   : links to ARV entry's pkTransID
// pfkOriLotID: same as pfkLotID for dispatch entries
// LotNum     : always '' (blank) — list query pulls from ARV entry via pfkLotID join
// GodownQty1/2: stored as NEGATIVE (stock leaving)
// TransQty   : GodownQty1 + GodownQty2 (negative total)
// GatePass   : plain integer (1, 2, 3 …) — displayed as MAX(FaYear)+1
//
// Arrival-inherited fields always saved as blank/0/NULL on both POST and PUT:
//   LotNum, ItemExtDesc, Packing, PackingType, PackingColour, BENum → ''
//   PackWght, GrossWght, RentRate, ItemRate, TransRemark              → 0 / ''
//   OriTransDt, OriTransQty                                           → NULL
//
// MIGRATION REQUIRED (run once on every company DB if created from an older schema):
//   ALTER TABLE tStockEntry     ADD COLUMN IF NOT EXISTS PickupBy VARCHAR(100) NOT NULL DEFAULT '' AFTER DelivOpt;
//   ALTER TABLE tStockEntry_AT  ADD COLUMN IF NOT EXISTS PickupBy VARCHAR(100) AFTER OwnTransFlg;

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineStockEntry  = require('../../models/company/StockEntry');
const defineParty       = require('../../models/company/Party');
const defineItem        = require('../../models/company/Item');
const defineRateChart        = require('../../models/company/RateChart');
const defineVCComboData      = require('../../models/company/VCComboData');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const { getFaYear }     = require('../../utils/faYear');
const { writeAuditEntry } = require('../../utils/auditEntry');
const { generateGatePassPDF } = require('../../utils/gatePass');
const { sendMail }           = require('../../utils/mailer');
const { resolveEmailGroup }  = require('../../utils/resolveEmailGroup');
const { Op }            = require('sequelize');
const connectionManager = require('../../config/connectionManager');

// Routes queries to the party's company DB if it differs from the logged-in company.
// This handles cross-company dispatch: stock stored under company A, user logged in as company B.
function getTargetContext(req, partyCompID) {
  if (partyCompID && partyCompID !== req.user.compID) {
    const db = connectionManager.getDB(partyCompID);
    if (db) return { db, compID: partyCompID, branchID: req.user.branchID };
  }
  return { db: req.db, compID: req.user.compID, branchID: req.user.branchID };
}

// Derives the 2-letter hamali code from 6 checkbox flags.
// Priority order (highest wins): noEntry > billChk > lbrAmt > varai combos > onAc > bankTrf > default cash.
// OA vs OC: onAc with no cash received (hamaliRecd=0) → OA; with cash → OC.
// The frontend carries the same logic — keep both in sync when adding new codes.
function deriveHamaliCode(flags, hamaliRecd) {
  const { onAc, varai, bankTrf, lbrAmt, billChk, noEntry } = flags;
  if (noEntry)                  return 'NO';
  if (billChk)                  return 'BA';
  if (lbrAmt)                   return 'LA';
  if (onAc && varai && bankTrf) return 'VB';
  if (onAc && varai)            return 'VC';
  if (onAc && bankTrf)          return 'OB';
  if (onAc)                     return Number(hamaliRecd) === 0 ? 'OA' : 'OC';
  if (bankTrf)                  return 'CB';
  return 'CR';
}

const DISPATCH_TYPES = ['DESP', 'TRF', 'OUT'];

router.use(requireAuth);

// ── LocBatch helper: delete then re-insert rows for a given transID ──────────
// Sign rules:
//   TRF  → fkGodownID1 rows negative (leaving), fkGodownID2 rows positive (arriving)
//   DESP / OUT → all rows negative
async function upsertLocBatches(db, transID, transType, locBatches = [], fkGodownID1 = '', fkGodownID2 = '') {
  await db.query(
    'DELETE FROM tstockentry_locbatch WHERE cpkTransID = ?',
    { replacements: [transID] },
  );
  const valid = (locBatches || []).filter(
    (r) => r && String(r.batchNum || '').trim(),
  );
  if (!valid.length) return;
  const vals = valid.map((r, i) => {
    let qty = Math.abs(parseFloat(r.qty) || 0);
    if (transType === 'TRF') {
      // G2 (arrival) rows are tagged isArrival:true → positive; G1 (despatch) → negative.
      // Fall back to godown ID comparison for rows saved before isArrival was introduced.
      const isArrival = r.isArrival === true || (!r.isArrival && r.fkGodownID === fkGodownID2);
      qty = isArrival ? qty : -qty;
    } else {
      qty = -qty;
    }
    return [
      transID,
      i + 1,
      transType,
      r.fkGodownID   || '',
      r.fkLocationID || '',
      String(r.batchNum || 'NA').trim(),
      qty,
      r.remark || '',
    ];
  });
  await db.query(
    `INSERT INTO tstockentry_locbatch
       (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`,
    { replacements: vals.flat() },
  );
}

// ── GET /api/transactions/dispatches  (list) ──────────────────────────────────
router.get('/', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  try {
    const { groupID } = req.user;
    const { transType, fromDt, toDt, partyID, itemID, godownID, lotNum, gatePass, companyID } = req.query;

    const allCompanies = connectionManager.getGroupCompanyDetails(groupID);
    const companies    = companyID ? allCompanies.filter((c) => c.pkCompID === companyID) : allCompanies;
    if (companies.length === 0) return res.json([]);

    const subCond = [`ts.TransType IN ('DESP','TRF','OUT')`];
    const subRepl = [];
    if (fromDt && toDt) { subCond.push('ts.TransDt BETWEEN ? AND ?'); subRepl.push(fromDt, toDt); }
    if (transType)  { subCond.push('ts.TransType = ?');                 subRepl.push(transType); }
    if (partyID)    { subCond.push('ts.fkPartyID = ?');                 subRepl.push(partyID); }
    if (itemID)     { subCond.push('ts.fkItemID = ?');                  subRepl.push(itemID); }
    if (godownID)   { subCond.push('(ts.fkGodownID1 = ? OR ts.fkGodownID2 = ?)'); subRepl.push(godownID, godownID); }
    // LotNum is blank in new dispatch entries; fall back to ARV entry via pfkLotID
    if (lotNum)     { subCond.push('(ts.LotNum LIKE ? OR arv.LotNum LIKE ?)'); subRepl.push(`%${lotNum}%`, `%${lotNum}%`); }
    if (gatePass)   { subCond.push('ts.GatePass = ?');                         subRepl.push(gatePass); }

    const parts = companies.map(({ dbName, pkCompID }) => {
      const where = [`ts.fkCompID = '${pkCompID}'`, ...subCond].join(' AND ');
      return `
        SELECT ts.pkTransID, ts.TransID, ts.TransType, ts.TransDt,
               COALESCE(NULLIF(ts.LotNum, ''), arv.LotNum)           AS LotNum,
               ts.fkCompID, ts.fkPartyID, p.pName, p.pCode,
               ts.fkItemID, im.iName,
               TRIM(CONCAT(COALESCE(im.iName, ''), ' ',
                 COALESCE(NULLIF(arv.ItemExtDesc, ''), NULLIF(ts.ItemExtDesc, ''), ''))) AS itemDesc,
               ts.TransQty,
               COALESCE(NULLIF(ts.Packing, ''), arv.Packing)         AS Packing,
               COALESCE(NULLIF(ts.PackWght, 0), arv.PackWght)        AS PackWght,
               ts.GatePass, ts.DoNum, ts.VehiNum, ts.DelivOpt,
               ts.fkGodownID1, g1.gNum AS godown1Num,
               ts.fkGodownID2, g2.gNum AS godown2Num
        FROM \`${dbName}\`.\`tStockEntry\` ts
        LEFT JOIN (
          SELECT pfkLotID,
                 MIN(LotNum)      AS LotNum,
                 MIN(ItemExtDesc) AS ItemExtDesc,
                 MIN(Packing)     AS Packing,
                 MIN(PackWght)    AS PackWght
          FROM \`${dbName}\`.\`tStockEntry\`
          WHERE TransType IN ('ARV', 'IN')
          GROUP BY pfkLotID
        ) arv ON arv.pfkLotID = ts.pfkLotID
        LEFT JOIN \`${dbName}\`.\`mParty\`  p  ON ts.fkPartyID   = p.pkPartyID
        LEFT JOIN \`${dbName}\`.\`mItem\`   im ON ts.fkItemID    = im.pkItemID
        LEFT JOIN \`${dbName}\`.\`mGodown\` g1 ON ts.fkGodownID1 = g1.pkGodownID
        LEFT JOIN \`${dbName}\`.\`mGodown\` g2 ON ts.fkGodownID2 = g2.pkGodownID
        WHERE ${where}`;
    });

    const sql = `SELECT * FROM (\n${parts.join('\nUNION ALL\n')}\n) _u
                 ORDER BY TransDt DESC, CAST(NULLIF(GatePass, '') AS UNSIGNED) DESC`;
    const allRepl = companies.flatMap(() => [...subRepl]);
    const [rows] = await req.db.query(sql, { replacements: allRepl });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load dispatches' });
  }
});

// ── GET /api/transactions/dispatches/lot-list  (lots with godown-wise balance) ─
// Returns lots for the party+faYear filtered by item name search.
// Each lot includes a `godowns` array with per-godown balance.
// Only lots with TotalBalQty > 0 are returned.
router.get('/lot-list', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  const { partyID, transDate, partyCompID, search, hideZero } = req.query;
  if (!partyID || !transDate) return res.status(400).json({ error: 'partyID and transDate required' });

  const { db, compID, branchID } = getTargetContext(req, partyCompID);
  const faYear = await getFaYear(db, compID, transDate);
  const searchPat = search ? `${search}%` : '%';
  const filterZero = hideZero !== 'false'; // default: hide zero-balance lots

  const sql = `
    SELECT STRAIGHT_JOIN
      ts.LotNum,
      ts.pfkLotID,
      ts.pfkOriLotID,
      TRIM(CONCAT(im.iName, ' ', COALESCE(ts.ItemExtDesc, ''))) AS iName,
      im.iName AS itemName,
      ts.ItemExtDesc,
      ts.fkItemID,
      ts.Packing,
      ts.PackingType,
      ts.PackingColour,
      ts.PackWght,
      ts.GrossWght,
      ts.BENum,
      ts.BatchNum,
      ts.TransRemark,
      ts.OriTransDt,
      ts.OriTransQty,
      ts.TransDt AS ArvTransDt,
      ts.LotBillFlg,
      ts.RentRate,
      gm.gNum,
      vtq.fkGodownID,
      SUM(vtq.GodownQty) AS GodownBalQty
    FROM vStkTransQty vtq
    LEFT JOIN tStockEntry ts ON vtq.pfkLotID = ts.pfkLotID
    LEFT JOIN mItem im ON vtq.fkItemID = im.pkItemID
    LEFT JOIN mGodown gm ON vtq.fkGodownID = gm.pkGodownID AND gm.Active = 'Y'
    WHERE ts.fkCompID = ?
      AND ts.fkBranchID = ?
      AND ts.fkPartyID = ?
      AND ts.TransType = 'ARV'
      AND ts.FaYear = ?
      AND im.iName LIKE ?
    GROUP BY ts.LotNum, ts.pfkLotID, ts.pfkOriLotID,
             im.iName, ts.ItemExtDesc, ts.fkItemID,
             ts.Packing, ts.PackingType, ts.PackingColour,
             ts.PackWght, ts.GrossWght, ts.BENum, ts.BatchNum,
             ts.TransRemark, ts.OriTransDt, ts.OriTransQty, ts.TransDt,
             ts.LotBillFlg, ts.RentRate, gm.gNum, vtq.fkGodownID
    ${filterZero ? 'HAVING SUM(vtq.GodownQty) > 0' : ''}
    ORDER BY ts.LotNum, gm.gNum`;

  try {
    const [rows] = await db.query(sql, { replacements: [compID, branchID, partyID, faYear, searchPat] });

    // Group per-godown rows by LotNum
    const lotsMap = {};
    for (const row of rows) {
      if (!lotsMap[row.LotNum]) {
        lotsMap[row.LotNum] = {
          LotNum:       row.LotNum,
          pfkLotID:     row.pfkLotID,
          pfkOriLotID:  row.pfkOriLotID,
          iName:        row.iName,
          itemName:     row.itemName,
          ItemExtDesc:  row.ItemExtDesc || '',
          fkItemID:     row.fkItemID,
          Packing:      row.Packing || '',
          PackingType:  row.PackingType || '',
          PackingColour:row.PackingColour || '',
          PackWght:     row.PackWght,
          GrossWght:    row.GrossWght,
          BENum:        row.BENum || '',
          BatchNum:     row.BatchNum || '',
          TransRemark:  row.TransRemark || '',
          OriTransDt:   row.OriTransDt,
          OriTransQty:  row.OriTransQty,
          ArvTransDt:   row.ArvTransDt,
          LotBillFlg:   row.LotBillFlg,
          RentRate:     row.RentRate,
          TotalBalQty:  0,
          godowns:      [],
        };
      }
      const bal = Number(row.GodownBalQty);
      lotsMap[row.LotNum].TotalBalQty += bal;
      if (row.fkGodownID) {
        lotsMap[row.LotNum].godowns.push({
          fkGodownID: row.fkGodownID,
          gNum:       row.gNum || row.fkGodownID,
          BalQty:     bal,
        });
      }
    }

    // When filterZero is false, include zero-balance lots; otherwise require TotalBalQty > 0
    const result = Object.values(lotsMap).filter((l) => !filterZero || l.TotalBalQty > 0);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/dispatches/hamali-rate ──────────────────────────────
// Single SQL query with priority ordering (best match wins):
//   Priority 1 — specific party  + specific packing
//   Priority 2 — specific party  + any packing ('')
//   Priority 3 — all parties ('') + specific packing
//   Priority 4 — all parties ('') + any packing ('')
//
// SQL:
//   SELECT BillRate, LabourRate, ChargeType,
//     CASE
//       WHEN fkPartyID = :partyID AND PackingType = :packing THEN 1
//       WHEN fkPartyID = :partyID AND PackingType = ''       THEN 2
//       WHEN fkPartyID = ''       AND PackingType = :packing THEN 3
//       ELSE 4
//     END AS priority
//   FROM RateChart
//   WHERE fkCompID    = :compID
//     AND fkPartyID   IN (:partyID, '')
//     AND RateType    = 'HM'
//     AND TransType   = :transType
//     AND HamaliCode  = :hamaliCode
//     AND PackingType IN (:packing, '')
//     AND Active      = 'Y'
//     AND FromDt     <= :dateStr
//     AND UnitFrom   <= :w
//     AND UnitTo     >= :w
//     AND (ToDt IS NULL OR ToDt >= :dateStr)
//   ORDER BY priority ASC, FromDt DESC
//   LIMIT 1
router.get('/hamali-rate', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  try {
    const { partyID, packing, weight, hamaliCode, transType, transDate, partyCompID } = req.query;
    if (!partyID || !hamaliCode) return res.status(400).json({ error: 'partyID and hamaliCode required' });

    // Derive the party's company directly from the partyID PK (format: CompID!BranchID!N)
    // This is more reliable than relying on the frontend's partyCompID param
    const derivedCompID = partyID ? partyID.split('!')[0] : '';
    const rateCompID    = derivedCompID || partyCompID || req.user.compID;
    const { db } = getTargetContext(req, rateCompID);
    const dt      = transDate ? new Date(transDate) : new Date();
    const dateStr = dt.toISOString().slice(0, 10);
    const w       = parseFloat(weight) || 0;
    const pack    = packing || '';
    const tType   = transType || 'DESP';

    const [rows] = await db.query(
      `SELECT BillRate, LabourRate, ChargeType,
         CASE
           WHEN fkPartyID = ? AND PackingType = ?     THEN 1
           WHEN fkPartyID = ? AND PackingType = ''    THEN 2
           WHEN fkPartyID IN ('0','') AND PackingType = ? THEN 3
           ELSE 4
         END AS priority
       FROM RateChart
       WHERE fkCompID    = ?
         AND fkPartyID   IN (?, '0', '')
         AND RateType    = 'HM'
         AND TransType   = ?
         AND HamaliCode  = ?
         AND PackingType IN (?, '')
         AND Active      = 'Y'
         AND FromDt     <= ?
         AND (UnitTo = 0 OR (UnitFrom <= ? AND UnitTo >= ?))
         AND ToDt IS NULL
       ORDER BY priority ASC, FromDt DESC
       LIMIT 1`,
      { replacements: [
          partyID, pack,   // CASE WHEN 1
          partyID,         // CASE WHEN 2
          pack,            // CASE WHEN 3
          rateCompID,      // WHERE fkCompID  (party's company)
          partyID,         // IN (partyID, '0', '')
          tType,           // TransType
          hamaliCode,      // HamaliCode
          pack,            // IN (pack, '')
          dateStr,         // FromDt <=
          w,               // UnitFrom <= (weight range branch)
          w,               // UnitTo   >= (weight range branch)
        ],
      }
    );

    const row        = rows[0];
    const ctCode     = row ? (row.ChargeType || '') : '';
    let   ctLabel    = ctCode;
    if (ctCode) {
      const [comboRows] = await db.query(
        `SELECT VCData FROM VCComboData WHERE VCPurpose = 'ChargeType' AND VCCode = ? LIMIT 1`,
        { replacements: [ctCode] }
      );
      if (comboRows.length > 0) ctLabel = comboRows[0].VCData || ctCode;
    }
    res.json({
      BillRate:        row ? Number(row.BillRate)   : 0,
      LabourRate:      row ? Number(row.LabourRate) : 0,
      ChargeType:      ctCode,
      ChargeTypeLabel: ctLabel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/dispatches/next-gatepass ───────────────────────────
// Returns MAX(GatePass) + 1 from vatStockentry for the current FaYear.
router.get('/next-gatepass', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  try {
    const { partyCompID, transDate } = req.query;
    const { db, compID } = getTargetContext(req, partyCompID);
    const dt     = transDate || new Date().toISOString().slice(0, 10);
    const faYear = await getFaYear(db, compID, dt);

    const [rows] = await db.query(
      `SELECT MAX(CAST(GatePass AS UNSIGNED)) AS maxGP
       FROM vatStockentry
       WHERE FaYear = ? AND GatePass != ''`,
      { replacements: [faYear] }
    );
    const maxGP   = rows.length > 0 && rows[0].maxGP ? Number(rows[0].maxGP) : 0;
    const nextNum = maxGP + 1;
    res.json({ nextGatePass: String(nextNum), faYear });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/dispatches/batch-list ───────────────────────────────
// Returns batch-wise balance for a specific lot in a specific godown.
// Balance is computed exclusively from tstockentry_locbatch:
//   SUM(lb.Qty) per BatchNum, filtered by lot + godown.
//   Qty is signed: positive for ARV/IN rows, negative for DESP/OUT rows.
//   HAVING SUM > 0 shows only batches with remaining stock.
router.get('/batch-list', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  const { pfkOriLotID, godownID, partyCompID } = req.query;
  if (!pfkOriLotID || !godownID)
    return res.status(400).json({ error: 'pfkOriLotID and godownID required' });

  const { db } = getTargetContext(req, partyCompID);

  try {
    const [rows] = await db.query(
      `SELECT lb.BatchNum, SUM(lb.Qty) AS balQty
       FROM tstockentry_locbatch lb
       LEFT JOIN tStockEntry ts
         ON lb.cpkTransID COLLATE utf8mb4_unicode_ci = ts.pkTransID COLLATE utf8mb4_unicode_ci
       WHERE ts.pfkOriLotID COLLATE utf8mb4_unicode_ci = ?
         AND lb.fkGodownID  COLLATE utf8mb4_unicode_ci = ?
       GROUP BY lb.BatchNum
       HAVING SUM(lb.Qty) > 0
       ORDER BY lb.BatchNum`,
      { replacements: [pfkOriLotID, godownID] }
    );

    res.json(rows.map((r) => ({ batchNum: r.BatchNum, balQty: parseFloat(r.balQty) || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/dispatches/location-list ────────────────────────────
// Returns location-wise balance for a given lot + godown + batch.
// Used by the DESP/OUT LocBatch grid to annotate the Location dropdown with qty.
// When no locbatch data exists for this batch, returns [] and the caller falls
// back to the plain mLocation list.
router.get('/location-list', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  const { pfkOriLotID, godownID, batchNum, partyCompID } = req.query;
  if (!pfkOriLotID || !godownID)
    return res.status(400).json({ error: 'pfkOriLotID and godownID required' });

  const { db } = getTargetContext(req, partyCompID);

  try {
    if (!batchNum) return res.json([]);

    console.log('[location-list] params:', { pfkOriLotID, godownID, batchNum });
    const [rows] = await db.query(
      `SELECT s.fkLocationID,
              s.BalQty,
              ml.LocationCode,
              ml.LocationName
       FROM (
         SELECT lb.fkLocationID, SUM(lb.Qty) AS BalQty
         FROM tstockentry_locbatch lb
         LEFT JOIN tStockEntry ts
           ON lb.cpkTransID COLLATE utf8mb4_unicode_ci = ts.pkTransID COLLATE utf8mb4_unicode_ci
         WHERE ts.pfkOriLotID COLLATE utf8mb4_unicode_ci = ? AND ts.OpFlg = 'N'
           AND lb.fkGodownID  COLLATE utf8mb4_unicode_ci = ?
           AND lb.BatchNum    COLLATE utf8mb4_unicode_ci = ?
         GROUP BY lb.fkLocationID
       ) s
       LEFT JOIN mLocation ml
         ON s.fkLocationID COLLATE utf8mb4_unicode_ci = ml.pkLocationID COLLATE utf8mb4_unicode_ci
       ORDER BY ml.LocationCode, ml.LocationName`,
      { replacements: [pfkOriLotID, godownID, batchNum] }
    );

    console.log('[location-list] rows found:', rows.length, rows);
    res.json(rows.map((r) => ({
      fkLocationID: r.fkLocationID || '',
      LocationCode: r.LocationCode || '',
      LocationName: r.LocationName || '',
      balQty:       parseFloat(r.BalQty) || 0,
    })));
  } catch (err) {
    console.error('[location-list] SQL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/dispatches/deliv-options ───────────────────────────
// Returns VCComboData rows for VCPurpose='DelvType'. Accepts optional partyCompID
// to support cross-company dispatch (reads from the party's company DB).
router.get('/deliv-options', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  try {
    const { partyCompID } = req.query;
    const { db, compID, branchID } = getTargetContext(req, partyCompID);
    const VCComboData = defineVCComboData(db);
    const rows = await VCComboData.findAll({
      attributes: ['VCCode', 'VCData', 'VCSrtOrd'],
      where: { fkCompID: compID, VCPurpose: 'DelvType', VCActive: 'Y' },
      order: [['VCSrtOrd', 'ASC'], ['VCData', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load delivery options' });
  }
});

// ── GET /api/transactions/dispatches/:id ──────────────────────────────────────
router.get('/:id', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  try {
    const [targetCompID] = req.params.id.split('!');
    const { db, compID, branchID } = getTargetContext(req, targetCompID);
    const StockEntry = defineStockEntry(db);

    const row = await StockEntry.findOne({
      where: { pkTransID: req.params.id, fkCompID: targetCompID },
    });
    if (!row) return res.status(404).json({ error: 'Entry not found' });

    // Also return per-godown balance for the lot so the form can show remaining capacity
    let godowns = [];
    try {
      const [gdRows] = await db.query(
        `SELECT gm.gNum, vtq.fkGodownID, SUM(vtq.GodownQty) AS GodownBalQty
         FROM vStkTransQty vtq
         LEFT JOIN mGodown gm ON vtq.fkGodownID = gm.pkGodownID AND gm.Active = 'Y'
         WHERE vtq.pfkLotID = ? AND vtq.fkCompID = ?
         GROUP BY vtq.fkGodownID, gm.gNum
         HAVING SUM(vtq.GodownQty) <> 0`,
        { replacements: [row.pfkLotID, targetCompID] }
      );
      // Add back the current dispatch quantities to the balances
      // (so the edit form shows available capacity as if this entry didn't exist)
      // GodownQty1 is always negative; GodownQty2 is negative for DESP/OUT, POSITIVE for TRF.
      // To undo: godown1 → +|qty1|; godown2 → subtract the signed qty2.
      const qty1    = Math.abs(parseFloat(row.GodownQty1 || 0));
      const qty2sig = parseFloat(row.GodownQty2 || 0);   // signed value from DB
      godowns = gdRows.map((g) => {
        let bal = Number(g.GodownBalQty);
        if (g.fkGodownID === row.fkGodownID1) bal += qty1;
        if (g.fkGodownID === row.fkGodownID2) bal -= qty2sig;  // undo: +|qty2| for DESP; -qty2 for TRF
        return { fkGodownID: g.fkGodownID, gNum: g.gNum || g.fkGodownID, BalQty: bal };
      });
      // For godowns missing from vStkTransQty (balance was 0), look up gNum from mGodown
      const missingG1 = row.fkGodownID1 && qty1 > 0 && !godowns.find((g) => g.fkGodownID === row.fkGodownID1);
      const missingG2 = row.fkGodownID2 && qty2sig !== 0 && !godowns.find((g) => g.fkGodownID === row.fkGodownID2);
      if (missingG1 || missingG2) {
        const ids = [row.fkGodownID1, row.fkGodownID2].filter(Boolean);
        const [gdLookup] = await db.query(
          `SELECT pkGodownID, gNum FROM mGodown WHERE pkGodownID IN (${ids.map(() => '?').join(',')})`,
          { replacements: ids }
        ).catch(() => [[]]);
        const gdMap = Object.fromEntries(gdLookup.map((g) => [g.pkGodownID, g.gNum]));
        if (missingG1) godowns.push({ fkGodownID: row.fkGodownID1, gNum: gdMap[row.fkGodownID1] || row.fkGodownID1, BalQty: qty1 });
        if (missingG2) godowns.push({ fkGodownID: row.fkGodownID2, gNum: gdMap[row.fkGodownID2] || row.fkGodownID2, BalQty: -qty2sig });
      }
    } catch {}

    // Fetch the ARV entry so the edit form can show arrival-inherited fields (Packing, PackWght, etc.)
    // ARV entries share pfkLotID with all their dispatch children — match on pfkLotID, not pkTransID.
    let lotDetail = null;
    try {
      const [arvRows] = await db.query(
        `SELECT LotNum, fkItemID, ItemExtDesc, Packing, PackingType, PackingColour, PackWght,
                BENum, BatchNum, OriTransDt, OriTransQty, RentRate, ItemRate, TransRemark,
                TransDt AS ArvTransDt
         FROM tStockEntry
         WHERE pfkLotID = ? AND TransType IN ('ARV', 'IN')
         LIMIT 1`,
        { replacements: [row.pfkLotID] }
      );
      if (arvRows.length > 0) lotDetail = arvRows[0];
    } catch (e) {
      console.error('lotDetail fetch error:', e.message, 'pfkLotID:', row.pfkLotID);
    }

    const [allLocBatches] = await db.query(
      `SELECT lb.fkGodownID, lb.fkLocationID, lb.BatchNum, lb.Qty, lb.Remark,
              ml.LocationCode, ml.LocationName
       FROM tstockentry_locbatch lb
       LEFT JOIN mLocation ml
         ON lb.fkLocationID COLLATE utf8mb4_unicode_ci = ml.pkLocationID COLLATE utf8mb4_unicode_ci
       WHERE lb.cpkTransID COLLATE utf8mb4_unicode_ci = ?
       ORDER BY lb.cpkSrNo`,
      { replacements: [req.params.id] }
    );

    let locBatches  = allLocBatches;
    let locBatches2 = [];

    if (row.TransType === 'TRF') {
      // For TRF, split by Qty sign: G1 rows have negative Qty (stock leaving),
      // G2 rows have positive Qty (stock arriving). This is reliable even for old
      // entries where fkGodownID may not match fkGodownID1/fkGodownID2 exactly.
      locBatches  = allLocBatches.filter((r) => parseFloat(r.Qty) < 0);
      locBatches2 = allLocBatches.filter((r) => parseFloat(r.Qty) > 0);
    }

    res.json({ ...row.toJSON(), godowns, lotDetail, locBatches, locBatches2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/transactions/dispatches  (create) ───────────────────────────────
router.post('/', requirePermission('DELIVERY', 'CanAdd'), async (req, res) => {
  const {
    TransType, TransDt, TransTm,
    fkPartyID, fkItemID, ItemExtDesc,
    pfkLotID: bodyPfkLotID, pfkOriLotID: bodyPfkOriLotID, LotNum: bodyLotNum,
    LotBillFlg: bodyLotBillFlg, OriTransDt: bodyOriTransDt, OriTransQty: bodyOriTransQty,
    Packing, PackingType, PackingColour,
    PackWght, GrossWght, ActualWght, RentRate, ItemRate,
    fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
    DoNum, VehiNum, BENum, BatchNum,
    TransExtDetail, TransNote, TransRemark,
    DelivOpt, PickupBy, OwnTransFlg, OutsideLabr,
    hamaliFlags, HamaliRecd, HamaliAmt, HmlBillAmt, OtherHmlAmt,
    GatePass: providedGatePass,
    partyCompID,
    locBatches,
  } = req.body;

  if (!TransType || !DISPATCH_TYPES.includes(TransType))
    return res.status(400).json({ error: `TransType must be one of: ${DISPATCH_TYPES.join(', ')}` });
  if (!TransDt)       return res.status(400).json({ error: 'Date is required' });
  if (!fkPartyID)     return res.status(400).json({ error: 'Party is required' });
  if (!bodyPfkLotID)  return res.status(400).json({ error: 'A Lot must be selected' });
  if (!DoNum)         return res.status(400).json({ error: 'Do Number is required' });
  if (!fkGodownID1 || !GodownQty1)
    return res.status(400).json({ error: 'Godown 1 and Quantity 1 are required' });

  const { db, compID, branchID } = getTargetContext(req, partyCompID);
  const { userId } = req.user;

  try {
    // 1. Generate pkTransID
    const transKey  = `${compID}!${branchID}!TSTOCKENT!PKTRANSID`;
    const transLong = await gudfGenSerialID(db, transKey, 'Stock Entry Trans ID', 'Y');
    if (transLong === -1) return res.status(500).json({ error: 'Failed to generate Transaction ID' });
    const pkTransID = buildSerialKey(compID, branchID, transLong);

    // 2. FaYear
    const faYear = await getFaYear(db, compID, TransDt);

    // 3. GatePass — MAX(GatePass)+1 from vatStockentry for this company/FaYear
    let gatePass = '';
    if (providedGatePass && String(providedGatePass).trim()) {
      gatePass = String(providedGatePass).trim();
    } else {
      const [gpRows] = await db.query(
        `SELECT MAX(CAST(GatePass AS UNSIGNED)) AS maxGP
         FROM vatStockentry
         WHERE FaYear = ? AND GatePass != ''`,
        { replacements: [faYear] }
      );
      const maxGP = gpRows.length > 0 && gpRows[0].maxGP ? Number(gpRows[0].maxGP) : 0;
      gatePass = String(maxGP + 1);
    }

    // 4. Quantities
    // TRF: qty1 negative (leaving godown1), qty2 POSITIVE (arriving at godown2)
    // DESP/OUT: both negative (stock leaving)
    const qty1     = -Math.abs(parseFloat(GodownQty1) || 0);
    const qty2     = fkGodownID2 && GodownQty2
      ? TransType === 'TRF'
        ?  Math.abs(parseFloat(GodownQty2))
        : -Math.abs(parseFloat(GodownQty2))
      : 0;
    const transQty = qty1 + qty2;

    // 5. HamaliCode
    const flags      = hamaliFlags || {};
    const hamaliCode = deriveHamaliCode(flags, HamaliRecd);

    // 6. Create entry
    const StockEntry = defineStockEntry(db);
    const now = new Date();
    const row = await StockEntry.create({
      pkTransID,
      TransID:       transLong,
      fkCompID:      compID,
      fkBranchID:    branchID,
      OpFlg:         'N',
      TransType,
      FaYear:        faYear,
      pfkLotID:      bodyPfkLotID,
      pfkOriLotID:   bodyPfkOriLotID || bodyPfkLotID,
      LotNum:        '',          // arrival-inherited — never store in dispatch
      fkPartyID,
      fkItemID:      fkItemID || '',
      ItemExtDesc:   '',          // arrival-inherited — never store in dispatch
      Packing:       '',          // arrival-inherited — never store in dispatch
      PackingType:   '',          // arrival-inherited — never store in dispatch
      PackingColour: '',          // arrival-inherited — never store in dispatch
      PackWght:      0,           // arrival-inherited — never store in dispatch
      GrossWght:     0,           // arrival-inherited — never store in dispatch
      RentRate:      0,           // arrival-inherited — never store in dispatch
      ItemRate:      0,           // arrival-inherited — never store in dispatch
      TransRemark:   '',          // arrival-inherited — never store in dispatch
      LotBillFlg:    bodyLotBillFlg || 'Y',
      OriTransDt:    null,           // arrival-inherited — never store in dispatch
      OriTransQty:   null,           // arrival-inherited — never store in dispatch
      TransDt,
      TransTm:       TransTm ? new Date(`${TransDt}T${TransTm}`) : now,
      TransQty:      transQty,
      DoNum:         DoNum     || '',
      GatePass:      gatePass,
      fkGodownID1:   fkGodownID1 || '',
      GodownQty1:    qty1,
      fkGodownID2:   (fkGodownID2 && qty2 !== 0) ? fkGodownID2 : '',
      GodownQty2:    qty2,
      VehiNum:       (VehiNum || '').toUpperCase(),
      BENum:         '',          // arrival-inherited — never store in dispatch
      ActualWght:    parseFloat(ActualWght) || 0,
      HamaliCode:    hamaliCode,
      HamaliRecd:    parseFloat(HamaliRecd)  || 0,
      HamaliAmt:     parseFloat(HamaliAmt)   || 0,
      HmlBillAmt:    parseFloat(HmlBillAmt)  || 0,
      OtherHmlAmt:   parseFloat(OtherHmlAmt) || 0,
      OutsideLabr:   OutsideLabr === true || OutsideLabr === 'Y' ? 'Y' : 'N',
      OwnTransFlg:   OwnTransFlg === true || OwnTransFlg === 'Y' ? 'Y' : 'N',
      BatchNum:      BatchNum       || '',
      TransNote:     TransNote      || '',
      TransExtDetail:TransExtDetail || '',
      DelivOpt:      DelivOpt       || '',
      PickupBy:      PickupBy       || '',
      UserID:        userId,
      CrMod:         now,
    });

    await writeAuditEntry(db, pkTransID, 'INS');
    await upsertLocBatches(db, pkTransID, TransType, locBatches, fkGodownID1, fkGodownID2 || '');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create dispatch entry' });
  }
});

// ── PUT /api/transactions/dispatches/:id  (update) ────────────────────────────
router.put('/:id', requirePermission('DELIVERY', 'CanEdit'), async (req, res) => {
  const {
    TransDt, TransTm,
    pfkLotID: bodyPfkLotID, pfkOriLotID: bodyPfkOriLotID,
    fkItemID, ItemExtDesc,
    LotNum,
    fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
    ActualWght,
    DoNum, VehiNum, BENum, BatchNum,
    TransExtDetail, TransNote, TransRemark,
    DelivOpt, PickupBy, OwnTransFlg, OutsideLabr,
    hamaliFlags, HamaliRecd, HamaliAmt, HmlBillAmt, OtherHmlAmt,
    GatePass: updatedGatePass,
    locBatches,
  } = req.body;

  if (!DoNum) return res.status(400).json({ error: 'Do Number is required' });

  try {
    const [targetCompID] = req.params.id.split('!');
    const { db } = getTargetContext(req, targetCompID);
    const StockEntry = defineStockEntry(db);

    const row = await StockEntry.findOne({
      where: { pkTransID: req.params.id, fkCompID: targetCompID },
    });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (!DISPATCH_TYPES.includes(row.TransType))
      return res.status(400).json({ error: 'Not a dispatch entry' });

    const qty1     = -Math.abs(parseFloat(GodownQty1) || 0);
    const qty2     = fkGodownID2 && GodownQty2
      ? row.TransType === 'TRF'
        ?  Math.abs(parseFloat(GodownQty2))
        : -Math.abs(parseFloat(GodownQty2))
      : 0;
    const flags    = hamaliFlags || {};
    const hamaliCode = deriveHamaliCode(flags, HamaliRecd);
    const oldGodown1 = row.fkGodownID1 || '';
    const oldGodown2 = row.fkGodownID2 || '';

    await writeAuditEntry(db, row.pkTransID, 'UPD1');
    await row.update({
      TransDt:       TransDt || row.TransDt,
      TransTm:       TransTm ? new Date(`${TransDt || row.TransDt}T${TransTm}`) : row.TransTm,
      pfkLotID:      bodyPfkLotID    || row.pfkLotID,
      pfkOriLotID:   bodyPfkOriLotID || bodyPfkLotID || row.pfkOriLotID,
      fkItemID:      fkItemID        || row.fkItemID,
      ItemExtDesc:   ItemExtDesc     || '',
      TransQty:      qty1 + qty2,
      DoNum:         DoNum    || '',
      fkGodownID1:   fkGodownID1 || '',
      GodownQty1:    qty1,
      fkGodownID2:   (fkGodownID2 && qty2 !== 0) ? fkGodownID2 : '',
      GodownQty2:    qty2,
      VehiNum:       (VehiNum || '').toUpperCase(),
      // Always reset arrival-inherited fields including OriTransDt / OriTransQty → NULL
      OriTransDt:    null,
      OriTransQty:   null,
      LotNum:        '',              // arrival-inherited — never store in dispatch
      BENum:         '',
      Packing:       '',
      PackingType:   '',
      PackingColour: '',
      PackWght:      0,
      GrossWght:     0,
      RentRate:      0,
      ItemRate:      0,
      ActualWght:    parseFloat(ActualWght) || 0,
      HamaliCode:    hamaliCode,
      HamaliRecd:    parseFloat(HamaliRecd)  || 0,
      HamaliAmt:     parseFloat(HamaliAmt)   || 0,
      HmlBillAmt:    parseFloat(HmlBillAmt)  || 0,
      OtherHmlAmt:   parseFloat(OtherHmlAmt) || 0,
      OutsideLabr:   OutsideLabr === true || OutsideLabr === 'Y' ? 'Y' : 'N',
      OwnTransFlg:   OwnTransFlg === true || OwnTransFlg === 'Y' ? 'Y' : 'N',
      BatchNum:      BatchNum       || '',
      TransNote:     TransNote      || '',
      TransExtDetail:TransExtDetail || '',
      DelivOpt:      DelivOpt       || '',
      PickupBy:      PickupBy       || '',
      GatePass:      updatedGatePass != null ? String(updatedGatePass).trim() : row.GatePass,
      UserID:        req.user.userId,
      CrMod:         new Date(),
    });
    await writeAuditEntry(db, row.pkTransID, 'UPD2');
    await upsertLocBatches(db, row.pkTransID, row.TransType, locBatches, fkGodownID1 || '', fkGodownID2 || '');
    const newGodown1 = fkGodownID1 || '';
    const newGodown2 = fkGodownID2 || '';
    if (oldGodown1 !== newGodown1) {
      await db.query(
        `UPDATE tstockentry_locbatch SET fkGodownID = ?
         WHERE cpkTransID = ? AND (fkGodownID = ? OR fkGodownID = '' OR fkGodownID IS NULL)`,
        { replacements: [newGodown1, row.pkTransID, oldGodown1] },
      );
    }
    if (oldGodown2 !== newGodown2) {
      await db.query(
        `UPDATE tstockentry_locbatch SET fkGodownID = ?
         WHERE cpkTransID = ? AND fkGodownID = ?`,
        { replacements: [newGodown2, row.pkTransID, oldGodown2] },
      );
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update dispatch entry' });
  }
});

// ── DELETE /api/transactions/dispatches/:id ───────────────────────────────────
router.delete('/:id', requirePermission('DELIVERY', 'CanDelete'), async (req, res) => {
  try {
    const [targetCompID] = req.params.id.split('!');
    const { db } = getTargetContext(req, targetCompID);
    const StockEntry = defineStockEntry(db);

    const row = await StockEntry.findOne({
      where: { pkTransID: req.params.id, fkCompID: targetCompID },
    });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (!DISPATCH_TYPES.includes(row.TransType))
      return res.status(400).json({ error: 'Not a dispatch entry' });

    await db.query(
      'DELETE FROM tstockentry_locbatch WHERE cpkTransID = ?',
      { replacements: [row.pkTransID] }
    );
    await writeAuditEntry(db, row.pkTransID, 'DEL');
    await row.destroy();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete dispatch entry' });
  }
});

// ── GET /api/transactions/dispatches/:id/gatepass  (generate Gate Pass PDF) ───
router.get('/:id/gatepass', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  const partyCompID = req.query.partyCompID;
  try {
    const [targetCompID] = req.params.id.split('!');
    const { db, compID } = getTargetContext(req, partyCompID || targetCompID);

    const StockEntry = defineStockEntry(db);
    const dispatch   = await StockEntry.findOne({ where: { pkTransID: req.params.id } });
    if (!dispatch) return res.status(404).json({ error: 'Entry not found' });

    const Party = defineParty(db);
    const party = await Party.findOne({ where: { pkPartyID: dispatch.fkPartyID } }) || {};

    const Item = defineItem(db);
    const item = await Item.findOne({ where: { pkItemID: dispatch.fkItemID } }) || {};

    const compDetails = connectionManager.getGroupCompanyDetails(req.user.groupID)
      .find((c) => c.pkCompID === compID) || { CompName: compID };

    // Fetch ARV entry for arrival-inherited fields (Packing, BatchNum, TransRemark, etc.)
    let arv = {};
    try {
      const [arvRows] = await db.query(
        `SELECT LotNum, Packing, PackingType, PackingColour, PackWght, GrossWght,
                BENum, BatchNum, TransRemark, ItemExtDesc, OriTransDt, OriTransQty
         FROM tStockEntry
         WHERE pfkLotID = ? AND TransType IN ('ARV', 'IN')
         LIMIT 1`,
        { replacements: [dispatch.pfkLotID] }
      );
      if (arvRows.length > 0) arv = arvRows[0];
    } catch {}

    // Fetch godown display name
    let godown1Name = '';
    try {
      if (dispatch.fkGodownID1) {
        const [gdRows] = await db.query(
          `SELECT gNum FROM mGodown WHERE pkGodownID = ? LIMIT 1`,
          { replacements: [dispatch.fkGodownID1] }
        );
        if (gdRows.length > 0) godown1Name = gdRows[0].gNum || '';
      }
    } catch {}

    // Current lot balance (post-dispatch, absolute value)
    let balance = 0;
    try {
      const [balRows] = await db.query(
        `SELECT SUM(GodownQty) AS TotalBalQty FROM vStkTransQty WHERE pfkLotID = ? AND fkCompID = ?`,
        { replacements: [dispatch.pfkLotID, compID] }
      );
      if (balRows.length > 0) balance = Math.max(0, Number(balRows[0].TotalBalQty) || 0);
    } catch {}

    const pdfBuffer = await generateGatePassPDF({
      dispatch:    dispatch.toJSON(),
      party:       party.toJSON ? party.toJSON() : party,
      item:        item.toJSON  ? item.toJSON()  : item,
      company:     compDetails,
      gatePassNum: dispatch.GatePass,
      arv,
      godown1Name,
      balance,
    });

    const filename = `GatePass_${dispatch.GatePass || dispatch.pkTransID}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to generate Gate Pass' });
  }
});

// ── POST /api/transactions/dispatches/:id/email  (send dispatch email) ────────
router.post('/:id/email', requirePermission('DELIVERY', 'CanView'), async (req, res) => {
  const { partyCompID } = req.body;
  try {
    const [targetCompID] = req.params.id.split('!');
    const { db, compID } = getTargetContext(req, partyCompID || targetCompID);

    const StockEntry = defineStockEntry(db);
    const dispatchRow = await StockEntry.findOne({ where: { pkTransID: req.params.id } });
    if (!dispatchRow) return res.status(404).json({ error: 'Entry not found' });
    const dispatch = dispatchRow.toJSON();

    const Party = defineParty(db);
    const party = await Party.findOne({ where: { pkPartyID: dispatch.fkPartyID } });
    if (!party || !party.pEmail)
      return res.status(400).json({ error: 'Party has no email address on file' });

    const Item = defineItem(db);
    const itemRow = await Item.findOne({ where: { pkItemID: dispatch.fkItemID } });
    const item = itemRow ? itemRow.toJSON() : {};

    // Fetch ARV entry for arrival-inherited fields (Packing, PackWght, LotNum, ItemExtDesc)
    let arv = {};
    try {
      const [arvRows] = await db.query(
        `SELECT LotNum, Packing, PackWght, ItemExtDesc
         FROM tStockEntry
         WHERE pfkLotID = ? AND TransType IN ('ARV', 'IN')
         LIMIT 1`,
        { replacements: [dispatch.pfkLotID] }
      );
      if (arvRows.length > 0) arv = arvRows[0];
    } catch {}

    const _groupComps = connectionManager.getGroupCompanyDetails(req.user.groupID);
    const compDetails = _groupComps.find((c) => c.IsPrimary === 'Y')
      || _groupComps.find((c) => c.pkCompID === compID)
      || { CompName: compID };

    const fmtNum = (v) => { const n = parseFloat(v); return isNaN(n) ? '' : (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2)); };
    const fmtDt  = (d) => {
      if (!d) return '';
      if (d instanceof Date) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = d.getFullYear();
        return `${dd}-${mm}-${yy}`;
      }
      const s = String(d).slice(0, 10);
      return s.split('-').reverse().join('-');
    };

    const packing   = dispatch.Packing  || arv.Packing  || '';
    const packWght  = parseFloat(arv.PackWght || dispatch.PackWght || 0);
    const lotNum    = dispatch.LotNum   || arv.LotNum   || '';
    const itemExtDesc = dispatch.ItemExtDesc || arv.ItemExtDesc || '';
    const itemDesc  = [item.iName, itemExtDesc].filter(Boolean).join(' ');
    const qty       = Math.abs(parseFloat(dispatch.GodownQty1 || 0)) + Math.abs(parseFloat(dispatch.GodownQty2 || 0));
    const wt        = fmtNum(packWght);
    const totalWt   = fmtNum(qty * packWght);
    const compName  = compDetails.CompName || compID;
    const typeLabel = { DESP: 'Despatch', TRF: 'Transfer', OUT: 'Out' }[dispatch.TransType] || dispatch.TransType;

    const subject = `Dispatched: ${fmtNum(qty)}${packing} ${itemDesc}`;

    const LS = 'font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;vertical-align:top;white-space:nowrap;padding-right:16px;';
    const VS = 'font-family:Arial,sans-serif;font-size:13px;color:#1e293b;vertical-align:top;text-align:left;';
    const RS = 'padding:9px 24px;border-bottom:1px solid #f4f6f9;text-align:left;';
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px 0;background:#e8edf4;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8edf4;">
<tr><td style="padding:0 12px;">
<table cellpadding="0" cellspacing="0" align="center" style="width:480px;max-width:100%;background:#ffffff;border-left:5px solid #f47920;box-shadow:0 6px 28px rgba(0,0,0,0.11);text-align:left;">
  <tr>
    <td style="padding:20px 24px 15px;border-bottom:2px solid #f0f4f8;text-align:left;">
      <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;">${compName}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#0d1b3e;">${typeLabel} Entry</p>
    </td>
  </tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">DATE</td><td style="${VS}">${fmtDt(dispatch.TransDt)}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">PARTY NAME</td><td style="${VS}">${party.pName || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">ITEM NAME</td><td style="${VS}">${itemDesc}</td></tr></table></td></tr>
  <tr>
    <td style="padding:10px 24px;background:#fffaf5;border-top:1px solid #fde8d0;border-bottom:1px solid #fde8d0;text-align:left;">
      <table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr>
        <td width="90" style="font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#c4620a;vertical-align:top;white-space:nowrap;padding-right:16px;text-align:left;">QUANTITY</td>
        <td style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#b45309;vertical-align:top;text-align:left;">${fmtNum(qty)} ${packing} &times; ${wt}kg = ${totalWt}kg</td>
      </tr></table>
    </td>
  </tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">DOC NO.</td><td style="${VS}">${dispatch.DoNum || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">PARTICULARS</td><td style="${VS}">${dispatch.TransExtDetail || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">VEHICLE NO.</td><td style="${VS}">${dispatch.VehiNum || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">LOT NO.</td><td style="${VS}">${lotNum}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">DELIVERY ON</td><td style="${VS}">${dispatch.DelivOpt || ''}</td></tr></table></td></tr>
  <tr>
    <td style="padding:12px 24px;border-top:1px solid #f0f4f8;text-align:left;">
      <table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr>
        <td style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;color:#0d1b3e;text-align:left;">${compName}</td>
        <td style="font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;text-align:right;">www.adityaservices.co.in</td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#f47920;padding:3px 0;"></td>
        <td style="background:#181266;padding:3px 0;"></td>
        <td style="background:#3065cf;padding:3px 0;"></td>
      </tr></table>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    // Use the dispatch company's current group (from connectionManager) rather than
    // the JWT-cached groupID so email routing is always correct regardless of session age.
    const dispatchGroupID = connectionManager.getCompanyInfo(compID)?.fkGroupID || req.user.groupID;
    await sendMail({ to: party.pEmail, subject, html, group: resolveEmailGroup(dispatchGroupID, 'ops') });

    res.json({ sent: true, to: party.pEmail });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

module.exports = router;
