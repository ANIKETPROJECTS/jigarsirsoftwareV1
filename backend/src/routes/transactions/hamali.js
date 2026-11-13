// ─────────────────────────────────────────────────────────────────────────────
// hamali.js  —  /api/transactions/hamali
//
// VB6 origin: frmHamaliCalEntry.frm
//
// Endpoints:
//   POST /go    — Step 1: load header params from DB + build date list + count working days
//   POST /view  — Step 2: populate grid rows (attendance, stock hamali, existing entries, calc)
//   POST /save  — Step 3: batch upsert tHamaliCalEntry1 + rebuild tHamaliCalEntry2
//
// Employee type codes (mEmployee.eType):
//   LABRB = Board Labour    (used in attendance + hamali split)
//   LABRO = Other Labour    (used in attendance + hamali split)
//
// Column mapping mirrors VB6 VSFlexGrid constants:
//   ccolBoardAttd=2, ccolOtherAttnd=3, ccolCDaily=4, ccolCVarai=5,
//   ccolCComm=6, ccolCBrdLbr=7, ccolCOthrLbr=8, ccolCPerBrdAmt=9,
//   ccolCPerOthrAmt=10, ccolODaily=11, ccolOVarai=12, ccolOcomm=13,
//   ccolOBrdLbr=14, ccolOothrLbr=15, ccolDepoBrd=16, ccolTotDepoBrd=17,
//   ccolOPerBrdAmt=18, ccolOPerOtheAmt=19, ccolOutsdLbrAmt=22,
//   ccolBrdDate=23, ccolTotHamali=24, ccolTotComm=25
// ─────────────────────────────────────────────────────────────────────────────

const router                = require('express').Router();
const { Op }                = require('sequelize');
const requireAuth           = require('../../middleware/auth');
const requirePermission     = require('../../middleware/permission');
const defineHamaliEntry1    = require('../../models/company/HamaliCalEntry1');
const defineHamaliEntry2    = require('../../models/company/HamaliCalEntry2');
const { gudfGenSerialID }   = require('../../utils/serialID');
const connectionManager     = require('../../config/connectionManager');

// Validate that a date string is safe to embed in raw SQL (no injection risk)
const isValidDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

router.use(requireAuth);

// ── Calculation helpers (mirror VB6 exactly) ─────────────────────────────────

/** Round to 2 decimal places */
function r2(n) { return Math.round((n || 0) * 100) / 100; }

/**
 * Calculate Cash Hamali amounts for one row.
 * VB6: udfCalCashHamali()
 *
 * cComm    = (cDaily - cVarai) * commPerct/100
 * totLbr   = boardAttd + otherAttnd
 * cPerLbr  = (cDaily - cVarai - cComm) / totLbr       (0 when no labour)
 * cBrdLbr  = round(cPerLbr * boardAttd)               Long cast in VB6
 * cOthrLbr = round(cPerLbr * otherAttnd)              Long cast in VB6
 */
function calcCashHamali(row, commPerct) {
  const cp     = parseFloat(commPerct) || 0;
  const cComm  = r2((row.cDaily - row.cVarai) * cp / 100);
  const totLbr = (row.boardAttd || 0) + (row.otherAttnd || 0);
  let cPerLbr  = 0;
  if (totLbr > 0) cPerLbr = (row.cDaily - row.cVarai - cComm) / totLbr;
  const cBrdLbr  = Math.round(cPerLbr * (row.boardAttd  || 0));
  const cOthrLbr = Math.round(cPerLbr * (row.otherAttnd || 0));
  return { cComm, cBrdLbr, cOthrLbr, cPerBrdAmt: cPerLbr, cPerOthrAmt: cPerLbr };
}

/**
 * Calculate Outstanding Hamali amounts for one row.
 * VB6: udfCalOutstandingHamali()
 *
 * oComm      = (oDaily - oVarai - outsdLbrAmt) * commPerct/100
 * oPerLbr    = (oDaily - oVarai - oComm - outsdLbrAmt) / totLbr
 * oBrdLabAmt = round(oPerLbr * boardAttd)              Long cast
 * oBrdLbr    = oBrdLabAmt - depoBrd                    subtract deposit
 * oPerBrdAmt = oBrdLbr / boardAttd                     (0 when no board labour)
 * oOthrLbr   = round(oPerLbr * otherAttnd)             Long cast
 */
