// JS port of VB6 gudfGenSerialID() from CommFunc.bas.
//
// Generates the next integer from SerialID table for a given key.
// Uses SELECT FOR UPDATE (pessimistic lock) instead of VB6's adLockPessimistic.
// The outer save transaction is separate — this runs in its own mini-transaction
// so it commits before the main INSERT, matching the VB6 separate-connection approach.
//
// pkSerialId   : key in SerialID table, e.g. 'ADS!HO!TSTOCKENT!PKTRANSID'
// serialDesc   : description stored on first insert
// insertIfNew  : 'Y' to auto-insert row if missing; otherwise returns -1
// Returns      : new LastID (integer >= 1) or -1 on failure

async function gudfGenSerialID(db, pkSerialId, serialDesc = '', insertIfNew = 'N') {
  const t = await db.transaction();
  try {
    const [rows] = await db.query(
      'SELECT LastID FROM SerialID WHERE pkSerialID = ? FOR UPDATE',
      { replacements: [pkSerialId], transaction: t }
    );

    let newID;
    if (rows.length === 0) {
      if (insertIfNew !== 'Y') {
        await t.rollback();
        return -1;
      }
      await db.query(
        'INSERT INTO SerialID (pkSerialID, LastID, SerialDesc) VALUES (?, 1, ?)',
        { replacements: [pkSerialId, serialDesc], transaction: t }
      );
      newID = 1;
    } else {
      const lastID = Number(rows[0].LastID) || 0;
      newID = lastID + 1;
      await db.query(
        'UPDATE SerialID SET LastID = ? WHERE pkSerialID = ?',
        { replacements: [newID, pkSerialId], transaction: t }
      );
    }

    await t.commit();
    return newID;
  } catch {
    try { await t.rollback(); } catch {}
    return -1;
  }
}

// Build the full pkTransID / pfkLotID string from the returned long integer.
// Format matches VB6: compID + '!' + branchID + '!' + longID
// e.g. 'ADS!HO!1234'
function buildSerialKey(compID, branchID, longID) {
  return `${compID}!${branchID}!${longID}`;
}

// Batch variant: increments LastID by `count` in ONE transaction and returns
// the first ID in the reserved range [start, start+count-1].
// Reduces 2×N serial-ID transactions (one per lot) to just 2 for the entire batch.
// Returns [startID, null] on success or [-1, errorMessage] on failure.
async function gudfGenSerialIDBatch(db, pkSerialId, count, serialDesc = '') {
  if (count <= 0) return [0, null];
  const t = await db.transaction();
  try {
    const [rows] = await db.query(
      'SELECT LastID FROM SerialID WHERE pkSerialID = ? FOR UPDATE',
      { replacements: [pkSerialId], transaction: t }
    );

    let startID;
    if (rows.length === 0) {
      await db.query(
        'INSERT INTO SerialID (pkSerialID, LastID, SerialDesc) VALUES (?, ?, ?)',
        { replacements: [pkSerialId, count, serialDesc], transaction: t }
      );
      startID = 1;
    } else {
      const lastID = Number(rows[0].LastID) || 0;
      startID = lastID + 1;
      await db.query(
        'UPDATE SerialID SET LastID = ? WHERE pkSerialID = ?',
        { replacements: [lastID + count, pkSerialId], transaction: t }
      );
    }

    await t.commit();
    return [startID, null];
  } catch (e) {
    try { await t.rollback(); } catch {}
    return [-1, e.message];
  }
}

module.exports = { gudfGenSerialID, gudfGenSerialIDBatch, buildSerialKey };
