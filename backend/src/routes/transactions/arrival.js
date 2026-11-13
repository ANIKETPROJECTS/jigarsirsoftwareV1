// TRANSACTION — Stock Entry (Arrival / DespReturn / TransIn)
// /api/transactions/arrivals
//
// pkTransID  : generated via gudfGenSerialID → 'CompID!BranchID!LastNum'
// pfkLotID   : generated via gudfGenSerialID → 'CompID!BranchID!LastNum'
// LotNum     : generated via SerialIDLot → '{pCode}{S|P|''}{2-digit-year}{padded3}'
//
// HamaliCode determination (6 checkboxes → code):
//   NO  : NoEntry
//   BA  : BillChk
//   LA  : LbrAmt
//   VB  : OnAc + Varai + BankTrf
//   VC  : OnAc + Varai
//   OB  : OnAc + BankTrf
//   OA  : OnAc (HamaliRecd = 0)
//   OC  : OnAc (HamaliRecd > 0)
//   CB  : BankTrf
//   CR  : (none)
//
// Delete guard: block if pfkLotID has entries with TransType NOT IN ('ARV','IN','DESPRET')

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineStockEntry  = require('../../models/company/StockEntry');
const defineParty       = require('../../models/company/Party');
const defineItem        = require('../../models/company/Item');
const defineRateChart        = require('../../models/company/RateChart');
const definePartyGodownLink  = require('../../models/company/PartyGodownLink');
const defineVCComboData      = require('../../models/company/VCComboData');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const { generateLotNum, syncSerialIDLot } = require('../../utils/lotNum');
const { getFaYear }     = require('../../utils/faYear');
const { writeAuditEntry } = require('../../utils/auditEntry');
const { Op }            = require('sequelize');
const connectionManager = require('../../config/connectionManager');

// Returns the DB and compID to use for a transaction.
// If the selected party belongs to a different company (partyCompID), switch to that company's DB.
function getTargetContext(req, partyCompID) {
  if (partyCompID && partyCompID !== req.user.compID) {
    const db = connectionManager.getDB(partyCompID);
    if (db) return { db, compID: partyCompID, branchID: req.user.branchID };
  }
  return { db: req.db, compID: req.user.compID, branchID: req.user.branchID };
}

router.use(requireAuth);

// ── LocBatch helper: delete then re-insert rows for a given transID ──────────
// ARV / IN / DESPRET are always inbound → Qty stored as positive.
async function upsertLocBatches(db, transID, transType, locBatches = []) {
  await db.query(
    'DELETE FROM tstockentry_locbatch WHERE cpkTransID = ?',
    { replacements: [transID] },
  );
  const valid = (locBatches || []).filter(
    (r) => r && String(r.batchNum || '').trim(),
  );
  if (!valid.length) return;
  const vals = valid.map((r, i) => [
    transID,
    i + 1,
    transType,
    r.fkGodownID   || '',
    r.fkLocationID || '',
    String(r.batchNum || 'NA').trim(),
    Math.abs(parseFloat(r.qty) || 0),
    r.remark || '',
  ]);
  await db.query(
    `INSERT INTO tstockentry_locbatch
       (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`,
    { replacements: vals.flat() },
  );
}

// ── Billable logic (mirrors VB6 udfValBillable) ─────────────────────────────
function computeBillable(pLotType, iType) {
  if (pLotType === 'ITM' && iType !== 'SPC') return { value: 'Y', editable: false };
  if (pLotType === 'SPC' && iType === 'SPC') return { value: 'Y', editable: false };
  if (pLotType === 'SPC' && iType === 'ITM') return { value: 'N', editable: false };
  if (pLotType === 'BOTH') return { value: 'Y', editable: true };
  return { value: 'Y', editable: false };
}

// ── HamaliCode derivation from 6 checkbox flags ──────────────────────────────
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

