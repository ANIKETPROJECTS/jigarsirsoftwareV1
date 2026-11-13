'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// BILLING — Bill Letter & Acknowledgement
// /api/billing/bill-letter
//
// VB6 Source: frmBillLetter.frm
//
// TABLES (company DB):
//   tBill1         — Godown Rent bills         (LtrFlg, AcknldgDt columns)
//   tBillTrHmGen1  — Tr/Hamali/General bills   (LtrFlg, AcknldgDt columns)
//   mParty         — party master
//   FaYearInFo     — financial year master (global — no compID filter in VB6)
//
// MODES (maps to VB6 optBillLtr radio):
//   letter  — sets LtrFlg='Y' for selected bills
//   ackdate — sets AcknldgDt=letterDate for selected bills
//   both    — sets both LtrFlg='Y' and AcknldgDt=letterDate
//
// BILL FETCH DATE RANGE:
//   FaYear.StartDate  to  min(letterDate, FaYear.EndDate)
//
// PERMISSIONS: BILL_LETTER module
// ─────────────────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');

router.use(requireAuth);

const localStr = d => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

// ── GET /form-data ─────────────────────────────────────────────────────────
// Returns parties (company-scoped) and financial years (FaYearInFo — global)
router.get('/form-data', requirePerm('BILL_LETTER', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const db = req.db;
  try {
    const [[parties], [faYears]] = await Promise.all([
      db.query(
        `SELECT pkPartyID, pName, pCode, pGroup, pBillAdd
           FROM mParty
          WHERE fkCompID=? AND fkBranchID=? AND Active='Y'
          ORDER BY pName`,
        { replacements: [compID, branchID] }
      ),
      db.query(
        `SELECT FaYear, StartDate, EndDate
           FROM FaYearInFo
          WHERE Nor_Alt='N' AND Active='Y' AND LockFlg='N'
          ORDER BY FaYear DESC`
      ),
    ]);

    const fmtFy = fy => ({
      ...fy,
      StartDate: fy.StartDate ? localStr(fy.StartDate) : null,
      EndDate:   fy.EndDate   ? localStr(fy.EndDate)   : null,
    });

    res.json({ parties, faYears: faYears.map(fmtFy) });
  } catch (e) {
    console.error('[billLetter] GET /form-data:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /bills ─────────────────────────────────────────────────────────────
// UNION ALL tBill1 + tBillTrHmGen1 for selected party + date range.
// Mode filter mirrors VB6 Add-mode: only show unprocessed bills.
// ?partyID=  &startDate=YYYY-MM-DD  &endDate=YYYY-MM-DD  &mode=letter|ackdate|both
router.get('/bills', requirePerm('BILL_LETTER', 'CanView'), async (req, res) => {
  const { compID, branchID } = req.user;
  const db = req.db;
  const { partyID, startDate, endDate, mode, viewSaved } = req.query;

  if (!partyID)               return res.status(400).json({ error: 'partyID is required' });
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  // Accept comma-separated partyIDs for multi-party (group) loading
  const partyIDs = String(partyID).split(',').map(s => s.trim()).filter(Boolean);
  if (!partyIDs.length) return res.status(400).json({ error: 'partyID is required' });
  const ph = partyIDs.map(() => '?').join(', ');

  // viewSaved=true → show already-processed bills; otherwise filter by mode (unprocessed only)
  let cond = '';
  if (viewSaved === 'true') {
    cond = "AND (b.LtrFlg='Y' OR b.AcknldgDt IS NOT NULL)";
  } else {
    if (mode === 'letter')  cond = "AND b.LtrFlg='N'";
    if (mode === 'ackdate') cond = 'AND b.AcknldgDt IS NULL';
    if (mode === 'both')    cond = "AND b.LtrFlg='N' AND b.AcknldgDt IS NULL";
  }

  const sql = `
    SELECT b.pkBillID, b.BillNum, b.BillDt, b.NetAmt, b.GrossAmt, b.LtrFlg, b.AcknldgDt,
           'tBill1' AS TableName, mp.pName, mp.pGroup
      FROM tBill1 b
      JOIN mParty mp ON mp.pkPartyID = b.fkPartyID COLLATE utf8mb4_unicode_ci
     WHERE b.fkCompID=? AND b.fkBranchID=? AND b.fkPartyID IN (${ph})
       AND b.BillDt BETWEEN ? AND ? AND b.BillStatus='N'
       ${cond}
    UNION ALL
    SELECT b.pkBillID, b.BillNum, b.BillDt, b.NetAmt, b.GrossAmt, b.LtrFlg, b.AcknldgDt,
           'tBillTrHmGen1' AS TableName, mp.pName, mp.pGroup
      FROM tBillTrHmGen1 b
      JOIN mParty mp ON mp.pkPartyID = b.fkPartyID COLLATE utf8mb4_unicode_ci
     WHERE b.fkCompID=? AND b.fkBranchID=? AND b.fkPartyID IN (${ph})
       AND b.BillDt BETWEEN ? AND ? AND b.BillStatus='N'
       ${cond}
    ORDER BY pName, BillDt DESC, BillNum`;

  try {
    const [rows] = await db.query(sql, {
      replacements: [
        compID, branchID, ...partyIDs, startDate, endDate,
        compID, branchID, ...partyIDs, startDate, endDate,
      ],
    });

    const fmt = r => ({
      ...r,
      BillDt:    r.BillDt    ? localStr(r.BillDt)    : null,
      AcknldgDt: r.AcknldgDt ? localStr(r.AcknldgDt) : null,
      BillAmt:   r.NetAmt != null ? Number(r.NetAmt) : Number(r.GrossAmt || 0),
    });

    res.json({ rows: rows.map(fmt) });
  } catch (e) {
    console.error('[billLetter] GET /bills:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /save ─────────────────────────────────────────────────────────────
// Batch-update LtrFlg and/or AcknldgDt for the caller-supplied bill list.
// Body: { mode: 'letter'|'ackdate'|'both', letterDate: 'YYYY-MM-DD',
//         bills: [{ pkBillID, TableName }] }
router.put('/save', requirePerm('BILL_LETTER', 'CanEdit'), async (req, res) => {
  const { compID, branchID } = req.user;
  const db = req.db;
  const { mode, letterDate, bills = [] } = req.body;

  if (!bills.length) return res.status(400).json({ error: 'No bills selected' });
  if (!mode)         return res.status(400).json({ error: 'mode is required' });
  if (!letterDate)   return res.status(400).json({ error: 'letterDate is required' });

  const t = await db.transaction();
  try {
    for (const { pkBillID, TableName } of bills) {
      // Guard against SQL injection via TableName
      if (!['tBill1', 'tBillTrHmGen1'].includes(TableName)) continue;

      const setClauses = [], params = [];

      if (mode === 'letter' || mode === 'both') {
        setClauses.push('LtrFlg=?');
        params.push('Y');
      }
      if (mode === 'ackdate' || mode === 'both') {
        setClauses.push('AcknldgDt=?');
        params.push(letterDate);
      }

      if (!setClauses.length) continue;

      params.push(compID, branchID, pkBillID);
      await db.query(
        `UPDATE \`${TableName}\` SET ${setClauses.join(', ')}
          WHERE fkCompID=? AND fkBranchID=? AND pkBillID=?`,
        { replacements: params, transaction: t }
      );
    }

    await t.commit();
    res.json({ ok: true, updated: bills.length });
  } catch (e) {
    await t.rollback();
    console.error('[billLetter] PUT /save:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
