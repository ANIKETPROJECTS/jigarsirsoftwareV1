const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// mRole — Role Master
//
// A "Role" is a named permission template. Instead of giving permissions
// directly to each user, you create a Role (e.g. "Admin", "Billing Clerk",
// "View Only") and assign permissions to that Role. Then each User is assigned
// one Role, and they automatically inherit all the permissions of that Role.
//
// Example:
//   Role "ADMIN"       → CanView=Y, CanAdd=Y, CanEdit=Y, CanDelete=Y on all modules
//   Role "BILLING"     → CanView=Y, CanAdd=Y, CanEdit=Y, CanDelete=N on MASTERS + ARRIVAL
//   Role "VIEW_ONLY"   → CanView=Y, everything else = N on all modules
//
// Relationships:
//   mRole  ──fkRoleID──►  mPermission  (one role → many module permission rows)
//   mRole  ◄──fkRoleID──  mUser        (each user has exactly one role)
//
// Scope: Roles are group-level (fkGroupID). Each company group defines
//        its own set of roles. Role IDs should be unique across all groups.
//
// MySQL CREATE TABLE:
//   CREATE TABLE mRole (
//     pkRoleID  VARCHAR(20) NOT NULL,
//     fkGroupID VARCHAR(10) NOT NULL,
//     RoleName  VARCHAR(50) NOT NULL,
//     Active    VARCHAR(2)  NOT NULL DEFAULT 'Y',
//     PRIMARY KEY (pkRoleID)
//   );
// ─────────────────────────────────────────────────────────────────────────────
module.exports = require('../config/database').define('mRole', {
  pkRoleID:  { type: DataTypes.STRING(20), primaryKey: true },  // short code: 'ADMIN', 'BILLING'
  fkGroupID: { type: DataTypes.STRING(10), allowNull: false },  // which group owns this role
  RoleName:  { type: DataTypes.STRING(50), allowNull: false },  // display name: 'Administrator'
  Active:    { type: DataTypes.STRING(2),  defaultValue: 'Y' },
}, { tableName: 'mRole', timestamps: false });
