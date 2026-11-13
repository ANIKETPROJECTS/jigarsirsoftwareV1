// hamaliReport.js — /api/reports/hamali-report
// VB6 origin: frmHamaliCalEntryReport.frm
//
// Endpoints:
//   GET  /employees  — Q1: load LabB/LabO employee list for dropdown (VB6: udfFillGridCombo)
//   POST /report     — Q2/Q3/Q4: run one of the 3 Crystal Report data queries (VB6: udfShowRep)
//
// Authorization: all routes require HAMALI_REP / CanView permission.
//
// Crystal Report replacement strategy:
//   drsLbrCalList       → reportType = 'labour'     (Q2)
//   drsBrdDepoDetail    → reportType = 'board-depo' (Q3)
//   drsGroceryBoardForm → reportType = 'board-form' (Q4)
//
// Formula fields that VB6 passed to Crystal ({@CompName}, {@StartDt}, {@EndDt}, {@UTRNo}, {@PaymentDt})
// are returned to the frontend in the response so the React report header can display them.

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');

router.use(requireAuth);

// ── GET /employees ─────────────────────────────────────────────────────────────
// VB6 udfFillGridCombo: fills vfgLbrName combo with Labour employees (LabB + LabO eType)
// Called on frontend Go button click after date range is set and validated.
// Q1 — exact SQL from VB6 udfFillGridCombo (adapted to parameterized form)
router.get('/employees', requirePerm('HAMALI_REP', 'CanView'), async (req, res) => {
  try {
    const compID   = req.user.compID;
    const branchID = req.user.branchID;

    const [rows] = await req.db.query(
      `SELECT me.eName, me.eShortName, me.pkEmpID
       FROM mEmployee me
       WHERE me.fkCompID = ? AND me.fkBranchID = ?
         AND me.eType IN ('LabB', 'LabO')
         AND me.Active = 'Y'
       ORDER BY me.eName`,
      { replacements: [compID, branchID] }
    );

    res.json(rows);
  } catch (err) {
    console.error('[HamaliRep /employees]', err.message);
    res.status(500).json({ error: 'Failed to load employee list' });
  }
});

// ── POST /summary ──────────────────────────────────────────────────────────────
// Go button: per-employee aggregated totals for the selected date range.
// VB6 origin: frmHamaliCalEntryReport — grid fill query (drsLbrSummary)
router.post('/summary', requirePerm('HAMALI_REP', 'CanView'), async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate)
      return res.status(400).json({ error: 'fromDate and toDate are required' });

    const { compID, branchID } = req.user;

    const [empRows] = await req.db.query(
      `SELECT em.eName, em.eShortName,
              COUNT(h2.fkEmpID)              AS Present,
              COALESCE(SUM(h2.tCashAmt),   0) AS CashAmt,
              COALESCE(SUM(h2.tOutStndAmt),0) AS OutAmt
       FROM   tHamaliCalEntry1 AS h1
       LEFT JOIN tHamaliCalEntry2 AS h2
              ON h1.pkHmlEntID = h2.pfkHmlEntID
       LEFT JOIN mEmployee AS em
              ON h2.fkEmpID COLLATE utf8mb4_unicode_ci = em.pkEmpID COLLATE utf8mb4_unicode_ci
       WHERE  h1.fkCompID = ? AND h1.fkBranchID = ?
         AND  DATE(h1.tDate) BETWEEN ? AND ?
       GROUP BY em.eName, em.eShortName
       ORDER BY em.eName`,
      { replacements: [compID, branchID, fromDate, toDate] }
    );

    res.json({ empRows, empty: empRows.length === 0 });
  } catch (err) {
    console.error('[HamaliRep /summary]', err.message);
    res.status(500).json({ error: 'Failed to load summary data.' });
  }
});

