// SHARED MASTER — Employee (writeable only from Primary company; auto-synced to siblings)
const { DataTypes } = require('sequelize');
module.exports = function defineEmployee(db) {
  if (db.isDefined('mEmployee')) return db.model('mEmployee');
  return db.define('mEmployee', {
    pkEmpID:      { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:     { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID:   { type: DataTypes.STRING(10) },
    EmpID:        { type: DataTypes.INTEGER },
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
  }, { tableName: 'mEmployee', timestamps: false, freezeTableName: true });
};
