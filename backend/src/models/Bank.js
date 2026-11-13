const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Bank = sequelize.define('mBank', {
  pkBankID:     { type: DataTypes.STRING(100), primaryKey: true },
  bName:        { type: DataTypes.STRING(50),  allowNull: false },
  bAcNo:        { type: DataTypes.STRING(50),  allowNull: false },
  bIFSC:        { type: DataTypes.STRING(20),  defaultValue: '' },
  bBranch:      { type: DataTypes.STRING(30),  defaultValue: '' },
  bPrimeryFlg:  { type: DataTypes.STRING(3),   defaultValue: 'N' },
  fkGroupID:     { type: DataTypes.STRING(100), allowNull: false },
  Active:       { type: DataTypes.STRING(3),   defaultValue: 'Y' },
  bNote:        { type: DataTypes.TEXT },
}, { tableName: 'mBank', timestamps: false });

module.exports = Bank;
