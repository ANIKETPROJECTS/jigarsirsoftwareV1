// ─────────────────────────────────────────────────────────────────────────────
// groupQuery.js  —  Cross-database UNION queries for group-wide data
//
// WHY UNION QUERIES?
//   Each company in a group has its own database (gms_ads, gms_test …).
//   For Transactions and Reports, the user must see data from ALL companies
//   in their group together.  MySQL handles cross-database queries natively
//   using fully-qualified table names:  `gms_ads`.`mParty`
//
//   A UNION ALL is cheaper than:
//     • Fetching from two DBs separately and merging in Node.js (two round trips)
//     • Using a single shared DB (loses company isolation)
//
// SECURITY:
//   Table names and DB names are taken from the in-memory connectionManager
//   (loaded from gms_admin at startup) — never from user input.  This prevents
//   SQL injection on the cross-DB query.
//
// USAGE:
//   const { groupPartyList } = require('../../utils/groupQuery');
//   const parties = await groupPartyList(req);   // all parties in caller's group
// ─────────────────────────────────────────────────────────────────────────────
const { QueryTypes } = require('sequelize');
const connectionManager = require('../config/connectionManager');

// ── groupUnionRaw ─────────────────────────────────────────────────────────────
// Low-level helper: builds and executes a UNION ALL across all company DBs
// in the caller's group.
//
// Parameters:
//   req          — Express request (uses req.db for the query runner, req.user.groupID)
//   tableName    — MySQL table name (e.g. 'mParty')
//   selectCols   — column list string (e.g. '*' or 'pkPartyID, pName')
//   whereClause  — SQL WHERE condition WITHOUT the WHERE keyword (e.g. "Active = 'Y'")
//   orderBy      — optional ORDER BY clause WITHOUT the keyword (e.g. 'pName ASC')
//
// Returns: flat array of rows, with `_compID` added so callers know which
//          company each row came from.
async function groupUnionRaw(req, tableName, selectCols, whereClause, orderBy) {
  const { groupID } = req.user;
  const companies = connectionManager.getGroupCompanyDetails(groupID);

  if (companies.length === 0) return [];

  // Build one SELECT per company database using fully-qualified `db`.`table` syntax
  const parts = companies.map(({ dbName, pkCompID }) => {
    // pkCompID injected as a literal string column so callers know the source company
    return (
      `SELECT ${selectCols}, '${pkCompID}' AS _compID ` +
      `FROM \`${dbName}\`.\`${tableName}\` ` +
      `WHERE ${whereClause}`
    );
  });

  let sql = parts.join(' UNION ALL ');
  if (orderBy) sql = `SELECT * FROM (${sql}) _union ORDER BY ${orderBy}`;

  // Run the UNION on any live connection (all point to the same MySQL server)
  return req.db.query(sql, { type: QueryTypes.SELECT });
}

// ── groupPartyList ────────────────────────────────────────────────────────────
// Returns all active parties across all companies in the caller's group.
// Used in: Transaction Entry party dropdown, Group-wide reports.
async function groupPartyList(req) {
  return groupUnionRaw(
    req,
    'mParty',
    'pkPartyID, pName, pAlias, pType, fkStateID, PinCode, fkCompID',
    "Active = 'Y'",
    'pName ASC'
  );
}

// ── groupTaxList ──────────────────────────────────────────────────────────────
// All active taxes across the group (for billing).
async function groupTaxList(req) {
  return groupUnionRaw(req, 'mTax', 'pkTaxID, TaxName, TaxRate', "Active = 'Y'", 'TaxName ASC');
}

// ── groupBankList ─────────────────────────────────────────────────────────────
async function groupBankList(req) {
  return groupUnionRaw(req, 'mBank', '*', "Active = 'Y'", 'BankName ASC');
}

module.exports = { groupUnionRaw, groupPartyList, groupTaxList, groupBankList };
