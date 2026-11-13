// ─────────────────────────────────────────────────────────────────────────────
// upSerialNum.js  —  /api/admin/up-serial-num
//
// VB6 origin: frmUpSerialNo.frm
//
// Purpose: Administrative utility to manually correct/override the "last used"
// serial counter for Bill Numbers (stored in VCSeriesSrno.LastNo) or for Lot
// Numbers (stored in SerialIDLot.LastNum).  This is a superuser-only operation
// guarded by the UP_SERIAL_NUM module permission.
//
// VB6 → Node.js translation notes:
//  • ADODB.Recordset open/update  → parameterized SELECT + explicit UPDATE in
//    a MySQL transaction (gDb.ConUpdt.BeginTrans / CommitTrans / RollbackTrans)
//  • VSFlexGrid combo lists       → plain SELECT queries, results sent as JSON
//    arrays for React <Select> dropdowns
//  • Module-level mImp / mFv vars → req.user for compID/branchID; query params
//    carry fkSeriesID, fkPartyID, FaYear, SeriesDate, ItemType, LotBillFlg
//
// Endpoints:
//   GET  /form-data          → parties + bill-types (populates the two static combos
//                              that load on form open — udfFillGridCombo)
//   GET  /bill-years         → distinct FaYear for a series (vfgBillYear combo —
//                              udfFillFaYear, Bill branch)
//   GET  /lot-years          → distinct FaYear for a party (vfgLotYear combo —
//                              udfFillFaYear, Lot branch)
//   GET  /series-dates       → SeriesDate options for series+year (vfgBillSeriesDt —
//                              udfFillSeriesDt)
//   GET  /bill-serial        → current LastNo  (udfUpdateSerialNumber, Bill branch)
//   GET  /lot-serial         → current LastNum (udfUpdateSerialNumber, Lot branch)
//   PUT  /bill-serial        → UPDATE VCSeriesSrno.LastNo  (udfSaveData, Bill branch)
//   PUT  /lot-serial         → UPDATE SerialIDLot.LastNum  (udfSaveData, Lot branch)
// ─────────────────────────────────────────────────────────────────────────────

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');

router.use(requireAuth);

