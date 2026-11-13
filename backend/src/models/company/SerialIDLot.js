const { DataTypes } = require('sequelize');
module.exports = function defineSerialIDLot(db) {
  if (db.isDefined('SerialIDLot')) return db.model('SerialIDLot');
  return db.define('SerialIDLot', {
    fkCompID:   { type: DataTypes.STRING(10),    primaryKey: true },
    fkBranchID: { type: DataTypes.STRING(10),    primaryKey: true },
    fkPartyID:  { type: DataTypes.STRING(100),   primaryKey: true },
    FaYear:     { type: DataTypes.STRING(10),    primaryKey: true },
    LotBillFlg: { type: DataTypes.STRING(2),     primaryKey: true },
    ItemType:   { type: DataTypes.STRING(5),     primaryKey: true },
    LastNum:    { type: DataTypes.DECIMAL(6, 0), allowNull: false, defaultValue: 0 },
  }, { tableName: 'SerialIDLot', timestamps: false, freezeTableName: true });
};
