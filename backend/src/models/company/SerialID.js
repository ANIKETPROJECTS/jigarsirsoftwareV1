const { DataTypes } = require('sequelize');
module.exports = function defineSerialID(db) {
  if (db.isDefined('SerialID')) return db.model('SerialID');
  return db.define('SerialID', {
    pkSerialID:  { type: DataTypes.STRING(100), primaryKey: true },
    LastID:      { type: DataTypes.DECIMAL(6, 0), allowNull: false, defaultValue: 0 },
    SerialDesc:  { type: DataTypes.STRING(50),   allowNull: false, defaultValue: '' },
  }, { tableName: 'SerialID', timestamps: false, freezeTableName: true });
};
