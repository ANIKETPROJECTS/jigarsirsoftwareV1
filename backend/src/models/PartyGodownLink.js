const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// PartyGodownLink — Party ↔ Godown Assignment
//
// Records which godown(s) a party (customer) stores their goods in, and for
// what period. This is used in:
//   - Transaction Entry: the godown dropdown can be filtered to only show
//     godowns linked to the selected party.
//   - Godown Detail Report: show which party is occupying which godown.
//   - Billing: validate that rent is being billed for the correct godown.
//
// LinkType: a combo value (from VCComboData) that categorises the type of
//   arrangement — e.g. 'OWN', 'RENT', 'SHARED'.
//
// A party can have multiple godown links (one row per godown).
// A godown can appear in multiple parties' links (shared godowns).
// Date range (FromDt–ToDt) allows historical tracking; NULL ToDt = still active.
//
// Scope: Company-level (fkCompID) — same as Party.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = sequelize.define('PartyGodownLink', {
  pkLinkID:   { type: DataTypes.STRING(100), primaryKey: true },
  fkCompID:   { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID: { type: DataTypes.STRING(10),  allowNull: false },
  fkPartyID:  { type: DataTypes.STRING(100), allowNull: false },
  fkGodownID: { type: DataTypes.STRING(100), allowNull: false },
  LinkType:   { type: DataTypes.STRING(20),  allowNull: false },  // e.g. 'Insurance' (9 chars)
  FromDt:     { type: DataTypes.DATEONLY,    allowNull: false },
  ToDt:       { type: DataTypes.DATEONLY,    allowNull: true },
  Note:       { type: DataTypes.TEXT,        allowNull: true },
  Active:     { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:   { type: DataTypes.STRING(100), allowNull: false },
  CrMod:      { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'PartyGodownLink', timestamps: false });
