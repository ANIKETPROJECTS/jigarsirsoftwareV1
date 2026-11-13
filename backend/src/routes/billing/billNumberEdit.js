// billNumberEdit.js — /api/billing/bill-numbers
// View, bulk-edit BillNum, and delete bills across Godown Rent (tBill1),
// Hamali (tBillTrHmGen1/HMLI), and General (tBillTrHmGen1/GEN).
//
// GET  / — list bills with BalanceAmt from vInvoice_Recpt_Amt
// PUT  / — batch update BillNum (blocked for paid bills)
// DELETE / — delete header + detail rows (blocked for paid bills)
//
// Permissions: BILL_NUM_EDIT / CanView (GET), CanEdit (PUT), CanDelete (DELETE)

'use strict';

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');
const connMgr     = require('../../config/connectionManager');

router.use(requireAuth);

const VALID_TYPES = new Set(['GODRENT', 'HMLI', 'GEN']);

function fmtDt(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ── GET / ─────────────────────────────────────────────────────────────────────
// Query params: billType?, fromDate?, toDate?, partyId?, compID?
// Uses vInvoice_Recpt_Amt so BalanceAmt is returned for paid-status detection.
router.get('/', requirePerm('BILL_NUM_EDIT', 'CanView'), async (req, res) => {
  try {
    const { compID: userCompID, branchID } = req.user;
    const { billType, fromDate, toDate, partyId, compID: qCompID } = req.query;

    const targetCompID = qCompID || userCompID;
    const db = (qCompID && qCompID !== userCompID) ? connMgr.getDB(qCompID) : req.db;
    if (!db) return res.status(400).json({ error: `No DB connection for company ${targetCompID}` });

    // Determine which BillTypes to fetch for this tab
    const types = billType ? [billType] : ['GODRENT', 'HMLI', 'GEN'];
    const validTypes = types.filter(t => VALID_TYPES.has(t));
    if (!validTypes.length) return res.status(400).json({ error: 'Invalid billType.' });

    const tph    = validTypes.map(() => '?').join(',');
    const params = [targetCompID, branchID, ...validTypes];
    const extra  = [];
    if (fromDate) { extra.push(`vra.BillDt >= ?`); params.push(fromDate); }
    if (toDate)   { extra.push(`vra.BillDt <= ?`); params.push(toDate); }
    if (partyId)  { extra.push(`vra.fkPartyID = ?`); params.push(partyId); }
    const where = extra.length ? `AND ${extra.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT vra.pkBillID, vra.BillType, vra.BillNum, vra.BillDt, vra.BillStatus,
              IFNULL(vra.NetAmt, vra.GrossAmt) AS NetAmt,
              vra.BalanceAmt,
              p.pName, vra.fkPartyID
       FROM vInvoice_Recpt_Amt vra
       JOIN mParty p ON p.pkPartyID = vra.fkPartyID AND p.Active = 'Y'
       WHERE vra.fkCompID = ? AND vra.fkBranchID = ?
         AND vra.BillType IN (${tph})
         ${where}
       ORDER BY vra.BillDt DESC, vra.BillNum`,
      { replacements: params }
    );

    const mapped = rows.map(r => ({
      pkBillID:   r.pkBillID,
      BillType:   (r.BillType || '').toUpperCase(),
      BillNum:    r.BillNum,
      BillDt:     fmtDt(r.BillDt),
      BillStatus: r.BillStatus,
      NetAmt:     parseFloat(r.NetAmt)     || 0,
      BalanceAmt: parseFloat(r.BalanceAmt) || 0,
      pName:      r.pName    || '',
      fkPartyID:  r.fkPartyID,
      compID:     targetCompID,
    }));

    res.json({ rows: mapped, count: mapped.length });
  } catch (err) {
    console.error('[BillNumEdit GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT / ─────────────────────────────────────────────────────────────────────
// Body: { updates: [{ pkBillID, billType, newBillNum, compID }] }
// Rejects blank newBillNum values or paid bills (BalanceAmt ≤ 0).
router.put('/', requirePerm('BILL_NUM_EDIT', 'CanEdit'), async (req, res) => {
  try {
    const { compID: userCompID, userID } = req.user;
    const { updates = [] } = req.body;

    if (!updates.length) return res.status(400).json({ error: 'No updates provided.' });

    const blankRecords = updates
      .filter(u => !u.newBillNum || !String(u.newBillNum).trim())
      .map(u => ({ pkBillID: u.pkBillID, billType: u.billType }));
    if (blankRecords.length) {
      return res.status(400).json({
        error: `Bill number must not be blank. ${blankRecords.length} record(s) have missing bill numbers.`,
        invalidRecords: blankRecords,
      });
    }

    updates.forEach(u => { u.billType = (u.billType || '').toUpperCase(); });
    const invalidType = updates.find(u => !VALID_TYPES.has(u.billType));
    if (invalidType) {
      return res.status(400).json({ error: `Invalid billType "${invalidType.billType}".` });
    }

    const byComp = new Map();
    for (const u of updates) {
      const cid = u.compID || userCompID;
      if (!byComp.has(cid)) byComp.set(cid, []);
      byComp.get(cid).push(u);
    }

    const results = [];

    for (const [compID, compUpdates] of byComp) {
      const db = connMgr.getDB(compID) || req.db;
      if (!db) {
        results.push(...compUpdates.map(u => ({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: `No DB for ${compID}` })));
        continue;
      }

      for (const u of compUpdates) {
        const table  = u.billType === 'GODRENT' ? 'tBill1' : 'tBillTrHmGen1';
        const newNum = String(u.newBillNum).trim();
        try {
          // Guard: block update on paid or old (>70 days) bills
          const [chk] = await db.query(
            `SELECT BalanceAmt, DATEDIFF(CURDATE(), BillDt) AS ageDays
               FROM vInvoice_Recpt_Amt
              WHERE pkBillID = ? AND BillType = ? AND fkCompID = ? LIMIT 1`,
            { replacements: [u.pkBillID, u.billType, compID] }
          );
          if (chk.length) {
            if (parseFloat(chk[0].BalanceAmt) <= 0.001)
              { results.push({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: 'Cannot update a paid bill.' }); continue; }
            if (parseInt(chk[0].ageDays) > 70)
              { results.push({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: 'Cannot update a bill older than 70 days.' }); continue; }
          }

          // Guard: duplicate bill number in same table + company (different bill)
          const [dup] = await db.query(
            `SELECT pkBillID FROM ${table}
              WHERE BillNum = ? AND fkCompID = ? AND pkBillID != ? LIMIT 1`,
            { replacements: [newNum, compID, u.pkBillID] }
          );
          if (dup.length) {
            results.push({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: `Bill number "${newNum}" already exists in another bill.` });
            continue;
          }

          const [result] = await db.query(
            `UPDATE ${table} SET BillNum = ? WHERE pkBillID = ? AND fkCompID = ?`,
            { replacements: [newNum, u.pkBillID, compID] }
          );
          const affected = result?.affectedRows ?? 0;
          if (!affected) {
            results.push({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: 'Record not found or no change.' });
          } else {
            console.log(`[BillNumEdit] ${table} pkBillID=${u.pkBillID} compID=${compID} BillNum→"${newNum}" by userID=${userID}`);
            results.push({ pkBillID: u.pkBillID, billType: u.billType, newBillNum: newNum, status: 'ok' });
          }
        } catch (e) {
          results.push({ pkBillID: u.pkBillID, billType: u.billType, status: 'error', error: e.message });
        }
      }
    }

    const failed  = results.filter(r => r.status === 'error');
    const updated = results.filter(r => r.status === 'ok').length;

    if (failed.length) {
      return res.status(207).json({ results, message: `${updated} updated, ${failed.length} failed.` });
    }
    res.json({ results, message: `${updated} bill number(s) updated successfully.` });
  } catch (err) {
    console.error('[BillNumEdit PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE / ──────────────────────────────────────────────────────────────────
// Body: { deletes: [{ pkBillID, billType, compID }] }
// Deletes header + detail in a transaction. Blocked for paid bills.
router.delete('/', requirePerm('BILL_NUM_EDIT', 'CanDelete'), async (req, res) => {
  try {
    const { compID: userCompID, branchID, userID } = req.user;
    const { deletes = [] } = req.body;

    if (!deletes.length) return res.status(400).json({ error: 'No records to delete.' });

    deletes.forEach(d => { d.billType = (d.billType || '').toUpperCase(); });
    const invalidType = deletes.find(d => !VALID_TYPES.has(d.billType));
    if (invalidType) {
      return res.status(400).json({ error: `Invalid billType "${invalidType.billType}".` });
    }

    const byComp = new Map();
    for (const d of deletes) {
      const cid = d.compID || userCompID;
      if (!byComp.has(cid)) byComp.set(cid, []);
      byComp.get(cid).push(d);
    }

    const results = [];

    for (const [compID, compDeletes] of byComp) {
      const db = connMgr.getDB(compID) || req.db;
      if (!db) {
        results.push(...compDeletes.map(d => ({ pkBillID: d.pkBillID, billType: d.billType, status: 'error', error: `No DB for ${compID}` })));
        continue;
      }

      for (const d of compDeletes) {
        const headerTable = d.billType === 'GODRENT' ? 'tBill1'          : 'tBillTrHmGen1';
        const detailTable = d.billType === 'GODRENT' ? 'tBill2'          : 'tBillTrHmGen2';

        try {
          // Guard: block delete on paid or old (>70 days) bills
          const [chk] = await db.query(
            `SELECT BalanceAmt, DATEDIFF(CURDATE(), BillDt) AS ageDays
               FROM vInvoice_Recpt_Amt
              WHERE pkBillID = ? AND BillType = ? AND fkCompID = ? LIMIT 1`,
            { replacements: [d.pkBillID, d.billType, compID] }
          );
          if (chk.length) {
            if (parseFloat(chk[0].BalanceAmt) <= 0.001)
              { results.push({ pkBillID: d.pkBillID, billType: d.billType, status: 'error', error: 'Cannot delete a paid bill.' }); continue; }
            if (parseInt(chk[0].ageDays) > 70)
              { results.push({ pkBillID: d.pkBillID, billType: d.billType, status: 'error', error: 'Cannot delete a bill older than 70 days.' }); continue; }
          }

          const t = await db.transaction();
          try {
            await db.query(
              `DELETE FROM ${detailTable} WHERE cpkBillID = ?`,
              { replacements: [d.pkBillID], transaction: t }
            );
            const [delResult] = await db.query(
              `DELETE FROM ${headerTable} WHERE pkBillID = ? AND fkCompID = ? AND fkBranchID = ?`,
              { replacements: [d.pkBillID, compID, branchID], transaction: t }
            );
            await t.commit();
            const affected = delResult?.affectedRows ?? 0;
            if (!affected) {
              results.push({ pkBillID: d.pkBillID, billType: d.billType, status: 'error', error: 'Record not found.' });
            } else {
              console.log(`[BillNumEdit DELETE] ${headerTable} pkBillID=${d.pkBillID} compID=${compID} by userID=${userID}`);
              results.push({ pkBillID: d.pkBillID, billType: d.billType, status: 'ok' });
            }
          } catch (e) {
            await t.rollback();
            throw e;
          }
        } catch (e) {
          results.push({ pkBillID: d.pkBillID, billType: d.billType, status: 'error', error: e.message });
        }
      }
    }

    const failed  = results.filter(r => r.status === 'error');
    const deleted = results.filter(r => r.status === 'ok').length;

    if (failed.length) {
      return res.status(207).json({ results, message: `${deleted} deleted, ${failed.length} failed.` });
    }
    res.json({ results, message: `${deleted} bill(s) deleted successfully.` });
  } catch (err) {
    console.error('[BillNumEdit DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
