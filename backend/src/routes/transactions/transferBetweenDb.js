// TRANSFER — Transfer Between DataBase  (frmTrfDB.frm migration)
// /api/transactions/transfer-db
//
// Moves open stock lots from a party in the CURRENT company database to a
// party in a DIFFERENT company database.  All companies share the same MySQL
// server, so cross-schema queries use `dbName`.`table` syntax.
//
// Permissions:
//   TRF_DB / CanView    — GET endpoints (init, parties, lots)
//   TRF_DB / CanExecute — POST /execute (actual transfer)
//
// MIGRATION NOTE (A4): VB6 wraps only the NEW-DB writes in a transaction
//   (conNewDbupdt.BeginTrans/CommitTrans). Old-DB writes (DESP inserts, DELETE)
//   are NOT in the same transaction. Since all MySQL databases are on the same
//   server, a unified cross-schema transaction is technically feasible and is
//   the recommended approach. This must be confirmed by the business owner.
//   Until then, VB6 behaviour is preserved: new DB uses newTxn; old DB writes
//   run outside any transaction.

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const { getFaYear } = require('../../utils/faYear');

router.use(requireAuth);

// Normalise any date value (JS Date object, ISO string, 'YYYY-MM-DD') to 'YYYY-MM-DD'
// so MySQL DATE/DATETIME columns never receive the ISO 'T'/'Z' format.
function toSqlDate(val) {
  if (!val) return null;
  const s = typeof val === 'string' ? val : new Date(val).toISOString();
  return s.slice(0, 10);
}

// Normalise a datetime value to 'YYYY-MM-DD HH:MM:SS' for MySQL DATETIME columns.
// VB6 stored time-only values with the OLE Automation epoch 1899-12-30 as the date
// part; those arrive from the frontend as '1899-12-30T12:13:33.000Z'.
// MySQL DATETIME minimum is 1000-01-01, so 1899-12-30 is within range — the date
// must be kept intact; only the ISO 'T'/'Z' separators need reformatting.
function toSqlDateTime(val) {
  if (!val) return null;
  const s = typeof val === 'string' ? val : new Date(val).toISOString();
  const tIdx = s.indexOf('T');
  if (tIdx !== -1) return s.slice(0, tIdx) + ' ' + s.slice(tIdx + 1, tIdx + 9);
  return s;  // already 'YYYY-MM-DD HH:MM:SS' or similar
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /init
// Mirrors VB6 Form_Load + udfGetCompID + udfInitialiseControls.
// Returns:
//   oldComp  — { compID, branchID, compName } — logged-in user's company (read-only in UI)
//   companies — all active companies in this group with their default branch
//
// VB6 udfGetCompID ran a hardcoded UNION ALL across named DBs (ADS, KPS, TEST …) and
// joined VCSetup to get fkBranchID/DefaultBranchID per company.
// In the web system, connectionManager already holds every company's info loaded from
// gms_admin.mCompany at startup; we query each company's VCSetup table for branch info.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/init', requirePermission('TRF_DB', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID, groupID } = req.user;

    const oldCompInfo = connectionManager.getCompanyInfo(compID);
    const oldComp = {
      compID,
      branchID,
      compName: oldCompInfo?.CompName || compID,
    };

    const groupCompanies = connectionManager.getGroupCompanyDetails(groupID);

    // For each company, query VCSetup for its default branch (mirrors VB6 udfGetCompID JOIN).
    // Fall back to FaYearInfo if VCSetup is absent.
    const companies = await Promise.all(
      groupCompanies.map(async (c) => {
        let fkBranchID = '';
        const cDb = connectionManager.getDB(c.pkCompID);
        if (cDb) {
          try {
            const [vcRows] = await cDb.query(
              `SELECT fkBranchID FROM VCSetup WHERE fkCompID = ? LIMIT 1`,
              { replacements: [c.pkCompID] }
            );
            if (vcRows.length > 0) fkBranchID = vcRows[0].fkBranchID;
          } catch {
            try {
              const [fyRows] = await cDb.query(
                `SELECT fkBranchID FROM FaYearInfo WHERE fkCompID = ? LIMIT 1`,
                { replacements: [c.pkCompID] }
              );
              if (fyRows.length > 0) fkBranchID = fyRows[0].fkBranchID;
            } catch {}
          }
        }
        return {
          pkCompID:   c.pkCompID,
          CompName:   c.CompName,
          CompAlias:  c.CompAlias || '',
          dbName:     c.dbName,
          fkBranchID,
        };
      })
    );

    res.json({ oldComp, companies });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load init data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /old-parties
// Mirrors VB6 udfFillOldPartyGrid.
// Returns active parties from the logged-in user's (old) company database.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/old-parties', requirePermission('TRF_DB', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const [parties] = await req.db.query(
      `SELECT pkPartyID, pName, pCode
       FROM mParty
       WHERE fkCompID = ? AND fkBranchID = ? AND Active = 'Y'
       ORDER BY pName`,
      { replacements: [compID, branchID] }
    );
    res.json(parties);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load old parties' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /new-parties?newCompID=&newBranchID=