// ── POST /report ───────────────────────────────────────────────────────────────
// Body: {
//   reportType  : 'labour' | 'board-depo' | 'board-form',
//   fromDate    : 'yyyy-mm-dd',
//   toDate      : 'yyyy-mm-dd',
//   utrNo?      : string   (Board Form only — VB6 Crystal formula: {@UTRNo})
//   paymentDate?: 'yyyy-mm-dd' (Board Form only — VB6 Crystal formula: {@PaymentDt})
// }
//
// VB6 udfShowRep selects one of 3 Crystal Reports and passes the matching SQL recordset.
// This endpoint runs the equivalent parameterized SQL and returns JSON rows.
//
// NOTE: COLLATE utf8mb4_unicode_ci added to mEmployee JOIN in Q2 because mEmployee
// retains its VB6 legacy collation (utf8mb4_unicode_ci) while tHamaliCalEntry2
// uses the default utf8mb4_0900_ai_ci — without COLLATE the JOIN throws ERROR 1267.
router.post('/report', requirePerm('HAMALI_REP', 'CanView'), async (req, res) => {
  try {
    const db       = req.db;
    const compID   = req.user.compID;
    const branchID = req.user.branchID;
    const { reportType, fromDate, toDate } = req.body;

    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required' });
    if (!reportType)           return res.status(400).json({ error: 'reportType is required' });

    let rows;

    if (reportType === 'labour') {
      // Q2 — Labour wise hamali calculation (VB6 Crystal Report: drsLbrCalList)
      // Joins tHamaliCalEntry1 → tHamaliCalEntry2 → mEmployee
      // Returns one row per date per employee: date, cash amount, outstanding amount, short name
      const [result] = await db.query(
        `SELECT t1.tDate, t2.tCashAmt, t2.tOutStndAmt, me.eShortName
         FROM tHamaliCalEntry1 t1
         JOIN tHamaliCalEntry2 t2
           ON t1.pkHmlEntID = t2.pfkHmlEntID
         JOIN mEmployee me
           ON t2.fkEmpID COLLATE utf8mb4_unicode_ci = me.pkEmpID COLLATE utf8mb4_unicode_ci
         WHERE t1.fkCompID = ? AND t1.fkBranchID = ?
           AND DATE(t1.tDate) >= ? AND DATE(t1.tDate) <= ?`,
        { replacements: [compID, branchID, fromDate, toDate] }
      );
      rows = result;

    } else if (reportType === 'board-depo') {
      // Q3 — Board Deposite Hamali Calculation (VB6 Crystal Report: drsBrdDepoDetail)
      // One row per calendar date (including Sundays/holidays with 0).
      // Recursive CTE generates all dates so gaps appear as 0 rows.
      const [result] = await db.query(
        `WITH RECURSIVE cal AS (
           SELECT ? AS d
           UNION ALL
           SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM cal WHERE d < ?
         )
         SELECT DATE_FORMAT(cal.d, '%Y-%m-%d')        AS tDate,
                COALESCE(t1.tBoardDepoAmt,    0)       AS tBoardDepoAmt,
                COALESCE(t1.tBoardTonRate,    0)       AS tBoardTonRate,
                COALESCE(t1.tBoardLeavyPerct, 0)       AS tBoardLeavyPerct
         FROM cal
         LEFT JOIN tHamaliCalEntry1 t1
           ON DATE(t1.tDate) = cal.d
           AND t1.fkCompID   = ?
           AND t1.fkBranchID = ?
         ORDER BY cal.d`,
        { replacements: [fromDate, toDate, compID, branchID] }
      );
      rows = result;

    } else if (reportType === 'board-form') {
      // Q4 — Board Deposite Form (VB6 Crystal Report: drsGroceryBoardForm)
      // Only BoardAmt is dynamic; all employer/board details are hardcoded in frontend.
      const [amtResult] = await db.query(
        `SELECT COALESCE(SUM(tBoardDepoAmt), 0) AS BoardAmt
         FROM tHamaliCalEntry1
         WHERE fkCompID = ? AND fkBranchID = ?
           AND tDate >= ? AND tDate <= ?`,
        { replacements: [compID, branchID, fromDate, toDate] }
      );

      return res.json({ rows: amtResult, empty: !amtResult.length });

    } else {
      return res.status(400).json({ error: 'Invalid reportType. Use: labour | board-depo | board-form' });
    }

    if (!rows || rows.length === 0) {
      return res.json({ rows: [], empty: true });
    }

    res.json({ rows, empty: false });
  } catch (err) {
    console.error('[HamaliRep /report]', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate report' });
  }
});

module.exports = router;
