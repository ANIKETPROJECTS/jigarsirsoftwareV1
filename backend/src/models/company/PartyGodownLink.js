// COMPANY-SPECIFIC — PartyGodownLink (which godowns a party uses; per company)
const { DataTypes } = require('sequelize');
module.exports = function definePartyGodownLink(db) {
  if (db.isDefined('PartyGodownLink')) return db.model('PartyGodownLink');
  return db.define('PartyGodownLink', {
    pkLinkID:   { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:   { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID: { type: DataTypes.STRING(10),  allowNull: false },
    fkPartyID:  { type: DataTypes.STRING(100), allowNull: false },
    fkGodownID: { type: DataTypes.STRING(100), allowNull: false },
    LinkType:   { type: DataTypes.STRING(20),  allowNull: false },
    FromDt:     { type: DataTypes.DATEONLY,    allowNull: false },
    ToDt:       { type: DataTypes.DATEONLY,    allowNull: true },
    Note:       { type: DataTypes.TEXT,        allowNull: true },
    Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
    fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
    CrMod:      { type: DataTypes.DATE,        allowNull: false },
  }, { tableName: 'PartyGodownLink', timestamps: false, freezeTableName: true });
};
