// ─────────────────────────────────────────────────────────────────────────────
// SHARED MASTER — State
// Exists in every company database.  Only the Primary company can write it;
// syncToGroup() copies every change to sibling company databases automatically.
// ─────────────────────────────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');
module.exports = function defineState(db) {
  // Sequelize caches models by name on each instance.
  // Calling define() a second time would throw — check first.
  if (db.isDefined('mState')) return db.model('mState');
  return db.define('mState', {
    pkStateID:  { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:   { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID: { type: DataTypes.STRING(10),  allowNull: false },
    StateID:    { type: DataTypes.INTEGER },
    sInitial:   { type: DataTypes.STRING(4),   allowNull: false },
    sName:      { type: DataTypes.STRING(30),  allowNull: false },
    sCode:      { type: DataTypes.STRING(4),   allowNull: false },
    sNote:      { type: DataTypes.TEXT },
    Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
    fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
    CrMod:      { type: DataTypes.DATE,        allowNull: false },
  }, { tableName: 'mState', timestamps: false, freezeTableName: true });
};
