// Writes a snapshot of a tStockEntry row into tStockEntry_AT.
// status: 'INS' | 'UPD1' (before update) | 'UPD2' (after update) | 'DEL'
// Wrapped in try/catch so audit failures never block the main operation.
async function writeAuditEntry(db, pkTransID, status) {
  const id = `AT${Date.now()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  try {
    await db.query(
      `INSERT INTO tStockEntry_AT
         (UniqueSrNo_AT, Status_AT, LogDate_AT,
          pkTransID, fkCompID, fkBranchID, TransID, TransType, pfkLotID, LotNum,
          fkPartyID, fkItemID, ItemExtDesc, TransDt, TransTm, TransQty,
          DoNum, GatePass, Packing, PackingType, PackingColour, PackWght, GrossWght, RentRate,
          fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
          VehiNum, BENum, ActualWght, TransNote,
          HamaliRecd, HamaliAmt, HmlBillAmt, HamaliCode, ItemRate, TransExtDetail, BatchNum,
          DelivOpt, TransRemark, LotBillFlg, OpFlg, OutsideLabr, OtherHmlAmt,
          pfkOriLotID, OriTransDt, OriTransQty,
          FaYear, OwnTransFlg, PickupBy, UserID, CrMod)
       SELECT ?, ?, NOW(),
          pkTransID, fkCompID, fkBranchID, TransID, TransType, pfkLotID, LotNum,
          fkPartyID, fkItemID, ItemExtDesc, TransDt, TransTm, TransQty,
          DoNum, GatePass, Packing, PackingType, PackingColour, PackWght, GrossWght, RentRate,
          fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
          VehiNum, BENum, ActualWght, TransNote,
          HamaliRecd, HamaliAmt, HmlBillAmt, HamaliCode, ItemRate, TransExtDetail, BatchNum,
          DelivOpt, TransRemark, LotBillFlg, OpFlg, OutsideLabr, OtherHmlAmt,
          pfkOriLotID, OriTransDt, OriTransQty,
          FaYear, OwnTransFlg, PickupBy, UserID, CrMod
       FROM tStockEntry WHERE pkTransID = ?`,
      { replacements: [id, status, pkTransID] }
    );
  } catch (e) {
    console.warn(`[auditEntry] ${status} for ${pkTransID} failed:`, e.message);
  }
}

module.exports = { writeAuditEntry };
