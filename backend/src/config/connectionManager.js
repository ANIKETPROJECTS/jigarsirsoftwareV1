// ─────────────────────────────────────────────────────────────────────────────
// connectionManager.js  —  Multi-database connection manager
//
// WHY THIS EXISTS:
//   Each company has its own MySQL database (gms_ads, gms_test, gms_vlco …).
//   Queries for company-specific data (Party, Tax, Transactions) must run
//   against the company's own database.  Cross-company (group-wide) queries
//   for Transactions and Reports use MySQL's native `dbName.tableName` syntax
//   in UNION ALL queries — no extra network hops, handled entirely in MySQL.
//
// LIFECYCLE:
//   1. App starts → connectionManager.init() is called from server.js
//   2. It reads all active companies from gms_admin.mCompany
//   3. It creates one Sequelize pool per company database
//   4. auth.js middleware calls getDB(compID) to attach req.db to every request
//
// ADDING A NEW COMPANY:
//   Call connectionManager.addCompany(compInfo) from the admin route after
//   creating the company in gms_admin and creating its database.  This registers
//   the new connection without restarting the server.
// ─────────────────────────────────────────────────────────────────────────────
const { Sequelize, QueryTypes } = require('sequelize');

// Shared MySQL connection options (same server, different DB names)
function makeSequelize(dbName) {
  const seq = new Sequelize(
    dbName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host:    process.env.DB_HOST || 'localhost',
      port:    parseInt(process.env.DB_PORT) || 3306,
      dialect: 'mysql',
      logging: false,
      pool: {
        max:     10,
        min:     0,
        acquire: 30000,
        idle:    10000,
      },
      define: {
        timestamps:      false,
        freezeTableName: true,
      },
    }
  );

  // Force utf8mb4_unicode_ci on every new connection so query parameters
  // match the table column collation and avoid "Illegal mix of collations".
  seq.addHook('afterConnect', (connection) =>
    new Promise((resolve, reject) =>
      connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) =>
        err ? reject(err) : resolve()
      )
    )
  );

  return seq;
}

class ConnectionManager {
  constructor() {
    // Map<compID, Sequelize>  — one pool per company database
    this._companyDBs = new Map();

    // Map<compID, { pkCompID, fkGroupID, dbName, IsPrimary, CompName, CompAlias }>
    this._companyInfo = new Map();

    // Map<groupID, compID[]>  — which companies belong to each group
    this._groupCompanies = new Map();
  }

  // ── init ────────────────────────────────────────────────────────────────────
  // Called ONCE from server.js (or app.js) at startup.
  // adminDB is the already-connected gms_admin Sequelize instance.
  async init(adminDB) {
    const companies = await adminDB.query(
      `SELECT pkCompID, fkGroupID, CompName, CompAlias, dbName, IsPrimary
       FROM mCompany WHERE Active = 'Y'`,
      { type: QueryTypes.SELECT }
    );

    for (const comp of companies) {
      this._register(comp);
    }

    console.log(
      `[ConnectionManager] Loaded ${companies.length} company databases:`,
      companies.map(c => `${c.pkCompID}→${c.dbName}`).join(', ')
    );
  }

  // ── _register ────────────────────────────────────────────────────────────────
  // Internal: creates a Sequelize pool for a company and stores its metadata.
  _register(comp) {
    if (!this._companyDBs.has(comp.pkCompID)) {
      this._companyDBs.set(comp.pkCompID, makeSequelize(comp.dbName));
    }
    this._companyInfo.set(comp.pkCompID, comp);

    if (!this._groupCompanies.has(comp.fkGroupID)) {
      this._groupCompanies.set(comp.fkGroupID, []);
    }
    const list = this._groupCompanies.get(comp.fkGroupID);
    if (!list.includes(comp.pkCompID)) list.push(comp.pkCompID);
  }

  // ── addCompany ───────────────────────────────────────────────────────────────
  // Called from the admin "create company" route so the new DB is reachable
  // immediately without a server restart.
  addCompany(comp) {
    this._register(comp);
  }

  // ── getDB ─────────────────────────────────────────────────────────────────────
  // Returns the Sequelize instance for a given company.
  // auth.js attaches this to req.db for every authenticated request.
  getDB(compID) {
    return this._companyDBs.get(compID) || null;
  }

  // ── isPrimary ─────────────────────────────────────────────────────────────────
  // Returns true if this company is the "Primary" company for its group.
  // Only Primary companies can write to shared masters (State, Item, Godown …).
  isPrimary(compID) {
    return this._companyInfo.get(compID)?.IsPrimary === 'Y';
  }

  // ── getCompanyInfo ────────────────────────────────────────────────────────────
  // Full company metadata row.
  getCompanyInfo(compID) {
    return this._companyInfo.get(compID) || null;
  }

  // ── getGroupCompanyIDs ────────────────────────────────────────────────────────
  // All compIDs belonging to a group (including the caller's own company).
  getGroupCompanyIDs(groupID) {
    return this._groupCompanies.get(groupID) || [];
  }

  // ── getGroupCompanyDetails ────────────────────────────────────────────────────
  // Full detail rows for every company in the group.
  // Used by groupQuery.js to build cross-DB UNION SQL.
  getGroupCompanyDetails(groupID) {
    return this.getGroupCompanyIDs(groupID)
      .map(cid => this._companyInfo.get(cid))
      .filter(Boolean);
  }

  // ── getPrimaryCompID ─────────────────────────────────────────────────────────
  // Returns the compID of the Primary company for a given group.
  getPrimaryCompID(groupID) {
    const found = this.getGroupCompanyDetails(groupID).find(c => c.IsPrimary === 'Y');
    return found?.pkCompID || null;
  }
}

// Singleton — one instance shared across the entire backend process
module.exports = new ConnectionManager();
