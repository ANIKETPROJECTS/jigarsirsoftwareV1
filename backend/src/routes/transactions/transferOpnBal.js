// TRANSFER — Opening Balance Transfer  (frmTrfOpnBal.frm migration)
// /api/transactions/transfer-opn-bal
//
// Purpose: Transfer the closing stock balance of the PREVIOUS financial year
//          as opening balance (OpFlg = 'Y') entries in the CURRENT financial year.
//
// FaYear direction:
//   sourceFaYear = previous FY  (where the closing balance is read from)
//   targetFaYear = current FY   (where the opening balance entries are written)
//   transDate    = EndDate of sourceFaYear (last day of previous FY — used as TransDt)
//
// Business logic (mirrors VB6 frmTrfOpnBal):
//   1. User selects one or more parties.
//   2. The system reads the godown-wise closing balance for the PREVIOUS FaYear
//      for each selected party.  (Query 3 — vStkTransQty)
//   3. For each lot with a non-zero balance:
//       a. Fetch the original ARV entry details.  (Query 4)
//       b. Check if an opening-balance entry already exists in the CURRENT FaYear.
//          (Query 5 — OpFlg = 'Y')
//       c. If it exists:
//          – Check whether changing the opening qty would cause a negative balance
//            given any non-ARV movements already entered in the current year. (Q6)
//          – If negative: log an error, skip.
//          – Otherwise: delete the old opening entries, re-insert.   (Q7 → Q8)
//       d. If not yet transferred: insert fresh opening entries.     (Q8)
//   4. For each lot the first godown gets TransType = 'ARV'; subsequent godowns
//      get TransType = 'IN'.  Both get OpFlg = 'Y', FaYear = targetFaYear (current),
//      TransDt = EndDate of sourceFaYear (last day of previous FY).

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const { gudfGenSerialIDBatch, buildSerialKey } = require('../../utils/serialID');

router.use(requireAuth);

// ── GET /init ─────────────────────────────────────────────────────────────────
// Returns parties list + FaYear info for the current company/branch.
// sourceFaYear = previous FY (source of closing balance)
// targetFaYear = current FY  (destination for opening balance entries)
// transDate    = EndDate of sourceFaYear (last day of previous FY — used as TransDt)
router.get('/init', requirePermission('TRF_OPN_BAL', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const db = req.db;

    // Q1: Active parties for this company + branch
    const [parties] = await db.query(
      `SELECT pName, pCode, pGroup, pkPartyID
       FROM mParty
       WHERE fkCompID = ? AND fkBranchID = ? AND Active = 'Y'
       ORDER BY pName`,
      { replacements: [compID, branchID] }
    );

    // Q2: Two most recent FaYear rows sorted by StartDate DESC — mirrors VB6 udfGetFaYear exactly.
    //   Row 0 = target FY (newest  — where opening balance entries are created)
    //   Row 1 = source FY (2nd newest — where closing balance is read from)
    //   transDate = EndDate of source FY = last day before target FY starts
    const [faRows] = await db.query(
      `SELECT FaYear,
              DATE_FORMAT(StartDate, '%Y-%m-%d') AS StartDate,
              DATE_FORMAT(EndDate,   '%Y-%m-%d') AS EndDate
       FROM FaYearInfo
       WHERE fkCompID = ? AND fkBranchID = ?
       ORDER BY StartDate DESC
       LIMIT 2`,
      { replacements: [compID, branchID] }
    );

    if (faRows.length < 2) {
      return res.status(400).json({
        error: 'At least 2 financial year records are required in FaYearInfo to run this transfer.',
      });
    }

    const targetFaYear = faRows[0].FaYear;
    const sourceFaYear = faRows[1].FaYear;
    const transDate    = faRows[1].EndDate; // EndDate of source FY = last day of that year

    res.json({ parties, sourceFaYear, targetFaYear, transDate });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load init data' });
  }
});