// ── GET /api/transactions/arrivals  (list) ───────────────────────────────────
// UNION ALL across every company DB in the group so cross-company arrivals appear together.
router.get('/', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    const { groupID } = req.user;
    const { transType, fromDt, toDt, partyID, itemID, godownID, lotNum, companyID } = req.query;

    const allCompanies = connectionManager.getGroupCompanyDetails(groupID);
    const companies    = companyID ? allCompanies.filter((c) => c.pkCompID === companyID) : allCompanies;
    if (companies.length === 0) return res.json([]);

    // Shared filter conditions (applied identically to every company sub-query)
    const subCond = [`ts.TransType IN ('ARV','IN','DESPRET')`];
    const subRepl = [];
    if (fromDt && toDt) { subCond.push('ts.TransDt BETWEEN ? AND ?'); subRepl.push(fromDt, toDt); }
    if (transType)  { subCond.push('ts.TransType = ?');                subRepl.push(transType); }
    if (partyID)    { subCond.push('ts.fkPartyID = ?');                subRepl.push(partyID); }
    if (itemID)     { subCond.push('ts.fkItemID = ?');                 subRepl.push(itemID); }
    if (godownID)   { subCond.push('(ts.fkGodownID1 = ? OR ts.fkGodownID2 = ?)'); subRepl.push(godownID, godownID); }
    if (lotNum)     { subCond.push('ts.LotNum LIKE ?');                subRepl.push(`%${lotNum}%`); }

    // One SELECT per company using fully-qualified `dbName`.`table` syntax
    const parts = companies.map(({ dbName, pkCompID }) => {
      const where = [`ts.fkCompID = '${pkCompID}'`, ...subCond].join(' AND ');
      return `
        SELECT ts.pkTransID, ts.TransID, ts.TransType, ts.TransDt, ts.TransTm, ts.LotNum,
               ts.fkCompID,  ts.fkPartyID, p.pName, p.pCode,
               ts.fkItemID,  im.iName, ts.ItemExtDesc,
               ts.TransQty,  ts.Packing, ts.PackWght,
               ts.fkGodownID1, g1.gNum AS godown1Num,
               ts.fkGodownID2, g2.gNum AS godown2Num,
               ts.CrMod
        FROM \`${dbName}\`.\`tStockEntry\` ts
        LEFT JOIN \`${dbName}\`.\`mParty\`  p  ON ts.fkPartyID   = p.pkPartyID
        LEFT JOIN \`${dbName}\`.\`mItem\`   im ON ts.fkItemID    = im.pkItemID
        LEFT JOIN \`${dbName}\`.\`mGodown\` g1 ON ts.fkGodownID1 = g1.pkGodownID
        LEFT JOIN \`${dbName}\`.\`mGodown\` g2 ON ts.fkGodownID2 = g2.pkGodownID
        WHERE ${where}`;
    });

    const sql = `SELECT * FROM (\n${parts.join('\nUNION ALL\n')}\n) _u
                 ORDER BY TransDt DESC, TransTm DESC`;

    // Each company part uses the same subRepl, so repeat them once per company
    const allRepl = companies.flatMap(() => [...subRepl]);
    const [rows] = await req.db.query(sql, { replacements: allRepl });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load entries' });
  }
});

