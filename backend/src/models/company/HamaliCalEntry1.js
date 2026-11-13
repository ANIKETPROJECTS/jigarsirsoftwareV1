// HamaliCalEntry1.js  —  Daily hamali calculation header + totals
// VB6: tHamaliCalEntry1 table. One row per working day per company/branch.
// pkHmlEntID = '{groupID}!{branchID}!{serialNum}' via gudfGenSerialID.
const { DataTypes } = require('sequelize');

module.exports = function defineHamaliCalEntry1(db) {
  if (db.isDefined('HamaliCalEntry1')) return db.model('HamaliCalEntry1');
  return db.define('HamaliCalEntry1', {
    pkHmlEntID:       { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:         { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID:       { type: DataTypes.STRING(10),  allowNull: false },
    HmlEntID:         { type: DataTypes.INTEGER,     allowNull: false },
    tDate:            { type: DataTypes.DATEONLY,    allowNull: false }, // DATE — one row per day
    tBrdDate:         { type: DataTypes.DATEONLY,    allowNull: false }, // Board date (editable)
    tMonthYear:       { type: DataTypes.STRING(10),  allowNull: false, defaultValue: '' },
    tTotVaraiAmt:     { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
    tVaraiAmt:        { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 }, // Cash Varai
    tBalVaraiAmt:     { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 }, // Outstanding Varai
    tCommPerct:       { type: DataTypes.DECIMAL(6,2),  allowNull: false, defaultValue: 0 },
    tCommAmt1:        { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 }, // Cash Comm
    tCommAmt2:        { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 }, // O/S Comm
    tDailyHmlAmt:     { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
    tOutstndHmlAmt:   { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
    tBoardDepoAmt:    { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
    tBoardTonRate:    { type: DataTypes.DECIMAL(8,2),  allowNull: false, defaultValue: 0 },
    tBoardLeavyPerct: { type: DataTypes.DECIMAL(6,2),  allowNull: false, defaultValue: 0 },
    fkUserID:         { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    CrMod:            { type: DataTypes.DATE,        allowNull: false },
  }, {
    tableName: 'tHamaliCalEntry1',
    timestamps: false,
    freezeTableName: true,
  });
};