// ── POST /execute ─────────────────────────────────────────────────────────────
// Runs the opening-balance transfer for the selected parties.
// Body: { partyIDs: string[], sourceFaYear, targetFaYear, transDate }
//   sourceFaYear = previous FY (where closing balance is read from)
//   targetFaYear = current FY  (where opening balance entries are written)
//   transDate    = last day of sourceFaYear (used as TransDt in INSERT)
// Returns: { processed: [...], errors: [...] }
//
// Performance design:
//   Phase 1 — Batch reads: Q4 + Q6 + fallback locations run in parallel; Q4b runs after
//             Q4 (needs transIDs). Total = 6 DB round-trips regardless of lot count.
//   Phase 2 — Batch ID generation: 2 transactions total (was 2×N).
//   Phase 3 — Per-lot write loop: only INSERTs + per-lot transactions; no reads.
router.post('/execute', requirePermission('TRF_OPN_BAL', 'CanAdd'), async (req, res) => {
  const { compID, branchID, userId } = req.user;
  const db = req.db;
  const { partyIDs, sourceFaYear, targetFaYear, transDate } = req.body;

  if (!partyIDs || partyIDs.length === 0)
    return res.status(400).json({ error: 'Select at least one party' });
  if (!sourceFaYear || !targetFaYear || !transDate)
    return res.status(400).json({ error: 'FaYear information is missing' });

  const processed = [];
  const errors    = [];

  try {
    const inPH = partyIDs.map(() => '?').join(', ');

    // ── Phase 1a: Q3 + Q5 (sequential — Q5 uses the same party list) ──────────

    // Q3: Godown-wise closing balance for selected parties in PREVIOUS FaYear
    const [balRows] = await db.query(
      `SELECT pfkLotID, fkGodownID, SUM(GodownQty) AS GodBal
       FROM vStkTransQty
       WHERE fkCompID = ? AND fkBranchID = ? AND FaYear = ? AND fkPartyID IN (${inPH})
       GROUP BY pfkLotID, fkGodownID
       HAVING SUM(GodownQty) <> 0
       ORDER BY pfkLotID, fkGodownID`,
      { replacements: [compID, branchID, sourceFaYear, ...partyIDs] }
    );

    if (balRows.length === 0)
      return res.json({ processed: [], errors: [], message: 'No stock balance found for selected parties in previous year' });

    // Q5: Already-transferred opening balance entries in target FaYear
    const [alrRows] = await db.query(
      `SELECT pfkOriLotID, fkGodownID, pkTransID, pfkLotID, TransType, GodownQty
       FROM vStkTransQty
       WHERE fkCompID = ? AND fkBranchID = ? AND FaYear = ? AND OpFlg = 'Y'
         AND fkPartyID IN (${inPH})`,
      { replacements: [compID, branchID, targetFaYear, ...partyIDs] }
    );

    // Build existingMap (pfkOriLotID → rows) and lotGroups (pfkLotID → godown entries)
    const existingMap = {};
    for (const row of alrRows) {
      const k = row.pfkOriLotID;
      if (!existingMap[k]) existingMap[k] = [];
      existingMap[k].push(row);
    }

    const lotGroups = {};
    for (const row of balRows) {
      if (!lotGroups[row.pfkLotID]) lotGroups[row.pfkLotID] = [];
      lotGroups[row.pfkLotID].push(row);
    }

    const allLotIDs = Object.keys(lotGroups);
    const numLots   = allLotIDs.length;
    const lotPH     = allLotIDs.map(() => '?').join(', ');

    // Collect all godown IDs and all existing OPB pfkLotIDs (for Q6) upfront
    const allGodownIDs = [...new Set(
      Object.values(lotGroups).flatMap((entries) => entries.map((g) => g.fkGodownID))
    )];
    const existingOPBLotIDs = [...new Set(
      Object.values(existingMap).flatMap((rows) => rows.map((r) => r.pfkLotID))
    )].filter(Boolean);

    const godPH    = allGodownIDs.length    > 0 ? allGodownIDs.map(() => '?').join(', ')    : null;
    const existPH  = existingOPBLotIDs.length > 0 ? existingOPBLotIDs.map(() => '?').join(', ') : null;

    // ── Phase 1b: Q4 + Q6 + fallback locations — run in parallel ─────────────
    const [q4Result, q6Result, fallbackResult] = await Promise.all([
      // Q4 batch: ARV entry details for ALL lots in one query
      db.query(
        `SELECT pkTransID, pfkLotID, LotNum, ItemExtDesc, DoNum, Packing, PackWght,
                RentRate, VehiNum, BENum, ActualWght, TransNote, ItemRate,
                pfkOriLotID, OriTransQty, OriTransDt, fkPartyID, fkItemID,
                TransTm, PackingType, PackingColour, GrossWght, TransExtDetail,
                BatchNum, DelivOpt, TransRemark, LotBillFlg, HamaliRecd, HamaliAmt,
                HmlBillAmt, HamaliCode, OutsideLabr, OtherHmlAmt, PickupBy, OwnTransFlg
         FROM tStockEntry
         WHERE fkCompID = ? AND fkBranchID = ? AND pfkLotID IN (${lotPH}) AND TransType = 'ARV'`,
        { replacements: [compID, branchID, ...allLotIDs] }
      ),

      // Q6 batch: sum of non-ARV movements for all existing OPB lots (re-transfer check)
      existPH
        ? db.query(
            `SELECT pfkLotID, SUM(TransQty) AS Qty
             FROM tStockEntry
             WHERE fkCompID = ? AND fkBranchID = ? AND pfkLotID IN (${existPH})
               AND FaYear = ? AND TransType <> 'ARV'
             GROUP BY pfkLotID`,
            { replacements: [compID, branchID, ...existingOPBLotIDs, targetFaYear] }
          )
        : Promise.resolve([[], null]),

      // Fallback locations: first location per godown (used when ARV has no locbatch rows)
      godPH
        ? db.query(
            `SELECT fkGodownID, MIN(pkLocationID) AS pkLocationID
             FROM mLocation
             WHERE fkGodownID IN (${godPH}) AND fkBranchID = ?
             GROUP BY fkGodownID`,
            { replacements: [...allGodownIDs, branchID] }
          )
        : Promise.resolve([[], null]),
    ]);

    const [allArvRows]   = q4Result;
    const [q6Rows]       = q6Result;
    const [fallbackRows] = fallbackResult;

    // Build lookup maps from batch results
    const arvMap = {}; // pfkLotID → arv row
    for (const row of allArvRows) arvMap[row.pfkLotID] = row;

    const nonArvQtyMap = {}; // existingOPB pfkLotID → total non-ARV qty
    for (const row of q6Rows) nonArvQtyMap[row.pfkLotID] = parseFloat(row.Qty || 0);

    const fallbackLocMap = {}; // godownID → locationID
    for (const row of fallbackRows) fallbackLocMap[row.fkGodownID] = row.pkLocationID || '';

    // ── Phase 1c: Q4b — locbatch for all ARV transactions (after Q4 for transIDs) ──
    const arvTransIDs = allArvRows.map((r) => r.pkTransID).filter(Boolean);
    const locBatchMap = {}; // pkTransID → [locbatch rows]
    if (arvTransIDs.length > 0) {
      const transPH = arvTransIDs.map(() => '?').join(', ');
      const [allLocBatches] = await db.query(
        `SELECT cpkTransID, fkGodownID, fkLocationID, BatchNum, SUM(ABS(Qty)) AS TotalQty
         FROM tStockEntry_LocBatch
         WHERE cpkTransID IN (${transPH})
         GROUP BY cpkTransID, fkGodownID, fkLocationID, BatchNum
         ORDER BY cpkTransID, fkGodownID, fkLocationID, BatchNum`,
        { replacements: arvTransIDs }
      );
      for (const row of allLocBatches) {
        if (!locBatchMap[row.cpkTransID]) locBatchMap[row.cpkTransID] = [];
        locBatchMap[row.cpkTransID].push(row);
      }
    }

    // ── Phase 2: Batch-generate all lot IDs + trans IDs in 2 transactions ─────
    // Previous code: 2×numLots serial-ID transactions (one per lot).
    // Now: 2 transactions that each claim the entire range at once.
    const [[lotIDStart, lotIDErr], [transIDStart, transIDErr]] = await Promise.all([
      gudfGenSerialIDBatch(db, `${compID}!${branchID}!LOTID!PFKLOTID`,     numLots, 'Opening Balance Lot ID'),
      gudfGenSerialIDBatch(db, `${compID}!${branchID}!TSTOCKENT!PKTRANSID`, numLots, 'Opening Balance Trans'),
    ]);

    if (lotIDStart   === -1) return res.status(500).json({ error: `Failed to generate Lot IDs: ${lotIDErr}` });
    if (transIDStart === -1) return res.status(500).json({ error: `Failed to generate Transaction IDs: ${transIDErr}` });

    // ── Phase 3: Per-lot write loop — all reads done above, loop only validates + writes ──
    let lotIdx = 0;
    for (const [sourceLotID, godEntries] of Object.entries(lotGroups)) {
      const newPfkLotID  = buildSerialKey(compID, branchID, lotIDStart  + lotIdx);
      const newPkTransID = buildSerialKey(compID, branchID, transIDStart + lotIdx);
      const transLong    = transIDStart + lotIdx;
      lotIdx++;

      let lotNum = sourceLotID;
      try {
        const arv = arvMap[sourceLotID];
        if (!arv) {
          errors.push({ SrNo: errors.length + 1, LotNum: '—', Description: 'ARV entry not found for this lot', pfkLotID: sourceLotID });
          continue;
        }

        lotNum = arv.LotNum || sourceLotID;
        const sourceOriID   = arv.pfkOriLotID || sourceLotID;
        const existingRows  = existingMap[sourceOriID] || [];
        const arvLocBatches = locBatchMap[arv.pkTransID] || [];

        let existingPfkLotID   = null;
        let existingArvTransID = null;
        if (existingRows.length > 0) {
          existingPfkLotID   = existingRows[0].pfkLotID;
          existingArvTransID = existingRows[0].pkTransID; // all OPB rows share the ARV pkTransID
          const totalNewQty       = godEntries.reduce((s, g) => s + parseFloat(g.GodBal), 0);
          const existingNonARVQty = nonArvQtyMap[existingPfkLotID] ?? 0;

          if (totalNewQty + existingNonARVQty < 0) {
            errors.push({
              SrNo:        errors.length + 1,
              LotNum:      lotNum,
              Description: `Negative balance would result (new opening: ${totalNewQty}, existing movements: ${existingNonARVQty})`,
              pfkLotID:    sourceLotID,
            });
            continue;
          }
        }

        // In re-transfer mode, preserve existing PKs so relational integrity is not broken.
        // The freshly generated IDs are consumed by the serial counter but not used.
        const useTransID   = existingArvTransID || newPkTransID;
        const usePfkLotID  = existingPfkLotID   || newPfkLotID;
        const useTransLong = existingArvTransID
          ? (parseInt(existingArvTransID.split('!').pop(), 10) || transLong)
          : transLong;

        const god0     = godEntries[0];
        const god1     = godEntries.length > 1 ? godEntries[1] : null;
        const totalQty = godEntries.reduce((s, g) => s + parseFloat(g.GodBal), 0);

        // Q7 + Q8 inside ONE transaction — delete old and insert new are atomic.
        const t = await db.transaction();
        try {
          // Q7: Delete old OPB rows (inside transaction so rollback restores them)
          if (existingRows.length > 0) {
            const oldTransIDs = existingRows.map((r) => r.pkTransID).filter(Boolean);
            if (oldTransIDs.length > 0) {
              const oldPH = oldTransIDs.map(() => '?').join(', ');
              await db.query(
                `DELETE FROM tStockEntry_LocBatch WHERE cpkTransID IN (${oldPH})`,
                { replacements: oldTransIDs, transaction: t }
              );
            }
            await db.query(
              `DELETE FROM tStockEntry
               WHERE fkCompID = ? AND fkBranchID = ? AND pfkLotID = ? AND FaYear = ? AND OpFlg = 'Y'`,
              { replacements: [compID, branchID, existingPfkLotID, targetFaYear], transaction: t }
            );
          }

          // Q8: ONE tStockEntry row per lot, TransType='ARV'.
          // Both godowns go into fkGodownID1/GodownQty1 + fkGodownID2/GodownQty2 of the same row.
          await db.query(
            `INSERT INTO tStockEntry
               (pkTransID, fkCompID, fkBranchID, TransID, pfkLotID, LotNum, TransType,
                fkPartyID, fkItemID, ItemExtDesc, TransDt, TransQty, DoNum, GatePass,
                Packing, PackWght, RentRate, fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
                VehiNum, BENum, ActualWght, TransNote, ItemRate, OpFlg,
                pfkOriLotID, OriTransDt, OriTransQty, FaYear, UserID, CrMod,
                TransTm, PackingType, PackingColour, GrossWght, TransExtDetail, BatchNum,
                DelivOpt, TransRemark, LotBillFlg, HamaliRecd, HamaliAmt, HmlBillAmt,
                HamaliCode, OutsideLabr, OtherHmlAmt, PickupBy, OwnTransFlg)
             VALUES
               (?, ?, ?, ?, ?, ?, 'ARV',
                ?, ?, ?, ?, ?, ?, '',
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, 'Y',
                ?, ?, ?, ?, ?, NOW(),
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?)`,
            {
              replacements: [
                useTransID, compID, branchID, useTransLong, usePfkLotID, arv.LotNum || '',
                arv.fkPartyID, arv.fkItemID, arv.ItemExtDesc || '',
                transDate, totalQty, 'CRF',
                arv.Packing || '', parseFloat(arv.PackWght) || 0,
                parseFloat(arv.RentRate) || 0,
                god0.fkGodownID, parseFloat(god0.GodBal),
                god1 ? god1.fkGodownID : '', god1 ? parseFloat(god1.GodBal) : 0,
                arv.VehiNum || '', arv.BENum || '',
                parseFloat(arv.ActualWght) || 0, arv.TransNote || '',
                parseFloat(arv.ItemRate) || 0,
                sourceOriID, arv.OriTransDt, arv.OriTransQty,
                targetFaYear, userId,
                transDate,
                arv.PackingType || '', arv.PackingColour || '',
                parseFloat(arv.GrossWght) || 0,
                arv.TransExtDetail || '', arv.BatchNum || '',
                arv.DelivOpt || '', arv.TransRemark || '',
                arv.LotBillFlg || 'Y',
                parseFloat(arv.HamaliRecd) || 0,
                parseFloat(arv.HamaliAmt) || 0,
                parseFloat(arv.HmlBillAmt) || 0,
                arv.HamaliCode || '',
                arv.OutsideLabr === 'Y' ? 'Y' : 'N',
                parseFloat(arv.OtherHmlAmt) || 0,
                arv.PickupBy || '',
                arv.OwnTransFlg === 'Y' ? 'Y' : 'N',
              ],
              transaction: t,
            }
          );

          // tStockEntry_LocBatch: one row per godown/location/batch combination.
          // Quantities are proportionally scaled from the source ARV locbatch rows to
          // match the authoritative closing balance (GodBal from vStkTransQty).
          // This ensures SUM(locbatch.Qty for godown G) = GodBal for G in tStockEntry,
          // even when source locbatch TotalQty reflects the original arrival qty (not balance).
          let locBatchSrNo = 0;
          for (const godEntry of godEntries) {
            const targetQty     = Math.abs(parseFloat(godEntry.GodBal) || 0);
            const godLocBatches = arvLocBatches.filter((lb) => lb.fkGodownID === godEntry.fkGodownID);
            const sourceSum     = godLocBatches.reduce((s, lb) => s + (parseFloat(lb.TotalQty) || 0), 0);

            if (godLocBatches.length === 0 || Math.abs(sourceSum) < 0.001) {
              // No locbatch source data → one fallback row carrying the full godown balance
              if (targetQty >= 0.001) {
                locBatchSrNo++;
                await db.query(
                  `INSERT INTO tStockEntry_LocBatch
                     (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
                   VALUES (?, ?, 'ARV', ?, ?, ?, ?, '')`,
                  {
                    replacements: [
                      useTransID, locBatchSrNo,
                      godEntry.fkGodownID,
                      fallbackLocMap[godEntry.fkGodownID] || '',
                      String(arv.BatchNum || 'NA').trim().substring(0, 50),
                      targetQty,
                    ],
                    transaction: t,
                  }
                );
              }
            } else {
              // Proportional distribution: preserve (fkLocationID, BatchNum) breakdown
              // but scale each qty so the godown total equals GodBal (closing balance).
              let runningQty = 0;
              for (let i = 0; i < godLocBatches.length; i++) {
                const lb     = godLocBatches[i];
                const isLast = i === godLocBatches.length - 1;
                const qty = isLast
                  ? Math.round((targetQty - runningQty) * 10000) / 10000
                  : Math.round((lb.TotalQty / sourceSum * targetQty) * 10000) / 10000;
                runningQty += qty;
                if (Math.abs(qty) < 0.0001) continue;
                locBatchSrNo++;
                await db.query(
                  `INSERT INTO tStockEntry_LocBatch
                     (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
                   VALUES (?, ?, 'ARV', ?, ?, ?, ?, '')`,
                  {
                    replacements: [
                      useTransID, locBatchSrNo,
                      lb.fkGodownID, lb.fkLocationID,
                      String(lb.BatchNum || 'NA').trim().substring(0, 50),
                      qty,
                    ],
                    transaction: t,
                  }
                );
              }
            }
          }

          await t.commit();
          processed.push({
            LotNum:  lotNum,
            godowns: godEntries.length,
            status:  existingRows.length > 0 ? 're-transferred' : 'transferred',
          });
        } catch (txErr) {
          await t.rollback();
          throw txErr;
        }

      } catch (lotErr) {
        errors.push({
          SrNo:        errors.length + 1,
          LotNum:      lotNum,
          Description: lotErr.message || 'Processing failed',
          pfkLotID:    sourceLotID,
        });
      }
    }

    res.json({ processed, errors, totalLots: numLots });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Transfer failed' });
  }
});

module.exports = router;
