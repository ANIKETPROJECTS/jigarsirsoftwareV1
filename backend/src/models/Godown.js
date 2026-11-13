const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('mGodown', {
  pkGodownID: { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:   { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID: { type: DataTypes.STRING(10) },
  GodownID:   { type: DataTypes.INTEGER,     allowNull: false },
  gNum:       { type: DataTypes.STRING(5),   allowNull: false },
  gRate:      { type: DataTypes.DECIMAL(6,2) },
  gSqrft:     { type: DataTypes.DECIMAL(8,2) },
  gAmt:       { type: DataTypes.DECIMAL(8,2) },
  gOwner:     { type: DataTypes.STRING(30) },
  gAdd:       { type: DataTypes.TEXT },
  gStartDt:   { type: DataTypes.DATE },
  gEndDt:     { type: DataTypes.DATE },
  gNote:      { type: DataTypes.TEXT },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
  CrMod:      { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mGodown', timestamps: false });
