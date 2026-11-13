const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('mItem', {
  pkItemID:   { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:   { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID: { type: DataTypes.STRING(10) },
  ItemID:     { type: DataTypes.INTEGER,     allowNull: false },
  iName:      { type: DataTypes.STRING(30),  allowNull: false },
  iGroup:     { type: DataTypes.STRING(15),  allowNull: false },
  iType:      { type: DataTypes.STRING(5),   allowNull: false },
  iNote:      { type: DataTypes.TEXT },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
  CrMod:      { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mItem', timestamps: false });
