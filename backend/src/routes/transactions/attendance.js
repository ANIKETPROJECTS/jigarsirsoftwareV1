// ─────────────────────────────────────────────────────────────────────────────
// attendance.js  —  /api/transactions/attendance
//
// VB6 origin: frmAttendanceEntry.frm
//   - Loads employees (grouped by eType) as grid columns
//   - Loads dates (From..To) as grid rows
//   - Default state: Present (checked) for all — matches VB6 flexChecked default
//   - Existing records override the default
//   - Holidays fetched from mHoliday for color-coding (Board/Office/Both/Sunday)
//   - Save: INSERT new records, UPDATE existing ones
//
// Endpoints:
//   GET  /meta          → employee type combos + full employee list (for filter dropdowns)
//   POST /load          → grid data: filtered employees + holidays + existing attendance + faYear
//   POST /save          → batch upsert (INSERT if new, UPDATE aPresent if existing)
//
// Permission module: 'ATTENDANCE'
// Scope: company-level (fkCompID + fkBranchID)
// ─────────────────────────────────────────────────────────────────────────────

const router                  = require('express').Router();
const { Op }                  = require('sequelize');
const requireAuth             = require('../../middleware/auth');
const requirePermission       = require('../../middleware/permission');
const defineAttendanceEntry   = require('../../models/company/AttendanceEntry');
const defineEmployee          = require('../../models/company/Employee');
const defineVCComboData       = require('../../models/company/VCComboData');
const { gudfGenSerialID, gudfGenSerialIDBatch } = require('../../utils/serialID');
const { getFaYear }           = require('../../utils/faYear');

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions/attendance/meta
//
// Returns data needed to populate the filter toolbar (no date range needed):
//   empTypes  : VCComboData rows where VCPurpose = 'EmpType'
//               (VCCode = eType code e.g. 'Lab', 'Off'; VCData = display label)
//   employees : All active employees for the branch, sorted by type then short name
//               Used to populate the "Employee Name" filter dropdown
// ─────────────────────────────────────────────────────────────────────────────
router.get('/meta', requirePermission('ATTENDANCE', 'CanView'), async (req, res) => {
  try {
    const VCComboData = defineVCComboData(req.db);
    const Employee    = defineEmployee(req.db);
    const { compID, branchID } = req.user;

    const [empTypes, employees] = await Promise.all([
      // VB6 query: SELECT VCData, VCCode FROM VCComboData WHERE VCPurpose = 'Type' ORDER BY VCSrtOrd
      // Web uses 'EmpType' — seed via VCComboData with VCPurpose='EmpType'
      VCComboData.findAll({
        attributes: ['VCCode', 'VCData', 'VCSrtOrd'],
        where:  { fkCompID: compID, fkBranchID: branchID, VCPurpose: 'EmpType', VCActive: 'Y' },
        order:  [['VCSrtOrd', 'ASC'], ['VCData', 'ASC']],
      }),
      // VB6 query: SELECT eShortName, pkEmpID, eName FROM mEmployee WHERE Active='Y' ORDER BY eName
      Employee.findAll({
        attributes: ['pkEmpID', 'eName', 'eShortName', 'eType'],
        where:  { fkCompID: compID, fkBranchID: branchID, Active: 'Y' },
        order:  [['eType', 'ASC'], ['eShortName', 'ASC']],
      }),
    ]);

    res.json({ empTypes, employees });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load meta data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/attendance/load
//
// Loads complete grid data for the selected date range and optional filters.
// Called when the user clicks "Go".
//
// Request body:
//   fromDate    : 'YYYY-MM-DD'  (required)
//   toDate      : 'YYYY-MM-DD'  (required)
//   empTypeCode : eType code e.g. 'Lab' (optional) — filters employees by type
//   empID       : pkEmpID (optional) — filters to a single employee
//
// Response:
//   employees  : filtered + sorted employee list (becomes grid columns)
//   holidays   : holidays in date range with hBoard/hOffice flags (for color coding)
//   attendance : existing attendance records (default is Present; these override)
//   faYear     : FY string for the fromDate e.g. '2526' (used during save)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/load', requirePermission('ATTENDANCE', 'CanView'), async (req, res) => {
  const { fromDate, toDate, empTypeCode, empID } = req.body;

  if (!fromDate || !toDate)
    return res.status(400).json({ error: 'fromDate and toDate are required' });
  if (fromDate > toDate)
    return res.status(400).json({ error: 'From Date cannot be greater than To Date' });

  const { compID, branchID } = req.user;

  try {
    const Employee    = defineEmployee(req.db);
    const Attendance  = defineAttendanceEntry(req.db);

    // Build employee WHERE clause (mirrors VB6 optional filters in udfFillGridEntry)
    const empWhere = { fkCompID: compID, fkBranchID: branchID, Active: 'Y' };
    if (empTypeCode) empWhere.eType    = empTypeCode;
    if (empID)       empWhere.pkEmpID  = empID;

    const [employees, holidays, attendance, faYear] = await Promise.all([
      // VB6: SELECT eShortName, eType, pkEmpID FROM mEmployee WHERE Active='Y' ORDER BY eType, eShortName
      Employee.findAll({
        attributes: ['pkEmpID', 'eName', 'eShortName', 'eType'],
        where:  empWhere,
        order:  [['eType', 'ASC'], ['eShortName', 'ASC']],
      }),

      // VB6: SELECT * FROM mHoliday WHERE hDate = '<date>' (queried per cell in VB6)
      // Web: fetch all holidays in range once → hash client-side for O(1) lookup
      // DATE() cast handles DATETIME values in hDate column
      req.db.query(
        `SELECT DATE_FORMAT(hDate, '%Y-%m-%d') AS hDate, hBoard, hOffice
         FROM   mHoliday
         WHERE  fkCompID = ? AND DATE(hDate) BETWEEN ? AND ? AND Active = 'Y'`,
        { replacements: [compID, fromDate, toDate] }
      ).then(([rows]) => rows),

      // VB6: SELECT * FROM AttendanceEntry WHERE fkEmpID=? AND aDate=? (per cell)
      // Web: fetch all records for the range once
      Attendance.findAll({
        attributes: ['fkEmpID', 'aDate', 'aPresent'],
        where: {
          fkCompID:   compID,
          fkBranchID: branchID,
          aDate:      { [Op.between]: [fromDate, toDate] },
        },
      }),

      // FaYear needed during save — compute once here from fromDate
      getFaYear(req.db, compID, fromDate),
    ]);

    res.json({ employees, holidays, attendance, faYear });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load attendance data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/attendance/save
//
// Batch upserts attendance records — mirrors VB6 cmdSave_Click + udfSaveData.
//
// VB6 logic (per cell):
//   SELECT * FROM AttendanceEntry WHERE fkEmpID=? AND aDate=?
//   If not found → INSERT (with new pkAttendID from gudfGenSerialID)
//   If found     → UPDATE aPresent
//
// Web: processes all entries sequentially (preserves data integrity).
//
// Request body:
//   entries : Array of { fkEmpID, aDate, aPresent ('Y'|'N'), aFaYear }
//
// Response:
//   saved  : count of records successfully saved
//   errors : array of any per-record error strings
// ─────────────────────────────────────────────────────────────────────────────
router.post('/save', requirePermission('ATTENDANCE', 'CanAdd'), async (req, res) => {
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'entries array is required and must not be empty' });

  const { compID, branchID, groupID, userId } = req.user;
  const now    = new Date();
  const errors = [];
  let   saved  = 0;

  try {
    const Attendance = defineAttendanceEntry(req.db);

    // ── Step 1: Fetch ALL existing records for the range in ONE query ──────────
    // Avoids N individual findOne calls (was the cause of HTTP timeout on large grids).
    const validEntries = entries.filter(e => e.fkEmpID && e.aDate);
    const empIDs = [...new Set(validEntries.map(e => e.fkEmpID))];
    const dates  = [...new Set(validEntries.map(e => String(e.aDate).slice(0, 10)))];

    const existingRows = await Attendance.findAll({
      attributes: ['pkAttendID', 'fkEmpID', 'aDate'],
      where: {
        fkCompID:   compID,
        fkBranchID: branchID,
        fkEmpID:    { [Op.in]: empIDs },
        aDate:      { [Op.in]: dates },
      },
    });

    // Build lookup: "empID|YYYY-MM-DD" → true (exists)
    const existingSet = new Set(
      existingRows.map(r => `${r.fkEmpID}|${String(r.aDate).slice(0, 10)}`)
    );

    // ── Step 2: Split into creates vs updates ─────────────────────────────────
    const toCreate = [];
    const toUpdate = [];

    for (const entry of validEntries) {
      const dateStr    = String(entry.aDate).slice(0, 10);
      const presentVal = entry.aPresent === 'N' ? 'N' : 'Y';
      const key        = `${entry.fkEmpID}|${dateStr}`;

      if (existingSet.has(key)) {
        toUpdate.push({ fkEmpID: entry.fkEmpID, dateStr, presentVal });
      } else {
        toCreate.push({
          fkEmpID:     entry.fkEmpID,
          dateStr,
          presentVal,
          aFaYear:     entry.aFaYear || '',
          aMonthYear:  dateStr.replace(/-/g, '').slice(0, 6),
        });
      }
    }

    // ── Step 3: Batch-generate serial IDs for new records (one transaction) ───
    if (toCreate.length > 0) {
      const serialKey = `${groupID}!${branchID}!AttendanceEntry!pkAttendID`;
      const [startID, idErr] = await gudfGenSerialIDBatch(
        req.db, serialKey, toCreate.length, 'Attendance Entry - pkAttendID'
      );

      if (startID === -1) {
        return res.status(500).json({ error: `ID generation failed: ${idErr}` });
      }

      const newRecords = toCreate.map((e, i) => ({
        pkAttendID:  `${groupID}!${startID + i}`,
        fkCompID:    compID,
        fkBranchID:  branchID,
        AttendID:    startID + i,
        aDate:       e.dateStr,
        fkEmpID:     e.fkEmpID,
        aPresent:    e.presentVal,
        aFaYear:     e.aFaYear,
        aMonthYear:  e.aMonthYear,
        fkUserID:    userId,
        CrMod:       now,
      }));

      try {
        await Attendance.bulkCreate(newRecords);
        saved += toCreate.length;
      } catch (err) {
        errors.push(`Bulk insert failed: ${err.message}`);
      }
    }

    // ── Step 4: Parallel updates for existing records ─────────────────────────
    // MySQL may report 0 affected rows when aPresent hasn't changed — that is NOT
    // an error; we count every settled promise as saved.
    if (toUpdate.length > 0) {
      const results = await Promise.allSettled(
        toUpdate.map(e =>
          Attendance.update(
            { aPresent: e.presentVal, fkUserID: userId, CrMod: now },
            { where: { fkCompID: compID, fkBranchID: branchID, fkEmpID: e.fkEmpID, aDate: e.dateStr } }
          )
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') saved++;
        else errors.push(r.reason?.message || 'Update failed');
      }
    }

    res.json({ saved, errors });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

module.exports = router;
