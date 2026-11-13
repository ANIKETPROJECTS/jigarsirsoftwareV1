const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Permission = sequelize.define('mPermission', {
  fkRoleID:   { type: DataTypes.STRING(20), primaryKey: true },
  ModuleCode: { type: DataTypes.STRING(30), primaryKey: true },
  CanView:    { type: DataTypes.STRING(2), defaultValue: 'N' },
  CanAdd:     { type: DataTypes.STRING(2), defaultValue: 'N' },
  CanEdit:    { type: DataTypes.STRING(2), defaultValue: 'N' },
  CanDelete:  { type: DataTypes.STRING(2), defaultValue: 'N' },
  CanPrint:   { type: DataTypes.STRING(2), defaultValue: 'N' },
  CanExport:  { type: DataTypes.STRING(2), defaultValue: 'N' },
}, { tableName: 'mPermission', timestamps: false });

module.exports = Permission;
