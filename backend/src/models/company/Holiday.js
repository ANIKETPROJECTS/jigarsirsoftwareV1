// SHARED MASTER — Holiday (writeable only from Primary company; auto-synced to siblings)
const { DataTypes } = require('sequelize');
module.exports = function defineHoliday(db) {
  if (db.isDefined('mHoliday')) return db.model('mHoliday');
  return db.define('mHoliday', {
    pkHldID:    { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:   { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID: { type: DataTypes.STRING(10) },
    HldID:      { type: DataTypes.INTEGER },
    hDate:      { type: DataTypes.DATE,        allowNull: false },
    hFaYear:    { type: DataTypes.STRING(10),  allowNull: false },
    hBoard:     { type: DataTypes.STRING(2),   defaultValue: 'N' },
    hOffice:    { type: DataTypes.STRING(2),   defaultValue: 'N' },
    hName:      { type: DataTypes.STRING(30),  allowNull: false },
    hNote:      { type: DataTypes.TEXT,        defaultValue: '' },
    Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
    fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
    CrMod:      { type: DataTypes.DATE,        allowNull: false },
  }, { tableName: 'mHoliday', timestamps: false, freezeTableName: true });
};
