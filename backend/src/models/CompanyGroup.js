const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// mCompanyGroup holds the top-level group that owns one or more companies.
// Example: Group "BHW" owns companies ADS, KPS, TEST.
// All group-level masters (State, Tax, Holiday, Bank, Item, Godown, Employee)
// are stored once per group instead of once per company.
const CompanyGroup = sequelize.define('mCompanyGroup', {
  pkGroupID:  { type: DataTypes.STRING(10),  primaryKey: true },
  GroupName:  { type: DataTypes.STRING(50),  allowNull: false },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
}, { tableName: 'mCompanyGroup', timestamps: false });

module.exports = CompanyGroup;
