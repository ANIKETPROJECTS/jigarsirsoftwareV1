// Admin model — stored in gms_admin.
// Users belong to a group (fkGroupID) and can log in to any company in that group.
const { DataTypes } = require('sequelize');
const adminDB = require('../../config/adminDatabase');
module.exports = adminDB.define('mUser', {
  pkUserId:     { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:    { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID:   { type: DataTypes.STRING(10),  allowNull: false },
  UserCode:     { type: DataTypes.STRING(10),  allowNull: false },
  UserFullName: { type: DataTypes.STRING(30),  allowNull: false },
  UserPassword: { type: DataTypes.STRING(255), allowNull: false },
  fkRoleID:     { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'ADMIN' },
  Active:       { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  CrMod:        { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mUser', timestamps: false });
