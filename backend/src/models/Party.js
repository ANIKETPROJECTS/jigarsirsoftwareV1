const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('mParty', {
  pkPartyID:     { type: DataTypes.STRING(100), primaryKey: true },
  fkCompID:      { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID:    { type: DataTypes.STRING(10),  allowNull: false },
  PartyID:       { type: DataTypes.INTEGER,     allowNull: false },
  pName:         { type: DataTypes.STRING(50) },
  pAlias:        { type: DataTypes.STRING(20),  allowNull: false },
  pCode:         { type: DataTypes.STRING(3),   allowNull: false },
  pGroup:        { type: DataTypes.STRING(30),  allowNull: false },
  pRef:          { type: DataTypes.STRING(30) },
  pBillType:     { type: DataTypes.STRING(5),   allowNull: false },
  pEmail:        { type: DataTypes.STRING(200) },
  pBillAdd:      { type: DataTypes.TEXT },
  pStartDate:    { type: DataTypes.DATE,        allowNull: false },
  pLotReNumFlg:  { type: DataTypes.STRING(2),   defaultValue: 'N' },
  StFlagGodRent: { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  StFlagTrans:   { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  pLotType:      { type: DataTypes.STRING(5),   allowNull: false },
  GSTNo:         { type: DataTypes.STRING(30),  allowNull: false },
  fkStateID:     { type: DataTypes.STRING(100), allowNull: false },
  pNote:         { type: DataTypes.TEXT },
  Active:        { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:      { type: DataTypes.STRING(100), allowNull: false },
  CrMod:         { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mParty', timestamps: false });
