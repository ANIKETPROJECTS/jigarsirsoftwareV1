// LotNum generation and decrement using SerialIDLot table.
//
// Format: {pCode}{suffix}{nLotYear}{padded3}
//   suffix   : 'S' for ITM+N (not billable), 'P' for SPC+Y (SPC item + billable), '' for ITM+Y
//   nLotYear : faYear.slice(2, 4)  e.g. '2425' → '25'
//   padded3  : LastNum padded to 3 digits; no padding if >= 1000
//
// Example: pCode='JNB', faYear='2425', iType='ITM', lotBillFlg='Y', lastNum=1 → 'JNB25001'
//          pCode='JNB', faYear='2425', iType='ITM', lotBillFlg='N', lastNum=1 → 'JNBS25001'
//          pCode='JNB', faYear='2425', iType='SPC', lotBillFlg='Y', lastNum=1 → 'JNBP25001'

async function generateLotNum(db, { compID, branchID, partyID, faYear, lotBillFlg, iType, pCode }) {
  const t = await db.transaction();
  try {
    const [rows] = await db.query(
      `SELECT LastNum FROM SerialIDLot
       WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=?
         AND FaYear=? AND LotBillFlg=? AND ItemType=?
       FOR UPDATE`,
      { replacements: [compID, branchID, partyID, faYear, lotBillFlg, iType], transaction: t }
    );

    let newNum;
    if (rows.length === 0) {
      await db.query(
        `INSERT INTO SerialIDLot (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType, LastNum)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        { replacements: [compID, branchID, partyID, faYear, lotBillFlg, iType], transaction: t }
      );
      newNum = 1;
    } else {
      newNum = Number(rows[0].LastNum) + 1;
      await db.query(
        `UPDATE SerialIDLot SET LastNum=?
         WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=? AND LotBillFlg=? AND ItemType=?`,
        { replacements: [newNum, compID, branchID, partyID, faYear, lotBillFlg, iType], transaction: t }
      );
    }

    await t.commit();

    const nLotYear = faYear.slice(2, 4);
    const padded   = newNum >= 1000 ? String(newNum) : String(newNum).padStart(3, '0');
    let suffix = '';
    if (iType === 'ITM' && lotBillFlg === 'N') suffix = 'S';
    else if (iType === 'SPC' && lotBillFlg === 'Y') suffix = 'P';

    return `${pCode}${suffix}${nLotYear}${padded}`;
  } catch {
    try { await t.rollback(); } catch {}
    return null;
  }
}

// Called AFTER row.destroy() when the deleted lot was confirmed as the latest for that party+faYear.
// Queries the new actual MAX(LotNum) from tStockEntry and SETs LastNum to that real value.
// This handles gaps: if AD26003-AD26006 were deleted before AD26007, after deleting AD26007
// the new max might be AD26002, so LastNum is SET to 2 (not decremented blindly to 6).
async function syncSerialIDLot(db, { compID, branchID, partyID, faYear, lotBillFlg, iType }) {
  const [newMaxRows] = await db.query(
    `SELECT MAX(LotNum) AS maxLot FROM tStockEntry
     WHERE fkPartyID=? AND fkCompID=? AND FaYear=? AND TransType='ARV' AND LotNum != ''`,
    { replacements: [partyID, compID, faYear] }
  );

  let newLastNum = 0;
  const maxLot = newMaxRows.length > 0 ? newMaxRows[0].maxLot : null;
  if (maxLot) {
    const numMatch = maxLot.match(/(\d+)$/);
    if (numMatch) {
      // Strip the embedded 2-digit year prefix from the trailing digits to get the sequence number.
      // e.g. maxLot='AD26002' → trailing='26002' → slice(2)='002' → newLastNum=2
      newLastNum = parseInt(numMatch[1].slice(2), 10) || 0;
    }
  }

  await db.query(
    `UPDATE SerialIDLot SET LastNum = ?
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=? AND LotBillFlg=? AND ItemType=?`,
    { replacements: [newLastNum, compID, branchID, partyID, faYear, lotBillFlg, iType] }
  );
}

module.exports = { generateLotNum, syncSerialIDLot };
