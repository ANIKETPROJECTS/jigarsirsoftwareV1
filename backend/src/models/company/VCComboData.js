// SHARED MASTER — VCComboData (dropdown lookup values)
// Shared within the group; only Primary can write; auto-synced to siblings.
const { DataTypes } = require('sequelize');
module.exports = function defineVCComboData(db) {
  if (db.isDefined('VCComboData')) return db.model('VCComboData');
  return db.define('VCComboData', {
    fkCompID:   { type: DataTypes.STRING(10),  primaryKey: true },
    fkBranchID: { type: DataTypes.STRING(10),  primaryKey: true },
    VCPurpose:  { type: DataTypes.STRING(30),  primaryKey: true },
    VCCode:     { type: DataTypes.STRING(30),  primaryKey: true },
    VCData:     { type: DataTypes.STRING(100), allowNull: false },
    VCDesc:     { type: DataTypes.STRING(200), allowNull: true,  defaultValue: '' },
    VCSrtOrd:   { type: DataTypes.INTEGER,     defaultValue: 0 },
    VCActive:   { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  }, { tableName: 'VCComboData', timestamps: false, freezeTableName: true });
};
