const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Company = sequelize.define('mCompany', {
  pkCompID:   { type: DataTypes.STRING(10),  primaryKey: true },
  fkGroupID:  { type: DataTypes.STRING(10),  allowNull: false }, // which group owns this company
  CompName:   { type: DataTypes.STRING(30),  allowNull: false },
  CompAlias:  { type: DataTypes.STRING(15),  allowNull: false },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
  CrMod:      { type: DataTypes.DATE,        allowNull: false },
}, {
  tableName: 'mCompany',
  timestamps: false,
});

module.exports = Company;
