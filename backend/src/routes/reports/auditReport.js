// auditReport.js — /api/reports/audit-report
// VB6 origin: frmAuditReport.frm, "Transaction Log" tab
//
// Endpoints:
//   GET  /init  — Queries 1–3: load fiscal year dates, report name list, date field list
//   POST /data  — Queries 4–6: look up table + columns for chosen report, run dynamic data query
//
// Authorization: all routes require AUDIT_REP / CanView permission.
//
// All queries run against the company DB (req.db), matching VB6 gDb.ConSele.
//
// VB6 bug fixed in Q6 (udfTLGenQury):
//   Original:  If sTLDateField <> "Select Field" Or sTLDateField <> ""  ← always True (tautology)
//   The Or condition makes the expression unconditionally True for any string value.
//   Corrected: only add WHERE clause when dateField is a non-empty, validated column name.
//
// Client-side post-processing (done in React, mirrors VB6 udfTLModifiedEntryCheck):
//   1. DEL rows: highlighted #FFC0C0 (VB6 &HC0C0FF BGR = RGB 255,192,192)
//   2. UPD2/UPD1 pairs (consecutive rows with UPD2 above UPD1):
//      - Compare cols 2+ (skip col 0=UniqueSrNo_AT, col 1=Status_AT)
//      - Bold differing cells in both rows
//      - If ALL columns match (nDiffCount=0), remove BOTH rows entirely

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');

router.use(requireAuth);

// Helper: convert MySQL Date / datetime to YYYY-MM-DD string
function isoDate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

// ── GET /init ──────────────────────────────────────────────────────────────────
// VB6 origin: Form_Load → udfTLInitialiseControls
//              → udfTLInitDate (Q1: fiscal year dates)
//              → udfTLFillReportNameCombo (Q2: report list, Q3: date field list)
//
// Response shape:
//   startDate   — YYYY-MM-DD from FaYearInfo.StartDate → seeds fromDate picker
//   endDate     — YYYY-MM-DD for today → seeds toDate picker (VB6: gudfGetCurrDateTime("D"))
//   reports     — [{ pkAudRepID, RepName }] for Report Name dropdown
//   dateFields  — [{ ColName, ColDisplayName }] for Select Date Field dropdown
router.get('/init', requirePerm('AUDIT_REP', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const today = new Date().toISOString().slice(0, 10); // VB6: gudfGetCurrDateTime("D")

    // Q1 — Find the fiscal year that contains today's date.
    // VB6: Select StartDate, EndDate, FaYear FROM FaYearInfo
    //       where fkCompID=? and fkBranchID=?
    //         and StartDate <= [today] and [today] <= EndDate
    //         and Nor_Alt='N' and Active='Y'
    // dtpTLFromDt.Value = rsAudRep("StartDate")  — fiscal year start seeds fromDate
    // dtpTLEndDt.Value  = gudfGetCurrDateTime("D") — today seeds toDate
    const [faRows] = await req.db.query(
      `SELECT StartDate, EndDate, FaYear
       FROM FaYearInfo
       WHERE fkCompID   = :compID
         AND fkBranchID = :branchID
         AND StartDate  <= :today
         AND :today     <= EndDate
         AND Nor_Alt    = 'N'
         AND Active     = 'Y'`,
      { replacements: { compID, branchID, today } }
    );

    // Q2 — Report Name list for the first dropdown.
    // VB6: Select pkAudRepID, RepName from AuditReport where Active='Y'
    // The combo stored pkAudRepID as the hidden value and RepName as the display.
    const [repRows] = await req.db.query(
      `SELECT pkAudRepID, RepName FROM AuditReport WHERE Active = 'Y'`
    );

    // Q3 — Date field list for the second dropdown.
    // VB6: Select ColName, ColDisplayName from AuditReportColumns
    //       where ComposeFlg='Y' Order By SortOrder
    // Unlike Q5, this query is NOT filtered by report — it loads ALL compose-flagged columns
    // across all reports so the user can pick which column to use as the date filter.
    const [fieldRows] = await req.db.query(
      `SELECT ColName, ColDisplayName
       FROM AuditReportColumns
       WHERE ComposeFlg = 'Y'
       ORDER BY SortOrder`
    );

    const faYear = faRows[0] || null;
    res.json({
      startDate:  faYear ? isoDate(faYear.StartDate) : today,
      endDate:    today,
      reports:    repRows,    // [{ pkAudRepID, RepName }]
      dateFields: fieldRows,  // [{ ColName, ColDisplayName }]
    });
  } catch (err) {
    console.error('[AuditRep /init]', err.message);
    res.status(500).json({ error: 'Failed to load audit report configuration' });
  }
});

