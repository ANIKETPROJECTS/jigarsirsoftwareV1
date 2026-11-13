const { DataTypes } = require('sequelize');
module.exports = function defineFaYearInfo(db) {
  if (db.isDefined('FaYearInfo')) return db.model('FaYearInfo');
  return db.define('FaYearInfo', {
    fkCompID:   { type: DataTypes.STRING(10),  primaryKey: true },
    FaYear:     { type: DataTypes.STRING(10),  primaryKey: true },
    Nor_Alt:    { type: DataTypes.STRING(2),   primaryKey: true },
    fkBranchID: { type: DataTypes.STRING(10),  allowNull: true },
    StartDate:  { type: DataTypes.DATE,        allowNull: false },
    EndDate:    { type: DataTypes.DATE,        allowNull: false },
    NextFaYear: { type: DataTypes.STRING(10),  allowNull: false, defaultValue: '' },
    LockFlg:    { type: DataTypes.STRING(2),   allowNull: false, defaultValue: 'N' },
    Active:     { type: DataTypes.STRING(2),   allowNull: false, defaultValue: 'Y' },
    fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
    CrMod:      { type: DataTypes.DATE,        allowNull: false },
  }, { tableName: 'FaYearInfo', timestamps: false, freezeTableName: true });
};
