const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const State = sequelize.define('mState', {
  pkStateID:  { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:   { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID: { type: DataTypes.STRING(10),  allowNull: false },
  StateID:    { type: DataTypes.INTEGER,     allowNull: false },
  sInitial:   { type: DataTypes.STRING(4),   allowNull: false },
  sName:      { type: DataTypes.STRING(30),  allowNull: false },
  sCode:      { type: DataTypes.STRING(4),   allowNull: false },
  sNote:      { type: DataTypes.TEXT },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
  CrMod:      { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mState', timestamps: false });

module.exports = State;