// ── GET /api/transactions/arrivals/billable  (compute billable + LotNum preview) ──
router.get('/billable', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    const { partyID, itemID, partyCompID } = req.query;
    if (!partyID || !itemID) return res.status(400).json({ error: 'partyID and itemID required' });

    const { db, compID } = getTargetContext(req, partyCompID);
    const Party = defineParty(db);
    const Item  = defineItem(db);
    const party = await Party.findOne({ where: { pkPartyID: partyID, fkCompID: compID } });
    const item  = await Item.findOne({ where: { pkItemID: itemID } });
    if (!party || !item) return res.status(404).json({ error: 'Party or Item not found' });

    const result = computeBillable(party.pLotType, item.iType);
    res.json({ ...result, pCode: party.pCode, pLotType: party.pLotType, iType: item.iType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/arrivals/rate  (auto-calculate RentRate for ARV) ───
// Called on PackWght blur. Matches GR rate by party, Packing type, weight range, and date validity.
router.get('/rate', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    const { partyID, packing, weight, transDate, partyCompID } = req.query;
    if (!partyID || !packing) return res.status(400).json({ error: 'partyID and packing required' });

    const { db, compID } = getTargetContext(req, partyCompID);
    const RateChart = defineRateChart(db);
    const w = parseFloat(weight) || 0;
    const dt = transDate ? new Date(transDate) : new Date();
    const dateStr = dt.toISOString().slice(0, 10);

    const row = await RateChart.findOne({
      where: {
        fkCompID:    compID,
        fkPartyID:   partyID,
        RateType:    'GR',
        PackingType: packing,
        Active:      'Y',
        UnitFrom:    { [Op.lte]: w },
        UnitTo:      { [Op.gte]: w },
        FromDt:      { [Op.lte]: dateStr },
        [Op.or]:     [{ ToDt: null }, { ToDt: { [Op.gte]: dateStr } }],
      },
      order: [['FromDt', 'DESC']],
    });

    res.json({ BillRate: row ? Number(row.BillRate) : 0, ChargeType: row ? row.ChargeType : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/arrivals/hamali-rate  (auto-calculate Hamali amounts) ──
// Called when Hamali checkboxes change or PackWght changes.
router.get('/hamali-rate', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    const { partyID, packing, weight, hamaliCode, transType, transDate, partyCompID } = req.query;
    if (!partyID || !hamaliCode) return res.status(400).json({ error: 'partyID and hamaliCode required' });

    const { db, compID } = getTargetContext(req, partyCompID);
    const RateChart = defineRateChart(db);
    const dt = transDate ? new Date(transDate) : new Date();
    const dateStr = dt.toISOString().slice(0, 10);
    const w = parseFloat(weight) || 0;

    const row = await RateChart.findOne({
      where: {
        fkCompID:    compID,
        fkPartyID:   partyID,
        RateType:    'HM',
        TransType:   transType || '',
        HamaliCode:  hamaliCode,
        PackingType: packing || '',
        Active:      'Y',
        FromDt:      { [Op.lte]: dateStr },
        UnitFrom:    { [Op.lte]: w },
        UnitTo:      { [Op.gte]: w },
        [Op.or]: [{ ToDt: null }, { ToDt: { [Op.gte]: dateStr } }],
      },
      order: [['FromDt', 'DESC']],
    });

    const ctCode  = row ? (row.ChargeType || '') : '';
    let   ctLabel = ctCode;
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

// ── GET /api/transactions/arrivals/lot-list  (open ARV lots for IN/DESPRET) ───
// Returns ARV lots for the party in the given FaYear with their balance qty.
// For DESPRET: only lots with BalQty <> 0.  For IN: all lots (including zero bal).
// Also returns lot's item/packing details so the frontend can auto-fill on selection.
router.get('/lot-list', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  const { partyID, transType, transDate, partyCompID } = req.query;
  if (!partyID || !transDate) return res.status(400).json({ error: 'partyID and transDate required' });
  const { db, compID, branchID } = getTargetContext(req, partyCompID);
  // IN and DESPRET both add back to a lot (returns/transfers in), so show ALL lots
  // including zero-balance ones (a fully-dispatched lot can still receive returns).
  const showAllLots = ['IN', 'DESPRET'].includes(transType);

  const faYear = await getFaYear(db, compID, transDate);

  // Balance subquery uses pfkOriLotID so that ARV + IN + DESPRET + DESP movements
  // on the same original lot are all summed together regardless of which pfkLotID
  // each individual transaction was stored under.
  let sql = `
    SELECT ts.LotNum,
           TRIM(CONCAT(im.iName, ' ', COALESCE(ts.ItemExtDesc, ''))) AS iName,
           ts.pfkOriLotID,
           ts.pfkLotID,
           ts.fkItemID,
           ts.PackWght,
           ts.Packing,
           ts.PackingType,
           ts.PackingColour,
           ts.fkGodownID1,
           ts.fkGodownID2,
           ts.RentRate,
           ts.TransDt AS ArvTransDt,
           COALESCE(b.BalQty, 0) AS BalQty
    FROM tStockEntry AS ts
    LEFT JOIN mItem AS im ON im.pkItemID = ts.fkItemID
    LEFT JOIN (
      SELECT pfkOriLotID, SUM(GodownQty) AS BalQty
      FROM vStkTransQty
      WHERE fkCompID = ? AND fkBranchID = ?
      AND OpFlg = 'N'
      GROUP BY pfkOriLotID
    ) b ON b.pfkOriLotID = ts.pfkOriLotID
    WHERE ts.fkCompID = ?
      AND ts.fkBranchID = ?
      AND ts.fkPartyID = ?
      AND ts.TransType = 'ARV'
      AND ts.FaYear = ?
    GROUP BY ts.LotNum, im.iName, ts.ItemExtDesc,
             ts.pfkOriLotID, ts.pfkLotID,
             ts.fkItemID, ts.PackWght, ts.Packing, ts.PackingType, ts.PackingColour,
             ts.fkGodownID1, ts.fkGodownID2, ts.RentRate, ts.TransDt, b.BalQty
  `;
  if (!showAllLots) sql += ' HAVING COALESCE(b.BalQty, 0) <> 0';
  sql += ' ORDER BY ts.LotNum';

  try {
    const [rows] = await db.query(sql, { replacements: [compID, branchID, compID, branchID, partyID, faYear] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/arrivals/last-lot  (last LotNum for a party) ────────
router.get('/last-lot', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  const { partyID, partyCompID } = req.query;
  if (!partyID) return res.status(400).json({ error: 'partyID required' });
  const { db, compID } = getTargetContext(req, partyCompID);
  try {
    const [rows] = await db.query(
      `SELECT LotNum FROM tStockEntry
       WHERE fkCompID = ? AND fkPartyID = ? AND TransType = 'ARV' AND LotNum IS NOT NULL AND LotNum <> ''
       ORDER BY TransDt DESC, pkTransID DESC LIMIT 1`,
      { replacements: [compID, partyID] }
    );
    res.json({ LotNum: rows.length ? rows[0].LotNum : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/arrivals/insurance-check ───────────────────────────
// Checks if a party-godown combination is insured (LinkType='I') on the transaction date.
// Returns: { status: 'insured' | 'not_insured' | 'none' }
//   'none'        = no insurance links exist for this party at all → show nothing
//   'not_insured' = party has insurance links but this godown/date doesn't match
//   'insured'     = active matching link found
router.get('/insurance-check', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  const { partyID, godownID, transDate, partyCompID } = req.query;
  if (!partyID || !godownID || !transDate)
    return res.status(400).json({ error: 'partyID, godownID, and transDate required' });
  try {
    const { db } = getTargetContext(req, partyCompID);
    const PartyGodownLink = definePartyGodownLink(db);
    const dateStr = new Date(transDate).toISOString().slice(0, 10);

    const totalLinks = await PartyGodownLink.count({
      where: { fkPartyID: partyID, LinkType: 'I', Active: 'Y' },
    });
    if (totalLinks === 0) return res.json({ status: 'none' });

    const matchLink = await PartyGodownLink.findOne({
      where: {
        fkPartyID:  partyID,
        fkGodownID: godownID,
        LinkType:   'I',
        Active:     'Y',
        FromDt:     { [Op.lte]: dateStr },
        [Op.or]:    [{ ToDt: null }, { ToDt: { [Op.gte]: dateStr } }],
      },
    });
    res.json({ status: matchLink ? 'insured' : 'not_insured' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to check insurance' });
  }
});

// ── GET /api/transactions/arrivals/packing-types ─────────────────────────────
// Returns VCComboData rows for VCPurpose='PackingType', scoped to the target company.
// Accepts optional partyCompID to support cross-company arrival entries.
router.get('/packing-types', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    const { partyCompID } = req.query;
    const { db, compID, branchID } = getTargetContext(req, partyCompID);
    const VCComboData = defineVCComboData(db);
    const rows = await VCComboData.findAll({
      attributes: ['VCCode', 'VCData', 'VCSrtOrd'],
      where: { fkCompID: compID, VCPurpose: 'PackingType', VCActive: 'Y' },
      order: [['VCSrtOrd', 'ASC'], ['VCData', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load packing types' });
  }
});

// ── GET /api/transactions/arrivals/:id ────────────────────────────────────────
router.get('/:id', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  try {
    // pkTransID format = CompID!BranchID!N — derive target company from the key itself
    const [targetCompID] = req.params.id.split('!');
    const { db } = getTargetContext(req, targetCompID);

    const [rows] = await db.query(
      `SELECT ts.*, p.pName,
              (SELECT arv.TransDt FROM tStockEntry arv
               WHERE arv.pkTransID = ts.pfkOriLotID LIMIT 1) AS ArvTransDt
       FROM tStockEntry ts
       LEFT JOIN mParty p ON ts.fkPartyID = p.pkPartyID
       WHERE ts.pkTransID = ? AND ts.fkCompID = ?
       LIMIT 1`,
      { replacements: [req.params.id, targetCompID] }
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
    const [locBatches] = await db.query(
      `SELECT lb.*, ml.LocationCode, ml.LocationName
       FROM tstockentry_locbatch lb
       LEFT JOIN mLocation ml
         ON lb.fkLocationID COLLATE utf8mb4_unicode_ci = ml.pkLocationID COLLATE utf8mb4_unicode_ci
       WHERE lb.cpkTransID = ? ORDER BY lb.cpkSrNo`,
      { replacements: [req.params.id] }
    );
    res.json({ ...rows[0], locBatches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/transactions/arrivals  (create) ─────────────────────────────────
router.post('/', requirePermission('ARRIVAL', 'CanAdd'), async (req, res) => {
  const {
    TransType, TransDt, TransTm,
    fkPartyID, fkItemID, ItemExtDesc,
    Packing, PackingType, PackingColour,
    PackWght, GrossWght, ActualWght, RentRate, ItemRate,
    fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
    DoNum, VehiNum, BENum,
    LotNum: providedLotNum,                // user-supplied for non-ARV
    pfkLotID: providedPfkLotID,            // direct pfkLotID from lot-list selection
    pfkOriLotID: providedPfkOriLotID,      // original lot's pfkOriLotID from lot-list (for IN/DESPRET)
    hamaliFlags,
    HamaliRecd, HamaliAmt, HmlBillAmt, OtherHmlAmt,
    OutsideLabr, OwnTransFlg,
    TransRemark, BatchNum, TransNote, TransExtDetail,
    Billable,
    partyCompID,                     // company the selected party belongs to
    locBatches,
  } = req.body;

  if (!TransType || !TransDt || !fkPartyID || !fkItemID)
    return res.status(400).json({ error: 'TransType, Date, Party and Item are required' });
  if (!DoNum)
    return res.status(400).json({ error: 'Do Number is required' });
  if (!Packing || !String(Packing).trim())
    return res.status(400).json({ error: 'Packing is required' });
  if (!fkGodownID1 || !GodownQty1)
    return res.status(400).json({ error: 'Godown 1 and Quantity 1 are required' });
  // IN and DESPRET must link to an existing lot — pfkLotID is required
  if (['IN', 'DESPRET'].includes(TransType) && !providedPfkLotID)
    return res.status(400).json({ error: 'Lot selection is required for IN and DESPRET entries' });

  // All DB operations and serial keys use the party's company, not the logged-in user's company
  const { db, compID, branchID } = getTargetContext(req, partyCompID);
  const { userId } = req.user;
  const isArrival = TransType === 'ARV';

  try {
    // 1. Generate pkTransID
    const transKey  = `${compID}!${branchID}!TSTOCKENT!PKTRANSID`;
    const transLong = await gudfGenSerialID(db, transKey, 'Stock Entry Trans ID', 'Y');
    if (transLong === -1) return res.status(500).json({ error: 'Failed to generate Transaction ID' });
    const pkTransID = buildSerialKey(compID, branchID, transLong);

    // 2. pfkLotID — generate for ARV; look up from existing lot for non-ARV
    let pfkLotID = '';
    let lotNum   = '';
    if (isArrival) {
      const lotKey  = `${compID}!${branchID}!LOTID!PFKLOTID`;
      const lotLong = await gudfGenSerialID(db, lotKey, 'Lot ID', 'Y');
      if (lotLong === -1) return res.status(500).json({ error: 'Failed to generate Lot ID' });
      pfkLotID = buildSerialKey(compID, branchID, lotLong);
    } else if (providedPfkLotID) {
      // Came from lot-list Autocomplete — pfkLotID already known
      pfkLotID = providedPfkLotID;
      lotNum   = providedLotNum || '';
    } else if (providedLotNum) {
      // Fallback: look up pfkLotID from LotNum
      const [existing] = await db.query(
        `SELECT pfkLotID FROM tStockEntry
         WHERE LotNum = ? AND fkPartyID = ? AND fkCompID = ? AND TransType = 'ARV' LIMIT 1`,
        { replacements: [providedLotNum, fkPartyID, compID] }
      );
      pfkLotID = existing.length ? existing[0].pfkLotID : '';
      lotNum   = providedLotNum;
    }

    // 3. Party + Item lookup
    const Party = defineParty(db);
    const Item  = defineItem(db);
    const party = await Party.findOne({ where: { pkPartyID: fkPartyID, fkCompID: compID } });
    const item  = await Item.findOne({ where: { pkItemID: fkItemID } });
    if (!party) return res.status(400).json({ error: 'Party not found' });
    if (!item)  return res.status(400).json({ error: 'Item not found' });

    // 4. FaYear
    const faYear = await getFaYear(db, compID, TransDt);

    // 5. LotBillFlg & LotNum (ARV: 'Y'/'N' from checkbox; IN/DESPRET: '' per VB6)
    const lotBillFlg = isArrival ? (Billable === 'N' ? 'N' : 'Y') : '';
    if (isArrival) {
      lotNum = await generateLotNum(db, {
        compID, branchID,
        partyID:    fkPartyID,
        faYear,
        lotBillFlg,
        iType:      item.iType,
        pCode:      party.pCode,
      });
      if (!lotNum) return res.status(500).json({ error: 'Failed to generate Lot Number' });
    }

    // 6. HamaliCode + quantities
    const flags      = hamaliFlags || {};
    const hamaliCode = deriveHamaliCode(flags, HamaliRecd);
    const qty1       = parseFloat(GodownQty1) || 0;
    const qty2       = parseFloat(GodownQty2) || 0;
    const transQty   = qty1 + qty2;

    // 7. Insert — all fields saved for all TransTypes
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
      pfkLotID,
      pfkOriLotID:   isArrival ? pfkLotID : (providedPfkOriLotID || pfkLotID),
      LotNum:        lotNum,
      fkPartyID,
      fkItemID,
      ItemExtDesc:   ItemExtDesc   || '',
      Packing:       Packing       || '',
      PackingType:   PackingType   || '',
      PackingColour: PackingColour || '',
      PackWght:      parseFloat(PackWght)  || 0,
      GrossWght:     parseFloat(GrossWght) || 0,
      RentRate:      parseFloat(RentRate)  || 0,
      ItemRate:      parseFloat(ItemRate)  || 0,
      TransRemark:   TransRemark   || '',
      LotBillFlg:    lotBillFlg,
      OriTransDt:    TransDt,
      OriTransQty:   transQty,
      TransDt,
      TransTm:       TransTm ? new Date(`${TransDt}T${TransTm}`) : now,
      TransQty:      transQty,
      DoNum:         DoNum    || '',
      GatePass:      '',
      fkGodownID1:   fkGodownID1 || '',
      GodownQty1:    qty1,
      fkGodownID2:   fkGodownID2 || '',
      GodownQty2:    qty2,
      VehiNum:       VehiNum  || '',
      BENum:         BENum    || '',
      ActualWght:    parseFloat(ActualWght) || 0,
      HamaliCode:    hamaliCode,
      HamaliRecd:    parseFloat(HamaliRecd)   || 0,
      HamaliAmt:     parseFloat(HamaliAmt)    || 0,
      HmlBillAmt:    parseFloat(HmlBillAmt)   || 0,
      OtherHmlAmt:   parseFloat(OtherHmlAmt)  || 0,
      OutsideLabr:   OutsideLabr === true || OutsideLabr === 'Y' ? 'Y' : 'N',
      OwnTransFlg:   OwnTransFlg === true || OwnTransFlg === 'Y' ? 'Y' : 'N',
      BatchNum:      BatchNum       || null,
      TransNote:     TransNote      || null,
      TransExtDetail:TransExtDetail || null,
      DelivOpt:      '',
      UserID:        userId,
      CrMod:         now,
    });

    await writeAuditEntry(db, pkTransID, 'INS');
    await upsertLocBatches(db, pkTransID, TransType, locBatches);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create entry' });
  }
});

// ── PUT /api/transactions/arrivals/:id  (update) ──────────────────────────────
router.put('/:id', requirePermission('ARRIVAL', 'CanEdit'), async (req, res) => {
  const {
    TransDt, TransTm,
    ItemExtDesc, Packing, PackingType, PackingColour,
    PackWght, GrossWght, ActualWght, RentRate, ItemRate,
    fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
    DoNum, VehiNum, BENum,
    hamaliFlags, HamaliRecd, HamaliAmt, HmlBillAmt, OtherHmlAmt,
    OutsideLabr, OwnTransFlg,
    TransRemark, BatchNum, TransNote, TransExtDetail,
    Billable,
    locBatches,
  } = req.body;

  if (!DoNum)    return res.status(400).json({ error: 'Do Number is required' });
  if (!Packing || !String(Packing).trim())
    return res.status(400).json({ error: 'Packing is required' });

  try {
    // pkTransID encodes the owning company: 'CompID!BranchID!N'
    // Use that company's DB, not necessarily the logged-in user's DB.
    const [targetCompID] = req.params.id.split('!');
    const { db } = getTargetContext(req, targetCompID);

    const StockEntry = defineStockEntry(db);
    const row = await StockEntry.findOne({
      where: { pkTransID: req.params.id, fkCompID: targetCompID },
    });
    if (!row) return res.status(404).json({ error: 'Entry not found' });

    // Capture old godown IDs before update so we can sync locbatch afterwards.
    const oldGodown1 = row.fkGodownID1 || '';
    const oldGodown2 = row.fkGodownID2 || '';

    const qty1       = parseFloat(GodownQty1) || 0;
    const qty2       = parseFloat(GodownQty2) || 0;
    const flags      = hamaliFlags || {};
    const hamaliCode = deriveHamaliCode(flags, HamaliRecd);

    await writeAuditEntry(db, row.pkTransID, 'UPD1');
    await row.update({
      TransDt:       TransDt || row.TransDt,
      TransTm:       TransTm ? new Date(`${TransDt || row.TransDt}T${TransTm}`) : row.TransTm,
      TransQty:      qty1 + qty2,
      OriTransQty:   qty1 + qty2,
      DoNum:         DoNum    || '',
      fkGodownID1:   fkGodownID1 || '',
      GodownQty1:    qty1,
      fkGodownID2:   fkGodownID2 || '',
      GodownQty2:    qty2,
      VehiNum:       VehiNum  || '',
      BENum:         BENum    || '',
      ItemExtDesc:   ItemExtDesc   || '',
      Packing:       Packing       || '',
      PackingType:   PackingType   || '',
      PackingColour: PackingColour || '',
      PackWght:      parseFloat(PackWght)  || 0,
      GrossWght:     parseFloat(GrossWght) || 0,
      ActualWght:    parseFloat(ActualWght) || 0,
      RentRate:      parseFloat(RentRate)  || 0,
      ItemRate:      parseFloat(ItemRate)  || 0,
      LotBillFlg:    row.TransType === 'ARV' ? (Billable === 'N' ? 'N' : 'Y') : '',
      HamaliCode:    hamaliCode,
      HamaliRecd:    parseFloat(HamaliRecd)   || 0,
      HamaliAmt:     parseFloat(HamaliAmt)    || 0,
      HmlBillAmt:    parseFloat(HmlBillAmt)   || 0,
      OtherHmlAmt:   parseFloat(OtherHmlAmt)  || 0,
      OutsideLabr:   OutsideLabr === true || OutsideLabr === 'Y' ? 'Y' : 'N',
      OwnTransFlg:   OwnTransFlg === true || OwnTransFlg === 'Y' ? 'Y' : 'N',
      TransRemark:   TransRemark    || '',
      BatchNum:      BatchNum       || null,
      TransNote:     TransNote      || null,
      TransExtDetail:TransExtDetail  || null,
      UserID:        req.user.userId,
      CrMod:         new Date(),
    });
    await writeAuditEntry(db, row.pkTransID, 'UPD2');

    const newGodown1 = fkGodownID1 || '';
    const newGodown2 = fkGodownID2 || '';

    // 1. Re-insert locbatch rows if the frontend sent them.
    if (locBatches && locBatches.length) {
      await upsertLocBatches(db, row.pkTransID, row.TransType, locBatches);
    }

    // 2. Always sync godown changes in locbatch rows, regardless of whether
    //    locBatches was sent. Runs AFTER any upsert so it corrects whatever
    //    fkGodownID ended up in the table.
    //    The godown1 WHERE also covers '' / NULL rows (legacy data or rows
    //    inserted without an explicit godown) so they get assigned to godown1.
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
    res.status(500).json({ error: err.message || 'Failed to update entry' });
  }
});

// ── DELETE /api/transactions/arrivals/:id ────────────────────────────────────
router.delete('/:id', requirePermission('ARRIVAL', 'CanDelete'), async (req, res) => {
  try {
    // pkTransID format = CompID!BranchID!N — derive target company and branch from the key
    const [targetCompID, targetBranchID] = req.params.id.split('!');
    const { db } = getTargetContext(req, targetCompID);
    const StockEntry = defineStockEntry(db);
    const row = await StockEntry.findOne({
      where: { pkTransID: req.params.id, fkCompID: targetCompID },
    });
    if (!row) return res.status(404).json({ error: 'Entry not found' });

    // Deletion guard — rules differ by TransType:
    //
    // ARV: block if ANY other entry shares the same pfkLotID (IN, DESPRET, DESP, TRF, OUT, etc.)
    //      pfkLotID for ARV = its own pkTransID, and every linked entry carries that same pfkLotID.
    //      Old guards missed IN/DESPRET because they were excluded from the NOT IN list.
    //
    // IN / DESPRET: only block if outward entries (DESP/TRF/OUT) exist for the lot,
    //               because the ARV itself also shares the pfkLotID and must not block these.
    if (row.TransType === 'ARV') {
      const [linkRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM tStockEntry
         WHERE pfkLotID = ? AND fkCompID = ? AND pkTransID != ?`,
        { replacements: [row.pfkLotID, targetCompID, req.params.id] }
      );
      if (Number(linkRows[0].cnt) > 0) {
        return res.status(400).json({
          error: 'Cannot delete: Other entries (IN / Return / Delivery) exist for this Lot. Delete those first.',
        });
      }
    // IN / DESPRET: no deletion guard — these entries are standalone additive records
    // and can always be deleted regardless of other entries on the same lot.
    }

    // Before deleting: check if this is the latest ARV lot for the party+faYear.
    // If it is, we'll re-sync SerialIDLot after deletion to the new actual max.
    let syncSerial = false;
    let serialIType = 'ITM';
    if (row.TransType === 'ARV' && row.LotNum) {
      const Item = defineItem(db);
      const item = await Item.findOne({ where: { pkItemID: row.fkItemID } });
      serialIType = item ? item.iType : 'ITM';

      const [maxRows] = await db.query(
        `SELECT MAX(LotNum) AS maxLot FROM tStockEntry
         WHERE fkPartyID=? AND fkCompID=? AND FaYear=? AND TransType='ARV' AND LotNum != ''`,
        { replacements: [row.fkPartyID, targetCompID, row.FaYear] }
      );
      syncSerial = maxRows.length > 0 && maxRows[0].maxLot === row.LotNum;
    }

    // Delete the entry (locbatch child rows first)
    await db.query(
      'DELETE FROM tstockentry_locbatch WHERE cpkTransID = ?',
      { replacements: [row.pkTransID] }
    );
    await writeAuditEntry(db, row.pkTransID, 'DEL');
    await row.destroy();

    // After deletion: set SerialIDLot.LastNum to the new actual MAX lot number.
    // This handles gaps — e.g. if AD26005/6 were already deleted, after deleting AD26007
    // the new max might be AD26002, so LastNum is SET to 2 (not blindly decremented).
    if (syncSerial) {
      await syncSerialIDLot(db, {
        compID:     targetCompID,
        branchID:   targetBranchID,
        partyID:    row.fkPartyID,
        faYear:     row.FaYear,
        lotBillFlg: row.LotBillFlg,
        iType:      serialIType,
      });
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete entry' });
  }
});

// ── GET /api/transactions/arrivals/:id/note  (download arrival note PDF) ────────
router.get('/:id/note', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  const partyCompID = req.query.partyCompID;
  try {
    const { db, compID } = getTargetContext(req, partyCompID);

    const StockEntry = defineStockEntry(db);
    const arrival    = await StockEntry.findOne({ where: { pkTransID: req.params.id } });
    if (!arrival) return res.status(404).json({ error: 'Entry not found' });

    const Party = defineParty(db);
    const party = await Party.findOne({ where: { pkPartyID: arrival.fkPartyID } }) || {};

    const Item = defineItem(db);
    const item = await Item.findOne({ where: { pkItemID: arrival.fkItemID } }) || {};

    const compDetails = connectionManager.getGroupCompanyDetails(req.user.groupID)
      .find((c) => c.pkCompID === compID) || { CompName: compID };

    const { generateArrivalNotePDF } = require('../../utils/arrivalNote');
    const pdfBuffer = await generateArrivalNotePDF({
      party:   party.toJSON ? party.toJSON() : {},
      item:    item.toJSON  ? item.toJSON()  : {},
      arrival: arrival.toJSON(),
      company: compDetails,
      groupID: req.user.groupID,
    });

    const filename = `ArrivalNote_${arrival.LotNum || arrival.pkTransID}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to generate note' });
  }
});

// ── POST /api/transactions/arrivals/:id/email  (send arrival note) ─────────────
router.post('/:id/email', requirePermission('ARRIVAL', 'CanView'), async (req, res) => {
  const { partyCompID } = req.body;
  try {
    const { db, compID } = getTargetContext(req, partyCompID);

    const StockEntry = defineStockEntry(db);
    const arrival    = await StockEntry.findOne({ where: { pkTransID: req.params.id } });
    if (!arrival) return res.status(404).json({ error: 'Entry not found' });

    const Party = defineParty(db);
    const party = await Party.findOne({ where: { pkPartyID: arrival.fkPartyID } });
    if (!party || !party.pEmail)
      return res.status(400).json({ error: 'Party has no email address on file' });

    const Item = defineItem(db);
    const item = await Item.findOne({ where: { pkItemID: arrival.fkItemID } }) || {};

    const _groupComps = connectionManager.getGroupCompanyDetails(req.user.groupID);
    const compDetails = _groupComps.find((c) => c.IsPrimary === 'Y')
      || _groupComps.find((c) => c.pkCompID === compID)
      || { CompName: compID };

    const { generateArrivalNotePDF } = require('../../utils/arrivalNote');
    const { sendMail }               = require('../../utils/mailer');
    const { resolveEmailGroup }      = require('../../utils/resolveEmailGroup');

    const pdfBuffer = await generateArrivalNotePDF({
      party:   party.toJSON(),
      item:    item.toJSON ? item.toJSON() : item,
      arrival: arrival.toJSON(),
      company: compDetails,
      groupID: req.user.groupID,
    });

    const fmtNum  = (v) => { const n = parseFloat(v); return isNaN(n) ? '' : (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2)); };
    const fmtDt   = (d) => {
      if (!d) return '';
      if (d instanceof Date) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}-${mm}-${d.getFullYear()}`;
      }
      return String(d).slice(0, 10).split('-').reverse().join('-');
    };
    const itemDesc = [item.iName, arrival.ItemExtDesc].filter(Boolean).join(' ');
    const qty      = fmtNum(arrival.GodownQty1);
    const wt       = fmtNum(arrival.PackWght);
    const totalWt  = fmtNum(parseFloat(arrival.GodownQty1 || 0) * parseFloat(arrival.PackWght || 0));
    const compName = compDetails.CompName || compID;

    const subject = `Arrived: ${qty}${arrival.Packing} ${itemDesc}`;

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
      <p style="margin:0;font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#0d1b3e;">Arrival Entry</p>
    </td>
  </tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">DATE</td><td style="${VS}">${fmtDt(arrival.TransDt)}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">PARTY NAME</td><td style="${VS}">${party.pName || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">ITEM NAME</td><td style="${VS}">${itemDesc}</td></tr></table></td></tr>
  <tr>
    <td style="padding:10px 24px;background:#fffaf5;border-top:1px solid #fde8d0;border-bottom:1px solid #fde8d0;text-align:left;">
      <table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr>
        <td width="90" style="font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#c4620a;vertical-align:top;white-space:nowrap;padding-right:16px;text-align:left;">QUANTITY</td>
        <td style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#b45309;vertical-align:top;text-align:left;">${qty} ${arrival.Packing} &times; ${wt}kg = ${totalWt}kg</td>
      </tr></table>
    </td>
  </tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">LOT NO.</td><td style="${VS}">${arrival.LotNum || ''}</td></tr></table></td></tr>
  <tr><td style="${RS}"><table width="100%" cellpadding="0" cellspacing="0" style="text-align:left;"><tr><td width="90" style="${LS}">DOC NO.</td><td style="${VS}">${arrival.BENum || ''}</td></tr></table></td></tr>
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

    await sendMail({
      to:          party.pEmail,
      subject,
      html,
      group:       resolveEmailGroup(req.user.groupID, 'ops'),
      attachments: [{
        filename:    `ArrivalNote_${arrival.LotNum || arrival.pkTransID}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    res.json({ sent: true, to: party.pEmail });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

module.exports = router;
