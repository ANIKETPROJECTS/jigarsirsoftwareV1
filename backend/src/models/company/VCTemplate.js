// VCTemplate — saved report configuration templates (per company DB).
//
// One logical template = N rows sharing the same cpkTemplID.
// Each row represents one filter or the print-settings block.
//
// Row Field_Name values and their Operator / Field_Value conventions:
//   'fkPartyID'      IN       "[\"ADS!HO!1\",\"ADS!HO!2\"]"  — array of IDs
//   'fkItemID'       IN       "[\"BHW!HO!3\"]"
//   'fkGodownID1'    IN       "[\"BHW!HO!4\"]"
//   'reportType'     EQ       "\"lot_wise\""                  — single string
//   'Print_Settings' SETTINGS "{\"showTotalWeight\":true,...}" — JSON object
//
// Required DB migration (run once per company schema):
//   CREATE TABLE VCTemplate (
//     cpkTemplID    VARCHAR(60)  NOT NULL,
//     cpkSrno       INT          NOT NULL,
//     fkCompID      VARCHAR(10)  NOT NULL,
//     fkBranchID    VARCHAR(10)  NOT NULL,
//     Template_Name VARCHAR(100),
//     Rep_Name      VARCHAR(50),
//     Field_Name    VARCHAR(50),
//     Operator      VARCHAR(20),
//     Field_Value   TEXT,
//     Template_Desc TEXT,
//     UserID        VARCHAR(50),
//     CrMod         DATETIME,
//     PRIMARY KEY (cpkTemplID, cpkSrno),
//     INDEX idx_vctempl_comp_rep (fkCompID, Rep_Name)
//   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

const { DataTypes } = require('sequelize');

module.exports = function defineVCTemplate(db) {
  if (db.isDefined('VCTemplate')) return db.model('VCTemplate');

  const model = db.define('VCTemplate', {
    cpkTemplID:    { type: DataTypes.STRING(60),  primaryKey: true },
    cpkSrno:       { type: DataTypes.INTEGER,     primaryKey: true },
    fkCompID:      { type: DataTypes.STRING(10),  allowNull: false },
    fkBranchID:    { type: DataTypes.STRING(10),  allowNull: false },
    Template_Name: { type: DataTypes.STRING(100) },
    Rep_Name:      { type: DataTypes.STRING(50) },
    Field_Name:    { type: DataTypes.STRING(50) },
    Operator:      { type: DataTypes.STRING(20) },
    Field_Value:   { type: DataTypes.TEXT },
    Template_Desc: { type: DataTypes.TEXT },
    UserID:        { type: DataTypes.STRING(50) },
    CrMod:         { type: DataTypes.DATE },
  }, {
    tableName:       'VCTemplate',
    timestamps:      false,
    freezeTableName: true,
  });

  // Auto-create the table on first use (safe no-op if table already exists).
  // sync() without {force} never drops or alters existing columns.
  model.sync().catch((e) => console.error('[VCTemplate] auto-sync failed:', e.message));

  return model;
};
