const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('mUser', {
  pkUserId:     { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:    { type: DataTypes.STRING(10),  allowNull: false }, // users belong to a group, not a single company
  fkBranchID:   { type: DataTypes.STRING(10),  allowNull: false },
  UserCode:     { type: DataTypes.STRING(10),  allowNull: false },
  UserFullName: { type: DataTypes.STRING(30),  allowNull: false },
  UserPassword: { type: DataTypes.STRING(255), allowNull: false },
  fkRoleID:     { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'ADMIN' },
  Active:       { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  CrMod:        { type: DataTypes.DATE,        allowNull: false },
}, {
  tableName: 'mUser',
  timestamps: false,
});

module.exports = User;
