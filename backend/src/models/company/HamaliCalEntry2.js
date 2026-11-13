// HamaliCalEntry2.js  —  Per-employee pay split for each hamali day
// VB6: tHamaliCalEntry2 table. Deleted + re-inserted on every Save.
// One row per employee per day (present employees only, eType LABRB or LABRO).
const { DataTypes } = require('sequelize');

module.exports = function defineHamaliCalEntry2(db) {
  if (db.isDefined('HamaliCalEntry2')) return db.model('HamaliCalEntry2');
  return db.define('HamaliCalEntry2', {
    pfkHmlEntID: { type: DataTypes.STRING(100), primaryKey: true }, // FK → tHamaliCalEntry1.pkHmlEntID
    fkEmpID:     { type: DataTypes.STRING(100), primaryKey: true },
    tCashAmt:    { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
    tOutstndAmt: { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'tHamaliCalEntry2',
    timestamps: false,
    freezeTableName: true,
  });
};
