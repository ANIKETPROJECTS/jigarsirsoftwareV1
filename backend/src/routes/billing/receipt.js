// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BILLING â€” Receipt Entry (Payment Receipt)
// /api/billing/receipts
//
// VB6 Source: frmPayment.frm (class: frmReceipt)
//
// TABLES (company DB):
//   tRecpt1          â€” receipt header (one row per receipt)
//   tRecpt2          â€” receipt allocation detail (one row per bill per receipt)
//   vInvoice_Recpt_Amt â€” view combining tBill1 + tBillTrHmGen1 with balance
//   mBank            â€” bank master
//   mParty           â€” party master
//   vcComboData      â€” configurable combo values (receipt mode, type)
//
// VIEW SETUP â€” run once per company DB if not already present:
//   CREATE OR REPLACE VIEW vInvoice_Recpt_Amt AS
//   SELECT b.pkBillID, 'GODRENT' AS BillType, b.fkPartyID, b.fkCompID, b.fkBranchID,
//          b.BillDt, b.BillNum, b.GrossAmt, b.NetAmt, b.BillStatus,
//          IFNULL(b.NetAmt, b.GrossAmt) - IFNULL(
//            (SELECT SUM(r2.RecptAmt + r2.TDSAmt) FROM tRecpt2 r2
//             WHERE r2.fkBillID = b.pkBillID AND r2.BillType = 'GODRENT'), 0) AS BalanceAmt
//   FROM tBill1 b
//   UNION ALL
//   SELECT b.pkBillID, b.BillType, b.fkPartyID, b.fkCompID, b.fkBranchID,
//          b.BillDt, b.BillNum, b.GrossAmt, b.NetAmt, b.BillStatus,
//          IFNULL(b.NetAmt, b.GrossAmt) - IFNULL(
//            (SELECT SUM(r2.RecptAmt + r2.TDSAmt) FROM tRecpt2 r2
//             WHERE r2.fkBillID = b.pkBillID AND r2.BillType = b.BillType), 0) AS BalanceAmt
//   FROM tBillTrHmGen1 b;
//
// RECEIPT TYPE (vcComboData vcPurpose='RecptType'):
//   N = Normal      â€” RecptAmt must exactly equal SUM(TotAmt in grid)
//   O = On Account  â€” RecptAmt >= SUM(TotAmt) and TotAmt > 0
//   A = Advance     â€” pure advance, grid must be empty (TotAmt = 0 or no bills selected)
//
// BILL TYPES:
//   GODRENT = Godown Rent (tBill1)
//   HMLI    = Hamali      (tBillTrHmGen1)
//   TRSP    = Transport   (tBillTrHmGen1)
//   GEN     = General     (tBillTrHmGen1)
//
// GRID MATH (matches VB6 vfgReceiptEnt_AfterEdit):
//   TotAmt   = RecdAmt - TDSAmt - DiscAmt    (stored as r2.RecptAmt)
//   BalAmt   = BillBalAmt - RecdAmt
//   TDSAmt   = GrAmt * TDSPernt / 100        (when TDS% typed)
//   TDSPernt = ROUND(TDSAmt / GrAmt * 100)   (when TDS$ typed)
//
// PERMISSIONS: BILLING module
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const router             = require('express').Router();
const requireAuth        = require('../../middleware/auth');
const requirePerm        = require('../../middleware/permission');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const connectionManager  = require('../../config/connectionManager');

router.use(requireAuth);

const localStr = d => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

