// ─────────────────────────────────────────────────────────────────────────────
// auth.js  —  JWT verification + per-request database attachment
//
// What this does on every authenticated request:
//   1. Reads the Bearer token from the Authorization header.
//   2. Verifies it with JWT_SECRET.
//   3. Looks up the company's database connection from connectionManager.
//   4. Attaches to req:
//        req.user       — decoded JWT payload
//                         { userId, compID, groupID, branchID, userCode,
//                           userFullName, roleID, isPrimary }
//        req.db         — Sequelize instance for req.user.compID's database
//                         (use this for all company data queries in routes)
//        req.adminDB    — Sequelize instance for gms_admin
//                         (use this for User/Role/Permission/Company lookups)
//
// IMPORTANT: req.db points to the LOGGED-IN company's database only.
// For group-wide queries (transaction entry, reports) use:
//   groupQuery.groupUnionRaw(req, tableName, ...)
// which builds UNION ALL SQL across all company databases in the group.
// ─────────────────────────────────────────────────────────────────────────────
const jwt               = require('jsonwebtoken');
const connectionManager = require('../config/connectionManager');
const adminDB           = require('../config/adminDatabase');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded payload as req.user
    req.user = decoded;

    // Attach the company's own DB connection
    // If connectionManager hasn't loaded this company yet (rare race condition
    // during startup), return 401 rather than crashing.
    const db = connectionManager.getDB(decoded.compID);
    if (!db) {
      return res.status(401).json({ error: 'Company database not ready — please try again' });
    }
    req.db      = db;
    req.adminDB = adminDB;

    next();
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
};
