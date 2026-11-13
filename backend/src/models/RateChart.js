const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// RateChart — Hamali Rate Chart Master
//
// Defines the Hamali (loading/unloading labour) rates for a Party + Item +
// Packing combination. When a stock transaction is entered, the system looks
// up the applicable rate from this table based on:
//   - Which party (fkPartyID)
//   - Which item (fkItemID)
//   - Packing type (e.g. 'BAG', 'GUNNY')
//   - Transaction type: ARV (arrival) or DEP (departure)
//   - Quantity range (UnitFrom to UnitTo)
//   - Date range (FromDt to ToDt) — rates can change over time
//
// BillRate  = rate charged TO the party (appears on the bill)
// LabourRate = rate paid TO the labour (internal cost)
//
// Scope: Company-level (fkCompID) — same as Party and tStockEntry.
//
// MySQL CREATE TABLE (already exists if running from script.sql):
//   Primary key: pkRateChartID (UUID)
//   No sequential display ID needed — rows are looked up by filter, not by number.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = sequelize.define('RateChart', {
  pkRateChartID: { type: DataTypes.STRING(100), primaryKey: true },
  fkCompID:      { type: DataTypes.STRING(10),  allowNull: false },
  fkBranchID:    { type: DataTypes.STRING(10),  allowNull: false },
  fkPartyID:     { type: DataTypes.STRING(100), allowNull: false },
  fkItemID:      { type: DataTypes.STRING(100), allowNull: false },
  RateType:      { type: DataTypes.STRING(5),   allowNull: false },
  TransType:     { type: DataTypes.STRING(10),  allowNull: false },   // ARV, DESP, DESPRET, TRF, IN, OUT
  PackingType:   { type: DataTypes.STRING(20),  allowNull: false },
  FromDt:        { type: DataTypes.DATEONLY,    allowNull: false },
  ToDt:          { type: DataTypes.DATEONLY,    allowNull: true },
  UnitFrom:      { type: DataTypes.DECIMAL(10,2), allowNull: false },
  UnitTo:        { type: DataTypes.DECIMAL(10,2), allowNull: false },
  ChargeType:    { type: DataTypes.STRING(20),  allowNull: false },
  HamaliCode:    { type: DataTypes.STRING(5),   allowNull: false },
  BillRate:      { type: DataTypes.DECIMAL(7,2), allowNull: false },
  LabourRate:    { type: DataTypes.DECIMAL(7,2), allowNull: false },
  Note:          { type: DataTypes.TEXT,        allowNull: true },
  Active:        { type: DataTypes.STRING(2),   defaultValue: 'Y' },
  fkUserID:      { type: DataTypes.STRING(10),  allowNull: false },
  CrMod:         { type: DataTypes.DATE,        allowNull: false },
}, { tableName: 'RateChart', timestamps: false });