// â”€â”€ GET /form-data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns parties, receipt modes, receipt types, banks, permissions
router.get('/form-data', requirePerm('RECEIPT_ENTRY', 'CanView'), async (req, res) => {
  const { compID, branchID, groupID } = req.user;

  try {
    const db = req.db;

    // Load parties from ALL group company DBs so cross-company parties appear
    // in the dropdown — same UNION ALL pattern used by the arrivals list.
    // Each row carries fkCompID so the UI can show which company the party belongs to.
    const allCompanies = connectionManager.getGroupCompanyDetails(groupID);
    const partyParts   = allCompanies.map(({ dbName }) =>
      `SELECT pkPartyID, pName, pCode, fkCompID, StFlagGodRent, StFlagTrans
       FROM \`${dbName}\`.\`mParty\`
       WHERE Active = 'Y'`
    );
    const [parties] = await db.query(
      partyParts.join(' UNION ALL ') + ' ORDER BY pName'
    );

    // Receipt modes from configurable combo table
    let recptModes = [];
    try {
      const [modes] = await db.query(
        `SELECT vcData AS label, vcCode AS value
         FROM vcComboData
         WHERE fkCompID = ? AND fkBranchID = ? AND vcActive = 'Y' AND vcPurpose = 'PmtRcptMode'
         ORDER BY vcSrtOrd`,
        { replacements: [compID, branchID] }
      );
      recptModes = modes;
    } catch {
      recptModes = [
        { label: 'Cash',   value: 'C' },
        { label: 'Cheque', value: 'Q' },
        { label: 'RTGS',   value: 'R' },
        { label: 'NEFT',   value: 'N' },
      ];
    }

    // Receipt types (global â€” no compID filter in VB6)
    let recptTypes = [];
    try {
      const [types] = await db.query(
        `SELECT vcData AS label, vcCode AS value
         FROM vcComboData
         WHERE vcActive = 'Y' AND vcPurpose = 'RecptType'
         ORDER BY vcSrtOrd`
      );
      recptTypes = types;
    } catch {
      recptTypes = [
        { label: 'Normal',     value: 'N' },
        { label: 'On Account', value: 'O' },
        { label: 'Advance',    value: 'A' },
      ];
    }

    // Banks
    const [banks] = await db.query(
      `SELECT pkBankID AS value, bName AS label
       FROM mBank
       WHERE Active = 'Y' AND fkCompID = ?
       ORDER BY bName`,
      { replacements: [compID] }
    );

    // Permissions â€” query mPermission directly (same pattern as billReport.js)
    const permRows = await req.adminDB.query(
      `SELECT CanAdd, CanEdit, CanDelete FROM mPermission
       WHERE fkRoleID = ? AND ModuleCode = 'RECEIPTS'`,
      { replacements: [req.user.roleID] }
    );
    const perm = permRows[0]?.[0] || {};

    res.json({
      parties,
      recptModes,
      recptTypes,
      banks,
      canAdd:    perm.CanAdd    === 'Y',
      canEdit:   perm.CanEdit   === 'Y',
      canDelete: perm.CanDelete === 'Y',
    });
  } catch (err) {
    console.error('receipt/form-data', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tab 0 list: filter by date range + optional text search
// VB6: cmdView_Click â†’ dlgSearch with tRecpt1 join vamParty
router.get('/search', requirePerm('RECEIPT_ENTRY', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const { q, fromDate, toDate } = req.query;

  try {
    const db = req.db;
    const conditions   = ['r1.fkCompID = ?', 'r1.fkBranchID = ?'];
    const replacements = [compID, branchID];

    if (fromDate) {
      conditions.push('r1.RecptDt >= ?');
      replacements.push(fromDate);
    }
    if (toDate) {
      conditions.push('r1.RecptDt < DATE_ADD(?, INTERVAL 1 DAY)');
      replacements.push(toDate);
    }
    if (q) {
      const like = `%${q}%`;
      conditions.push('(p.pName LIKE ? OR CAST(r1.RecptAmt AS CHAR) LIKE ?)');
      replacements.push(like, like);
    }

    const [rows] = await db.query(
      `SELECT r1.pkRecptID, r1.RecptDt, r1.RecptAmt, r1.RecptType,
              p.pName AS partyName
       FROM tRecpt1 r1
       JOIN mParty p ON p.pkPartyID = r1.fkPartyID
       WHERE ${conditions.join(' AND ')}
       ORDER BY r1.RecptDt DESC, p.pName ASC
       LIMIT 500`,
      { replacements }
    );
    res.json(rows);
  } catch (err) {
    console.error('receipt/search', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /pending-advances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns pending advance receipts for a party (VB6: udfFillPendingAmtGrid)
// Shows receipts where some amount is still unallocated to bills
router.get('/pending-advances', requirePerm('RECEIPT_ENTRY', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const { partyId } = req.query;
  if (!partyId) return res.json([]);

  try {
    const db = req.db;
    // VB6 udfFillPendingAmtGrid: Bal = t1.RecptAmt - Sum(t2.RecptAmt)
    // t2.RecptAmt stores TotAmt = RecdAmt - TDSAmt - DiscAmt (net cash allocated per bill).
    // t1.RecptAmt is the total cash received (net of TDS); TDSAmt must NOT be added back
    // â€” doing so over-subtracts and produces negative/wrong pending amounts when TDS exists.
    const [rows] = await db.query(
      `SELECT t1.pkRecptID, t1.RecptDt, t1.RecptAmt, t1.RecptType,
              (t1.RecptAmt - IFNULL(SUM(t2.RecptAmt), 0)) AS PendAmt
       FROM tRecpt1 t1
       LEFT JOIN tRecpt2 t2 ON t2.cpkRecptID = t1.pkRecptID
       WHERE t1.fkPartyID = ? AND t1.fkCompID = ? AND t1.fkBranchID = ?
       GROUP BY t1.pkRecptID, t1.RecptAmt, t1.RecptDt, t1.RecptType
       HAVING PendAmt <> 0 OR PendAmt IS NULL
       ORDER BY t1.RecptDt`,
      { replacements: [partyId, compID, branchID] }
    );
    res.json(rows);
  } catch (err) {
    console.error('receipt/pending-advances', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /bills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns pending bills for party + bill types (VB6: udfFillBill)
// Bypasses vInvoice_Recpt_Amt view to avoid per-row correlated subqueries:
//   - Filters base tables first (uses indexes on compID/branchID/partyID/status/date)
//   - Joins a single pre-aggregated tRecpt2 subquery instead of N correlated lookups
router.get('/bills', requirePerm('RECEIPT_ENTRY', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const { partyId, billTypes, receiptDate } = req.query;

  if (!partyId || !receiptDate) return res.status(400).json({ error: 'partyId and receiptDate required' });

  const typesArr = billTypes ? billTypes.split(',').map(t => t.trim()).filter(Boolean) : [];
  if (!typesArr.length) return res.status(400).json({ error: 'At least one bill type required' });

  try {
    const db = req.db;
    const parts        = [];
    const replacements = [];

    const hasGodrent = typesArr.includes('GODRENT');
    const otherTypes = typesArr.filter(t => t !== 'GODRENT');

    // â”€â”€ GODRENT bills (tBill1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (hasGodrent) {
      parts.push(
        `SELECT b.pkBillID, 'GODRENT' AS BillType, b.BillDt, b.BillNum,
                b.GrossAmt, b.NetAmt,
                IFNULL(b.NetAmt, b.GrossAmt) - IFNULL(r.paid, 0) AS BalanceAmt
         FROM tBill1 b
         LEFT JOIN (
           SELECT fkBillID, SUM(RecptAmt + TDSAmt) AS paid
           FROM tRecpt2
           WHERE BillType = 'GODRENT'
           GROUP BY fkBillID
         ) r ON r.fkBillID = b.pkBillID
         WHERE b.fkCompID = ? AND b.fkBranchID = ? AND b.fkPartyID = ?
           AND b.BillStatus = 'N' AND b.BillDt <= ?
         HAVING BalanceAmt <> 0`
      );
      replacements.push(compID, branchID, partyId, receiptDate);
    }

    // â”€â”€ HMLI / TRSP / GEN bills (tBillTrHmGen1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (otherTypes.length) {
      const ph = otherTypes.map(() => '?').join(',');
      parts.push(
        `SELECT b.pkBillID, b.BillType, b.BillDt, b.BillNum,
                b.GrossAmt, b.NetAmt,
                IFNULL(b.NetAmt, b.GrossAmt) - IFNULL(r.paid, 0) AS BalanceAmt
         FROM tBillTrHmGen1 b
         LEFT JOIN (
           SELECT fkBillID, BillType, SUM(RecptAmt + TDSAmt) AS paid
           FROM tRecpt2
           WHERE BillType IN (${ph})
           GROUP BY fkBillID, BillType
         ) r ON r.fkBillID = b.pkBillID AND r.BillType = b.BillType
         WHERE b.fkCompID = ? AND b.fkBranchID = ? AND b.fkPartyID = ?
           AND b.BillStatus = 'N' AND b.BillDt <= ?
           AND b.BillType IN (${ph})
         HAVING BalanceAmt <> 0`
      );
      // Order of ? in the SQL above: inner subquery IN, outer WHERE cols, outer WHERE IN
      replacements.push(...otherTypes, compID, branchID, partyId, receiptDate, ...otherTypes);
    }

    const sql = parts.join(' UNION ALL ') + ' ORDER BY BillDt, BillType';
    const [rows] = await db.query(sql, { replacements });
    res.json(rows);
  } catch (err) {
    console.error('receipt/bills', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns full receipt for editing (VB6: Modify mode in udfInitialiseControls)
router.get('/:id', requirePerm('RECEIPT_ENTRY', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const { id } = req.params;

  try {
    const db = req.db;
    // Header
    const [hdrs] = await db.query(
      `SELECT r1.*, p.pName AS partyName
       FROM tRecpt1 r1
       JOIN mParty p ON p.pkPartyID = r1.fkPartyID
       WHERE r1.fkCompID = ? AND r1.fkBranchID = ? AND r1.pkRecptID = ?`,
      { replacements: [compID, branchID, id] }
    );
    if (!hdrs.length) return res.status(404).json({ error: 'Receipt not found' });
    const hdr = hdrs[0];

    // Detail â€” join vInvoice_Recpt_Amt with tRecpt2 for this receipt
    // BalanceAmt in view already excludes this receipt's payment, so we add it back
    // to restore the bill's balance BEFORE this receipt was applied.
    const [det] = await db.query(
      `SELECT vbr.pkBillID, vbr.BillType, vbr.BillNum, vbr.BillDt,
              vbr.GrossAmt, vbr.NetAmt, vbr.BalanceAmt AS viewBalAmt,
              r2.cpkRecptID, r2.cpkSrNo, r2.RecptAmt AS storedRecptAmt,
              r2.TDSAmt AS storedTDSAmt, r2.DiscAmt, r2.rRemark
       FROM vInvoice_Recpt_Amt vbr
       LEFT JOIN tRecpt2 r2
         ON vbr.pkBillID = r2.fkBillID AND vbr.BillType = r2.BillType
            AND r2.cpkRecptID = ?
       WHERE vbr.fkPartyID = ?
         AND (r2.cpkRecptID = ? OR r2.cpkRecptID IS NULL)
         AND (vbr.BalanceAmt > 0 OR r2.RecptAmt >= 0)
       ORDER BY vbr.BillDt, vbr.BillType`,
      { replacements: [id, hdr.fkPartyID, id] }
    );

    const lines = det.map(r => {
      const isExisting = r.cpkRecptID != null;
      const storedNet  = parseFloat(r.storedRecptAmt) || 0;
      const storedTDS  = parseFloat(r.storedTDSAmt)   || 0;
      const recdAmt    = isExisting ? storedNet + storedTDS : 0;
      const tdsAmt     = isExisting ? storedTDS : 0;
      const discAmt    = isExisting ? (parseFloat(r.DiscAmt) || 0) : 0;
      // Reconstruct BillBalAmt: view already subtracted (RecptAmt+TDS), add it back
      const billBalAmt = parseFloat(r.viewBalAmt) + (isExisting ? recdAmt : 0);

      // VB6 Modify init (line 1307): ccolTotAmt = ccolRecdAmt - ccolTDSAmt
      //   ccolRecdAmt = storedNet + storedTDS, so totAmt = storedNet (= TotAmt in DB).
      //   discAmt is NOT subtracted again â€” it is already embedded in storedNet.
      return {
        rowState:   isExisting ? 'View' : 'None',
        newRowFlg:  isExisting ? 'N' : 'Y',
        cpkSrNo:    isExisting ? r.cpkSrNo : -1,
        fkBillID:   r.pkBillID,
        billType:   r.BillType,
        billDt:     localStr(new Date(r.BillDt)),
        billNum:    r.BillNum,
        grAmt:      parseFloat(r.GrossAmt) || 0,
        netAmt:     parseFloat(r.NetAmt)   || 0,
        billBalAmt,
        recdAmt,
        tdsPernt:   (recdAmt && r.GrossAmt)
                      ? Math.round((tdsAmt / parseFloat(r.GrossAmt)) * 100)
                      : 0,
        tdsAmt,
        discAmt,
        totAmt:     isExisting ? storedNet : 0,
        balAmt:     billBalAmt - recdAmt,
        remarks:    isExisting ? (r.rRemark || '') : '',
      };
    });

    res.json({
      pkRecptID:  hdr.pkRecptID,
      recptDt:    localStr(new Date(hdr.RecptDt)),
      fkPartyID:  hdr.fkPartyID,
      partyName:  hdr.partyName,
      recptAmt:   parseFloat(hdr.RecptAmt) || 0,
      recptType:  hdr.RecptType,
      recptMode:  hdr.RecptMode,
      fkBankID:   hdr.fkBankID || '',
      bankName:   hdr.BankName || '',
      chqNo:      hdr.ChqNo   || '',
      chqDt:      hdr.ChqDt ? localStr(new Date(hdr.ChqDt)) : '',
      rNote:      hdr.rNote  || '',
      lines,
    });
  } catch (err) {
    console.error('receipt/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ POST / â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Save new receipt (VB6: udfSaveData when enEditMode = Add)
router.post('/', requirePerm('RECEIPT_ENTRY', 'CanAdd'), async (req, res) => {
  const { compID, branchID, userId } = req.user;
  const { recptDt, fkPartyID, recptAmt, recptType, recptMode,
          fkBankID, bankName, chqNo, chqDt, rNote, lines } = req.body;

  const now      = new Date();
  const serialKey = `${compID}!${branchID}!TRECEIPT1!PKRECPTID`;

  try {
    const db = req.db;

    // Sync SerialID counter with actual max pkRecptID in tRecpt1.
    // This handles VB6 coexistence: if VB6 created receipts (ADS!HO!1 â€¦ ADS!HO!N)
    // but the SerialID row is missing or behind, we seed it to max so the web never
    // generates a PK that already exists.
    // ON DUPLICATE KEY UPDATE uses GREATEST so it never moves the counter backwards.
    const [maxRows] = await db.query(
      `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(pkRecptID, '!', -1) AS UNSIGNED)), 0) AS maxID
       FROM tRecpt1 WHERE fkCompId = ? AND fkBranchID = ?`,
      { replacements: [compID, branchID] }
    );
    const maxExisting = parseInt(maxRows[0]?.maxID) || 0;
    await db.query(
      `INSERT INTO SerialID (pkSerialID, LastID, SerialDesc) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE LastID = GREATEST(LastID, ?)`,
      { replacements: [serialKey, maxExisting, 'Receipt Entry - pkRecptID(Primary Key)', maxExisting] }
    );

    // Generate PK â€” key matches VB6's UCase() format (frmPayment.frm line 1789)
    const lRecptID = await gudfGenSerialID(db, serialKey, 'Receipt Entry - pkRecptID(Primary Key)', 'Y');
    if (lRecptID <= 0) return res.status(500).json({ error: 'Cannot generate receipt ID â€” check SerialID table' });
    const pkRecptID = buildSerialKey(compID, branchID, lRecptID);  // â†’ 'ADS!HO!N'

    const t = await db.transaction();
    try {
      // tRecpt1 header
      await db.query(
        `INSERT INTO tRecpt1
           (pkRecptID, fkCompId, fkBranchID, RecptDt, fkPartyID,
            RecptAmt, RecptType, RecptMode, BankName, ChqNo, ChqDt,
            fkBankID, rNote, fkUserID, CrMod)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        {
          replacements: [
            pkRecptID, compID, branchID, recptDt, fkPartyID,
            recptAmt, recptType, recptMode, bankName ?? '', chqNo ?? '',
            chqDt || localStr(now), fkBankID ?? '', rNote ?? '', userId, now,
          ],
          transaction: t,
        }
      );

      // tRecpt2 detail â€” only rows where recdAmt > 0
      let srNo = 0;
      for (const ln of (lines || [])) {
        if (!ln.recdAmt || ln.recdAmt <= 0) continue;
        srNo++;
        const totAmt = (parseFloat(ln.recdAmt) || 0)
                     - (parseFloat(ln.tdsAmt)   || 0)
                     - (parseFloat(ln.discAmt)  || 0);
        await db.query(
          `INSERT INTO tRecpt2
             (cpkRecptID, cpkSrNo, BillType, fkBillID,
              RecptAmt, TDSAmt, DiscAmt, rRemark, fkUserID, CrMod)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          {
            replacements: [
              pkRecptID, srNo, ln.billType, ln.fkBillID,
              totAmt, parseFloat(ln.tdsAmt) || 0, parseFloat(ln.discAmt) || 0,
              ln.remarks ?? '', userId, now,
            ],
            transaction: t,
          }
        );
      }

      await t.commit();
      res.json({ pkRecptID, message: 'Receipt Entry Saved.' });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (err) {
    console.error('receipt POST', err);
    // Expose the real MySQL message (Sequelize wraps ER_DUP_ENTRY as "Validation error")
    const sqlMsg = err.parent?.sqlMessage || err.original?.sqlMessage;
    res.status(500).json({ error: sqlMsg || err.message });
  }
});

// â”€â”€ PUT /:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Update existing receipt (VB6: udfSaveData when enEditMode = Modify + udfAddRecpt2Detail)
router.put('/:id', requirePerm('RECEIPT_ENTRY', 'CanEdit'), async (req, res) => {
  const { compID, branchID, userId } = req.user;
  const { id } = req.params;
  const { recptDt, fkPartyID, recptAmt, recptType, recptMode,
          fkBankID, bankName, chqNo, chqDt, rNote, lines } = req.body;

  const now = new Date();
  let t;
  try {
    const db = req.db;

    // Determine max cpkSrNo already in DB (VB6: udfGetMaxSrNo)
    const [srRows] = await db.query(
      `SELECT IFNULL(MAX(cpkSrNo), 0) AS maxSr FROM tRecpt2 WHERE cpkRecptID = ?`,
      { replacements: [id] }
    );
    let nextSrNo = parseInt(srRows[0].maxSr) || 0;

    t = await db.transaction();

    // Update header â€” VB6 sets fkPartyID in both Add and Modify paths
    await db.query(
      `UPDATE tRecpt1
       SET RecptDt=?, fkPartyID=?, RecptAmt=?, RecptType=?, RecptMode=?,
           BankName=?, ChqNo=?, ChqDt=?, fkBankID=?, rNote=?, fkUserID=?, CrMod=?
       WHERE pkRecptID=? AND fkCompId=? AND fkBranchID=?`,
      {
        replacements: [
          recptDt, fkPartyID || null, recptAmt, recptType, recptMode,
          bankName ?? '', chqNo ?? '', chqDt || localStr(now), fkBankID ?? '',
          rNote ?? '', userId, now,
          id, compID, branchID,
        ],
        transaction: t,
      }
    );

    // Process detail rows by rowState (matches VB6 udfAddRecpt2Detail)
    for (const ln of (lines || [])) {
      const { rowState, newRowFlg, cpkSrNo, billType, fkBillID,
              recdAmt, tdsAmt, discAmt, remarks } = ln;
      // VB6 udfAddRecpt2Detail saves ccolTotAmt which equals:
      //   new rows  (newRowFlg='Y'): TotAmt = RecdAmt âˆ’ TDSAmt âˆ’ DiscAmt  (AfterEdit formula)
      //   edit rows (newRowFlg='N'): ccolRecdAmt âˆ’ ccolTDSAmt              (line 1307 of VB6)
      //     where ccolRecdAmt = storedNet + storedTDS = TotAmt + TDSAmt, so result = TotAmt
      //     â€” discAmt is NOT subtracted again because it was already absorbed into storedNet
      const totAmt = newRowFlg === 'N'
        ? (parseFloat(recdAmt) || 0) - (parseFloat(tdsAmt) || 0)
        : (parseFloat(recdAmt) || 0) - (parseFloat(tdsAmt) || 0) - (parseFloat(discAmt) || 0);

      // Skip: new row with no amount, or existing unchanged
      if (newRowFlg === 'Y' && (rowState === 'None' || rowState === 'Delete')) continue;
      if (newRowFlg === 'N' && rowState === 'View') continue;

      if (newRowFlg === 'Y' && rowState === 'Add') {
        nextSrNo++;
        await db.query(
          `INSERT INTO tRecpt2
             (cpkRecptID, cpkSrNo, BillType, fkBillID,
              RecptAmt, TDSAmt, DiscAmt, rRemark, fkUserID, CrMod)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          {
            replacements: [
              id, nextSrNo, billType, fkBillID,
              totAmt, parseFloat(tdsAmt) || 0, parseFloat(discAmt) || 0,
              remarks ?? '', userId, now,
            ],
            transaction: t,
          }
        );
      } else if (newRowFlg === 'N' && rowState === 'Modify') {
        await db.query(
          `UPDATE tRecpt2
           SET RecptAmt=?, TDSAmt=?, DiscAmt=?, rRemark=?, fkUserID=?, CrMod=?
           WHERE cpkRecptID=? AND cpkSrNo=?`,
          {
            replacements: [
              totAmt, parseFloat(tdsAmt) || 0, parseFloat(discAmt) || 0,
              remarks ?? '', userId, now,
              id, cpkSrNo,
            ],
            transaction: t,
          }
        );
      } else if (newRowFlg === 'N' && rowState === 'Delete') {
        await db.query(
          `DELETE FROM tRecpt2 WHERE cpkRecptID=? AND cpkSrNo=?`,
          { replacements: [id, cpkSrNo], transaction: t }
        );
      }
    }

    await t.commit();
    res.json({ message: 'Receipt Entry Saved.' });
  } catch (err) {
    if (t) { try { await t.rollback(); } catch {} }
    console.error('receipt PUT', err);
    const sqlMsg = err.parent?.sqlMessage || err.original?.sqlMessage;
    res.status(500).json({ error: sqlMsg || err.message });
  }
});

// â”€â”€ DELETE /:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Delete receipt header and all allocations (VB6: cmdDelete_Click)
router.delete('/:id', requirePerm('RECEIPT_ENTRY', 'CanDelete'), async (req, res) => {
  const { compID, branchID } = req.user;
  const { id } = req.params;
  let t;
  try {
    const db = req.db;
    t = await db.transaction();
    // Detail first (FK order)
    await db.query(
      `DELETE FROM tRecpt2 WHERE cpkRecptID = ?`,
      { replacements: [id], transaction: t }
    );
    const [result] = await db.query(
      `DELETE FROM tRecpt1 WHERE pkRecptID = ? AND fkCompID = ? AND fkBranchID = ?`,
      { replacements: [id, compID, branchID], transaction: t }
    );
    if (!result.affectedRows) {
      await t.rollback();
      return res.status(404).json({ error: 'Receipt not found' });
    }
    await t.commit();
    res.json({ message: 'Receipt Entry Deleted.' });
  } catch (err) {
    if (t) { try { await t.rollback(); } catch {} }
    console.error('receipt DELETE', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
