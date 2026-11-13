// ─────────────────────────────────────────────────────────────────────────────
// AttendanceEntry.js  —  Sequelize model for the AttendanceEntry table
//
// VB6 origin: AttendanceEntry table (same name in SQL Server).
// One row = one employee on one date, with a Present/Absent flag.
//
// Key fields:
//   pkAttendID  : composite key  '{GroupID}!{SerialNum}'
//   aDate       : DATE (not DATETIME) — stored as YYYY-MM-DD
//   aPresent    : 'Y' = Present, 'N' = Absent
//   aFaYear     : Financial year string e.g. '2526' (Apr 2025 – Mar 2026)
//   aMonthYear  : 'YYYYMM' e.g. '202506' — used for monthly roll-up queries
//
// UNIQUE constraint on (fkCompID, fkBranchID, fkEmpID, aDate)
// ensures one record per employee per day and allows safe UPSERT logic.
// ─────────────────────────────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = function defineAttendanceEntry(db) {
  // Return cached model if already registered on this db connection
  if (db.isDefined('AttendanceEntry')) return db.model('AttendanceEntry');

  return db.define('AttendanceEntry', {
    pkAttendID:  { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:    { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID:  { type: DataTypes.STRING(10),  allowNull: false },
    AttendID:    { type: DataTypes.INTEGER,      allowNull: false },
    aDate:       { type: DataTypes.DATEONLY,     allowNull: false }, // DATEONLY → stored as DATE
    fkEmpID:     { type: DataTypes.STRING(100),  allowNull: false },
    aPresent:    { type: DataTypes.STRING(2),    allowNull: false, defaultValue: 'Y' },
    aFaYear:     { type: DataTypes.STRING(10),   allowNull: false, defaultValue: '' },
    aMonthYear:  { type: DataTypes.STRING(10),   allowNull: false, defaultValue: '' },
    fkUserID:    { type: DataTypes.STRING(100),  allowNull: false, defaultValue: '' },
    CrMod:       { type: DataTypes.DATE,         allowNull: false },
  }, {
    tableName:       'AttendanceEntry',
    timestamps:      false,
    freezeTableName: true,
  });
};
