const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('mEmployee', {
  pkEmpID:      { type: DataTypes.STRING(100), primaryKey: true },
  fkGroupID:     { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID:   { type: DataTypes.STRING(10) },
  EmpID:        { type: DataTypes.INTEGER,     allowNull: false },
  eName:        { type: DataTypes.STRING(50),  allowNull: false },
  eShortName:   { type: DataTypes.STRING(20),  allowNull: false },
  eAddress:     { type: DataTypes.TEXT,        allowNull: false },
  eContect:     { type: DataTypes.STRING(50),  allowNull: false },
  eType:        { type: DataTypes.STRING(20),  allowNull: false },
  eDesignation: { type: DataTypes.STRING(20),  allowNull: false },
  eBoardRegNum: { type: DataTypes.STRING(15),  allowNull: false },
  eToliNum:     { type: DataTypes.STRING(10),  allowNull: false },
  eBoardName:   { type: DataTypes.STRING(50),  allowNull: false },
  eNote:        { type: DataTypes.TEXT,        allowNull: false },
  Active:       { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:     { type: DataTypes.STRING(100), allowNull: false },
  CrMod:        { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'mEmployee', timestamps: false });
