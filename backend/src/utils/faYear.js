// JS port of VB6 gudfGetFaYear() from FaFunc.bas.
//
// Queries FaYearInfo table: finds the row whose StartDate <= date <= EndDate
// for the given company and Nor_Alt type.
//
// Parameters:
//   db      : Sequelize instance for the company DB
//   compID  : company ID (e.g. 'ADS')
//   date    : JS Date or ISO date string
//   norAlt  : 'N' (Normal FY) or 'A' (Alternate FY) — default 'N'
//
// Returns: FaYear string (e.g. '2425') or null if not found
//
// Fallback: if FaYearInfo table is empty or not yet seeded,
// computes mathematically (Apr→Mar Indian FY) so the app still works.

async function getFaYear(db, compID, date, norAlt = 'N') {
  const d = date instanceof Date ? date : new Date(date);
  const dateStr = d.toISOString().slice(0, 10);

  try {
    const [rows] = await db.query(
      `SELECT FaYear FROM FaYearInfo
       WHERE fkCompID  = ?
         AND StartDate <= ?
         AND ?          <= EndDate
         AND Nor_Alt   = ?
         AND Active    = 'Y'
       LIMIT 1`,
      { replacements: [compID, dateStr, dateStr, norAlt] }
    );

    if (rows.length > 0 && rows[0].FaYear) {
      return rows[0].FaYear;
    }
  } catch {
    // Table may not exist yet — fall through to mathematical calculation
  }

  // Mathematical fallback (Apr→Mar Indian FY)
  const month = d.getMonth() + 1;
  const year  = d.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear   = startYear + 1;
  return String(startYear % 100).padStart(2, '0') + String(endYear % 100).padStart(2, '0');
}

module.exports = { getFaYear };
