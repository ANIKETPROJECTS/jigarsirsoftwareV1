// COMPANY-SPECIFIC — RateChart (Contract Rate per party; each company has its own)
const { DataTypes } = require('sequelize');
module.exports = function defineRateChart(db) {
  if (db.isDefined('RateChart')) return db.model('RateChart');
  return db.define('RateChart', {
    pkRateChartID: { type: DataTypes.STRING(100),  primaryKey: true },
    fkCompID:      { type: DataTypes.STRING(10),   allowNull: false },
    fkBranchID:    { type: DataTypes.STRING(10),   allowNull: false },
    fkPartyID:     { type: DataTypes.STRING(100),  allowNull: false },
    fkItemID:      { type: DataTypes.STRING(100),  allowNull: false },
    RateType:      { type: DataTypes.STRING(5),    allowNull: false },
    TransType:     { type: DataTypes.STRING(10),   allowNull: false },
    PackingType:   { type: DataTypes.STRING(20),   allowNull: false },
    FromDt:        { type: DataTypes.DATEONLY,     allowNull: false },
    ToDt:          { type: DataTypes.DATEONLY,     allowNull: true },
    UnitFrom:      { type: DataTypes.DECIMAL(10,2), allowNull: false },
    UnitTo:        { type: DataTypes.DECIMAL(10,2), allowNull: false },
    ChargeType:    { type: DataTypes.STRING(20),   allowNull: false },
    HamaliCode:    { type: DataTypes.STRING(20),   allowNull: false },
    BillRate:      { type: DataTypes.DECIMAL(7,2), allowNull: false },
    LabourRate:    { type: DataTypes.DECIMAL(7,2), allowNull: false },
    Note:          { type: DataTypes.TEXT,         allowNull: true },
    Active:        { type: DataTypes.STRING(2),    defaultValue: 'Y' },
    fkUserID:      { type: DataTypes.STRING(100),  allowNull: false },
    CrMod:         { type: DataTypes.DATE,         allowNull: false },
  }, { tableName: 'RateChart', timestamps: false, freezeTableName: true });
};
