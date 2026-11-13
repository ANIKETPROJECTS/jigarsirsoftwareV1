const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Composite PK: (fkCompID, fkBranchID, TaxCode, TaxFromDt)
const Tax = sequelize.define('mTax', {
  fkGroupID:   { type: DataTypes.STRING(100), primaryKey: true },
  fkBranchID: { type: DataTypes.STRING(100), primaryKey: true },
  TaxCode:    { type: DataTypes.STRING(30),  primaryKey: true },
  TaxFromDt:  { type: DataTypes.DATE,        primaryKey: true },
  TaxToDt:    { type: DataTypes.DATE },
  TaxType:    { type: DataTypes.STRING(2),   allowNull: false },
  TaxRate:    { type: DataTypes.DECIMAL(5,2), allowNull: false },
  TaxDesc:    { type: DataTypes.STRING(100) },
}, { tableName: 'mTax', timestamps: false });

module.exports = Tax;