// ── Shorthand: destructure the three user-identity fields used on every query ─
// VB6 equivalent: gv.vCompId, gv.vBranchID (global variables set at login)
function userCtx(req) {
  const { compID, branchID } = req.user;
  return { compID, branchID };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /form-data
//
// VB6: udfFillGridCombo() called from Form_Load.
//   Fills vfgPartyName  → SELECT pName,pkPartyID FROM mParty
//   Fills vfgBillType   → SELECT SeriesName,pkSeriesID FROM VCSeriesMast
//   vfgItemType and vfgToBilled are static combos — returned as constants.
//
// Returns: { parties, billTypes, itemTypes, toBilledOptions }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/form-data', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);

    // VB6 SQL: "Select pName,pkPartyID from mParty where fkCompID=? and fkBranchID=? order by pName"
    // Web convention: mParty is scoped by fkCompID only (no fkBranchID — matches party route).
    // req.db is already the current company's DB connection, so compID is the only filter needed.
    const [parties] = await req.db.query(
      `SELECT pName, pkPartyID
       FROM   mParty
       WHERE  fkCompID = ? AND Active = 'Y'
       ORDER  BY pName`,
      { replacements: [compID] }
    );

    // VB6: vfgBillType.BuildComboList(rs, "SeriesName", "pkSeriesID")
    // VB6 stores TextMatrix(0,0) as fkSeriesID — col 0 of a 2-col grid populated by
    // BuildComboList is the KEY field (pkSeriesID), so fkSeriesID = pkSeriesID in VCSeriesSrno.
    // We return both so the frontend can use pkSeriesID as the filter value.
    const [billTypes] = await req.db.query(
      `SELECT SeriesName, pkSeriesID
       FROM   VCSeriesMast
       WHERE  fkCompID = ? AND fkBranchID = ?
       ORDER  BY SeriesName`,
      { replacements: [compID, branchID] }
    );

    // VB6: vfgItemType.ColComboList(0) = "|#ITM;Item|#SPC;Space"
    // VSFlexGrid strips the # key-marker before storing — DB has ITM / SPC (no #).
    const itemTypes = [
      { value: 'ITM', label: 'Item' },
      { value: 'SPC', label: 'Space' },
    ];

    // VB6: vfgToBilled.ColComboList(0) = "|#Y;Yes|#N;No"
    // Same stripping — DB has Y / N (no #).
    const toBilledOptions = [
      { value: 'Y', label: 'Yes' },
      { value: 'N', label: 'No' },
    ];

    res.json({ parties, billTypes, itemTypes, toBilledOptions });
  } catch (err) {
    console.error('[up-serial-num GET /form-data]', err.message);
    res.status(500).json({ error: err.message || 'Failed to load form data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /bill-years?seriesID=xxx
//
// VB6: udfFillFaYear() → Bill branch
//   "select Distinct FaYear from VCSeriesSrNo where fkCompID=? and fkBranchID=?
//    and fkSeriesID=? order by FaYear DESC"
// Called when vfgBillType_AfterEdit fires and ComboIndex ≠ -1.
// Returns: [{ FaYear }]
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bill-years', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);
    const { seriesID } = req.query;

    if (!seriesID) return res.status(400).json({ error: 'seriesID is required' });

    console.log('[bill-years] params →', { compID, branchID, seriesID });

    const [rows] = await req.db.query(
      `SELECT DISTINCT FaYear
       FROM   VCSeriesSrNo
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkSeriesID = ?
       ORDER  BY FaYear DESC`,
      { replacements: [compID, branchID, seriesID] }
    );

    console.log('[bill-years] rows →', JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error('[up-serial-num GET /bill-years]', err.message);
    res.status(500).json({ error: err.message || 'Failed to load bill years' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lot-years?partyID=xxx
//
// VB6: udfFillFaYear() → Lot branch
//   "select Distinct FaYear from SerialIDLot where fkCompID=? and fkBranchID=?
//    and fkPartyID=? order by FaYear DESC"
// Called when vfgPartyName_AfterEdit fires.
// Returns: [{ FaYear }]
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lot-years', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);
    const { partyID } = req.query;

    if (!partyID) return res.status(400).json({ error: 'partyID is required' });

    const [rows] = await req.db.query(
      `SELECT DISTINCT FaYear
       FROM   SerialIDLot
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkPartyID = ?
       ORDER  BY FaYear DESC`,
      { replacements: [compID, branchID, partyID] }
    );

    res.json(rows);
  } catch (err) {
    console.error('[up-serial-num GET /lot-years]', err.message);
    res.status(500).json({ error: err.message || 'Failed to load lot years' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /series-dates?seriesID=xxx&faYear=xxx
//
// VB6: udfFillSeriesDt()
//   "Select SeriesDate,fkSeriesID from VCSeriesSrno where fkCompID=? and fkBranchID=?
//    and fkSeriesID=? and FaYear=? order by SeriesDate DESC"
// Called when vfgBillYear_AfterEdit fires.
// Returns: [{ SeriesDate }]
// ─────────────────────────────────────────────────────────────────────────────
router.get('/series-dates', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);
    const { seriesID, faYear } = req.query;

    if (!seriesID || !faYear)
      return res.status(400).json({ error: 'seriesID and faYear are required' });

    console.log('[series-dates] params →', { compID, branchID, seriesID, faYear });

    const [rows] = await req.db.query(
      `SELECT CAST(SeriesDate AS CHAR) AS SeriesDate, fkSeriesID
       FROM   VCSeriesSrno
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkSeriesID = ? AND FaYear = ?
       ORDER  BY SeriesDate DESC`,
      { replacements: [compID, branchID, seriesID, faYear] }
    );

    console.log('[series-dates] rows →', JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error('[up-serial-num GET /series-dates]', err.message);
    res.status(500).json({ error: err.message || 'Failed to load series dates' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /bill-serial?seriesID=xxx&faYear=xxx&seriesDate=xxx
//
// VB6: udfUpdateSerialNumber() → Bill branch
//   "Select * from VCSeriesSrno where fkCompID=? and fkBranchID=?
//    and fkSeriesID=? and FaYear=? and SeriesDate=?"
// Returns { LastNo } so the frontend can pre-fill txtBillSerialNum.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bill-serial', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);
    const { seriesID, faYear, seriesDate } = req.query;

    if (!seriesID || !faYear || !seriesDate)
      return res.status(400).json({ error: 'seriesID, faYear and seriesDate are required' });

    // Strip time component if the client sent an ISO timestamp ("2024-04-01T00:00:00.000Z" → "2024-04-01")
    const cleanDate = seriesDate.split('T')[0];

    console.log('[bill-serial] query params →', { compID, branchID, seriesID, faYear, cleanDate });

    const [rows] = await req.db.query(
      `SELECT *
       FROM   VCSeriesSrno
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkSeriesID = ?
         AND  FaYear = ? AND CAST(SeriesDate AS CHAR) = ?`,
      { replacements: [compID, branchID, seriesID, faYear, cleanDate] }
    );

    console.log('[bill-serial] rows found →', rows.length);

    // VB6: if BOF and EOF → "There is no record to show."
    if (!rows.length)
      return res.status(404).json({ error: 'No record found for the selected filters.' });

    // Return the full row; frontend reads row.LastNo
    res.json(rows[0]);
  } catch (err) {
    console.error('[up-serial-num GET /bill-serial]', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch bill serial number' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lot-serial?partyID=xxx&faYear=xxx&itemType=xxx&toBilled=xxx
//
// VB6: udfUpdateSerialNumber() → Lot branch
//   "Select * from SerialIDLot where fkCompID=? and fkBranchID=?
//    and fkPartyID=? and FaYear=? and ItemType=? and LotBillFlg=?"
// Returns { LastNum } so the frontend can pre-fill txtLotSerialNum.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lot-serial', requirePermission('UP_SERIAL_NUM', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = userCtx(req);
    const { partyID, faYear, itemType, toBilled } = req.query;

    if (!partyID || !faYear || !itemType || !toBilled)
      return res.status(400).json({ error: 'partyID, faYear, itemType and toBilled are required' });

    const [rows] = await req.db.query(
      `SELECT *
       FROM   SerialIDLot
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkPartyID = ?
         AND  FaYear = ? AND ItemType = ? AND LotBillFlg = ?`,
      { replacements: [compID, branchID, partyID, faYear, itemType, toBilled] }
    );

    if (!rows.length)
      return res.status(404).json({ error: 'No record found for the selected filters.' });

    res.json(rows[0]);
  } catch (err) {
    console.error('[up-serial-num GET /lot-serial]', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch lot serial number' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /bill-serial
// Body: { seriesID, faYear, seriesDate, lastNo }
//
// VB6: udfSaveData() → Bill branch
//   gDb.ConUpdt.BeginTrans
//   rsUpSerialNum("LastNo") = txtBillSerialNum.Text
//   rsUpSerialNum.Update
//   gDb.ConUpdt.CommitTrans
//   (on error → RollbackTrans)
//
// Wraps the UPDATE in an explicit MySQL transaction so any mid-flight error
// triggers an automatic ROLLBACK — identical to VB6's BeginTrans/RollbackTrans.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/bill-serial', requirePermission('UP_SERIAL_NUM', 'CanEdit'), async (req, res) => {
  const { seriesID, faYear, seriesDate, lastNo } = req.body;

  // ── Validate (udfValSerialNum equivalent) ────────────────────────────────
  // VB6: "if txtBillSerialNum.Text = Trim("") Or Val(txtBillSerialNum) < 0"
  if (lastNo === undefined || lastNo === null || String(lastNo).trim() === '')
    return res.status(400).json({ error: 'Please enter a Serial Number.' });

  const parsed = parseInt(lastNo, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    return res.status(400).json({ error: 'Serial Number must be a whole number ≥ 0.' });

  if (!seriesID || !faYear || !seriesDate)
    return res.status(400).json({ error: 'seriesID, faYear and seriesDate are required' });

  const { compID, branchID } = userCtx(req);

  // VB6: gDb.ConUpdt.BeginTrans — start a transaction before touching the DB
  const txn = await req.db.transaction();
  try {
    // VB6: rsUpSerialNum("LastNo") = txtBillSerialNum.Text ; rsUpSerialNum.Update
    // Translated to a parameterized UPDATE — same WHERE clause as the fetch query.
    const cleanDate = seriesDate.split('T')[0];
    const [result] = await req.db.query(
      `UPDATE VCSeriesSrno
       SET    LastNo = ?
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkSeriesID = ?
         AND  FaYear = ? AND CAST(SeriesDate AS CHAR) = ?`,
      { replacements: [parsed, compID, branchID, seriesID, faYear, cleanDate], transaction: txn }
    );

    if (result.affectedRows === 0) {
      // Record has disappeared between GET and PUT — roll back cleanly
      await txn.rollback();
      return res.status(404).json({ error: 'Record not found — update cancelled.' });
    }

    // VB6: gDb.ConUpdt.CommitTrans — commit only when everything succeeded
    await txn.commit();

    // VB6: MsgBox "Series Number Updated.", vbOKOnly + vbInformation, ...
    res.json({ updated: true, lastNo: parsed });
  } catch (err) {
    // VB6: ErrSeriesNumSave → gDb.ConUpdt.RollbackTrans ; "Series is not Updated"
    await txn.rollback();
    console.error('[up-serial-num PUT /bill-serial]', err.message);
    res.status(500).json({ error: err.message || 'Series is not Updated' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /lot-serial
// Body: { partyID, faYear, itemType, toBilled, lastNum }
//
// VB6: udfSaveData() → Lot branch
//   rsUpSerialNum("LastNum") = txtLotSerialNum.Text
//   rsUpSerialNum.Update
// Same transaction pattern as the Bill branch above.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/lot-serial', requirePermission('UP_SERIAL_NUM', 'CanEdit'), async (req, res) => {
  const { partyID, faYear, itemType, toBilled, lastNum } = req.body;

  // ── Validate ────────────────────────────────────────────────────────────
  if (lastNum === undefined || lastNum === null || String(lastNum).trim() === '')
    return res.status(400).json({ error: 'Please enter a Serial Number.' });

  const parsed = parseInt(lastNum, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    return res.status(400).json({ error: 'Serial Number must be a whole number ≥ 0.' });

  if (!partyID || !faYear || !itemType || !toBilled)
    return res.status(400).json({ error: 'partyID, faYear, itemType and toBilled are required' });

  const { compID, branchID } = userCtx(req);

  // VB6: gDb.ConUpdt.BeginTrans
  const txn = await req.db.transaction();
  try {
    // VB6: rsUpSerialNum("LastNum") = txtLotSerialNum.Text ; rsUpSerialNum.Update
    const [result] = await req.db.query(
      `UPDATE SerialIDLot
       SET    LastNum = ?
       WHERE  fkCompID = ? AND fkBranchID = ? AND fkPartyID = ?
         AND  FaYear = ? AND ItemType = ? AND LotBillFlg = ?`,
      { replacements: [parsed, compID, branchID, partyID, faYear, itemType, toBilled], transaction: txn }
    );

    if (result.affectedRows === 0) {
      await txn.rollback();
      return res.status(404).json({ error: 'Record not found — update cancelled.' });
    }

    // VB6: gDb.ConUpdt.CommitTrans
    await txn.commit();

    res.json({ updated: true, lastNum: parsed });
  } catch (err) {
    // VB6: ErrSeriesNumSave → gDb.ConUpdt.RollbackTrans
    await txn.rollback();
    console.error('[up-serial-num PUT /lot-serial]', err.message);
    res.status(500).json({ error: err.message || 'Series is not Updated' });
  }
});

module.exports = router;