function calcOutstandingHamali(row, commPerct) {
  const cp       = parseFloat(commPerct) || 0;
  const oComm    = r2((row.oDaily - row.oVarai - row.outsdLbrAmt) * cp / 100);
  const totLbr   = (row.boardAttd || 0) + (row.otherAttnd || 0);
  let oPerLbr    = 0;
  if (totLbr > 0)
    oPerLbr = (row.oDaily - row.oVarai - oComm - row.outsdLbrAmt) / totLbr;
  const oBrdLabAmt  = Math.round(oPerLbr * (row.boardAttd  || 0));
  const oBrdLbr     = oBrdLabAmt - (row.depoBrd || 0);
  const oPerBrdAmt  = (row.boardAttd || 0) > 0 ? oBrdLbr / row.boardAttd : 0;
  const oOthrLbr    = Math.round(oPerLbr * (row.otherAttnd || 0));
  const oPerOtherAmt = oPerLbr;
  const totHamali   = (row.cDaily || 0) + (row.oDaily || 0);
  const totComm     = (row.cComm  || 0) + oComm;
  return { oComm, oBrdLbr, oOthrLbr, oPerBrdAmt, oPerOtherAmt, totHamali, totComm };
}

/** Build YYYY-MM-DD string from local date object (avoids UTC shift in IST) */
function localDateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

/**
 * Safely convert a Sequelize date field value to 'YYYY-MM-DD' string.
 * mysql2 may return DATE columns as JS Date objects (not strings), depending on
 * the typeCast / dateStrings setting. String(Date) gives a locale string like
 * "Mon Jan 15 2024 ..." which breaks substring extraction.
 * This function handles both cases robustly.
 */
function toDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return localDateStr(val);
  // Extract YYYY-MM-DD from any string format (handles '2024-01-15 00:00:00' too)
  const m = String(val).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(val).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/hamali/go
