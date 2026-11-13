const { DataTypes } = require('sequelize');
module.exports = function defineDocumentsFile(db) {
  if (db.isDefined('DocumentsFile')) return db.model('DocumentsFile');
  return db.define('DocumentsFile', {
    pkDocID:       { type: DataTypes.STRING(100), primaryKey: true },
    fkCompID:      { type: DataTypes.STRING(100), allowNull: false },
    DocType:       { type: DataTypes.STRING(50),  allowNull: false },
    DocDiscrption: { type: DataTypes.STRING(400), allowNull: false },
    fkPartyID:     { type: DataTypes.STRING(100), allowNull: true },
    fkGodownID:    { type: DataTypes.STRING(100), allowNull: true },
    FromDt:        { type: DataTypes.DATEONLY,    allowNull: false },
    ToDt:          { type: DataTypes.DATEONLY,    allowNull: false },
    FileName:      { type: DataTypes.STRING(200), allowNull: false },
    Note:          { type: DataTypes.TEXT,        allowNull: true },
    Active:        { type: DataTypes.STRING(2),   allowNull: false, defaultValue: 'Y' },
    fkUserID:      { type: DataTypes.STRING(100), allowNull: false },
    CrMod:         { type: DataTypes.DATE,        allowNull: true },
  }, { tableName: 'DocumentsFile', timestamps: false, freezeTableName: true });
};