// ── POST /data ─────────────────────────────────────────────────────────────────
// VB6 origin: cmdTLView_Click → udfTLFillGrid → udfTLGenQury + udfTLQuryStringGen
//
// Body: { audRepID, fromDate, toDate, dateField }
//   audRepID  — pkAudRepID from Report Name dropdown
//   fromDate  — YYYY-MM-DD, used in WHERE clause if dateField is set
//   toDate    — YYYY-MM-DD, used in WHERE clause if dateField is set
//   dateField — ColName value; empty string means no date filtering
//
// Response shape:
//   columns — [{ ColName, ColDisplayName }] in SortOrder — grid header definitions
//   rows    — array of row objects (key = ColName) — raw DB result in ORDER BY UniqueSrNo_AT, Status_AT
//
// The ORDER BY ensures UPD2 always appears immediately above its matching UPD1 row,
// which is required for the UPD1/UPD2 pair detection done client-side in processRows().
router.post('/data', requirePerm('AUDIT_REP', 'CanView'), async (req, res) => {
  try {
    const { audRepID, fromDate, toDate, dateField = '' } = req.body;
    if (!audRepID) return res.status(400).json({ error: 'audRepID is required' });

    // Q4 — Look up the table name for the selected report.
    // VB6 udfTLGenQury: Select pkAudRepID, TableName from AuditReport
    //                    where pkAudRepID=? and Active='Y'
    const [repRows] = await req.db.query(
      `SELECT pkAudRepID, TableName FROM AuditReport WHERE pkAudRepID = ? AND Active = 'Y'`,
      { replacements: [audRepID] }
    );
    if (!repRows.length)
      return res.status(400).json({ error: 'Report not found or inactive' });

    const tableName = repRows[0].TableName; // e.g. "tAuditTrail" — sourced from our own DB

    // Q5 — Get ordered column list for the selected report.
    // VB6 udfTLQuryStringGen: Select ColName, ColDisplayName from AuditReportColumns
    //                          where cpkAudRepID=? and ComposeFlg='Y' order by SortOrder
    // VB6 also uses this loop to:
    //   - Build the SELECT column string (psString)
    //   - Set grid column count and header labels (vfgTL.TextMatrix(0, nCols-1))
    // We return columns to the frontend for the same two purposes.
    const [colRows] = await req.db.query(
      `SELECT ColName, ColDisplayName
       FROM AuditReportColumns
       WHERE cpkAudRepID = ?
         AND ComposeFlg  = 'Y'
       ORDER BY SortOrder`,
      { replacements: [audRepID] }
    );
    if (!colRows.length)
      return res.status(400).json({ error: 'No columns configured for this report' });

    // Validate dateField against columns returned from Q5 to prevent SQL injection.
    // dateField originates from /init Q3 results, but we re-validate server-side.
    const validColNames = new Set(colRows.map(c => c.ColName));
    if (dateField && !validColNames.has(dateField))
      return res.status(400).json({ error: 'Invalid date field selection' });

    // Q6 — Dynamic data query built from Q4 (tableName) + Q5 (column list).
    // VB6 udfTLGenQury builds: "Select " & sString & " from " & TableName
    //                           [& " Where dateField >= date and dateField <= date"]
    //                           & " Order By UniqueSrNo_AT, Status_AT"
    //
    // VB6 bug fixed: original Or condition was always True.
    // We correctly add WHERE only when dateField, fromDate, and toDate are all provided.
    const selectCols = colRows.map(c => `\`${c.ColName}\``).join(', ');
    const replacements = [];
    let sql = `SELECT ${selectCols} FROM \`${tableName}\``;

    if (dateField && fromDate && toDate) {
      // VB6 formatted dates as 'dd-MMM-yyyy'; MySQL accepts YYYY-MM-DD ISO format directly.
      sql += ` WHERE \`${dateField}\` >= ? AND \`${dateField}\` <= ?`;
      replacements.push(fromDate, toDate);
    }

    // ORDER BY is critical: guarantees UPD2 appears directly above UPD1 in result set,
    // matching the grid ordering VB6 relied on for udfTLModifiedEntryCheck.
    sql += ` ORDER BY UniqueSrNo_AT, Status_AT`;

    const [dataRows] = await req.db.query(sql, { replacements });

    res.json({
      columns: colRows,   // column metadata — col[0]=UniqueSrNo_AT, col[1]=Status_AT, col[2+]=data
      rows:    dataRows,  // raw rows with key=ColName; client runs UPD1/UPD2 post-processing
    });
  } catch (err) {
    console.error('[AuditRep /data]', err.message);
    res.status(500).json({ error: 'Failed to load audit report data' });
  }
});

module.exports = router;