//
// Step 1 — Load header params + build date list + count working days.
// VB6: cmdGo_Click → queries tHamaliCalEntry1 for fromDate (or MAX fallback),
//      then calls udfCalWorkingDays() which builds the date grid rows.
//
// Request: { fromDate, toDate }
// Response:
//   header   : { tCommPerct, tTotVaraiAmt, tBoardTonRate, tBoardLeavyPerct }
//   dates    : [{ date:'YYYY-MM-DD', isHoliday:bool }]
//   workingDays : number
// ─────────────────────────────────────────────────────────────────────────────
router.post('/go', requirePermission('HAMALI', 'CanView'), async (req, res) => {
  const { fromDate, toDate } = req.body;
  if (!fromDate || !toDate)
    return res.status(400).json({ error: 'fromDate and toDate are required' });
  if (fromDate > toDate)
    return res.status(400).json({ error: 'From Date cannot be greater than To Date' });

  const { compID, branchID, groupID } = req.user;

  try {
    const H1 = defineHamaliEntry1(req.db);

    // Q1: Load header from exact fromDate, fallback to MAX(tDate)
    // VB6: "Select * from tHamaliCalEntry1 where fkCompID=? and fkBranchID=? and tDate=?"
    let header = await H1.findOne({ where: { fkCompID: compID, fkBranchID: branchID, tDate: fromDate } });
    if (!header) {
      // VB6 fallback: "Select * ... where tDate = (Select Max(tDate) ...)"
      header = await H1.findOne({
        where: { fkCompID: compID, fkBranchID: branchID },
        order: [['tDate', 'DESC']],
      });
    }

    // Q_Holidays: fetch all board holidays in date range in one query
    // VB6: queried per day; web: fetch all at once for O(1) lookup
    const [holidayRows] = await req.db.query(
      `SELECT DATE_FORMAT(hDate, '%Y-%m-%d') AS hDate
       FROM   mHoliday
       WHERE  fkCompID = ? AND DATE(hDate) BETWEEN ? AND ?
         AND  hBoard = 'Y' AND Active = 'Y'`,
      { replacements: [compID, fromDate, toDate] }
    );
    const boardHolidaySet = new Set(holidayRows.map(r => r.hDate));

    // Build date list — VB6: udfCalWorkingDays loop
    // Sundays and Board Holidays are NOT working days (and are coloured green in grid)
    const dates = [];
    let workingDays = 0;
    let d = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T00:00:00');

    while (d <= end) {
      const ds        = localDateStr(d);
      const isSunday  = d.getDay() === 0;
      const isHoliday = isSunday || boardHolidaySet.has(ds);
      if (!isHoliday) workingDays++;
      dates.push({ date: ds, isHoliday });
      d = new Date(d.getTime() + 86_400_000);
    }

    res.json({
      header: header ? {
        tCommPerct:       parseFloat(header.tCommPerct)       || 0,
        tTotVaraiAmt:     parseFloat(header.tTotVaraiAmt)     || 0,
        tBoardTonRate:    parseFloat(header.tBoardTonRate)    || 0,
        tBoardLeavyPerct: parseFloat(header.tBoardLeavyPerct) || 0,
      } : null,
      dates,
      workingDays,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load header data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/hamali/view
//
// Step 2 — Populate grid: attendance counts, stock hamali amounts, existing
//           entries, then calculate all derived columns.
// VB6: cmdView_Click → udfPopHamaliEntryGrid() which for each row calls:
//   1. udfCountLabourAttendance  → boardAttd, otherAttnd
//   2. udfDailyCashHamaliAmt     → cDaily, outsdLbrAmt
//   3. udfDailyOutstndHamaliAmt  → oDaily
//   4. udfViewHamaliEntry        → cVarai, oVarai, totDepoBrd, pkHmlEntID, brdDate
//   5. udfCalCashHamali          → cComm, cBrdLbr, cOthrLbr, cPerBrdAmt, cPerOthrAmt
//   6. udfCalOutstandingHamali   → oComm, oBrdLbr, oOthrLbr, oPerBrdAmt, oPerOtherAmt
//   For MODIFY rows only: depoBrd = totDepoBrd - cBrdLbr, then recalc outstanding
//
// All DB queries are batched (one query per data type for the whole date range)
// instead of per-row as in VB6 (N×4 queries → 4 queries).
//
// Request: { fromDate, toDate, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct, dates }
// Response: { rows: [...] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/view', requirePermission('HAMALI', 'CanView'), async (req, res) => {
  const { fromDate, toDate, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct, dates } = req.body;
  if (!fromDate || !toDate || !Array.isArray(dates))
    return res.status(400).json({ error: 'fromDate, toDate and dates are required' });
  if (!isValidDate(fromDate) || !isValidDate(toDate))
    return res.status(400).json({ error: 'Invalid date format' });

  const { compID, branchID, groupID } = req.user;
  const cp = parseFloat(commPerct) || 0;

  try {
    const H1 = defineHamaliEntry1(req.db);

    // ── Q_Attendance ────────────────────────────────────────────────────────
    // Fix GROUP BY: must match SELECT expression exactly to satisfy only_full_group_by.
    // Use DATE_FORMAT in both SELECT and GROUP BY (not DATE() in one and DATE_FORMAT in other).
    // COLLATE: mEmployee (legacy, utf8mb4_unicode_ci) vs AttendanceEntry (utf8mb4_0900_ai_ci).
    const [attdRows] = await req.db.query(
      `SELECT DATE_FORMAT(ae.aDate, '%Y-%m-%d') AS aDate, me.eType, COUNT(*) AS cnt
       FROM   AttendanceEntry ae
       JOIN   mEmployee me ON ae.fkEmpID COLLATE utf8mb4_unicode_ci = me.pkEmpID COLLATE utf8mb4_unicode_ci
       WHERE  ae.fkCompID = ? AND ae.fkBranchID = ?
         AND  DATE(ae.aDate) BETWEEN ? AND ?
         AND  ae.aPresent = 'Y'
         AND  me.eType IN ('LABRB', 'LABRO')
       GROUP BY DATE_FORMAT(ae.aDate, '%Y-%m-%d'), me.eType`,
      { replacements: [compID, branchID, fromDate, toDate] }
    );

    // ── Q_CashHamali — UNION ALL across all group company databases ──────────
    // VB6: udfDailyCashHamaliAmt — loops through gDb.sDBName array and UNION ALL
    //      each company's tStockEntry. fkCompID = company ID, fkBranchID = branch.
    // We mirror this exactly: one sub-SELECT per company DB, wrapped in SUM GROUP BY date.
    const companies = connectionManager.getGroupCompanyDetails(groupID);
    const cashParts = companies.map(({ dbName, pkCompID }) =>
      `SELECT DATE(TransDt) AS tDate,` +
      ` COALESCE(SUM(HamaliRecd), 0) AS HamaliRecd,` +
      ` COALESCE(SUM(OtherHmlAmt), 0) AS OutsdLbrAmt` +
      ` FROM \`${dbName}\`.\`tStockEntry\`` +
      ` WHERE fkCompID = '${pkCompID}' AND fkBranchID = '${branchID}'` +
      `   AND DATE(TransDt) BETWEEN '${fromDate}' AND '${toDate}'` +
      `   AND OpFlg = 'N'` +
      `   AND HamaliCode IN ('CR','VC','BA')` +
      ` GROUP BY DATE(TransDt)`
    );
    const cashSql = cashParts.length > 0
      ? `SELECT DATE_FORMAT(tDate, '%Y-%m-%d') AS transDate,` +
        ` COALESCE(SUM(HamaliRecd), 0) AS HamaliRecd,` +
        ` COALESCE(SUM(OutsdLbrAmt), 0) AS OutsdLbrAmt` +
        ` FROM (${cashParts.join(' UNION ALL ')}) AS _c` +
        ` GROUP BY DATE_FORMAT(tDate, '%Y-%m-%d')`
      : null;
    const [cashRows] = cashSql
      ? await req.db.query(cashSql)
      : [[]];

    // ── Q_OutstandingHamali — same UNION ALL across all group company databases
    // VB6: udfDailyOutstndHamaliAmt — same loop, WHERE HamaliRecd < HamaliAmt
    const ostParts = companies.map(({ dbName, pkCompID }) =>
      `SELECT DATE(TransDt) AS tDate,` +
      ` COALESCE(SUM(HamaliAmt), 0) AS HamaliAmt,` +
      ` COALESCE(SUM(OtherHmlAmt), 0) AS OutsdLbrAmt` +
      ` FROM \`${dbName}\`.\`tStockEntry\`` +
      ` WHERE fkCompID = '${pkCompID}' AND fkBranchID = '${branchID}'` +
      `   AND DATE(TransDt) BETWEEN '${fromDate}' AND '${toDate}'` +
      `   AND OpFlg = 'N'` +
      `   AND HamaliCode IN ('OA','CB','OC','OB','VB','LA')` +
      ` GROUP BY DATE(TransDt)`
    );
    const ostSql = ostParts.length > 0
      ? `SELECT DATE_FORMAT(tDate, '%Y-%m-%d') AS transDate,` +
        ` COALESCE(SUM(HamaliAmt), 0) AS HamaliAmt,` +
        ` COALESCE(SUM(OutsdLbrAmt), 0) AS OutsdLbrAmt` +
        ` FROM (${ostParts.join(' UNION ALL ')}) AS _o` +
        ` GROUP BY DATE_FORMAT(tDate, '%Y-%m-%d')`
      : null;
    const [ostRows] = ostSql
      ? await req.db.query(ostSql)
      : [[]];

    // ── Q_ExistingEntries ───────────────────────────────────────────────────
    // VB6: udfViewHamaliEntry — fetch existing tHamaliCalEntry1 rows for date range
    const existingEntries = await H1.findAll({
      where: { fkCompID: compID, fkBranchID: branchID, tDate: { [Op.between]: [fromDate, toDate] } },
    });

    // Build lookup maps for O(1) access per date
    const attdMap     = {};  // date → { LABRB: N, LABRO: N }
    const cashMap     = {};  // date → { HamaliRecd, OutsdLbrAmt }
    const ostMap      = {};  // date → { HamaliAmt }
    const existingMap = {};  // date → existing row

    for (const r of attdRows) {
      if (!attdMap[r.aDate]) attdMap[r.aDate] = {};
      attdMap[r.aDate][r.eType] = parseInt(r.cnt) || 0;
    }
    for (const r of cashRows)      cashMap[r.transDate]  = r;
    for (const r of ostRows)       ostMap[r.transDate]   = r;
    for (const r of existingEntries) {
      existingMap[toDateStr(r.tDate)] = r;
    }

    // ── Build each row, mirroring VB6 udfPopHamaliEntryGrid loop ────────────
    const rows = [];
    for (const { date, isHoliday } of dates) {
      const attd  = attdMap[date]  || {};
      const cash  = cashMap[date]  || {};
      const ost   = ostMap[date]   || {};
      const exist = existingMap[date];

      const boardAttd  = attd['LABRB'] || 0;
      const otherAttnd = attd['LABRO'] || 0;
      const cDaily     = parseFloat(cash.HamaliRecd)  || 0;
      const outsdLbrAmt = parseFloat(ost.OutsdLbrAmt)  || 0;
      const oDaily     = parseFloat(ost.HamaliAmt)    || 0;

      // Load from existing DB record (if MODIFY row)
      const cVarai     = exist ? parseFloat(exist.tVaraiAmt)    || 0 : 0;
      const oVarai     = exist ? parseFloat(exist.tBalVaraiAmt) || 0 : 0;
      const totDepoBrdDB = exist ? parseFloat(exist.tBoardDepoAmt) || 0 : 0;
      const pkHmlEntID = exist ? exist.pkHmlEntID : '';
      const brdDate    = exist ? toDateStr(exist.tBrdDate) : date; // VB6: brdDate defaults to the date
      const rowState   = exist ? 'MODIFY' : 'ADD';

      // Step 5: udfCalCashHamali
      const cashCalc = calcCashHamali(
        { cDaily, cVarai, boardAttd, otherAttnd, outsdLbrAmt },
        cp
      );

      // For MODIFY: depoBrd = totDepoBrd - cBrdLbr (VB6 line 797, after udfCalCashHamali)
      // Math.max(0,...) guards against negative values if attendance changed since last save
      const depoBrd = exist ? Math.max(0, totDepoBrdDB - cashCalc.cBrdLbr) : 0;

      // Step 6: udfCalOutstandingHamali (called twice for MODIFY in VB6 — final call uses correct depoBrd)
      const ostCalc = calcOutstandingHamali(
        { oDaily, oVarai, outsdLbrAmt, depoBrd, boardAttd, otherAttnd,
          cComm: cashCalc.cComm, cDaily },
        cp
      );

      const totDepoBrd = cashCalc.cBrdLbr + depoBrd; // cmdCalBrdAmt result

      rows.push({
        date, isHoliday, rowState, pkHmlEntID, brdDate,
        boardAttd, otherAttnd,
        cDaily, outsdLbrAmt, oDaily,
        cVarai, cComm: cashCalc.cComm,
        cBrdLbr: cashCalc.cBrdLbr, cOthrLbr: cashCalc.cOthrLbr,
        cPerBrdAmt: cashCalc.cPerBrdAmt, cPerOthrAmt: cashCalc.cPerOthrAmt,
        oVarai, depoBrd, totDepoBrd,
        oComm: ostCalc.oComm,
        oBrdLbr: ostCalc.oBrdLbr, oOthrLbr: ostCalc.oOthrLbr,
        oPerBrdAmt: ostCalc.oPerBrdAmt, oPerOtherAmt: ostCalc.oPerOtherAmt,
        totHamali: ostCalc.totHamali, totComm: ostCalc.totComm,
      });
    }

    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load hamali data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/hamali/save
//
// Step 3 — Batch upsert. For each row:
//   - If ADD: generate pkHmlEntID via gudfGenSerialID, INSERT into tHamaliCalEntry1
//   - If MODIFY: UPDATE tHamaliCalEntry1 for that pkHmlEntID
//   - DELETE from tHamaliCalEntry2 for pkHmlEntID
//   - INSERT into tHamaliCalEntry2 one row per present LABRB/LABRO employee
//
// VB6: udfSaveData + udfUpdtHmlEnt2
//
// Request: { fromDate, rows: [{ date, rowState, pkHmlEntID, brdDate, cVarai, oVarai,
//            cComm, oComm, cDaily, oDaily, totDepoBrd, boardAttd, otherAttnd,
//            cPerBrdAmt, oPerBrdAmt, cPerOthrAmt, oPerOtherAmt, ... }],
//            commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct }
// Response: { saved: N, errors: [...] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/save', requirePermission('HAMALI', 'CanAdd'), async (req, res) => {
  const { fromDate, rows, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'rows array is required' });

  const { compID, branchID, groupID, userId } = req.user;
  const tMonthYear = (fromDate || '').replace(/-/g, '').slice(0, 6); // YYYYMM
  let saved = 0;
  const errors = [];
  const now = new Date();

  try {
    const H1 = defineHamaliEntry1(req.db);
    const H2 = defineHamaliEntry2(req.db);

    for (const row of rows) {
      if (row.rowState !== 'ADD' && row.rowState !== 'MODIFY') continue;

      try {
        let pkHmlEntID = row.pkHmlEntID;

        if (row.rowState === 'ADD') {
          // VB6: gudfGenSerialID key format: '{CompID}!{BranchID}!tHamaliCalEntry1!pkHmlEntID'
          const serialKey = `${groupID}!${branchID}!tHamaliCalEntry1!pkHmlEntID`;
          const n = await gudfGenSerialID(req.db, serialKey, 'Hamali Calculation Entry - pkHmlEntID', 'Y');
          if (n === -1) {
            errors.push(`ID generation failed for ${row.date}`);
            continue;
          }
          pkHmlEntID = `${groupID}!${branchID}!${n}`;

          await H1.create({
            pkHmlEntID,
            fkCompID:         compID,
            fkBranchID:       branchID,
            HmlEntID:         n,
            tDate:            row.date,
            tBrdDate:         row.brdDate || row.date,
            tMonthYear,
            tTotVaraiAmt:     parseFloat(totVaraiAmt)     || 0,
            tVaraiAmt:        parseFloat(row.cVarai)       || 0,
            tBalVaraiAmt:     parseFloat(row.oVarai)       || 0,
            tCommPerct:       parseFloat(commPerct)        || 0,
            tCommAmt1:        parseFloat(row.cComm)        || 0,
            tCommAmt2:        parseFloat(row.oComm)        || 0,
            tDailyHmlAmt:     parseFloat(row.cDaily)       || 0,
            tOutstndHmlAmt:   parseFloat(row.oDaily)       || 0,
            tBoardDepoAmt:    parseFloat(row.totDepoBrd)   || 0,
            tBoardTonRate:    parseFloat(boardTonRate)     || 0,
            tBoardLeavyPerct: parseFloat(boardLeavyPerct)  || 0,
            fkUserID:         userId,
            CrMod:            now,
          });
        } else {
          // MODIFY — UPDATE existing record
          await H1.update({
            tDate:            row.date,
            tBrdDate:         row.brdDate || row.date,
            tMonthYear,
            tTotVaraiAmt:     parseFloat(totVaraiAmt)     || 0,
            tVaraiAmt:        parseFloat(row.cVarai)       || 0,
            tBalVaraiAmt:     parseFloat(row.oVarai)       || 0,
            tCommPerct:       parseFloat(commPerct)        || 0,
            tCommAmt1:        parseFloat(row.cComm)        || 0,
            tCommAmt2:        parseFloat(row.oComm)        || 0,
            tDailyHmlAmt:     parseFloat(row.cDaily)       || 0,
            tOutstndHmlAmt:   parseFloat(row.oDaily)       || 0,
            tBoardDepoAmt:    parseFloat(row.totDepoBrd)   || 0,
            tBoardTonRate:    parseFloat(boardTonRate)     || 0,
            tBoardLeavyPerct: parseFloat(boardLeavyPerct)  || 0,
            fkUserID:         userId,
            CrMod:            now,
          }, { where: { pkHmlEntID } });
        }

        // ── tHamaliCalEntry2: delete + re-insert ─────────────────────────
        // VB6: udfUpdtHmlEnt2 — DELETE WHERE pfkHmlEntID=? then INSERT for each present LABRB/LABRO
        await H2.destroy({ where: { pfkHmlEntID: pkHmlEntID } });

        // Fetch present LABRB + LABRO employees for this date
        const [empRows] = await req.db.query(
          `SELECT ae.fkEmpID, me.eType
           FROM   AttendanceEntry ae
           JOIN   mEmployee me ON ae.fkEmpID COLLATE utf8mb4_unicode_ci = me.pkEmpID COLLATE utf8mb4_unicode_ci
           WHERE  ae.fkCompID = ? AND ae.fkBranchID = ?
             AND  DATE(ae.aDate) = ?
             AND  ae.aPresent = 'Y'
             AND  me.eType IN ('LABRB', 'LABRO')`,
          { replacements: [compID, branchID, row.date] }
        );

        for (const emp of empRows) {
          // LABRB → use board per-person amounts; LABRO → use other per-person amounts
          const tCashAmt   = emp.eType === 'LABRB'
            ? r2(parseFloat(row.cPerBrdAmt)  || 0)
            : r2(parseFloat(row.cPerOthrAmt) || 0);
          const tOutstndAmt = emp.eType === 'LABRB'
            ? r2(parseFloat(row.oPerBrdAmt)  || 0)
            : r2(parseFloat(row.oPerOtherAmt) || 0);

          await H2.create({
            pfkHmlEntID: pkHmlEntID,
            fkEmpID:     emp.fkEmpID,
            tCashAmt,
            tOutstndAmt,
          });
        }

        saved++;
      } catch (rowErr) {
        errors.push(`${row.date}: ${rowErr.message}`);
      }
    }

    res.json({ saved, errors });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

module.exports = router;
