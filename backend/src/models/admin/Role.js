// Admin model — stored in gms_admin.
// Roles are group-level (one set of roles per company group).
const { DataTypes } = require('sequelize');
const adminDB = require('../../config/adminDatabase');
module.exports = adminDB.define('mRole', {
  pkRoleID:  { type: DataTypes.STRING(20), primaryKey: true },
  fkGroupID: { type: DataTypes.STRING(10), allowNull: false },
  RoleName:  { type: DataTypes.STRING(50), allowNull: false },
  Active:    { type: DataTypes.STRING(2),  defaultValue: 'Y' },
}, { tableName: 'mRole', timestamps: false });