// Mirrors VB6 udfFillNewPartyGrid.
// Queries the TARGET company's database using connectionManager.getDB(newCompID).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/new-parties', requirePermission('TRF_DB', 'CanView'), async (req, res) => {
  try {
    const { newCompID, newBranchID } = req.query;
    if (!newCompID || !newBranchID) {
      return res.status(400).json({ error: 'newCompID and newBranchID are required' });
    }
    const newDb = connectionManager.getDB(newCompID);
    if (!newDb) {
      return res.status(400).json({ error: `Company '${newCompID}' not found in connection pool` });
    }
    const [parties] = await newDb.query(
      `SELECT pkPartyID, pName, pCode
       FROM mParty
       WHERE fkCompID = ? AND fkBranchID = ? AND Active = 'Y'
       ORDER BY pName`,
      { replacements: [newCompID, newBranchID] }
    );
    res.json(parties);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load new parties' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lots?partyID=&fromDt=
// Mirrors VB6 udfPopLotSel + udfValFromDt.
// Returns all open lots for the selected old party as of fromDt, with all
// grid columns needed by the frontend and by the /execute payload.
//
// FaYear is derived server-side from fromDt+1 day:
//   VB6 adds 1 day to fromDt before calling gudfGetFaYear to avoid a 31-Mar
//   year-end boundary bug ("date 31/Mar comes back as prior year").
//
// Two-branch UNION ALL (mirrors udfPopLotSel exactly):
//   Branch 1: lots arrived BEFORE fromDt → balance from vstkTransQty aggregate
//   Branch 2: lots arrived AFTER  fromDt → balance from GodownQty1+GodownQty2 on ARV row
//   NOTE: Branch 2 has NO FaYear filter — preserved from VB6 udfPopLotSel lines 978-983.
//
// MIGRATION NOTE: date-lock validation (VB6 gudfChkDateLock "StockEntryMin") is not
//   yet implemented. Add check against VCSetup "StockEntryMin" before production use.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lots', requirePermission('TRF_DB', 'CanView'), async (req, res) => {
  try {
    const { partyID, fromDt } = req.query;
    const { compID, branchID } = req.user;

    if (!partyID || !fromDt) {
      return res.status(400).json({ error: 'partyID and fromDt are required' });
    }

    // +1 day mirrors VB6 "dtpFromDt.Value + 1" to avoid 31-Mar year-end boundary
    const faYearDate = new Date(fromDt);
    faYearDate.setDate(faYearDate.getDate() + 1);
    const faYear = await getFaYear(req.db, compID, faYearDate, 'N');

    if (!faYear) {
      return res.status(400).json({ error: 'Could not determine Financial Year for the given date' });
    }

    const [lots] = await req.db.query(
      `SELECT
          ts.pfkLotID, ts.LotNum, im.iName, ts.ItemExtDesc,
          SUM(vtq.GodownQty)                    AS Balance,
          ts.TransQty, ts.Packing, ts.TransDt,
          ts.PackWght, ts.fkItemID, ts.RentRate,
          ts.GatePass, ts.DoNum,
          ts.VehiNum,  ts.BENum, ts.ActualWght, ts.TransNote, ts.ItemRate,
          ts.pfkOriLotID, ts.OriTransDt, ts.OriTransQty, ts.OpFlg, ts.FaYear,
          ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode, ts.GrossWght,
          ts.PackingType, ts.PackingColour, ts.TransExtDetail, ts.BatchNum,
          ts.DelivOpt, ts.TransRemark, ts.LotBillFlg, ts.TransTm,
          ts.OutSideLabr, ts.OtherHmlAmt, ts.PickupBy, ts.OwnTransFlg
       FROM  tStockEntry ts
       JOIN  vstkTransQty vtq ON ts.pfkLotID = vtq.pfkLotID
       JOIN  mItem im          ON ts.fkItemID = im.pkItemID
       WHERE ts.fkCompID  = ? AND ts.fkBranchID = ?
         AND vtq.TransDt  <= ?
         AND ts.TransType = 'ARV'
         AND ts.fkPartyID = ?
         AND ts.FaYear    = ?
       GROUP BY
          ts.pfkLotID, ts.LotNum, im.iName, ts.ItemExtDesc, ts.TransQty, ts.Packing,
          ts.TransDt, ts.PackWght, ts.fkItemID, ts.RentRate, ts.GatePass, ts.DoNum,
          ts.VehiNum, ts.BENum, ts.ActualWght, ts.TransNote, ts.ItemRate,
          ts.pfkOriLotID, ts.OriTransDt, ts.OriTransQty, ts.OpFlg, ts.FaYear,
          ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode, ts.GrossWght,
          ts.PackingType, ts.PackingColour, ts.TransExtDetail, ts.BatchNum,
          ts.DelivOpt, ts.TransRemark, ts.LotBillFlg, ts.TransTm,
          ts.OutSideLabr, ts.OtherHmlAmt, ts.PickupBy, ts.OwnTransFlg
       HAVING SUM(vtq.GodownQty) > 0

       UNION ALL

       SELECT
          ts.pfkLotID, ts.LotNum, im.iName, ts.ItemExtDesc,
          (ts.GodownQty1 + ts.GodownQty2)       AS Balance,
          ts.TransQty, ts.Packing, ts.TransDt,
          ts.PackWght, ts.fkItemID, ts.RentRate,
          ts.GatePass, ts.DoNum,
          ts.VehiNum,  ts.BENum, ts.ActualWght, ts.TransNote, ts.ItemRate,
          ts.pfkOriLotID, ts.OriTransDt, ts.OriTransQty, ts.OpFlg, ts.FaYear,
          ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode, ts.GrossWght,
          ts.PackingType, ts.PackingColour, ts.TransExtDetail, ts.BatchNum,
          ts.DelivOpt, ts.TransRemark, ts.LotBillFlg, ts.TransTm,
          ts.OutSideLabr, ts.OtherHmlAmt, ts.PickupBy, ts.OwnTransFlg
       FROM  tStockEntry ts
       JOIN  mItem im ON ts.fkItemID = im.pkItemID
       WHERE ts.fkCompID  = ? AND ts.fkBranchID = ?
         AND ts.TransDt   > ?
         AND ts.fkPartyID = ?
         AND ts.TransType = 'ARV'

       ORDER BY LotNum`,
      {
        replacements: [
          compID, branchID, fromDt, partyID, faYear,   // branch 1
          compID, branchID, fromDt, partyID,            // branch 2 — no FaYear (VB6 lines 978-983)
        ],
      }
    );

    res.json({ faYear, lots });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load lots' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /execute
// Mirrors VB6 cmdCreat_Click → udfGenNewDB and all its udf* sub-functions.
//
// Body:
//   newCompID, newBranchID   — destination company/branch
//   oldPartyID               — source party (logged-in company)
//   newPartyID               — destination party
//   fromDt                   — cutoff date (YYYY-MM-DD)
//   faYear                   — 4-char FaYear derived at /lots time
//   genLotNum   (bool)       — generate new lot numbers (VB6 chkGenLotNum, runtime default: FALSE)
//   resetLotNum (bool)       — reset old party's SerialIDLot after transfer (default: TRUE)
//   sameCompBranch (bool)    — true when old and new comp+branch are identical
//   selectedLots []          — array of lot objects (all fields from /lots response)
//
// Transaction strategy (see MIGRATION NOTE A4 at top of file):
//   newTxn covers all INSERT/UPDATE on the new DB.
//   Old DB writes (DESP inserts, DELETE) run outside any transaction.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/execute', requirePermission('TRF_DB', 'CanAdd'), async (req, res) => {
  const {
    newCompID,
    newBranchID,
    oldPartyID,
    newPartyID,
    fromDt,
    faYear,
    genLotNum    = false,  // VB6 chkGenLotNum runtime default = vbUnchecked
    resetLotNum  = true,   // VB6 chkResetLotNum runtime default = vbChecked
    sameCompBranch = false,
    selectedLots,
  } = req.body;

  const { compID: oldCompID, branchID: oldBranchID, userId } = req.user;
  const oldDb = req.db;

  if (!selectedLots || selectedLots.length === 0) {
    return res.status(400).json({ error: 'No lots selected for transfer' });
  }
  if (!newCompID || !newBranchID || !oldPartyID || !newPartyID || !fromDt || !faYear) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const newDb = connectionManager.getDB(newCompID);
  if (!newDb) {
    return res.status(400).json({ error: `Destination company '${newCompID}' not found in connection pool` });
  }

  // Begin transaction on the NEW DB only (VB6: conNewDbupdt.BeginTrans)
  // MIGRATION NOTE (A4): old-DB writes are NOT covered by this transaction.
  const newTxn = await newDb.transaction();

  try {
    // ── Step 1: seed / reset lot serial counter on the NEW party ──────────────
    // VB6 udfGenNewDB lines 1080-1092:
    //   sameCompBranch (mFv.bCondFlg=False) → udfResetLotSrNo (reset to 0)
    //   different comp  (mFv.bCondFlg=True)  → udfUptNewLotSerialID (seed from max suffix)
    if (sameCompBranch) {
      const err = await resetLotSrNo(newDb, newCompID, newBranchID, newPartyID, faYear, newTxn);
      if (err) throw new Error(err);
    } else {
      const err = await uptNewLotSerialID(newDb, newCompID, newBranchID, newPartyID, faYear, selectedLots, newTxn);
      if (err) throw new Error(err);
    }

    // ── Step 2: process each selected lot ─────────────────────────────────────
    const processed = [];

    for (const lot of selectedLots) {
      const result = await pros1Lot({
        lot,
        oldDb, newDb, newTxn,
        oldCompID, oldBranchID, oldPartyID,
        newCompID, newBranchID, newPartyID,
        fromDt, faYear, genLotNum, resetLotNum,
        sameCompBranch, userId,
      });
      if (result.error) throw new Error(result.error);
      processed.push({ LotNum: result.newLotNum });
    }

    // ── Step 3: sync new party SerialIDLot when genLotNum is OFF ──────────────
    // VB6 udfGenNewDB lines 1107-1114: udfChkGenNewLotNum when chkGenLotNum=vbUnchecked
    if (!genLotNum) {
      const err = await chkGenNewLotNum(
        newDb, oldDb,
        oldCompID, oldBranchID, oldPartyID,
        newCompID, newBranchID, newPartyID,
        faYear, newTxn
      );
      if (err) throw new Error(err);
    }

    await newTxn.commit();
    res.json({ ok: true, message: 'Lot transfer Completed.', processed });

  } catch (err) {
    try { await newTxn.rollback(); } catch {}
    res.status(500).json({ error: err.message || 'Transfer failed' });
  }
});

