// COMPANY-SPECIFIC — Bank (each company maintains its own bank accounts)
const { DataTypes } = require('sequelize');
module.exports = function defineBank(db) {
  if (db.isDefined('mBank')) return db.model('mBank');
  return db.define('mBank', {
    pkBankID:    { type: DataTypes.STRING(100), primaryKey: true },
    bName:       { type: DataTypes.STRING(50),  allowNull: false },
    bAcNo:       { type: DataTypes.STRING(50),  allowNull: false },
    bIFSC:       { type: DataTypes.STRING(20),  defaultValue: '' },
    bBranch:     { type: DataTypes.STRING(30),  defaultValue: '' },
    bPrimeryFlg: { type: DataTypes.STRING(3),   defaultValue: 'N' },
    fkCompID:    { type: DataTypes.STRING(10),  allowNull: false },
    Active:      { type: DataTypes.STRING(3),   defaultValue: 'Y' },
    bNote:       { type: DataTypes.TEXT },
  }, { tableName: 'mBank', timestamps: false, freezeTableName: true });
};
