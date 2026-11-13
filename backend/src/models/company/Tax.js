// COMPANY-SPECIFIC — Tax (each company maintains its own tax rates)
const { DataTypes } = require('sequelize');
module.exports = function defineTax(db) {
  if (db.isDefined('mTax')) return db.model('mTax');
  return db.define('mTax', {
    fkCompID:   { type: DataTypes.STRING(100), primaryKey: true },
    fkBranchID: { type: DataTypes.STRING(100), primaryKey: true },
    TaxCode:    { type: DataTypes.STRING(30),  primaryKey: true },
    TaxFromDt:  { type: DataTypes.DATE,        primaryKey: true },
    TaxToDt:    { type: DataTypes.DATE },
    TaxType:    { type: DataTypes.STRING(2),   allowNull: false },
    TaxRate:    { type: DataTypes.DECIMAL(5,2), allowNull: false },
    TaxDesc:    { type: DataTypes.STRING(100) },
  }, { tableName: 'mTax', timestamps: false, freezeTableName: true });
};