// =============================================================================
// HELPER FUNCTIONS — each maps 1:1 to a VB6 udf* subroutine
// =============================================================================

// ── udfResetLotSrNo ──────────────────────────────────────────────────────────
// Called when old and new comp+branch are the SAME (mFv.bCondFlg=False).
// Resets SerialIDLot.LastNum to 0 for the new party so lot numbering restarts.
// Runs within newTxn (VB6 uses conNewDbupdt which is inside BeginTrans).
async function resetLotSrNo(newDb, newCompID, newBranchID, newPartyID, faYear, newTxn) {
  const [rows] = await newDb.query(
    `SELECT LastNum FROM SerialIDLot
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?
     FOR UPDATE`,
    { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
  );

  if (rows.length === 0) {
    return 'SerialLotID not found for new party.';
  }

  await newDb.query(
    `UPDATE SerialIDLot SET LastNum = 0
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?`,
    { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
  );

  return null;
}

// ── udfUptNewLotSerialID ──────────────────────────────────────────────────────
// Called when old and new comp+branch DIFFER (mFv.bCondFlg=True — the normal case).
// Seeds SerialIDLot.LastNum for the new party from the highest sequence number
// found in the selected lots' lot numbers.
//
// VB6 algorithm:
//   For each selected lot: nPrev = CInt(Right(LotNum, 5)) — compare numerically
//   nLastLotNum = CInt(Right(CStr(max(nPrev)), 3))
//   INSERT if row not found; if row exists, do nothing (no UPDATE).
//
// Example: LotNum='AB25007' → Right(5)='25007'=25007 → Right(3)='007'=7
//
// MIGRATION NOTE (A1): mFv.bResetLot (set in vfgTrfDB_AfterEdit when same party is
//   chosen) is read in udfGenNewDB but never used to branch differently — the
//   bCondFlg path already handles the same-party case. mFv.bResetLot is a dead variable.
async function uptNewLotSerialID(newDb, newCompID, newBranchID, newPartyID, faYear, selectedLots, newTxn) {
  let nLastLotNum = 0;

  for (const lot of selectedLots) {
    const s = String(lot.LotNum || '');
    if (s.length >= 5) {
      const rightFive = parseInt(s.slice(-5), 10) || 0;
      if (rightFive > nLastLotNum) nLastLotNum = rightFive;
    }
  }
  // Strip the embedded 2-char year from the max: Right(max, 3)
  nLastLotNum = parseInt(String(nLastLotNum).slice(-3), 10) || 0;

  if (nLastLotNum === 0) {
    return 'Unable to update LastID on New DataBase!!!';
  }

  const [rows] = await newDb.query(
    `SELECT LastNum FROM SerialIDLot
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?
     FOR UPDATE`,
    { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
  );

  if (rows.length === 0) {
    // VB6: AddNew only when BOF/EOF — existing row is left untouched
    await newDb.query(
      `INSERT INTO SerialIDLot (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType, LastNum)
       VALUES (?, ?, ?, ?, 'Y', 'ITM', ?)`,
      { replacements: [newCompID, newBranchID, newPartyID, faYear, nLastLotNum], transaction: newTxn }
    );
  }
  // If row exists: VB6 does nothing (mRs.rsNewDb.Close without Update)

  return null;
}

// ── udfLotGeneration ─────────────────────────────────────────────────────────
// Generates the next lot number for the new party using SerialIDLot.
// Called per-lot when genLotNum = true.
//
// Lot number format (VB6 lines 1619-1623):
//   pCode + faYear[2:4] + padded3   e.g. 'AB' + '25' + '007' = 'AB25007'
//   For sequence >= 1000: no padding  e.g. 'AB251234'
//
// Runs within newTxn (same connection that holds the BeginTrans lock in VB6).
// RecordCount check (VB6 lines 1578-1583): errors if >1 row found for the key.
async function lotGeneration(newDb, newCompID, newBranchID, newPartyID, faYear, newTxn) {
  const [partyRows] = await newDb.query(
    `SELECT pCode FROM mParty WHERE pkPartyID = ?`,
    { replacements: [newPartyID] }
  );
  if (partyRows.length === 0 || !partyRows[0].pCode) {
    return { error: 'Cannot Generate Lot Number (PCode error)!!!' };
  }
  const pCode = partyRows[0].pCode;

  const [rows] = await newDb.query(
    `SELECT LastNum FROM SerialIDLot
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?
     FOR UPDATE`,
    { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
  );

  // VB6 RecordCount check: error if more than 1 row returned
  if (rows.length > 1) {
    return { error: 'Error - Lot Number Generation (Too many records)!!!' };
  }

  let nLotNum;
  if (rows.length === 0) {
    // VB6: AddNew with LastNum=0 → reads back → IsNull → nLotNum=1
    nLotNum = 1;
    await newDb.query(
      `INSERT INTO SerialIDLot (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType, LastNum)
       VALUES (?, ?, ?, ?, 'Y', 'ITM', 1)`,
      { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
    );
  } else {
    const last = Number(rows[0].LastNum);
    // VB6: IsNull(nLastLotNum) → nLotNum=1; else nLotNum=nLastLotNum+1
    nLotNum = (last === null || last === undefined || isNaN(last)) ? 1 : last + 1;
    await newDb.query(
      `UPDATE SerialIDLot SET LastNum = ?
       WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?`,
      { replacements: [nLotNum, newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
    );
  }

  const nLotYear = String(faYear).slice(2, 4);  // '2425' → '25'
  const padded   = nLotNum < 1000
    ? String(nLotNum).padStart(3, '0')           // Right("000" & nLotNum, 3)
    : String(nLotNum);

  return { lotNum: `${pCode}${nLotYear}${padded}` };
}

// ── udfGetGodBal ──────────────────────────────────────────────────────────────
// Mirrors VB6 udfGetGodBal().
// Returns per-godown balance for a lot as of fromDt.
//
// Two-branch UNION ALL on vstkTransQty:
//   Branch 1: TransDt < fromDt → SUM per godown (exclude zero via HAVING)
//   Branch 2: TransDt > fromDt AND TransType='ARV' → raw GodownQty row
//
// Returns: { error } on negative/no balance, or { godownRows: [{fkGodownID, GodBal}] }
async function getGodBal(oldDb, oldCompID, oldBranchID, pfkLotID, fromDt, lotNum) {
  const [rows] = await oldDb.query(
    `SELECT DISTINCT fkGodownID, SUM(GodownQty) AS GodBal
     FROM vstkTransQty
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=? AND TransDt < ?
     GROUP BY fkGodownID
     HAVING SUM(GodownQty) <> 0
     UNION ALL
     SELECT DISTINCT fkGodownID, GodownQty AS GodBal
     FROM vstkTransQty
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=? AND TransDt >= ? AND TransType='ARV'
     ORDER BY fkGodownID`,
    { replacements: [oldCompID, oldBranchID, pfkLotID, fromDt, oldCompID, oldBranchID, pfkLotID, fromDt] }
  );

  if (rows.length === 0) {
    return { error: `No godown balance found for lot ${lotNum}` };
  }
  for (const r of rows) {
    if (parseFloat(r.GodBal) < 0) {
      return { error: `Negative godown balance in lot ${lotNum}` };
    }
  }
  return { godownRows: rows };
}

// ── udfUpdtNewDB ──────────────────────────────────────────────────────────────
// Inserts the transferred lot into the new database:
//   1) ARV row with first godown (GodownID1/Qty1) and optionally second (GodownID2/Qty2).
//      TransQty = sum of first two godowns.
//   2) For 3rd+ godowns: a separate IN row per godown (new TransID each).
//   3) Copies all post-cutoff non-ARV transactions (TransDt > fromDt) from old DB to new DB.
//
// TransDt rule (APN comment "09-08-2012" in VB6 lines 1660-1664):
//   If lot OpFlg='Y' (opening balance entry) → use fromDt as TransDt
//   If lot OpFlg='N' (normal arrival)        → use OriTransDt as TransDt
//
// pfkOriLotID rule (VB6 lines 1686-1690):
//   sameCompBranch → new pfkLotID (prevents lot showing in both parties' balance reports)
//   different comp → old pfkOriLotID
//
// Fields zeroed in IN rows (VB6 lines 1734, 1742-1743, 1764-1766, 1769):
//   LotNum='', Packing='', PackWght=0, PackingType='', GrossWght=0, PackingColour='', DelivOpt=''
// Fields NOT set in IN rows (VB6 lines 1757-1759 commented out):
//   pfkOriLotID, OriTransDt, OriTransQty
//
// Fields zeroed/empty in post-cutoff copies (VB6 lines 1810, 1818-1820, 1826, 1846-1848):
//   LotNum='', Packing='', PackWght=0, RentRate=0, BENum='', PackingType='', GrossWght=0, PackingColour=''
// Fields NOT set in post-cutoff copies (VB6 lines 1840-1841 commented out):
//   OriTransDt, OriTransQty
async function updateNewDb({
  newDb, newTxn, oldDb,
  newPkTransID, newTransLong, newPfkLotID, newLotNum,
  lot, godownRows,
  oldCompID, oldBranchID, oldPartyID,
  newCompID, newBranchID, newPartyID,
  fromDt, faYear, userId, sameCompBranch,
}) {
  const first  = godownRows[0];
  const second = godownRows.length > 1 ? godownRows[1] : null;

  // TransDt: OpFlg='Y' → fromDt; OpFlg='N' → OriTransDt (APN 09-08-2012 rule)
  let arvTransDt;
  if (lot.OpFlg === 'Y') {
    arvTransDt = fromDt;
  } else {
    // OriTransDt may arrive as ISO string or Date — normalise to YYYY-MM-DD
    const ot = lot.OriTransDt;
    arvTransDt = ot
      ? (typeof ot === 'string' ? ot.slice(0, 10) : new Date(ot).toISOString().slice(0, 10))
      : fromDt;
  }

  const pfkOriLotID = sameCompBranch
    ? newPfkLotID
    : (lot.pfkOriLotID || lot.pfkLotID);

  // TransQty = first godown qty + second godown qty (if exists)
  const firstQty  = parseFloat(first.GodBal) || 0;
  const secondQty = second ? (parseFloat(second.GodBal) || 0) : 0;
  const arvTransQty = firstQty + secondQty;

  // Net locbatch balance per godown+location+batch for this lot (all transactions up to fromDt).
  // Used to populate tStockEntry_LocBatch for the ARV row and any extra IN rows.
  const [netLocBatches] = await oldDb.query(
    `SELECT lb.fkGodownID, lb.fkLocationID, lb.BatchNum, SUM(lb.Qty) AS BalQty
     FROM tStockEntry_LocBatch lb
     JOIN tStockEntry ts ON lb.cpkTransID = ts.pkTransID
     WHERE ts.fkCompID = ? AND ts.fkBranchID = ? AND ts.pfkLotID = ? AND ts.TransDt < ?
     GROUP BY lb.fkGodownID, lb.fkLocationID, lb.BatchNum
     HAVING SUM(lb.Qty) <> 0
     ORDER BY lb.fkGodownID, lb.fkLocationID, lb.BatchNum`,
    { replacements: [oldCompID, oldBranchID, lot.pfkLotID, fromDt] }
  );

  // Balance alignment: SUM(tStockEntry_LocBatch.Qty per godown) must equal
  // the godown balance from vstkTransQty (Rule 1 of business requirement).
  //
  // godBalMap  — authoritative per-godown balance from getGodBal (vstkTransQty aggregate)
  // locbatchSumByGodown — net locbatch sum per godown from source DB
  //
  // Godowns where locbatchSum < godBal (including zero-locbatch godowns) need a
  // residual/fallback row.  We pre-fetch one default location per such godown so
  // the residual row can reference a valid fkLocationID.
  const godBalMap           = {};
  for (const g of godownRows) godBalMap[g.fkGodownID] = parseFloat(g.GodBal) || 0;

  const godownsWithData     = new Set(netLocBatches.map((r) => r.fkGodownID));
  const allLotGodownIDs     = godownRows.map((g) => g.fkGodownID);
  const locbatchSumByGodown = {};
  for (const lb of netLocBatches) {
    locbatchSumByGodown[lb.fkGodownID] =
      (locbatchSumByGodown[lb.fkGodownID] || 0) + (parseFloat(lb.BalQty) || 0);
  }

  // Group netLocBatches by godown for proportional-scaling inserts below
  const locbatchByGodown = {};
  for (const lb of netLocBatches) {
    if (!locbatchByGodown[lb.fkGodownID]) locbatchByGodown[lb.fkGodownID] = [];
    locbatchByGodown[lb.fkGodownID].push(lb);
  }

  // Fallback location only needed for godowns with no locbatch source rows at all
  const needFallbackLoc = allLotGodownIDs.filter((gid) => {
    if (!godownsWithData.has(gid)) return true;
    return Math.abs(locbatchSumByGodown[gid] || 0) < 0.001;
  });
  const fallbackLocMap = {}; // godownID → pkLocationID
  if (needFallbackLoc.length > 0) {
    const godPH = needFallbackLoc.map(() => '?').join(', ');
    const [fbRows] = await oldDb.query(
      `SELECT fkGodownID, MIN(pkLocationID) AS pkLocationID
       FROM mLocation WHERE fkGodownID IN (${godPH}) AND fkBranchID = ?
       GROUP BY fkGodownID`,
      { replacements: [...needFallbackLoc, oldBranchID] }
    );
    for (const row of fbRows) fallbackLocMap[row.fkGodownID] = row.pkLocationID || '';
  }

  // ── INSERT ARV row ──────────────────────────────────────────────────────────
  await newDb.query(
    `INSERT INTO tStockEntry
       (pkTransID,   fkCompID,    fkBranchID,  TransID,     pfkLotID,    LotNum,      TransType,
        fkPartyID,   fkItemID,    ItemExtDesc, TransDt,     TransQty,    DoNum,       GatePass,
        Packing,     PackWght,    RentRate,    fkGodownID1, GodownQty1,  fkGodownID2, GodownQty2,
        VehiNum,     BENum,       ActualWght,  TransNote,   HamaliRecd,  HamaliAmt,   HmlBillAmt,
        HamaliCode,  ItemRate,    OpFlg,
        pfkOriLotID, OriTransDt,  OriTransQty, FaYear,      UserID,      CrMod,
        TransTm,     PackingType, PackingColour, GrossWght, TransExtDetail, BatchNum,
        DelivOpt,    TransRemark, LotBillFlg,  OutSideLabr, OtherHmlAmt, PickupBy,    OwnTransFlg)
     VALUES
       (?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,?,'N',
        ?,?,?,?,?,NOW(),
        ?,?,?,?,?,?,
        ?,?,?,?,?,?,?)`,
    {
      replacements: [
        newPkTransID, newCompID, newBranchID, newTransLong, newPfkLotID, newLotNum, 'ARV',
        newPartyID, lot.fkItemID, lot.ItemExtDesc || '',
        arvTransDt, arvTransQty, lot.DoNum || '', '',           // GatePass=''
        lot.Packing || '', parseFloat(lot.PackWght) || 0,
        parseFloat(lot.RentRate) || 0,
        first.fkGodownID, firstQty,
        second ? second.fkGodownID : '', secondQty,
        lot.VehiNum || '', lot.BENum || '',
        parseFloat(lot.ActualWght) || 0, lot.TransNote || '',
        parseFloat(lot.HamaliRecd) || 0, parseFloat(lot.HamaliAmt) || 0,
        parseFloat(lot.HmlBillAmt) || 0,
        lot.HamaliCode || '', parseFloat(lot.ItemRate) || 0,
        // OpFlg = 'N' hardcoded (VB6 line 1684, APN comment "08-08-2012")
        pfkOriLotID,
        toSqlDate(lot.OriTransDt), parseFloat(lot.OriTransQty) || 0,
        faYear, userId,
        // CrMod = NOW()
        toSqlDateTime(lot.TransTm),
        lot.PackingType || '', lot.PackingColour || '',
        parseFloat(lot.GrossWght) || 0,
        lot.TransExtDetail || '', lot.BatchNum || '',
        lot.DelivOpt || '', lot.TransRemark || '',
        lot.LotBillFlg || 'Y',
        lot.OutSideLabr || '', parseFloat(lot.OtherHmlAmt) || 0,
        lot.PickupBy || '', lot.OwnTransFlg || '',
      ],
      transaction: newTxn,
    }
  );

  // tStockEntry_LocBatch for ARV row (godowns 1 and 2):
  // Quantities are distributed proportionally across source location/batch rows,
  // scaled to match the authoritative godown balance (godBalMap from vstkTransQty).
  // This handles missing DESP locbatch rows in the source DB: if source sum > godBal,
  // each row is scaled down; if source sum < godBal, each row is scaled up.
  // Last row absorbs rounding so SUM = godBal exactly.
  let arvLbSrNo = 0;
  for (const g of [first, ...(second ? [second] : [])]) {
    const gid        = g.fkGodownID;
    const targetQty  = godBalMap[gid] || 0;
    const sourceRows = locbatchByGodown[gid] || [];
    const sourceSum  = locbatchSumByGodown[gid] || 0;

    if (sourceRows.length === 0 || Math.abs(sourceSum) < 0.001) {
      // No locbatch source data → one fallback row carrying the full godown balance
      if (targetQty >= 0.001) {
        arvLbSrNo++;
        await newDb.query(
          `INSERT INTO tStockEntry_LocBatch
             (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
           VALUES (?, ?, 'ARV', ?, ?, ?, ?, '')`,
          {
            replacements: [
              newPkTransID, arvLbSrNo,
              gid, fallbackLocMap[gid] || '',
              String(lot.BatchNum || 'NA').trim().substring(0, 50),
              targetQty,
            ],
            transaction: newTxn,
          }
        );
      }
    } else {
      // Proportional distribution: preserve (fkLocationID, BatchNum) breakdown
      // but scale each qty so the godown total equals godBalMap[gid].
      let runningQty = 0;
      for (let i = 0; i < sourceRows.length; i++) {
        const lb     = sourceRows[i];
        const isLast = i === sourceRows.length - 1;
        const qty = isLast
          ? Math.round((targetQty - runningQty) * 10000) / 10000
          : Math.round((lb.BalQty / sourceSum * targetQty) * 10000) / 10000;
        runningQty += qty;
        if (Math.abs(qty) < 0.0001) continue;
        arvLbSrNo++;
        await newDb.query(
          `INSERT INTO tStockEntry_LocBatch
             (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
           VALUES (?, ?, 'ARV', ?, ?, ?, ?, '')`,
          {
            replacements: [
              newPkTransID, arvLbSrNo,
              lb.fkGodownID, lb.fkLocationID,
              String(lb.BatchNum || 'NA').trim().substring(0, 50),
              qty,
            ],
            transaction: newTxn,
          }
        );
      }
    }
  }

  // ── INSERT IN rows for 3rd+ godowns (VB6 lines 1720-1779) ──────────────────
  for (let i = 2; i < godownRows.length; i++) {
    const god = godownRows[i];
    const godQty = parseFloat(god.GodBal) || 0;

    const inLong = await gudfGenSerialID(
      newDb,
      `${newCompID}!${newBranchID}!TSTOCKENT!PKTRANSID`,
      'TrfDB IN Trans',
      'Y'
    );
    if (inLong === -1) {
      return { error: `Cannot generate TransID for extra godown of lot ${lot.LotNum}` };
    }
    const inPkTransID = buildSerialKey(newCompID, newBranchID, inLong);

    await newDb.query(
      `INSERT INTO tStockEntry
         (pkTransID,   fkCompID,    fkBranchID,  TransID,     pfkLotID,    LotNum,      TransType,
          fkPartyID,   fkItemID,    ItemExtDesc, TransDt,     TransQty,    DoNum,       GatePass,
          Packing,     PackWght,    RentRate,    fkGodownID1, GodownQty1,  fkGodownID2, GodownQty2,
          VehiNum,     BENum,       ActualWght,  TransNote,   HamaliRecd,  HamaliAmt,   HmlBillAmt,
          HamaliCode,  ItemRate,    OpFlg,
          FaYear,      UserID,      CrMod,
          TransTm,     PackingType, PackingColour, GrossWght, TransExtDetail, BatchNum,
          DelivOpt,    TransRemark, LotBillFlg,  OutSideLabr, OtherHmlAmt, PickupBy,    OwnTransFlg)
       VALUES
         (?,?,?,?,?,?,'IN',
          ?,?,?,?,?,?,?,
          '',0,?,?,?,?,0,
          ?,?,?,?,?,?,?,
          ?,?,'N',
          ?,?,NOW(),
          ?,?,?,0,?,?,
          '',?,?,?,?,?,?)`,
      {
        replacements: [
          inPkTransID, newCompID, newBranchID, inLong, newPfkLotID, '', // LotNum='' for IN
          newPartyID, lot.fkItemID, lot.ItemExtDesc || '',
          // TransDt = original lot date (not fromDt) for IN rows — same as ARV grid date
          arvTransDt, godQty, lot.DoNum || '', '',
          // Packing='' PackWght=0 hardcoded
          parseFloat(lot.RentRate) || 0,
          god.fkGodownID, godQty, '',  // fkGodownID1, GodownQty1, fkGodownID2=''
          // GodownQty2=0 hardcoded
          lot.VehiNum || '', lot.BENum || '',
          parseFloat(lot.ActualWght) || 0, lot.TransNote || '',
          parseFloat(lot.HamaliRecd) || 0, parseFloat(lot.HamaliAmt) || 0,
          parseFloat(lot.HmlBillAmt) || 0,
          lot.HamaliCode || '', parseFloat(lot.ItemRate) || 0,
          // pfkOriLotID/OriTransDt/OriTransQty NOT set for IN rows (VB6 lines 1757-1759 commented out)
          faYear, userId,
          // CrMod = NOW()
          toSqlDateTime(lot.TransTm),
          '', '',   // PackingType='', PackingColour='' (VB6 lines 1764,1766)
          // GrossWght=0 hardcoded
          lot.TransExtDetail || '', lot.BatchNum || '',
          // DelivOpt='' hardcoded (VB6 line 1769)
          lot.TransRemark || '', lot.LotBillFlg || 'Y',
          lot.OutSideLabr || '', parseFloat(lot.OtherHmlAmt) || 0,
          lot.PickupBy || '', lot.OwnTransFlg || '',
        ],
        transaction: newTxn,
      }
    );

    // tStockEntry_LocBatch for IN row: same proportional-scaling approach as ARV.
    const inGid      = god.fkGodownID;
    const inTarget   = godBalMap[inGid] || 0;
    const inSrcRows  = locbatchByGodown[inGid] || [];
    const inSrcSum   = locbatchSumByGodown[inGid] || 0;
    let inLbSrNo = 0;

    if (inSrcRows.length === 0 || Math.abs(inSrcSum) < 0.001) {
      if (inTarget >= 0.001) {
        inLbSrNo = 1;
        await newDb.query(
          `INSERT INTO tStockEntry_LocBatch
             (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
           VALUES (?, ?, 'IN', ?, ?, ?, ?, '')`,
          {
            replacements: [
              inPkTransID, inLbSrNo,
              inGid, fallbackLocMap[inGid] || '',
              String(lot.BatchNum || 'NA').trim().substring(0, 50),
              inTarget,
            ],
            transaction: newTxn,
          }
        );
      }
    } else {
      let runningQty = 0;
      for (let i = 0; i < inSrcRows.length; i++) {
        const lb     = inSrcRows[i];
        const isLast = i === inSrcRows.length - 1;
        const qty = isLast
          ? Math.round((inTarget - runningQty) * 10000) / 10000
          : Math.round((lb.BalQty / inSrcSum * inTarget) * 10000) / 10000;
        runningQty += qty;
        if (Math.abs(qty) < 0.0001) continue;
        inLbSrNo++;
        await newDb.query(
          `INSERT INTO tStockEntry_LocBatch
             (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
           VALUES (?, ?, 'IN', ?, ?, ?, ?, '')`,
          {
            replacements: [
              inPkTransID, inLbSrNo,
              lb.fkGodownID, lb.fkLocationID,
              String(lb.BatchNum || 'NA').trim().substring(0, 50),
              qty,
            ],
            transaction: newTxn,
          }
        );
      }
    }
  }

  // ── Copy post-cutoff non-ARV rows from old DB (VB6 lines 1784-1864) ─────────
  // These rows have TransDt > fromDt and TransType <> 'ARV'.
  // They are copied to the new DB under newPfkLotID / newPartyID with several
  // fields zeroed (LotNum, Packing, PackWght, RentRate, BENum, PackingType,
  // GrossWght, PackingColour) and OriTransDt/OriTransQty left empty.
  const [postRows] = await oldDb.query(
    `SELECT * FROM tStockEntry
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=?
       AND fkPartyID=? AND TransDt >= ? AND TransType <> 'ARV'`,
    { replacements: [oldCompID, oldBranchID, lot.pfkLotID, oldPartyID, fromDt] }
  );

  for (const pr of postRows) {
    const postLong = await gudfGenSerialID(
      newDb,
      `${newCompID}!${newBranchID}!TSTOCKENT!PKTRANSID`,
      'TrfDB Post Trans',
      'Y'
    );
    if (postLong === -1) {
      return { error: `Cannot generate TransID for post-cutoff row of lot ${lot.LotNum}` };
    }
    const postPkTransID = buildSerialKey(newCompID, newBranchID, postLong);

    // pfkOriLotID rule applies to post-cutoff copies too (VB6 lines 1835-1839)
    const postPfkOriLotID = sameCompBranch ? newPfkLotID : (pr.pfkOriLotID || lot.pfkLotID);

    // FaYear: post-cutoff copies keep the ORIGINAL FaYear (not updated to new FaYear)
    const prTransDt = pr.TransDt
      ? (typeof pr.TransDt === 'string' ? pr.TransDt.slice(0, 10) : new Date(pr.TransDt).toISOString().slice(0, 10))
      : fromDt;

    await newDb.query(
      `INSERT INTO tStockEntry
         (pkTransID,   fkCompID,    fkBranchID,  TransID,     pfkLotID,    LotNum,      TransType,
          fkPartyID,   fkItemID,    ItemExtDesc, TransDt,     TransQty,    DoNum,       GatePass,
          Packing,     PackWght,    RentRate,    fkGodownID1, GodownQty1,  fkGodownID2, GodownQty2,
          VehiNum,     BENum,       ActualWght,  TransNote,   HamaliRecd,  HamaliAmt,   HmlBillAmt,
          HamaliCode,  ItemRate,    OpFlg,
          pfkOriLotID, FaYear,      UserID,      CrMod,
          TransTm,     PackingType, PackingColour, GrossWght, TransExtDetail, BatchNum,
          DelivOpt,    TransRemark, LotBillFlg,  OutSideLabr, OtherHmlAmt, PickupBy,    OwnTransFlg)
       VALUES
         (?,?,?,?,?,'',?,
          ?,?,?,?,?,?,?,
          '',0,0,?,?,?,?,
          ?,'',?,?,?,?,?,
          ?,?,?,
          ?,?,?,NOW(),
          ?,?,?,0,?,?,
          ?,?,?,?,?,?,?)`,
      {
        replacements: [
          postPkTransID, newCompID, newBranchID, postLong, newPfkLotID, // LotNum='' (VB6 line 1810)
          pr.TransType,
          newPartyID, pr.fkItemID, pr.ItemExtDesc || '',
          prTransDt, pr.TransQty, pr.DoNum || '', pr.GatePass || '',
          // Packing='', PackWght=0, RentRate=0 (VB6 lines 1818-1820)
          pr.fkGodownID1 || '', pr.GodownQty1 || 0, pr.fkGodownID2 || '', pr.GodownQty2 || 0,
          pr.VehiNum || '',
          // BENum='' (VB6 line 1826)
          parseFloat(pr.ActualWght) || 0, pr.TransNote || '',
          parseFloat(pr.HamaliRecd) || 0, parseFloat(pr.HamaliAmt) || 0,
          parseFloat(pr.HmlBillAmt) || 0,
          pr.HamaliCode || '', parseFloat(pr.ItemRate) || 0, pr.OpFlg || 'N',
          postPfkOriLotID,
          // OriTransDt/OriTransQty NOT set (VB6 lines 1840-1841 commented out)
          pr.FaYear, userId,
          // CrMod = NOW()
          toSqlDateTime(pr.TransTm),
          '', '', // PackingType='', PackingColour='' (VB6 lines 1846,1848)
          // GrossWght=0 hardcoded (VB6 line 1847)
          pr.TransExtDetail || '', pr.BatchNum || '',
          pr.DelivOpt || '', pr.TransRemark || '', pr.LotBillFlg || 'Y',
          pr.OutSideLabr || '', parseFloat(pr.OtherHmlAmt) || 0,
          pr.PickupBy || '', pr.OwnTransFlg || '',
        ],
        transaction: newTxn,
      }
    );

    // tStockEntry_LocBatch for post-cutoff row: exact copy from old DB
    const [postLocBatches] = await oldDb.query(
      `SELECT fkGodownID, fkLocationID, BatchNum, TransType, Qty, Remark
       FROM tStockEntry_LocBatch WHERE cpkTransID = ? ORDER BY cpkSrNo`,
      { replacements: [pr.pkTransID] }
    );
    let postLbSrNo = 0;
    for (const plb of postLocBatches) {
      postLbSrNo++;
      await newDb.query(
        `INSERT INTO tStockEntry_LocBatch
           (cpkTransID, cpkSrNo, TransType, fkGodownID, fkLocationID, BatchNum, Qty, Remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        {
          replacements: [
            postPkTransID, postLbSrNo,
            plb.TransType, plb.fkGodownID, plb.fkLocationID,
            String(plb.BatchNum || 'NA').trim().substring(0, 50),
            parseFloat(plb.Qty) || 0,
            plb.Remark || '',
          ],
          transaction: newTxn,
        }
      );
    }
  }

  return { ok: true };
}

// ── udfOldPartyZeroBal ────────────────────────────────────────────────────────
// Inserts a DESP row in the OLD database for each godown that has a balance
// as-of fromDt (inclusive ≤) to zero out the transferred balance.
//
// NOTE: uses TransDt <= fromDt (INCLUSIVE) while udfGetGodBal uses < (EXCLUSIVE).
//   This is intentional — the DESP captures the full balance up to and including
//   the cutoff date.
//
// DESP row fields (VB6 lines 1900-1955):
//   TransType='DESP', DoNum='TRF', GatePass='0', TransNote='Transfer to New Party',
//   TransQty=-GodBal (negative), GodownQty1=-GodBal, HamaliCode='NO', OpFlg='N'
//
// MIGRATION NOTE (A4): Runs on old DB WITHOUT a transaction.
// MIGRATION NOTE (A5): Hard DELETE/INSERT with no audit trail — confirm soft-delete approach.
async function oldPartyZeroBal(oldDb, oldCompID, oldBranchID, pfkLotID, oldPartyID, lot, fromDt, faYear, userId) {
  const [godRows] = await oldDb.query(
    `SELECT DISTINCT fkGodownID, SUM(GodownQty) AS GodBal
     FROM vstkTransQty
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=? AND TransDt <= ?
     GROUP BY fkGodownID
     HAVING SUM(GodownQty) <> 0`,
    { replacements: [oldCompID, oldBranchID, pfkLotID, fromDt] }
  );

  if (godRows.length === 0) {
    // MIGRATION NOTE: VB6 udfOldPartyZeroBal returns False here but the call site
    // never sets outer bOk=False, so the transfer continues — silently skip.
    return null;
  }

  for (const gr of godRows) {
    if (parseFloat(gr.GodBal) < 0) {
      return `Negative balance in lot ${lot.LotNum} — cannot create DESP entry`;
    }

    const despLong = await gudfGenSerialID(
      oldDb,
      `${oldCompID}!${oldBranchID}!TSTOCKENT!PKTRANSID`,
      'TrfDB DESP',
      'Y'
    );
    if (despLong === -1) {
      return `Cannot generate DESP TransID for lot ${lot.LotNum}`;
    }
    const despPkTransID = buildSerialKey(oldCompID, oldBranchID, despLong);
    const negQty = -(parseFloat(gr.GodBal) || 0);

    await oldDb.query(
      `INSERT INTO tStockEntry
         (pkTransID,   fkCompID,    fkBranchID,  TransID,     pfkLotID,    LotNum,      TransType,
          fkPartyID,   fkItemID,    ItemExtDesc, TransDt,     TransQty,    DoNum,       GatePass,
          Packing,     PackWght,    RentRate,    fkGodownID1, GodownQty1,  fkGodownID2, GodownQty2,
          VehiNum,     BENum,       ActualWght,  TransNote,   HamaliRecd,  HamaliAmt,   HmlBillAmt,
          HamaliCode,  ItemRate,    OpFlg,
          pfkOriLotID, OriTransDt,  OriTransQty, FaYear,      UserID,      CrMod,
          TransTm,     PackingType, PackingColour, GrossWght, TransExtDetail, BatchNum,
          DelivOpt,    TransRemark, LotBillFlg,  OutSideLabr, OtherHmlAmt, PickupBy,    OwnTransFlg)
       VALUES
         (?,?,?,?,?,?,'DESP',
          ?,?,?,?,?,'TRF','0',
          '',0,0,?,?,?,0,
          '','',0,'Transfer to New Party',0,0,0,
          'NO',0,'N',
          ?,?,?,?,?,NOW(),
          ?,?,?,0,'','',
          '',?,?,?,?,?,?)`,
      {
        replacements: [
          despPkTransID, oldCompID, oldBranchID, despLong, pfkLotID, '',
          // LotNum='' (VB6 line 1927)
          oldPartyID, lot.fkItemID, lot.ItemExtDesc || '',
          fromDt, negQty,
          // DoNum='TRF' GatePass='0' Packing='' PackWght=0 RentRate=0
          gr.fkGodownID, negQty, '',  // fkGodownID1, GodownQty1, fkGodownID2=''
          // GodownQty2=0
          // VehiNum='' BENum='' ActualWght=0 TransNote='Transfer to New Party'
          // HamaliRecd=0 HamaliAmt=0 HmlBillAmt=0 HamaliCode='NO' ItemRate=0 OpFlg='N'
          lot.pfkOriLotID || pfkLotID,                   // pfkOriLotID (VB6 line 1943)
          toSqlDate(lot.OriTransDt),                       // OriTransDt  (VB6 line 1944)
          parseFloat(lot.OriTransQty) || 0,                // OriTransQty (VB6 line 1945)
          faYear, userId,
          // CrMod=NOW()
          toSqlDateTime(lot.TransTm),
          '', '',   // PackingType='', PackingColour=''
          // GrossWght=0 TransExtDetail='' BatchNum=''
          // DelivOpt=''
          lot.TransRemark || '',
          lot.LotBillFlg || 'Y',
          lot.OutSideLabr || '',
          parseFloat(lot.OtherHmlAmt) || 0,
          lot.PickupBy || '', lot.OwnTransFlg || '',
        ],
      }
    );
  }

  return null;
}

// ── udfOldPartyDeleteData ─────────────────────────────────────────────────────
// Deletes post-cutoff transaction rows (TransDt > fromDt) for the transferred
// lot from the OLD database.  These were already copied to the new DB.
//
// MIGRATION NOTE (A4): Runs on old DB outside the new-DB transaction.
// MIGRATION NOTE (A5): Hard DELETE — no audit trail.
async function oldPartyDeleteData(oldDb, oldCompID, oldBranchID, pfkLotID, fromDt) {
  await oldDb.query(
    `DELETE FROM tStockEntry
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=? AND TransDt > ?`,
    { replacements: [oldCompID, oldBranchID, pfkLotID, fromDt] }
  );
  return null;
}

// ── udfResetOldLotNum ─────────────────────────────────────────────────────────
// After transferring a lot, updates the OLD party's SerialIDLot.LastNum to the
// highest 3-digit sequence suffix still in tStockEntry for that lot+faYear.
//
// MIGRATION NOTE (A3): VB6 line 2020 reads `mRs.rsTranfDB("LastNum")` inside the
//   BOF/EOF branch (no rows found), but rsTranfDB is not open at that point.
//   This is a copy/paste bug: nLastNo stays 0 (its initialised value) when no rows
//   are found.  This migration replicates the VB6 behaviour: nLastNo = 0 if no rows.
async function resetOldLotNum(oldDb, oldCompID, oldBranchID, pfkLotID, oldPartyID, faYear) {
  const [selectRows] = await oldDb.query(
    `SELECT MAX(RIGHT(LotNum, 3)) AS LastNum
     FROM tStockEntry
     WHERE fkCompID=? AND fkBranchID=? AND pfkLotID=? AND FaYear=?`,
    { replacements: [oldCompID, oldBranchID, pfkLotID, faYear] }
  );

  // MIGRATION NOTE (A3): BOF/EOF path in VB6 reads rsTranfDB which was never opened here.
  // nLastNo stays 0, matching the default value. We replicate that.
  let nLastNo = 0;
  if (selectRows.length > 0 && selectRows[0].LastNum !== null) {
    nLastNo = parseInt(selectRows[0].LastNum, 10) || 0;
  }

  const t = await oldDb.transaction();
  try {
    const [idRows] = await oldDb.query(
      `SELECT LastNum FROM SerialIDLot
       WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?
       FOR UPDATE`,
      { replacements: [oldCompID, oldBranchID, oldPartyID, faYear], transaction: t }
    );

    if (idRows.length === 0) {
      await t.rollback();
      // MIGRATION NOTE (A3 cont.): VB6 sets udfResetOldLotNum=False here but the
      // call site never propagates that to abort the transfer — it silently continues.
      return null;
    }

    await oldDb.query(
      `UPDATE SerialIDLot SET LastNum=?
       WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?`,
      { replacements: [nLastNo, oldCompID, oldBranchID, oldPartyID, faYear], transaction: t }
    );
    await t.commit();
    return null;
  } catch (err) {
    try { await t.rollback(); } catch {}
    return err.message;
  }
}

// ── udfChkGenNewLotNum ────────────────────────────────────────────────────────
// Called when genLotNum=false (chkGenLotNum=vbUnchecked).
// Syncs the new party's SerialIDLot.LastNum with the old party's LastNum.
// Only INSERTs if no row exists for the new party — existing row is not updated.
//
// APN note in VB6 (22/04/2019): if old party has no SerialIDLot for current FaYear,
// treat LastNum as 0 (not an error).
async function chkGenNewLotNum(newDb, oldDb, oldCompID, oldBranchID, oldPartyID, newCompID, newBranchID, newPartyID, faYear, newTxn) {
  let nLastNum = 0;
  const [oldRows] = await oldDb.query(
    `SELECT LastNum FROM SerialIDLot
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?`,
    { replacements: [oldCompID, oldBranchID, oldPartyID, faYear] }
  );
  if (oldRows.length > 0 && oldRows[0].LastNum !== null) {
    nLastNum = Number(oldRows[0].LastNum) || 0;
  }

  const [newRows] = await newDb.query(
    `SELECT LastNum FROM SerialIDLot
     WHERE fkCompID=? AND fkBranchID=? AND fkPartyID=? AND FaYear=?
     FOR UPDATE`,
    { replacements: [newCompID, newBranchID, newPartyID, faYear], transaction: newTxn }
  );

  if (newRows.length === 0) {
    await newDb.query(
      `INSERT INTO SerialIDLot (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType, LastNum)
       VALUES (?, ?, ?, ?, 'Y', 'ITM', ?)`,
      { replacements: [newCompID, newBranchID, newPartyID, faYear, nLastNum], transaction: newTxn }
    );
  }
  // If row exists: VB6 does nothing (close without Update)

  return null;
}

// ── udfPros1Lot ───────────────────────────────────────────────────────────────
// Orchestrates the full transfer pipeline for ONE selected lot.
// Maps to VB6 udfPros1Lot (called per-row from the grid loop in udfGenNewDB).
//
// Pipeline:
//   1. getGodBal         — per-godown balance, reject negatives
//   2. gudfGenSerialID   — new TransID (new DB scope)
//   3. gudfGenSerialID   — new pfkLotID (new DB scope)
//   4. lotGeneration     — new lot number (only when genLotNum=true)
//   5. updateNewDb       — insert ARV + IN + post-cutoff rows into new DB
//   6. oldPartyZeroBal   — DESP rows in old DB (outside newTxn — A4)
//   7. oldPartyDeleteData — DELETE post-cutoff rows from old DB (outside newTxn — A4)
//   8. resetOldLotNum    — update old party SerialIDLot (when resetLotNum=true)
async function pros1Lot({
  lot, oldDb, newDb, newTxn,
  oldCompID, oldBranchID, oldPartyID,
  newCompID, newBranchID, newPartyID,
  fromDt, faYear, genLotNum, resetLotNum, sameCompBranch, userId,
}) {
  // 1. Per-godown balance
  const godResult = await getGodBal(oldDb, oldCompID, oldBranchID, lot.pfkLotID, fromDt, lot.LotNum);
  if (godResult.error) return { error: godResult.error };
  const { godownRows } = godResult;

  // 2. New TransID (scoped to new DB)
  const transLong = await gudfGenSerialID(
    newDb,
    `${newCompID}!${newBranchID}!TSTOCKENT!PKTRANSID`,
    'TrfDB TransID',
    'Y'
  );
  if (transLong === -1) return { error: `Cannot generate TransID for lot ${lot.LotNum}` };
  const newPkTransID = buildSerialKey(newCompID, newBranchID, transLong);

  // 3. New pfkLotID (scoped to new DB)
  const lotLong = await gudfGenSerialID(
    newDb,
    `${newCompID}!${newBranchID}!LOTID!PFKLOTID`,
    'TrfDB LotID',
    'Y'
  );
  if (lotLong === -1) return { error: `Cannot generate LotID for lot ${lot.LotNum}` };
  const newPfkLotID = buildSerialKey(newCompID, newBranchID, lotLong);

  // 4. New lot number (only when genLotNum=true; otherwise keep original)
  let newLotNum;
  if (genLotNum) {
    const lotGenResult = await lotGeneration(newDb, newCompID, newBranchID, newPartyID, faYear, newTxn);
    if (lotGenResult.error) return { error: lotGenResult.error };
    newLotNum = lotGenResult.lotNum;
  } else {
    newLotNum = lot.LotNum;  // VB6 line 1343: keep original LotNum when unchecked
  }

  // 5. Insert into new DB
  const updResult = await updateNewDb({
    newDb, newTxn, oldDb,
    newPkTransID, newTransLong: transLong, newPfkLotID, newLotNum,
    lot, godownRows,
    oldCompID, oldBranchID, oldPartyID,
    newCompID, newBranchID, newPartyID,
    fromDt, faYear, userId, sameCompBranch,
  });
  if (updResult.error) return { error: updResult.error };

  // 6. DESP row in old DB (outside newTxn — A4)
  const zeroBalErr = await oldPartyZeroBal(
    oldDb, oldCompID, oldBranchID, lot.pfkLotID, oldPartyID, lot, fromDt, faYear, userId
  );
  if (zeroBalErr) return { error: zeroBalErr };

  // 7. DELETE post-cutoff rows from old DB (outside newTxn — A4)
  const delErr = await oldPartyDeleteData(oldDb, oldCompID, oldBranchID, lot.pfkLotID, fromDt);
  if (delErr) return { error: delErr };

  // 8. Reset old party's lot serial (when resetLotNum=true)
  if (resetLotNum) {
    const resetErr = await resetOldLotNum(oldDb, oldCompID, oldBranchID, lot.pfkLotID, oldPartyID, faYear);
    if (resetErr) return { error: resetErr };
  }

  return { newLotNum };
}

module.exports = router;
