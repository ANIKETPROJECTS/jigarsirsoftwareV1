// Admin model — stored in gms_admin.
const { DataTypes } = require('sequelize');
const adminDB = require('../../config/adminDatabase');
module.exports = adminDB.define('mCompanyGroup', {
  pkGroupID: { type: DataTypes.STRING(10), primaryKey: true },
  GroupName: { type: DataTypes.STRING(50), allowNull: false },
  Active:    { type: DataTypes.STRING(2),  defaultValue: 'Y' },
}, { tableName: 'mCompanyGroup', timestamps: false });
