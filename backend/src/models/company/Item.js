// SHARED MASTER — Item (writeable only from Primary company; auto-synced to siblings)
const { DataTypes } = require('sequelize');
module.exports = function defineItem(db) {
  if (db.isDefined('mItem')) return db.model('mItem');
  return db.define('mItem', {
    pkItemID:   { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:   { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID: { type: DataTypes.STRING(10) },
    ItemID:     { type: DataTypes.INTEGER },
    iName:      { type: DataTypes.STRING(30),  allowNull: false },
    iGroup:     { type: DataTypes.STRING(15),  allowNull: false },
    iType:      { type: DataTypes.STRING(5),   allowNull: false },
    iNote:      { type: DataTypes.TEXT },
    Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
    fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
    CrMod:      { type: DataTypes.DATE,        allowNull: false },
  }, { tableName: 'mItem', timestamps: false, freezeTableName: true });
};
