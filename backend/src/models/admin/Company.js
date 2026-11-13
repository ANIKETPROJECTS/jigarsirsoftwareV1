// Admin model — stored in gms_admin, not in any company DB.
// NEW columns vs original:
//   dbName    — the MySQL database name for this company (e.g. 'gms_ads')
//   IsPrimary — 'Y' if this company is the Primary for its group.
//               Only Primary companies can write shared masters (State, Item …).
//               Exactly one company per group should be Primary.
const { DataTypes } = require('sequelize');
const adminDB = require('../../config/adminDatabase');

module.exports = adminDB.define('mCompany', {
  pkCompID:  { type: DataTypes.STRING(10),  primaryKey: true },
  fkGroupID: { type: DataTypes.STRING(10),  allowNull: false },
  CompName:  { type: DataTypes.STRING(30),  allowNull: false },
  CompAlias: { type: DataTypes.STRING(15),  allowNull: false },
  dbName:    { type: DataTypes.STRING(50),  allowNull: false }, // e.g. 'gms_ads'
  IsPrimary: { type: DataTypes.STRING(2),   defaultValue: 'N' }, // 'Y' or 'N'
  Active:    { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:  { type: DataTypes.STRING(100), allowNull: false },
  CrMod:     { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mCompany', timestamps: false });
