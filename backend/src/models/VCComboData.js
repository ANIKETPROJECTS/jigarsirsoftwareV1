const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VCComboData = sequelize.define('VCComboData', {
  fkCompID:    { type: DataTypes.STRING(10),  primaryKey: true },
  fkBranchID: { type: DataTypes.STRING(10),  primaryKey: true },
  VCPurpose:  { type: DataTypes.STRING(30),  primaryKey: true },
  VCCode:     { type: DataTypes.STRING(30),  primaryKey: true },
  VCData:     { type: DataTypes.STRING(100), allowNull: false },
  VCSrtOrd:   { type: DataTypes.INTEGER,     defaultValue: 0 },
  VCActive:   { type: DataTypes.STRING(2),   defaultValue: 'Y' },
}, { tableName: 'VCComboData', timestamps: false });

module.exports = VCComboData;
