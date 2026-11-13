// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// billReport.js  â€”  /api/reports/bill-report
// VB6 Source: frmBillReport.frm
//
// This module is the web equivalent of the VB6 "Bill Report" screen. It covers:
//   â€¢ Listing bills (GR and/or Hamali) across all group company DBs via UNION ALL
//   â€¢ Updating BillStatus (N / P / D) â€” current company only (per VB6 label:
//     "Bill Status will affect on current loged In Company Only.")
//   â€¢ Deleting bill header + detail rows â€” current company only
//   â€¢ Sending HTML email via Nodemailer with the PDF bill attached (CDO â†’ nodemailer)
//   â€¢ Generating a simple PDF stub (full Crystal Reports â†’ pdfkit placeholder)
//
// Endpoints:
//   GET  /form-data                â€” parties + companies for filter panels
//   POST /                         â€” bill list (date range, type, parties, search)
//   PUT  /status                   â€” update BillStatus for selected bill IDs
//   DELETE /                       â€” delete header + detail for selected bill IDs
//   POST /email                    â€” send email with PDF attachment via nodemailer
//   POST /pdf                      â€” generate PDF for a bill (pdfkit stub)
//
// Authorization:
//   All routes: BILLING / CanView
//   PUT /status and DELETE /: BILLING / CanEdit (enforced in route; also surfaced
//   to frontend via /form-data so it can show/hide action buttons without an
//   extra round-trip).
//
// Multi-company querying (VB6 pattern replicated):
//   VB6 looped gDb.sDBName[] and built SQL with " union all " between each
//   database. Here we use connectionManager.getGroupCompanyDetails(groupID) to
//   get all companies, then iterate and UNION ALL their results in JS before
//   returning a merged sorted array â€” identical semantic behaviour.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

'use strict';

const router            = require('express').Router();
const path              = require('path');
const fs                = require('fs');
const nodemailer        = require('nodemailer');
const PDFDocument       = require('pdfkit');
const puppeteer         = require('puppeteer-core');
const requireAuth       = require('../../middleware/auth');
const requirePerm       = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');

// All routes require a valid JWT
router.use(requireAuth);

// â”€â”€ Letterhead image cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reads ADS_LetterHead.png (BHW) or VLCO_LetterHead.png (MUM) once from disk,
// encodes as base64 data URI, and caches for the process lifetime.
// Place image files in: backend/src/assets/letterheads/
const _ltrHeadCache = {};
function getLetterheadB64(compID) {
  if (_ltrHeadCache[compID] !== undefined) return _ltrHeadCache[compID];
  const filename = compID === 'ADS'  ? 'ADS_LetterHead.png'
                 : compID === 'VLCO' ? 'VLCO_LetterHead.png'
                 : null;
  if (!filename) return (_ltrHeadCache[compID] = '');
  const filePath = path.join(__dirname, '../../assets/letterheads', filename);
  try {
    const buf = fs.readFileSync(filePath);
    return (_ltrHeadCache[compID] = `data:image/png;base64,${buf.toString('base64')}`);
  } catch {
    return (_ltrHeadCache[compID] = '');
  }
}

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GST cutoff date â€” APN comment in VB6: "Change in GST Number from 16 Oct 2022"
const GST_CUTOFF_FROM = new Date('2022-10-15');  // last valid "old GST" day
const GST_CUTOFF_TO   = new Date('2022-10-31');  // first day that must be in "new GST" range

// Returns the last day of a calendar month as a Date object.
// Mirrors VB6: Day(DateSerial(nEYear, nEMonth + 1, 0))
function lastDayOfMonth(year, month) {   // month is 1-based
  return new Date(year, month, 0);      // Day 0 of next month = last day of this month
}

// Returns a YYYY-MM-DD string from a Date (avoids timezone drift from toISOString)
function localStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// â”€â”€ Default billing month logic (VB6: udfInitialiseControls) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VB6 calls gudfGetBillToDay to get nBillToDay, then:
//   If nBillToDay <= 29 â†’ shift both pickers to previous month
//   Else               â†’ shift both pickers to 2 months back
// We replicate this: given today's billing day (billing day = day of month of
// today's date, which is what gudfGetBillToDay returns when called with Now),
// return the default { fromYM, toYM } as 'YYYY-MM' strings.
function defaultBillingMonth() {
  const today     = new Date();
  const billToDay = today.getDate();
  const shift     = billToDay <= 29 ? 1 : 2;   // months to go back

  const d = new Date(today.getFullYear(), today.getMonth() - shift, 1);
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { fromYM: ym, toYM: ym };  // both default to same month
}

// â”€â”€ Date validation (VB6: udfDateVal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns null on success, or an error string.
// fromYM, toYM: 'YYYY-MM' strings (month granularity only â€” pickers are M/Y)
function validateDateRange(fromYM, toYM) {
  const [fy, fm] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);

  // from = 1st of the from month; to = last day of the to month
  const fromDate = new Date(fy, fm - 1, 1);
  const toDate   = lastDayOfMonth(ty, tm);

  // ToDate month/year cannot exceed current month/year
  const now        = new Date();
  const currYearMo = now.getFullYear() * 100 + (now.getMonth() + 1);
  const endYearMo  = ty * 100 + tm;
  if (endYearMo > currYearMo) {
    return 'End Date is Greater than current month.';
  }

  // From must be <= To
  if (fromDate > toDate) {
    return 'From Date cannot be greater than To Date.';
  }

  // CRITICAL GST cutoff rule (VB6 line 1422):
  // If fromDate < 15-Oct-2022 AND toDate > 31-Oct-2022 the date range spans the
  // GST number change and will mix old-GST and new-GST bills in the same report.
  if (fromDate < GST_CUTOFF_FROM && toDate > GST_CUTOFF_TO) {
    return 'From 16th October 2022 GST No has Changed, so From Date and To Date should be Higher or Lesser than 15-Oct-2022.';
  }

  return null;  // valid
}

// â”€â”€ GET /form-data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns:
//   parties    â€” all active parties across group companies for the party-selection grid
//   companies  â€” all company names/IDs for the company list checkbox
//   defaults   â€” { fromYM, toYM } for the date pickers
//   canEdit    â€” whether this user's role can update bill status / delete
//
// VB6 equivalents: udfInitialiseControls â†’ udfFillSelPartyGrid + udfAddCompNameLst
router.get('/form-data', requirePerm('BILL_REP', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const groupCompanies = connectionManager.getGroupCompanyDetails(groupID);

    // Collect parties from every company DB in the group (mirrors VB6 UNION ALL loop)
    const allParties = [];
    for (const comp of groupCompanies) {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) continue;

      const [rows] = await cdb.query(
        // VB6: select pName, pkPartyID, fkCompID from mParty
        //      where fkCompID = ? and fkBranchID = ? and Active = 'Y'
        `SELECT pkPartyID, pName, fkCompID
           FROM mParty
          WHERE fkCompID   = ?
            AND fkBranchID = ?
            AND Active     = 'Y'
          ORDER BY pName`,
        { replacements: [comp.pkCompID, branchID] }
      );
      allParties.push(...rows.map(r => ({ ...r, compAlias: comp.CompAlias })));
    }

    // Sort merged list by pName (VB6: "order by pName")
    allParties.sort((a, b) => a.pName.localeCompare(b.pName));

    // Build company list for the lstCompName checkbox (VB6: udfAddCompNameLst)
    const companies = groupCompanies.map(c => ({
      pkCompID:  c.pkCompID,
      CompName:  c.CompName,
      CompAlias: c.CompAlias,
    }));

    // Check edit permission so the frontend can show/hide status + delete buttons
    // without an extra permission API call.
    const { roleID } = req.user;
    const permRows = await req.adminDB.query(
      `SELECT CanEdit, CanDelete FROM mPermission
        WHERE fkRoleID = ? AND ModuleCode = 'BILL_REP'`,
      { replacements: [roleID] }
    );
    const permRow  = permRows[0]?.[0] || {};
    const canEdit   = permRow.CanEdit   === 'Y';
    const canDelete = permRow.CanDelete === 'Y';

    res.json({
      parties:   allParties,
      companies,
      defaults:  defaultBillingMonth(),
      canEdit,
      canDelete,
    });
  } catch (e) {
    console.error('[billReport] GET /form-data:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST / (fetch bill list) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body:
//   fromYM      â€” 'YYYY-MM'  (From month picker value)
//   toYM        â€” 'YYYY-MM'  (To month picker value)
//   billTypes   â€” string[]   e.g. ['GR'] | ['HM'] | ['GR','HM']
//   partyIDs    â€” string[]   selected party IDs (from party-selection grid)
//   compIDs     â€” string[]   selected company IDs (from lstCompName checkbox group)
//   search      â€” string     optional bill number search (VB6: psBillNum)
//
// Returns:
//   bills       â€” merged, sorted bill rows
//
// VB6 equivalent: udfPopBillDet â€” builds UNION ALL across gDb.sDBName[] for GR
//   and/or HM tables, filtered by fkPartyID IN (sCond) and optional BillNum.
router.post('/', requirePerm('BILL_REP', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const { fromYM, toYM, billTypes = ['GR', 'HM'], partyIDs = [], compIDs = [], search = '' } = req.body;

    // Validate required fields
    if (!fromYM || !toYM) return res.status(400).json({ error: 'fromYM and toYM are required.' });
    if (!billTypes.length) return res.status(400).json({ error: 'Select at least one bill type.' });
    if (!partyIDs.length) return res.status(400).json({ error: 'Select at least one party.' });

    // Validate date range (VB6: udfDateVal)
    const dateErr = validateDateRange(fromYM, toYM);
    if (dateErr) return res.status(400).json({ error: dateErr });

    const [fy, fm] = fromYM.split('-').map(Number);
    const [ty, tm] = toYM.split('-').map(Number);
    // From = 1st of from-month; To = last day of to-month (mirrors VB6 udfDateVal)
    const fromDate = localStr(new Date(fy, fm - 1, 1));
    const toDate   = localStr(lastDayOfMonth(ty, tm));

    // Safe parameterised IN list builder â€” never string-interpolated
    const pIdPlaceholders = partyIDs.map(() => '?').join(',');

    const groupCompanies = connectionManager.getGroupCompanyDetails(groupID);

    // Filter to only the user-selected companies (if any subset was chosen)
    const targetComps = compIDs.length
      ? groupCompanies.filter(c => compIDs.includes(c.pkCompID))
      : groupCompanies;

    // â”€â”€ All companies in parallel; GR + HM combined into one UNION ALL per company â”€â”€
    const compQueries = targetComps.map(async (comp) => {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) return [];

      const parts  = [];   // SQL fragments
      const params = [];   // positional params accumulated in part order

      // VB6: Select B1.BillNum, B1.BillDt ... from tBill1 B1, mParty pm
      //       where B1.fkPartyID = pm.pkPartyID
      //         and B1.fkCompID = ? and B1.fkBranchID = ?
      //         and B1.BillDt >= ? and B1.BillDt <= ?
      //         and B1.fkPartyID in (...)
      if (billTypes.includes('GR')) {
        let sql =
          `SELECT B1.BillNum, B1.BillDt, B1.fkPartyID, 'GR' AS BillType,
                  B1.pkBillID, B1.GrossAmt,
                  COALESCE(B1.NetAmt, 0)   AS NetAmt,
                  B1.StFlagGodRent         AS StFlag,
                  pm.pName, pm.pEmail, pm.pCode,
                  COALESCE(B1.Tax1Amt, 0)  AS Tax1Amt,
                  COALESCE(B1.Tax2Amt, 0)  AS Tax2Amt,
                  COALESCE(B1.Tax3Amt, 0)  AS Tax3Amt,
                  B1.fkCompID, B1.GSTNo,
                  COALESCE(B1.RoundOff, 0) AS RoundOff,
                  B1.BillStatus
             FROM tBill1 B1
             JOIN mParty pm ON B1.fkPartyID = pm.pkPartyID
            WHERE B1.fkCompID   = ?
              AND B1.fkBranchID = ?
              AND B1.BillDt    BETWEEN ? AND ?
              AND B1.fkPartyID  IN (${pIdPlaceholders})`;
        const p = [comp.pkCompID, branchID, fromDate, toDate, ...partyIDs];
        if (search) { sql += ' AND B1.BillNum = ?'; p.push(search); }
        parts.push(sql);
        params.push(...p);
      }

      // VB6: Select B1.BillNum, B1.BillDt ... from tBillTrHmGen1 B1, vamParty vp
      //       where B1.fkPartyID = vp.pkPartyID and B1.BillType = 'HMLI'
      //         and B1.fkCompID = ? ...
      if (billTypes.includes('HM')) {
        let sql =
          `SELECT B1.BillNum, B1.BillDt, B1.fkPartyID, B1.BillType,
                  B1.pkBillID, B1.GrossAmt,
                  COALESCE(B1.NetAmt, 0)   AS NetAmt,
                  B1.StFlagTrans           AS StFlag,
                  vp.pName, vp.pEmail, vp.pCode,
                  COALESCE(B1.Tax1Amt, 0)  AS Tax1Amt,
                  COALESCE(B1.Tax2Amt, 0)  AS Tax2Amt,
                  COALESCE(B1.Tax3Amt, 0)  AS Tax3Amt,
                  B1.fkCompID, B1.GSTNo,
                  COALESCE(B1.RoundOff, 0) AS RoundOff,
                  B1.BillStatus
             FROM tBillTrHmGen1 B1
             JOIN vamParty vp ON B1.fkPartyID = vp.pkPartyID
            WHERE B1.fkCompID   = ?
              AND B1.fkBranchID = ?
              AND B1.BillDt    BETWEEN ? AND ?
              AND B1.BillType   = 'HMLI'
              AND B1.fkPartyID  IN (${pIdPlaceholders})`;
        const p = [comp.pkCompID, branchID, fromDate, toDate, ...partyIDs];
        if (search) { sql += ' AND B1.BillNum = ?'; p.push(search); }
        parts.push(sql);
        params.push(...p);
      }

      if (!parts.length) return [];

      const [rows] = await cdb.query(parts.join('\nUNION ALL\n'), { replacements: params });
      return rows.map(r => ({
        ...r,
        BillDt:    r.BillDt instanceof Date ? localStr(r.BillDt) : r.BillDt,
        compAlias: comp.CompAlias,
      }));
    });

    // Await all company queries in parallel then flatten
    const allBills = (await Promise.all(compQueries)).flat();

    // Sort merged result: by company, then bill date, then bill number
    // VB6: "Order By fkCompID, BillDt, BillNum"
    allBills.sort((a, b) => {
      if (a.fkCompID < b.fkCompID) return -1;
      if (a.fkCompID > b.fkCompID) return  1;
      if (a.BillDt   < b.BillDt)   return -1;
      if (a.BillDt   > b.BillDt)   return  1;
      if (a.BillNum  < b.BillNum)   return -1;
      if (a.BillNum  > b.BillNum)   return  1;
      return 0;
    });

    res.json({ bills: allBills });
  } catch (e) {
    console.error('[billReport] POST /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ PUT /status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Updates BillStatus on the current logged-in company's DB only.
// VB6 label: "Bill Status will affect on current loged In Company Only."
//
// Body:
//   billIDs   â€” string[]   PKs to update
//   billType  â€” 'GR' | 'HM'   (must be exactly one â€” VB6 blocks both-selected)
//   status    â€” 'N' | 'P' | 'D'
//
// VB6 equivalent: cmdBillStatus_Click â€” loops recordset, sets BillStatus, .Update
router.put('/status', requirePerm('BILL_REP', 'CanEdit'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const { billIDs, billType, status } = req.body;

    if (!billIDs?.length) return res.status(400).json({ error: 'No bills selected.' });
    if (!['GR', 'HM'].includes(billType)) return res.status(400).json({ error: 'billType must be GR or HM.' });
    if (!['N', 'P', 'D'].includes(status)) return res.status(400).json({ error: 'status must be N, P, or D.' });

    const table = billType === 'GR' ? 'tBill1' : 'tBillTrHmGen1';
    const placeholders = billIDs.map(() => '?').join(',');

    // VB6: Update tBill1 SET BillStatus = ? WHERE fkCompID = ? AND pkBillID IN (...)
    const [result] = await req.db.query(
      `UPDATE ${table}
          SET BillStatus = ?
        WHERE fkCompID   = ?
          AND fkBranchID = ?
          AND pkBillID   IN (${placeholders})`,
      { replacements: [status, compID, branchID, ...billIDs] }
    );

    res.json({ updated: result.affectedRows });
  } catch (e) {
    console.error('[billReport] PUT /status:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ DELETE / â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Deletes header + detail rows from the current logged-in company's DB only.
// VB6: udfDeleteEntry â€” deletes from tBill1/tBill2 or tBillTrHmGen1/tBillTrHmGen2.
//
// Body:
//   billIDs   â€” string[]   PKs to delete
//   billType  â€” 'GR' | 'HM'
//
// Delete order: detail first (FK child), then header (FK parent), wrapped in
// a transaction so a failure leaves neither table half-deleted.
router.delete('/', requirePerm('BILL_REP', 'CanDelete'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const { billIDs, billType } = req.body;

    if (!billIDs?.length) return res.status(400).json({ error: 'No bills selected.' });
    if (!['GR', 'HM'].includes(billType)) return res.status(400).json({ error: 'billType must be GR or HM.' });

    const headerTable = billType === 'GR' ? 'tBill1'          : 'tBillTrHmGen1';
    const detailTable = billType === 'GR' ? 'tBill2'          : 'tBillTrHmGen2';
    const detailFK    = billType === 'GR' ? 'cpkBillID'       : 'cpkBillID';   // same name in both tables
    const placeholders = billIDs.map(() => '?').join(',');

    // Use a Sequelize transaction so header + detail delete are atomic
    const t = await req.db.transaction();
    try {
      // VB6: Delete from tBill2 where cpkBillID in (...)
      await req.db.query(
        `DELETE FROM ${detailTable} WHERE ${detailFK} IN (${placeholders})`,
        { replacements: [...billIDs], transaction: t }
      );

      // VB6: Delete from tBill1 where fkCompID = ? and pkBillID in (...)
      await req.db.query(
        `DELETE FROM ${headerTable}
          WHERE fkCompID   = ?
            AND fkBranchID = ?
            AND pkBillID   IN (${placeholders})`,
        { replacements: [compID, branchID, ...billIDs], transaction: t }
      );

      await t.commit();
      res.json({ deleted: billIDs.length });
    } catch (innerErr) {
      await t.rollback();
      throw innerErr;
    }
  } catch (e) {
    console.error('[billReport] DELETE /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ HTML â†’ PDF via headless Chrome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Uses puppeteer-core with the system Chrome (CHROME_PATH in .env).
// Returns a Buffer containing the PDF bytes.
async function htmlToPdf(html) {
  const executablePath = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

// â”€â”€ SMTP config per company group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VB6: gv.sDbGroup = "MUM" â†’ Gmail account; gv.sDbGroup = "BHW" â†’ Office 365
// Credentials in .env keyed as SMTP_{GROUP}_USER, SMTP_{GROUP}_PASS, etc.
// Falls back to generic SMTP_* vars for any group without a specific override.
function getSmtpConfig(groupID) {
  const g = (groupID || '').toUpperCase();
  const e = (k) => process.env[`SMTP_${g}_${k}`] || process.env[`SMTP_${k}`];

  const user = e('USER');
  const pass = e('PASS');
  if (!user || !pass) return null;

  const port   = parseInt(e('PORT') || '465');
  const secure = (e('SECURE') || 'true') !== 'false';   // true=SSL/465; false=STARTTLS/587

  return {
    host:     e('HOST')      || 'smtp.gmail.com',
    port, secure,
    auth:     { user, pass },
    fromName: e('FROM_NAME') || 'GMS Billing',
    fromAddr: e('FROM_ADDR') || user,
    compName: e('COMP_NAME') || process.env.COMPANY_NAME || 'GMS',
    website:  e('COMP_WEB')  || process.env.COMPANY_WEB  || 'www.adityaservices.co.in',
  };
}

// â”€â”€ POST /email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sends an HTML email with a PDF attachment for each selected bill.
// VB6 equivalents: udfEmailMAPI_GR / udfEmailMAPI_HM
// Body: { bills, billType ('GR'|'HM') }
router.post('/email', requirePerm('BILL_REP', 'CanPrint'), async (req, res) => {
  try {
    const { bills = [], billType } = req.body;

    if (!bills.length) return res.status(400).json({ error: 'No bills provided for email.' });
    if (!['GR', 'HM'].includes(billType)) return res.status(400).json({ error: 'billType must be GR or HM.' });

    // Determine SMTP config from logged-in company's group (VB6: gv.sDbGroup)
    const groupID  = req.user?.groupID || '';
    const smtpConf = getSmtpConfig(groupID);
    if (!smtpConf) {
      return res.status(500).json({
        error: `SMTP not configured for group "${groupID}". ` +
               `Add SMTP_${groupID.toUpperCase()}_USER and SMTP_${groupID.toUpperCase()}_PASS to .env.`,
      });
    }

    console.log('[email] group=%s host=%s port=%d secure=%s user=%s',
      groupID, smtpConf.host, smtpConf.port, smtpConf.secure, smtpConf.auth.user);

    const transporter = nodemailer.createTransport({
      host:       smtpConf.host,
      port:       smtpConf.port,
      secure:     smtpConf.secure,
      auth:       smtpConf.auth,
      tls:        { rejectUnauthorized: false },
    });

    const { fromName, fromAddr, compName, website } = smtpConf;

    const errors  = [];
    const sent    = [];
    const billLabel = billType === 'GR' ? 'Godown Rent' : 'Hamali';

    // Group bills by party â€” one email per party with all their bills in one attachment
    const byParty = new Map();
    for (const bill of bills) {
      const key = `${bill.fkCompID}||${bill.fkPartyID}`;
      if (!byParty.has(key)) byParty.set(key, []);
      byParty.get(key).push(bill);
    }

    for (const partyBills of byParty.values()) {
      const rep   = partyBills[0];   // use first bill for party-level info
      const toAddr = rep.pEmail?.trim();
      const recipientAddr = toAddr || process.env.FALLBACK_EMAIL || fromAddr;
      const noEmail = !toAddr;

      // VB6: Format(dtpBillRepDt(cixToDt).Value, "MMMM-yyyy") â†’ e.g. "July-2024"
      const repDtObj  = new Date(rep.BillDt + 'T00:00:00');
      const monthYear = repDtObj.toLocaleDateString('en-IN', { month: 'long' }) + '-' + repDtObj.getFullYear();

      // Email body table â€” one row per bill for this party
      const TD = 'font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:10px 14px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;';
      const billRowsHtml = partyBills.map(b => {
        const dt  = new Date(b.BillDt + 'T00:00:00')
          .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const amt = Number(b.NetAmt || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        return `<tr>` +
          `<td style="${TD}">${b.BillNum}</td>` +
          `<td style="${TD}">${dt}</td>` +
          `<td style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1e293b;padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:center;">Rs.${amt}/-</td>` +
          `</tr>`;
      }).join('');

      const TH = 'font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1a0a00;padding:10px 14px;text-align:center;';
      const htmlBody = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px 0;background:#edf2f7;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#edf2f7;">
<tr><td style="padding:0 16px;">
<table cellpadding="0" cellspacing="0" align="center" style="width:520px;max-width:100%;background:#ffffff;box-shadow:0 4px 20px rgba(0,0,0,0.10);">

  <!-- Top accent bar: yellow | orange | blue -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#f4c531;padding:5px 0;width:33%;"></td>
      <td style="background:#f47920;padding:5px 0;width:34%;"></td>
      <td style="background:#1565C0;padding:5px 0;width:33%;"></td>
    </tr></table>
  </td></tr>

  <!-- Header -->
  <tr><td style="padding:22px 28px 18px;border-bottom:2px solid #f0f4f8;">
    <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;">${compName}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#0d1b3e;">${billLabel} Bill</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:20px 28px 4px;">
    <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;color:#334155;">Dear Sir/Madam,</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#334155;">Greetings from <b style="color:#1565C0;">${compName}</b></p>
  </td></tr>

  <!-- Message -->
  <tr><td style="padding:12px 28px 0;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#334155;">Here is ${billLabel} bill for <b>${rep.pName}</b>.</p>
  </td></tr>

  <!-- Bill table -->
  <tr><td style="padding:16px 28px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
      <tr style="background:#f47920;">
        <th style="${TH}border-right:1px solid rgba(255,255,255,0.35);">Bill No</th>
        <th style="${TH}border-right:1px solid rgba(255,255,255,0.35);">Bill Date</th>
        <th style="${TH}">Bill Amount</th>
      </tr>
      ${billRowsHtml}
    </table>
  </td></tr>

  <!-- Footer message -->
  <tr><td style="padding:0 28px 18px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#475569;">Enclosed herewith soft copy of ${billLabel} Bill.</p>
  </td></tr>

  <!-- Thanks -->
  <tr><td style="padding:16px 28px;border-top:1px solid #f0f4f8;">
    <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;color:#334155;">Thanks &amp; Regards,</p>
    <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;color:#334155;">---</p>
    <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1565C0;">${compName}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;">${website}</p>
  </td></tr>

  <!-- Footer bands: yellow | orange | blue -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#f4c531;padding:4px 0;width:33%;"></td>
      <td style="background:#f47920;padding:4px 0;width:34%;"></td>
      <td style="background:#1565C0;padding:4px 0;width:33%;"></td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      // Generate bill HTML attachment â€” runs the same detail query as /print
      // withLetterhead=true for emailed copies (VB6: chkExportEmail â†’ LetterHead = 'Y')
      const byComp = new Map();
      for (const b of partyBills) {
        if (!byComp.has(b.fkCompID)) byComp.set(b.fkCompID, []);
        byComp.get(b.fkCompID).push(b.pkBillID);
      }
      const printRows = [];
      for (const [compID, ids] of byComp) {
        const db = connectionManager.getDB(compID);
        if (!db) continue;
        try {
          printRows.push(...await queryPrintRows(db, billType, ids));
        } catch (qErr) {
          console.error('[email] print query compID=%s:', compID, qErr.message);
        }
      }

      if (billType === 'HM') await fillMissingPartyData(printRows);

      const attachments = [];
      if (printRows.length) {
        const billHtml = generatePrintHTML(printRows, billType, 'main', true, req.user.compID || '');
        const safeName = rep.pName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);
        try {
          const pdfBuffer = await htmlToPdf(billHtml);
          attachments.push({
            filename:    `Bill_${safeName}_${monthYear}.pdf`,
            content:     pdfBuffer,
            contentType: 'application/pdf',
          });
        } catch (pdfErr) {
          console.error('[email] PDF generation failed pName=%s err=%s', rep.pName, pdfErr.message);
          // fall back to HTML attachment if PDF generation fails
          attachments.push({
            filename:    `Bill_${safeName}_${monthYear}.html`,
            content:     billHtml,
            contentType: 'text/html',
          });
        }
      }

      try {
        await transporter.sendMail({
          from:    `"${fromName}" <${fromAddr}>`,
          to:      recipientAddr,
          subject: `Invoice: ${billLabel} ${monthYear}`,
          html:    htmlBody,
          attachments,
        });
        sent.push({ pkBillID: rep.pkBillID, pName: rep.pName, noEmail });
      } catch (mailErr) {
        console.error('[email] send failed to=%s pName=%s err=%s', recipientAddr, rep.pName, mailErr.message);
        errors.push({ pkBillID: rep.pkBillID, pName: rep.pName, error: mailErr.message });
      }
    }

    res.json({ sent, errors });
  } catch (e) {
    console.error('[billReport] POST /email:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /pdf â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generates a simple PDF for one or more bills using pdfkit.
// VB6 equivalent: udfConvtPDF (Crystal Reports â†’ PDF file on disk)
//
// Body:
//   bills     â€” array of bill header + detail rows (from the full detail query)
//   billType  â€” 'GR' | 'HM'
//   withLetterhead â€” boolean (VB6: chkLtrHead)
//
// Full Crystal Reports fidelity is NOT replicated here â€” that requires dedicated
// HTML/CSS templates per report type (drsBillGSTReport, drsHGSTBill, etc.).
// This endpoint streams a tabular PDF that shows the bill data so users have
// *something* to view/print while proper templates are built later.
//
// See MIGRATION_PLAN.md Â§PDF Strategy for the recommended template approach.
router.post('/pdf', requirePerm('BILL_REP', 'CanPrint'), async (req, res) => {
  try {
    const { bills = [], billType = 'GR', withLetterhead = false } = req.body;
    if (!bills.length) return res.status(400).json({ error: 'No bill data provided.' });

    const label = billType === 'GR' ? 'Godown Rent Bill' : 'Hamali Bill';

    // Stream PDF directly to response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Bill_${Date.now()}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // â”€â”€ Cover / header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (withLetterhead) {
      doc.fontSize(16).font('Helvetica-Bold')
         .text(process.env.COMPANY_NAME || 'GMS', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
         .text(process.env.COMPANY_ADDRESS || '', { align: 'center' });
      doc.moveDown(0.5);
    }

    doc.fontSize(14).font('Helvetica-Bold').text(label, { align: 'center' });
    doc.moveDown(1);

    // â”€â”€ Bill rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const colW = [160, 80, 70, 70, 70];  // Party | BillNum | Date | Gross | Net
    const headers = ['Party Name', 'Bill No', 'Date', 'Gross', 'Net'];

    // Header row
    doc.fontSize(9).font('Helvetica-Bold');
    let x = 50;
    headers.forEach((h, i) => {
      doc.text(h, x, doc.y, { width: colW[i], continued: i < headers.length - 1 });
      x += colW[i];
    });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.2);

    // Data rows
    doc.fontSize(8).font('Helvetica');
    for (const b of bills) {
      const dtFmt = b.BillDt
        ? new Date(b.BillDt + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '';
      const row = [
        b.pName   || '',
        b.BillNum || '',
        dtFmt,
        Number(b.GrossAmt || 0).toFixed(2),
        Number(b.NetAmt   || 0).toFixed(2),
      ];
      x = 50;
      const rowY = doc.y;
      row.forEach((cell, i) => {
        doc.text(String(cell), x, rowY, { width: colW[i], continued: i < row.length - 1 });
        x += colW[i];
      });
      doc.moveDown(0.2);

      // Auto page-break if close to bottom
      if (doc.y > 740) { doc.addPage(); }
    }

    doc.moveDown(1);
    doc.fontSize(8).text(`Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'right' });
    doc.end();
  } catch (e) {
    console.error('[billReport] POST /pdf:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PRINT / HTML BILL GENERATION
// Returns a browser-printable HTML document for one or more bills.
// VB6 equivalents: drsBillReport (GR Main), drsBillStatement (GR Statement),
//                  drsHamBill (HM Main)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function printFmt(n, dec = 2) {
  return (parseFloat(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  });
}

function printDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
}

// "1-Jul-26" format used in space-charge description lines
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return '';
  return `${dt.getDate()}-${SHORT_MONTHS[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
}

// Builds the space-charge description line from row fields
function spcDesc(r) {
  const qty  = Math.round(parseFloat(r.BalQty)   || 0);
  const rate = (parseFloat(r.BillRate) || 0).toFixed(2);
  return `Warehousing Charges for the period from ${shortDate(r.FromDt)} to ${shortDate(r.ToDt)} for the ${r.iName || 'Space Used'} ${qty}sqrft @ ${rate}/-`;
}

function amountToWords(amount) {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tensW = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function twoDigit(n) {
    if (n < 20) return ones[n];
    return tensW[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigit(n) {
    if (n === 0) return '';
    if (n < 100) return twoDigit(n);
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return ones[h] + ' Hundred' + (rem ? ' ' + twoDigit(rem) : '');
  }
  const val    = parseFloat(amount) || 0;
  const rupees = Math.floor(val);
  const paise  = Math.round((val - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Only';
  const crore = Math.floor(rupees / 10000000);
  const lakh  = Math.floor((rupees % 10000000) / 100000);
  const thou  = Math.floor((rupees % 100000) / 1000);
  const rem   = rupees % 1000;
  const parts = [];
  if (crore) parts.push(threeDigit(crore) + ' Crore');
  if (lakh)  parts.push(twoDigit(lakh)    + ' Lakh');
  if (thou)  parts.push(twoDigit(thou)    + ' Thousand');
  if (rem)   parts.push(threeDigit(rem));
  let words = 'Rupees ' + parts.join(' ');
  if (paise) words += ' and Paise ' + twoDigit(paise);
  return words + ' Only';
}

const BILL_PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm 15mm 10mm; }
*,*::before,*::after { box-sizing: border-box; }
body { margin:0; padding:0; font-family:'Times New Roman',Times,serif; font-size:11pt; color:#000; }
.bill-section { page-break-after: always; }
.bill-section:last-child { page-break-after: auto; }
.hdr-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; }
.party-name { font-size:12pt; font-weight:bold; }
.bill-meta { text-align:right; font-size:10.5pt; line-height:1.5; }
.party-addr { font-size:9pt; margin-bottom:6px; white-space:pre-line; }
table { width:100%; border-collapse:collapse; margin-top:4px; }
th,td { border:1px solid #444; padding:2px 4px; font-size:9.5pt; vertical-align:middle; }
th { background:#f0f0f0; font-weight:bold; text-align:center; white-space:nowrap; }
.tc { text-align:center; }
.tr { text-align:right; }
.bold { font-weight:bold; }
.lot-num { font-size:8.5pt; color:#333; }
.tax-reg { font-size:9pt; margin-top:6px; }
.hm-title { text-align:center; font-size:14pt; font-weight:bold; margin-bottom:10px; }
.print-footer { font-size:9pt; text-align:right; margin-top:14px; }
.ti-box { border:2px solid #000; margin-bottom:0; page-break-inside:avoid; }
.ti-title { text-align:center; font-size:13pt; font-weight:bold; padding:3px; border-bottom:1px solid #000; }
.ti-info { display:flex; justify-content:space-between; padding:3px 8px; font-size:10pt; line-height:1.7; }
.ti-left { flex:1; }
.ti-right { text-align:right; }
.party-box { border:1px solid #000; border-top:none; display:flex; justify-content:space-between; padding:4px 8px; font-size:10pt; line-height:1.5; }
.party-left { flex:1; }
.party-right { text-align:right; }
.no-bd { border:none !important; padding:0 !important; }
.hsn-table { width:100%; border-collapse:collapse; margin-top:6px; }
.hsn-table th,.hsn-table td { border:1px solid #000; padding:2px 4px; font-size:9pt; }
.words-wrap { display:flex; margin-top:6px; font-size:9.5pt; }
.words-l { flex:1; border:1px solid #000; padding:5px 8px; }
.words-r { width:42%; border:1px solid #000; border-left:none; padding:5px 8px; }
.words-r table { width:100%; border-collapse:collapse; }
.words-r td { border:none; padding:1px 4px; font-size:9.5pt; }
.terms-box { margin-top:8px; font-size:9.5pt; }
.sig-row { display:flex; justify-content:space-between; margin-top:18px; font-size:10pt; }
.sig-right { text-align:center; }
/* â”€â”€ GR Bill Statement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.gs-block { margin-bottom:10px; }
.gs-hdr-tbl { width:100%; border-collapse:collapse; margin-bottom:1px; }
.gs-hdr-tbl td { padding:0 3px; border:none; vertical-align:top; }
.gs-pname { width:46%; font-size:10pt; }
.gs-bdt { white-space:nowrap; font-size:9.5pt; padding-right:8px; }
.gs-bno { white-space:nowrap; font-size:9.5pt; padding-right:8px; }
.gs-ccode { text-align:right; font-weight:bold; font-size:9.5pt; }
.gs-addr { font-size:8.5pt; }
.gs-bqhdr { text-align:center; font-size:8.5pt; font-weight:bold; white-space:nowrap; }
.gs-gflag { text-align:right; font-size:9pt; font-weight:bold; }
.gs-data { width:100%; border-collapse:collapse; margin-top:0; }
.gs-data th,.gs-data td { border:none; }
.gs-data th { font-size:8pt; font-weight:bold; text-align:center; padding:1px 2px;
              border-bottom:1px solid #000 !important; background:none; white-space:nowrap; }
.gs-data td { font-size:8pt; padding:0 2px; }
.gs-lot  { width:9%;  text-align:left; }
.gs-iname{ width:21%; text-align:left; }
.gs-dt   { width:7%;  text-align:center; }
.gs-arrq { width:10%; text-align:center; }
.gs-wght { width:6%;  text-align:right; }
.gs-bq   { width:7%;  text-align:right; }
.gs-rate { width:6%;  text-align:right; }
.gs-ramt { width:9%;  text-align:right; }
.gs-sub td { border-top:1px solid #000 !important; }
.gs-taxtext { text-align:right; font-size:8pt; }
.gs-net { text-align:right; font-weight:bold; font-size:8.5pt; }
.no-print { margin-bottom:8px; }
.no-print button { padding:5px 14px; cursor:pointer; font-size:11px; }
@media print { .no-print { display:none !important; } }
`;

// â”€â”€ GR Main Bill â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildGRMainHTML(billMap, ltrHtml) {
  const parts = [];
  for (const [, rows] of billMap) {
    const h = rows[0];

    const detailHTML = rows.map(r => {
      const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
      const lotLabel = (r.BillDesc2 && r.BillDesc2.trim())
        ? `${esc(r.LotNum)} - ${esc(r.BillDesc2)}`
        : esc(r.LotNum);
      return `<tr>
        <td>${esc(r.iName)}<br><span class="lot-num">${lotLabel}</span></td>
        <td class="tc">${printDate(r.OriTransDt)}</td>
        <td class="tc">${printFmt(r.OriTransQty, 2)} ${esc(r.Packing)}</td>
        <td class="tc">${printDate(r.FromDt)}</td>
        <td class="tc">${printDate(r.ToDt)}</td>
        <td class="tc">${printFmt(r.BalQty, 2)} ${esc(r.Packing)}</td>
        <td class="tr">${printFmt(r.BillRate, 2)}</td>
        <td class="tr">${printFmt(rowAmt, 2)}</td>
      </tr>`;
    }).join('');

    const grossRow = `<tr>
      <td colspan="7" style="border-top:2px solid #444;"></td>
      <td class="tr">${printFmt(h.GrossAmt)}</td>
    </tr>`;

    const taxRows = [];
    if (parseFloat(h.Tax1Amt)) taxRows.push(`<tr>
      <td colspan="7" class="tr">${esc(h.Tax1Desc || 'Service Tax')} ${printFmt(h.Tax1Rate || 0, 2)}% =</td>
      <td class="tr">${printFmt(h.Tax1Amt)}</td>
    </tr>`);
    if (parseFloat(h.Tax2Amt)) taxRows.push(`<tr>
      <td colspan="7" class="tr">${esc(h.Tax2Desc || 'SBC')} ${printFmt(h.Tax2Rate || 0, 2)}% =</td>
      <td class="tr">${printFmt(h.Tax2Amt)}</td>
    </tr>`);
    if (parseFloat(h.Tax3Amt)) taxRows.push(`<tr>
      <td colspan="7" class="tr">${esc(h.Tax3Desc || 'KKC')} ${printFmt(h.Tax3Rate || 0, 2)}% =</td>
      <td class="tr">${printFmt(h.Tax3Amt)}</td>
    </tr>`);

    const netRow = `<tr>
      <td colspan="7" style="text-align:right; border-top:2px solid #444;" class="bold">Net Amount</td>
      <td class="tr bold">${printFmt(h.NetAmt)}</td>
    </tr>`;

    const stInfo = (h.CompST || h.CompRegNum)
      ? `<div class="tax-reg">Service Tax No. : ${esc(h.CompST || '')} &nbsp;&nbsp;&nbsp; Reg No. : ${esc(h.CompRegNum || '')}</div>`
      : '';

    parts.push(`<div class="bill-section">
      ${ltrHtml}
      <div class="hdr-row">
        <div class="party-name">M/s ${esc(h.pName)}</div>
        <div class="bill-meta">Bill No. : ${esc(h.BillNum)}<br>Bill Dt : ${printDate(h.BillDt)}</div>
      </div>
      ${h.pBillAdd ? `<div class="party-addr">${esc(h.pBillAdd)}</div>` : ''}
      <table>
        <thead><tr>
          <th>Item Name</th><th>Arrival Date</th><th>Arrival Quantity</th>
          <th>From Date</th><th>To Date</th><th>Goods Billed</th>
          <th>Rate</th><th>Total Amount</th>
        </tr></thead>
        <tbody>
          ${detailHTML}
          ${grossRow}
          ${taxRows.join('')}
          ${netRow}
        </tbody>
      </table>
      ${stInfo}
    </div>`);
  }
  return parts.join('\n');
}

// â”€â”€ GR Bill Statement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildGRStatementHTML(billMap, ltrHtml) {
  const sections = [];
  let first = true;
  for (const [, rows] of billMap) {
    const h = rows[0];

    const detailHTML = rows.map(r => {
      const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
      return `<tr>
        <td class="tc">${esc(r.LotNum)}</td>
        <td>${esc([r.iName, r.ItemExtDesc].filter(Boolean).join(' '))}</td>
        <td class="tc">${printDate(r.OriTransDt)}</td>
        <td class="tc">${printFmt(r.OriTransQty, 2)}<br><span class="lot-num">${esc(r.Packing)}</span></td>
        <td class="tc">${printFmt(r.PackWght, 2)}</td>
        <td class="tc">${printDate(r.FromDt)}</td>
        <td class="tc">${printDate(r.ToDt)}</td>
        <td class="tc">${printFmt(r.BalQty, 2)}<br><span class="lot-num">${esc(r.Packing)}</span></td>
        <td class="tr">${printFmt(r.BillRate, 2)}</td>
        <td class="tr">${printFmt(rowAmt, 2)}</td>
      </tr>`;
    }).join('');

    const taxParts = [];
    if (parseFloat(h.Tax1Rate)) taxParts.push(`+${printFmt(h.Tax1Rate, 2)} &nbsp; ${printFmt(h.Tax1Amt)}`);
    if (parseFloat(h.Tax2Rate)) taxParts.push(`+${printFmt(h.Tax2Rate, 2)} &nbsp; ${printFmt(h.Tax2Amt)}`);
    if (parseFloat(h.Tax3Rate)) taxParts.push(`+${printFmt(h.Tax3Rate, 2)} &nbsp; ${printFmt(h.Tax3Amt)}`);

    const taxRow = `<tr>
      <td colspan="9" style="text-align:right; font-size:9pt; border-top:1px solid #444;">
        ${taxParts.join(' &nbsp;&nbsp; ')}
      </td>
      <td class="tr bold">${printFmt(h.NetAmt)}</td>
    </tr>`;

    sections.push(`<div style="margin-bottom:18px;">
      ${first ? ltrHtml : ''}
      <div class="hdr-row">
        <div class="party-name">M/S ${esc(h.pName)}</div>
        <div class="bill-meta">Bill Dt : ${printDate(h.BillDt)} &nbsp; Bill No. : ${esc(h.BillNum)}</div>
      </div>
      <table>
        <thead><tr>
          <th>Lot No.</th><th>Item Name</th><th>Arrival Date</th><th>Arrival Qty</th>
          <th>Wght</th><th>From Date</th><th>To Date</th>
          <th>Balance Qty</th><th>Rate</th><th>Amount</th>
        </tr></thead>
        <tbody>
          ${detailHTML}
          ${taxRow}
        </tbody>
      </table>
    </div>`);

    first = false;
  }

  const today = new Date();
  const todayStr = printDate(
    `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  );

  return `<div>${sections.join('\n')}<div class="print-footer">Print on ${todayStr}</div></div>`;
}

// â”€â”€ Hamali Main Bill â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildHMMainHTML(billMap, ltrHtml) {
  const parts = [];
  for (const [, rows] of billMap) {
    const h = rows[0];

    const detailHTML = rows.map(r => {
      let particular;
      if (r.BillDesc2 && r.BillDesc2.trim()) {
        particular = esc(r.BillDesc2);
      } else if (r.HamaliFlg === 'L') {
        particular = `Loading of ${printFmt(r.TransQty, 2)} ${esc(r.Packing)} @ ${printFmt(r.PackWght, 2)}kg of ${esc(r.iName)} from LotNo - ${esc(r.LotNum)}`;
      } else if (r.HamaliFlg === 'U') {
        particular = `Unloading of ${printFmt(r.TransQty, 2)} ${esc(r.Packing)} @ ${printFmt(r.PackWght, 2)}kg of ${esc(r.iName)} from LotNo - ${esc(r.LotNum)}`;
      } else {
        particular = `${esc(r.iName || '')}${r.LotNum ? ` from LotNo - ${esc(r.LotNum)}` : ''}`.trim();
      }
      return `<tr>
        <td class="tc">${printDate(r.RecdDt)}</td>
        <td>${particular}</td>
        <td class="tr">${printFmt(r.BillRate, 2)}</td>
        <td class="tr">${printFmt(r.Amount, 2)}</td>
      </tr>`;
    }).join('');

    parts.push(`<div class="bill-section">
      ${ltrHtml}
      <div class="hm-title">Hamali Bill</div>
      <div class="hdr-row">
        <div class="party-name">M/s ${esc(h.pName)}</div>
        <div class="bill-meta">Bill No : ${esc(h.BillNum)}<br>Bill Date : ${printDate(h.BillDt)}</div>
      </div>
      ${h.pBillAdd ? `<div class="party-addr">${esc(h.pBillAdd)}</div>` : ''}
      <table>
        <colgroup>
          <col style="width:10%"><col style="width:65%">
          <col style="width:10%"><col style="width:15%">
        </colgroup>
        <thead><tr><th>Date</th><th>Particular</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>
          ${detailHTML}
          <tr>
            <td colspan="3" style="text-align:right; border-top:2px solid #444;" class="bold">Total Amount</td>
            <td class="tr bold">${printFmt(h.NetAmt)}</td>
          </tr>
        </tbody>
      </table>
    </div>`);
  }
  return parts.join('\n');
}

// â”€â”€ Shared GST footer builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns HTML for the last-page GST summary block (HSN table, amount in words,
// bank details, terms, signature). Used by both GR and HM GST builders.
// colspan must match the number of columns in the enclosing table.
function buildGSTFooterRows(h, colspan) {
  const grossAmt  = parseFloat(h.GrossAmt) || 0;
  const tax1Rate  = parseFloat(h.Tax1Rate) || 0;
  const tax1Amt   = parseFloat(h.Tax1Amt)  || 0;
  const tax2Rate  = parseFloat(h.Tax2Rate) || 0;
  const tax2Amt   = parseFloat(h.Tax2Amt)  || 0;
  const tax3Rate  = parseFloat(h.Tax3Rate) || 0;
  const tax3Amt   = parseFloat(h.Tax3Amt)  || 0;
  const netAmt    = parseFloat(h.NetAmt)   || 0;
  const roundOff  = parseFloat(h.RoundOff) || 0;
  const totalTax  = tax1Amt + tax2Amt + tax3Amt;
  const tax1Desc  = esc(h.Tax1Desc || 'CGST');
  const tax2Desc  = esc(h.Tax2Desc || 'SGST');
  const tax3Desc  = esc(h.Tax3Desc || 'IGST');
  const hsnCode   = esc(h.HSNCode        || '');
  const svcName   = esc(h.NameOfService  || '');
  const bankName  = esc(h.bName   || '');
  const bankAcNo  = esc(h.bAcNo   || '');
  const bankIFSC  = esc(h.bIFSC   || '');
  const bankBranch = esc(h.bBranch || '');

  const hsnTable = `
    <table class="hsn-table">
      <thead>
        <tr>
          <th rowspan="2">Sr. No.</th>
          <th rowspan="2">Name of Service</th>
          <th rowspan="2">HSN/SAC</th>
          <th rowspan="2">Taxable Value</th>
          <th colspan="2">${tax1Desc}</th>
          <th colspan="2">${tax2Desc}</th>
          <th colspan="2">${tax3Desc}</th>
          <th rowspan="2">Total Amount</th>
        </tr>
        <tr>
          <th>Rate%</th><th>Amount</th>
          <th>Rate%</th><th>Amount</th>
          <th>Rate%</th><th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="tc">1</td>
          <td>${svcName}</td>
          <td class="tc">${hsnCode}</td>
          <td class="tr">${printFmt(grossAmt)}</td>
          <td class="tc">${printFmt(tax1Rate, 2)}%</td>
          <td class="tr">${printFmt(tax1Amt)}</td>
          <td class="tc">${printFmt(tax2Rate, 2)}%</td>
          <td class="tr">${printFmt(tax2Amt)}</td>
          <td class="tc">${printFmt(tax3Rate, 2)}%</td>
          <td class="tr">${printFmt(tax3Amt)}</td>
          <td class="tr">${printFmt(netAmt)}</td>
        </tr>
      </tbody>
    </table>`;

  const bankInfo = bankName
    ? `<br><br><strong>Bank Details :</strong><br>
       Bank : ${bankName}<br>
       A/c No. : ${bankAcNo}<br>
       IFSC Code : ${bankIFSC}<br>
       Branch : ${bankBranch}`
    : '';

  const amountWordsSection = `
    <div class="words-wrap">
      <div class="words-l">
        <strong>Total Invoice Amount in words</strong><br>
        Rs. ${esc(amountToWords(netAmt))}
        ${bankInfo}
      </div>
      <div class="words-r">
        <table>
          <tr><td>Total Invoice Before Tax</td><td>:</td><td class="tr">${printFmt(grossAmt)}</td></tr>
          <tr><td>Add: ${tax1Desc} @ ${printFmt(tax1Rate, 2)}%</td><td>:</td><td class="tr">${printFmt(tax1Amt)}</td></tr>
          <tr><td>Add: ${tax2Desc} @ ${printFmt(tax2Rate, 2)}%</td><td>:</td><td class="tr">${printFmt(tax2Amt)}</td></tr>
          <tr><td>Add: ${tax3Desc} @ ${printFmt(tax3Rate, 2)}%</td><td>:</td><td class="tr">${printFmt(tax3Amt)}</td></tr>
          <tr><td>Tax Amount : GST</td><td>:</td><td class="tr">${printFmt(totalTax)}</td></tr>
          <tr><td>Rounding off</td><td>:</td><td class="tr">${roundOff ? printFmt(roundOff) : ''}</td></tr>
          <tr class="bold"><td>Total Amount After Tax</td><td>:</td><td class="tr">${printFmt(netAmt)}</td></tr>
        </table>
      </div>
    </div>`;

  const termsSection = `
    <div class="terms-box">
      <strong>Terms &amp; Conditions :</strong>
      <ol style="margin:4px 0 0 20px; padding:0; line-height:1.6;">
        <li>Payment should be made within 7 days from the date of Invoice.</li>
        <li>Cheque / D.D. / RTGS / NEFT should be drawn in favour of &quot;Aditya Services&quot;.</li>
        <li>Interest @ 24% p.a. will be charged on overdue amounts.</li>
        <li>Subject to Mumbai Jurisdiction only.</li>
      </ol>
    </div>`;

  const sigSection = `
    <div class="sig-row">
      <div>E &amp; O.E.</div>
      <div class="sig-right">
        For Aditya Services<br><br><br>
        Authorised Signature
      </div>
    </div>`;

  return `
    <tr>
      <td colspan="${colspan}" style="text-align:right; font-weight:bold; border-top:2px solid #000;">Total Amount</td>
      <td class="tr bold">${printFmt(grossAmt)}</td>
    </tr>
    <tr style="page-break-inside:avoid;">
      <td colspan="${colspan + 1}" class="no-bd">
        ${hsnTable}
        ${amountWordsSection}
        ${termsSection}
        ${sigSection}
      </td>
    </tr>`;
}

// â”€â”€ GR Main Bill (GST era â€” on/after 1-Jul-2017) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Three layouts depending on row types:
//   Only SPC  â†’ 2-col table: Particulars | Amount
//   Pkg + SPC â†’ 8-col table: lot rows first, then space row spanning 7 cols
//   Only Pkg  â†’ 8-col table: lot rows only (unchanged)
function buildGRMainGSTHTML(billMap, ltrHtml) {
  const parts = [];
  for (const [, rows] of billMap) {
    const h = rows[0];
    const compGST    = esc(h.BillGSTNo || h.CompGST || '');
    const compState  = esc(h.CompStateName || '');
    const compCode   = esc(h.CompStateCode  || '');
    const partyGST   = esc(h.PartyGSTNo     || '');
    const partyState = esc(h.PartyStateName || '');
    const partyCode  = esc(h.PartyStateCode || '');

    const pkgRows = rows.filter(r => (r.iType || '').toUpperCase() !== 'SPC');
    const spcRows = rows.filter(r => (r.iType || '').toUpperCase() === 'SPC');
    const hasPkg  = pkgRows.length > 0;
    const hasSpc  = spcRows.length > 0;

    const lh = ltrHtml;

    // Header box is identical in all layouts; only the colspan differs
    const totalCols = hasPkg ? 8 : 2;
    const headerHTML = `<td colspan="${totalCols}" class="no-bd">
      <div class="ti-box">
        <div class="ti-title">TAX  INVOICE</div>
        <div class="ti-info">
          <div class="ti-left">
            State : ${compState} &nbsp;&nbsp;&nbsp; State Code : ${compCode}<br>
            Reverse Charges : NO
          </div>
          <div class="ti-right">
            GSTIN : ${compGST}<br>
            Invoice No. : <strong>${esc(h.BillNum)}</strong><br>
            Invoice Date : ${printDate(h.BillDt)}
          </div>
        </div>
      </div>
      <div class="party-box">
        <div class="party-left">
          <strong>M/S ${esc(h.pName)}</strong><br>
          ${esc(h.pBillAdd || '')}
        </div>
        <div class="party-right">
          GSTIN : ${partyGST}<br>
          State : ${partyState} &nbsp; State Code : ${partyCode}
        </div>
      </div>
    </td>`;

    if (!hasPkg && hasSpc) {
      // â”€â”€ Only Space rows: 2-column layout (Particulars | Amount) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const spcDetailHTML = spcRows.map(r => {
        const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
        return `<tr>
          <td>${esc(spcDesc(r))}</td>
          <td class="tr">${printFmt(rowAmt, 2)}</td>
        </tr>`;
      }).join('');

      parts.push(`<div class="bill-section">
${lh}
<table style="width:100%;border-collapse:collapse;">
  <thead>
    <tr>${headerHTML}</tr>
    <tr>
      <th style="width:85%;">Particulars</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>
    ${spcDetailHTML}
    ${buildGSTFooterRows(h, 1)}
  </tbody>
</table>
</div>`);

    } else {
      // â”€â”€ Package rows (with or without space rows at bottom): 8-column layout â”€
      const pkgDetailHTML = pkgRows.map(r => {
        const rowAmt   = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
        const lotLabel = `${esc(r.LotNum)}`;
        return `<tr>
          <td class="tc">${lotLabel}</td>
          <td>${esc(r.iName)}</td>
          <td class="tc">${printDate(r.OriTransDt)}<br>${printFmt(r.OriTransQty, 0)} ${esc(r.Packing)}</td>
          <td class="tc">${printDate(r.FromDt)}</td>
          <td class="tc">${printDate(r.ToDt)}</td>
          <td class="tc">${printFmt(r.BalQty, 2)}</td>
          <td class="tr">${printFmt(r.BillRate, 2)}</td>
          <td class="tr">${printFmt(rowAmt, 2)}</td>
        </tr>`;
      }).join('');

      // Space rows at the bottom: description spans 7 cols, amount in col 8
      const spcDetailHTML = spcRows.map(r => {
        const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
        return `<tr>
          <td colspan="7">${esc(spcDesc(r))}</td>
          <td class="tr">${printFmt(rowAmt, 2)}</td>
        </tr>`;
      }).join('');

      parts.push(`<div class="bill-section">
${lh}
<table style="width:100%;border-collapse:collapse;">
  <thead>
    <tr>${headerHTML}</tr>
    <tr>
      <th>Lot No.</th>
      <th>Item Name</th>
      <th>Arrival Date<br>/ Quantity</th>
      <th>From Date</th>
      <th>To Date</th>
      <th>Goods Billed</th>
      <th>Rate</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>
    ${pkgDetailHTML}
    ${spcDetailHTML}
    ${buildGSTFooterRows(h, 7)}
  </tbody>
</table>
</div>`);
    }
  }
  return parts.join('\n');
}

// â”€â”€ GR Bill Statement (GST era) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildGRStatementGSTHTML(billMap, ltrHtml, compID = '') {
  const SMON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // DD-Mon-YYYY for bill header (e.g. 15-Jun-2026)
  function hdrDt(d) {
    const dt = d instanceof Date ? d : new Date((d || '') + 'T00:00:00');
    if (!d || isNaN(dt)) return '';
    return `${String(dt.getDate()).padStart(2,'0')}-${SMON[dt.getMonth()]}-${dt.getFullYear()}`;
  }

  // DD/MM/YY for data rows (e.g. 04/04/14)
  function rDt(d) {
    const dt = d instanceof Date ? d : new Date((d || '') + 'T00:00:00');
    if (!d || isNaN(dt)) return '';
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
  }

  // Plain fixed-point, no commas (for row amounts and subtotal)
  function sfmt(n, dec = 2) { return (parseFloat(n) || 0).toFixed(dec); }

  // Western comma format for net total (e.g. 238,919.32)
  function netFmt(n) {
    return (parseFloat(n) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  const sections = [];

  for (const [, rows] of billMap) {
    const h        = rows[0];
    const cCode    = esc(h.fkCompID || compID || '');
    const partyGST = esc(h.PartyGSTNo || '');
    const gstFlag  = partyGST ? 'Y' : 'N';
    const addr     = esc((h.pBillAdd || '').replace(/[\r\n\t]+/g, ' ').trim());

    const detailHTML = rows.map(r => {
      const rowAmt  = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
      const oq      = parseFloat(r.OriTransQty) || 0;
      const arrQty  = `${oq % 1 === 0 ? Math.round(oq) : oq.toFixed(2)}${esc(r.Packing || '')}`;
      return `<tr>
        <td class="gs-lot">${esc(r.LotNum)}</td>
        <td class="gs-iname">${esc([r.iName, r.ItemExtDesc].filter(Boolean).join(' '))}</td>
        <td class="gs-dt">${rDt(r.OriTransDt)}</td>
        <td class="gs-arrq">${arrQty}</td>
        <td class="gs-wght">${sfmt(r.PackWght)}</td>
        <td class="gs-dt">${rDt(r.FromDt)}</td>
        <td class="gs-dt">${rDt(r.ToDt)}</td>
        <td class="gs-bq">${sfmt(r.BalQty)}</td>
        <td class="gs-rate">${sfmt(r.BillRate)}</td>
        <td class="gs-ramt">${sfmt(rowAmt)}</td>
      </tr>`;
    }).join('');

    const t1r = sfmt(h.Tax1Rate); const t1a = sfmt(h.Tax1Amt);
    const t2r = sfmt(h.Tax2Rate); const t2a = sfmt(h.Tax2Amt);
    const t3r = sfmt(h.Tax3Rate); const t3a = sfmt(h.Tax3Amt);

    sections.push(`
<div class="gs-block">
  <table class="gs-hdr-tbl">
    <tr>
      <td class="gs-pname"><em>M/S</em>&nbsp;&nbsp;<strong>${esc(h.pName)}</strong></td>
      <td class="gs-bdt">Bill Dt &nbsp;: &nbsp;${hdrDt(h.BillDt)}</td>
      <td class="gs-bno">Bill No. : &nbsp;${esc(h.BillNum)}</td>
      <td class="gs-ccode">${cCode}</td>
    </tr>
    <tr>
      <td class="gs-addr" colspan="2">${addr}&nbsp;&nbsp;&nbsp;${partyGST}</td>
      <td class="gs-bqhdr">Balance<br>Quantity</td>
      <td class="gs-gflag">${gstFlag}</td>
    </tr>
  </table>
  <table class="gs-data">
    <thead><tr>
      <th class="gs-lot">Lot No.</th>
      <th class="gs-iname">Item Name</th>
      <th class="gs-dt">Arrival<br>Date</th>
      <th class="gs-arrq">Arrival Quantity</th>
      <th class="gs-wght">Wght</th>
      <th class="gs-dt">From Date</th>
      <th class="gs-dt">To Date</th>
      <th class="gs-bq">&nbsp;</th>
      <th class="gs-rate">Rate</th>
      <th class="gs-ramt">Amount</th>
    </tr></thead>
    <tbody>
      ${detailHTML}
      <tr class="gs-sub">
        <td colspan="9"></td>
        <td class="gs-ramt">${sfmt(h.GrossAmt)}</td>
      </tr>
      <tr class="gs-tax">
        <td colspan="9" class="gs-taxtext">+${t1r}&nbsp;${t1a}&nbsp;&nbsp;+${t2r}&nbsp;${t2a}&nbsp;&nbsp;+${t3r}&nbsp;${t3a}</td>
        <td class="gs-net">${netFmt(h.NetAmt)}</td>
      </tr>
    </tbody>
  </table>
</div>`);
  }

  const today   = new Date();
  const todayStr = printDate(
    `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  );

  return `<div>${sections.join('\n')}<div class="print-footer">Print on ${todayStr}</div></div>`;
}

// â”€â”€ Hamali Main Bill â€” GST era (page-fixed A4 standalone document) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateHMMainGSTDoc(billMap, ltrHtml) {
  const ROWS_NON_LAST = 25;
  const ROWS_LAST = 13;
  const MAX_LAST = 13;

  const css = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; }
  .no-print { margin-bottom:8px; text-align:center; }
  .page {
    position:relative;
    width:595pt;
    height:841pt;
    margin:0 auto;
    page-break-after:always;
    overflow:hidden;
    background:#fff;
    font-size:8pt;
  }
  .page:last-child { page-break-after:auto; }
  .header-space { height:148.5pt; }
  .header-space-img { padding-top:8pt; padding-bottom:6pt; }
  .header-space-img img { width:100%; height:auto; display:block; }
  .invoice-box {
    position:relative;
    margin-left:53.7pt;
    width:522.5pt;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
  }
  .invoice-box:not(.page6-box) { height:692.5pt; border-bottom:0.7pt solid #000; overflow:hidden; }
  table { border-collapse:collapse; table-layout:fixed; width:100%; }
  .invoice-meta {
    width:100%;
    border-collapse:collapse;
    border:0.7pt solid #000;
    table-layout:fixed;
    font-size:8pt;
  }
  .invoice-meta td {
    border:0.7pt solid #000;
    padding:2.5pt 7pt;
    vertical-align:middle;
    line-height:1.1;
  }
  .invoice-meta .title-row td {
    height:20pt;
    text-align:center;
    font-size:10pt;
    font-weight:bold;
    padding:2pt;
  }
  .invoice-meta .party-row td {
    height:59pt;
    vertical-align:top;
    padding-top:6pt;
    line-height:1.25;
    white-space:normal;
  }
  .invoice-meta .party-row td:first-child { width:51.5%; }
  .invoice-meta .party-row td:last-child { width:48.5%; }
  .invoice-meta .label-cell { white-space:nowrap; }
  .invoice-meta .blank-cell { min-height:25pt; }
  .invoice-meta .customer-name { font-weight:bold; font-size:9pt; }
  .invoice-meta .party-right-cell { padding:0 !important; vertical-align:top; }
  .invoice-meta .party-gstin,
  .invoice-meta .party-state,
  .invoice-meta .party-empty { padding:5pt 7pt; line-height:1.25; }
  .invoice-meta .party-gstin { height:22pt; border-bottom:0.7pt solid #000; }
  .invoice-meta .party-state { height:22pt; border-bottom:0.7pt solid #000; }
  .invoice-meta .party-empty { height:15pt; }
  .items { border-top:0.7pt solid #000; border-bottom:0.7pt solid #000; }
  .items th, .items td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    padding:1.5pt 3pt;
    vertical-align:middle;
    overflow:hidden;
    white-space:nowrap;
  }
  .items th:last-child, .items td:last-child { border-right:0; }
  .items th { text-align:center; font-weight:bold; line-height:1.05; }
  .items td:nth-child(1), .items td:nth-child(2), .items td:nth-child(3),
  .items td:nth-child(4), .items td:nth-child(5), .items td:nth-child(7),
  .items td:nth-child(8) { text-align:center; }
  .items td:nth-child(3) { white-space:normal; line-height:1.1; }
  .items td:nth-child(6) { text-align:left; }
  .page-number {
    position:absolute;
    right:5pt;
    bottom:3pt;
    font-size:8pt;
    white-space:nowrap;
  }
  .page6-box {
    height:678pt;
    display:flex;
    flex-direction:column;
  }
  .page6-box .items { border-bottom:0; }
  .page6-spacer { flex:1; min-height:0; }
  .gross-amount-line { border-top:0.7pt solid #000; position:relative; height:20pt; }
  .gross-amount-line span { position:absolute; right:2pt; top:3pt; }
  .tax-summary { border:0.7pt solid #000; font-size:7.2pt; }
  .tax-summary th, .tax-summary td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    text-align:center;
    padding:1pt 2pt;
    line-height:1.05;
    overflow:hidden;
  }
  .tax-summary th:last-child, .tax-summary td:last-child { border-right:0; border-left:0.7pt solid #000; }
  .tax-head { height:14pt; }
  .tax-subhead { height:13pt; }
  .tax-data { height:14pt; }
  .tax-data td:nth-child(2) { text-align:left; }
  .amount-summary {
    width:100%;
    border-collapse:collapse;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    font-size:8pt;
    table-layout:fixed;
  }
  .amount-summary td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    padding:2.5pt 5pt;
    height:15pt;
    vertical-align:middle;
  }
  .amount-summary td:last-child { border-right:0; text-align:right; }
  .amount-summary td:nth-child(2) { width:125pt; }
  .amount-summary td:nth-child(3) { width:68pt; }
  .amount-summary .words {
    width:264pt;
    vertical-align:top;
    text-align:left;
    line-height:1.25;
    padding-top:3pt;
  }
  .footer-separator { width:100%; height:9pt; border-top:0.7pt solid #000; border-bottom:0.7pt solid #000; }
  .terms-sign {
    width:100%;
    border-collapse:collapse;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    table-layout:fixed;
    font-size:8pt;
  }
  .terms-sign td {
    height:65pt;
    vertical-align:top;
    padding:5pt;
    border-right:0.7pt solid #000;
    position:relative;
  }
  .terms-sign td:last-child { border-right:0; }
  .terms { width:50%; line-height:1.45; }
  .sign { width:50%; line-height:1.25; }
  .terms-title, .sign-title { font-weight:bold; margin-bottom:3pt; }
  .terms-title { font-size:8.5pt; }
  .sign-title { font-size:9pt; }
  .eoe { position:absolute; right:7pt; bottom:4pt; }
  .signature { position:absolute; left:7pt; bottom:4pt; }
  @media screen {
    body { background:#ddd; padding:12px 0; }
    .page { margin:0 auto 12px auto; box-shadow:0 0 6px rgba(0,0,0,.25); }
  }
  @media print {
    body { background:#fff; }
    .page { margin:0; box-shadow:none; }
    .no-print { display:none !important; }
  }`;

  const colgroup = `<colgroup>
      <col style="width:60px"><col style="width:55px"><col style="width:55px">
      <col style="width:70px"><col style="width:47.5px"><col style="width:127.5px">
      <col style="width:40px"><col style="width:67.5px">
    </colgroup>`;

  const thead = `<thead>
      <tr style="height:30pt">
        <th>Date</th><th>Lot No.</th><th>Loading/<br>Unloading</th>
        <th>Quantity</th><th>Weight<br>(Kg)</th><th>Item Name</th>
        <th>Rate</th><th>Amount</th>
      </tr>
    </thead>`;

  const isImg = ltrHtml.trimStart().startsWith('<img');
  const headerInner = isImg ? ltrHtml : '';

  const allPageDivs = [];

  for (const [, rows] of billMap) {
    const h = rows[0];

    const compGST    = esc(h.CompRegGSTNum || h.CompGST || h.BillGSTNo || '');
    const compState  = esc(h.CompStateName || '');
    const compCode   = esc(h.CompStateCode || '');
    const partyGST   = esc(h.PartyGSTNo || '');
    const partyState = esc(h.PartyStateName || '');
    const partyCode  = esc(h.PartyStateCode || '');
    const rawCompName = (h.CompName || '').trim().toUpperCase();
    const compForSign = (rawCompName === 'TEST' || rawCompName === 'TEST1')
      ? '' : esc(h.CompName || '');

    const grossAmt = parseFloat(h.GrossAmt) || 0;
    const tax1Rate = parseFloat(h.Tax1Rate) || 0;
    const tax1Amt  = parseFloat(h.Tax1Amt)  || 0;
    const tax2Rate = parseFloat(h.Tax2Rate) || 0;
    const tax2Amt  = parseFloat(h.Tax2Amt)  || 0;
    const tax3Rate = parseFloat(h.Tax3Rate) || 0;
    const tax3Amt  = parseFloat(h.Tax3Amt)  || 0;
    const netAmt   = parseFloat(h.NetAmt)   || 0;
    const roundOff = parseFloat(h.RoundOff) || 0;
    const totalTax = tax1Amt + tax2Amt + tax3Amt;
    const tax1Desc = esc(h.Tax1Desc || 'CGST');
    const tax2Desc = esc(h.Tax2Desc || 'SGST');
    const tax3Desc = esc(h.Tax3Desc || 'IGST');
    const hsnCode  = esc(h.HSNCode || '');
    const svcName  = esc(h.NameOfService || '');
    const bankName   = esc(h.bName || '');
    const bankAcNo   = esc(h.bAcNo || '');
    const bankIFSC   = esc(h.bIFSC || '');
    const bankBranch = esc(h.bBranch || '');

    // Chunk rows: last page reserves ROWS_LAST slots for the footer section
    let chunks;
    if (rows.length <= MAX_LAST) {
      chunks = [rows];
    } else {
      chunks = [];
      let ci = 0;
      while (rows.length - ci > MAX_LAST) {
        const take = Math.min(ROWS_NON_LAST, rows.length - ci);
        chunks.push(rows.slice(ci, ci + take));
        ci += take;
      }
      chunks.push(rows.slice(ci)); // may be empty — last page shows only tax summary
    }

    const totalPages = chunks.length;

    const metaHTML = `<table class="invoice-meta">
        <tr class="title-row"><td colspan="2">TAX INVOICE</td></tr>
        <tr>
          <td class="label-cell">State : ${compState}&nbsp;&nbsp;&nbsp;&nbsp; State Code : ${compCode}</td>
          <td class="label-cell">GSTIN No. : ${compGST}</td>
        </tr>
        <tr>
          <td class="label-cell">Reverse Charges : No</td>
          <td class="label-cell">Invoice No. : &nbsp;<b>${esc(h.BillNum)}</b></td>
        </tr>
        <tr>
          <td class="blank-cell"></td>
          <td class="label-cell">Invoice Date : ${printDate(h.BillDt)}</td>
        </tr>
        <tr class="party-row">
          <td>
            <div class="customer-name">M/S ${esc(h.pName)}</div>
            ${esc(h.pBillAdd || '').replace(/\n/g, '<br>')}
          </td>
          <td class="party-right-cell">
            <div class="party-gstin">GSTIN No. : ${partyGST}</div>
            <div class="party-state">State : ${partyState}&nbsp;&nbsp;&nbsp;&nbsp; State Code : ${partyCode}</div>
            <div class="party-empty"></div>
          </td>
        </tr>
      </table>`;

    chunks.forEach((chunk, idx) => {
      const isLast = idx === totalPages - 1;
      const pageNum = idx + 1;

      const rowsHTML = chunk.map(r => {
        const isGen = r.BillDesc2 && r.BillDesc2.trim();
        if (isGen) {
          return `<tr style="height:20pt"><td></td><td></td><td></td><td></td><td></td><td>${esc(r.BillDesc2)}</td><td></td><td>${(parseFloat(r.Amount) || 0).toFixed(2)}</td></tr>`;
        }
        const luFlag = esc(r.HamaliFlg || '');
        const qty = `${(parseFloat(r.TransQty) || 0).toFixed(2)}${esc(r.Packing || '')}`;
        return `<tr style="height:20pt"><td>${printDate(r.RecdDt)}</td><td>${esc(r.LotNum)}</td><td>${luFlag}</td><td>${qty}</td><td>${(parseFloat(r.PackWght) || 0).toFixed(2)}</td><td>${esc(r.iName)}</td><td>${(parseFloat(r.BillRate) || 0).toFixed(2)}</td><td>${(parseFloat(r.Amount) || 0).toFixed(2)}</td></tr>`;
      }).join('');

      let lastPageFooter = '';
      if (isLast) {
        const bankTerm = bankName
          ? `Bank Name: ${bankName}, A/C No: ${bankAcNo}, IFSC: ${bankIFSC}, Branch: ${bankBranch}.`
          : '';

        lastPageFooter = `
          <div class="gross-amount-line"><span>${printFmt(grossAmt)}</span></div>
          <table class="tax-summary">
            <colgroup>
              <col style="width:29px"><col style="width:151px"><col style="width:54px">
              <col style="width:57px"><col style="width:39px"><col style="width:60px">
              <col style="width:39px"><col style="width:60px">
              <col style="width:39px"><col style="width:60px"><col style="width:68px">
            </colgroup>
            <tr class="tax-head">
              <th rowspan="2">Sr.<br>No.</th>
              <th rowspan="2">Name of Service</th>
              <th rowspan="2">HSN/<br>SAC</th>
              <th rowspan="2">Taxable<br>Value</th>
              <th colspan="2">${tax1Desc}</th>
              <th colspan="2">${tax2Desc}</th>
              <th colspan="2">${tax3Desc}</th>
              <th rowspan="2">Total<br>Amount</th>
            </tr>
            <tr class="tax-subhead">
              <th>Rate</th><th>Amount</th>
              <th>Rate</th><th>Amount</th>
              <th>Rate</th><th>Amount</th>
            </tr>
            <tr class="tax-data">
              <td>1</td><td>${svcName}</td><td>${hsnCode}</td>
              <td>${grossAmt.toFixed(2)}</td>
              <td>${tax1Rate.toFixed(2)}</td><td>${tax1Amt.toFixed(2)}</td>
              <td>${tax2Rate.toFixed(2)}</td><td>${tax2Amt.toFixed(2)}</td>
              <td>${tax3Rate.toFixed(2)}</td><td>${tax3Amt.toFixed(2)}</td>
              <td>${netAmt.toFixed(2)}</td>
            </tr>
          </table>
          <table class="amount-summary">
            <tr>
              <td rowspan="6" class="words"><b>Total Invoice Amount in Words</b><br><br>Rs.&nbsp;${esc(amountToWords(netAmt))}</td>
              <td>Total Amount Before Tax</td><td>${printFmt(grossAmt)}</td>
            </tr>
            <tr><td>Add: ${tax1Desc} @ ${tax1Rate.toFixed(2)}%</td><td>${printFmt(tax1Amt)}</td></tr>
            <tr><td>Add: ${tax2Desc} @ ${tax2Rate.toFixed(2)}%</td><td>${printFmt(tax2Amt)}</td></tr>
            <tr><td>Add: ${tax3Desc} @ ${tax3Rate.toFixed(2)}%</td><td>${printFmt(tax3Amt)}</td></tr>
            <tr><td>Tax Amount : GST</td><td>${printFmt(totalTax)}</td></tr>
            <tr><td>Rounding off</td><td>${printFmt(roundOff)}</td></tr>
            <tr>
              <td class="words"></td>
              <td><b>Total Amount After Tax</b></td>
              <td><b>${printFmt(netAmt)}</b></td>
            </tr>
          </table>
          <div class="footer-separator"></div>
          <table class="terms-sign">
            <colgroup><col style="width:50%;"><col style="width:50%;"></colgroup>
            <tr>
              <td class="terms">
                <div class="terms-title">Terms and Conditions</div>
                <div>1. Subject to Mumbai Jurisdiction</div>
                ${bankTerm ? `<div>2. ${bankTerm}</div>` : ''}
                <div class="eoe">E &amp; O.E.</div>
              </td>
              <td class="sign">
                <div class="sign-title">${compForSign ? `For ${compForSign}` : ''}</div>
                <div class="signature">Authorised Signeture</div>
              </td>
            </tr>
          </table>`;
      }

      allPageDivs.push(`<div class="page">
          <div class="${isImg ? 'header-space-img' : 'header-space'}">${headerInner}</div>
          <div class="invoice-box${isLast ? ' page6-box' : ''}">
            ${metaHTML}
            ${chunk.length > 0 ? `<table class="items">
              ${colgroup}
              ${thead}
              <tbody>${rowsHTML}</tbody>
            </table>` : ''}
            ${isLast ? '<div class="page6-spacer"></div>' : ''}
            ${lastPageFooter}
          </div>
          <div class="page-number">Page ${pageNum} of ${totalPages}</div>
        </div>`);
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GMS Bill</title>
<style>${css}</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
${allPageDivs.join('\n')}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

// â”€â”€ Godown Rent Main Bill â€” GST era (page-fixed A4 standalone document) â”€â”€â”€â”€â”€â”€
function generateGRMainGSTDoc(billMap, ltrHtml) {
  const ROWS_NON_LAST = 24;
  const ROWS_LAST = 10;
  const MAX_LAST = 13; // last page can absorb up to this many rows along with tax summary

  // Shared CSS â€” identical to HM bill page structure
  const css = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; }
  .no-print { margin-bottom:8px; text-align:center; }
  .page {
    position:relative;
    width:595pt;
    height:841pt;
    margin:0 auto;
    page-break-after:always;
    overflow:hidden;
    background:#fff;
    font-size:8pt;
  }
  .page:last-child { page-break-after:auto; }
  .header-space { height:148.5pt; }
  .header-space-img { padding-top:8pt; padding-bottom:6pt; }
  .header-space-img img { width:100%; height:auto; display:block; }
  .invoice-box {
    position:relative;
    margin-left:53.7pt;
    width:522.5pt;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
  }
  .invoice-box:not(.page6-box) { height:692.5pt; border-bottom:0.7pt solid #000; overflow:hidden; }
  table { border-collapse:collapse; table-layout:fixed; width:100%; }
  .invoice-meta {
    width:100%;
    border-collapse:collapse;
    border:0.7pt solid #000;
    table-layout:fixed;
    font-size:8pt;
  }
  .invoice-meta td {
    border:0.7pt solid #000;
    padding:2.5pt 7pt;
    vertical-align:middle;
    line-height:1.1;
  }
  .invoice-meta .title-row td {
    height:20pt;
    text-align:center;
    font-size:10pt;
    font-weight:bold;
    padding:2pt;
  }
  .invoice-meta .party-row td {
    height:59pt;
    vertical-align:top;
    padding-top:6pt;
    line-height:1.25;
    white-space:normal;
  }
  .invoice-meta .party-row td:first-child { width:51.5%; }
  .invoice-meta .party-row td:last-child { width:48.5%; }
  .invoice-meta .label-cell { white-space:nowrap; }
  .invoice-meta .blank-cell { min-height:25pt; }
  .invoice-meta .customer-name { font-weight:bold; font-size:9pt; }
  .invoice-meta .party-right-cell { padding:0 !important; vertical-align:top; }
  .invoice-meta .party-gstin,
  .invoice-meta .party-state,
  .invoice-meta .party-empty { padding:5pt 7pt; line-height:1.25; }
  .invoice-meta .party-gstin { height:22pt; border-bottom:0.7pt solid #000; }
  .invoice-meta .party-state { height:22pt; border-bottom:0.7pt solid #000; }
  .invoice-meta .party-empty { height:15pt; }
  .items { border-top:0.7pt solid #000; border-bottom:0.7pt solid #000; }
  .items th, .items td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    padding:1.5pt 3pt;
    vertical-align:middle;
    overflow:hidden;
    white-space:nowrap;
  }
  .items th:last-child, .items td:last-child { border-right:0; }
  .items th { text-align:center; font-weight:bold; line-height:1.05; }
  .page-number {
    position:absolute;
    right:5pt;
    bottom:3pt;
    font-size:8pt;
    white-space:nowrap;
  }
  .page6-box {
    height:678pt;
    display:flex;
    flex-direction:column;
  }
  .page6-box .items { border-bottom:0; }
  .page6-spacer { flex:1; min-height:0; }
  .gross-amount-line { border-top:0.7pt solid #000; position:relative; height:20pt; }
  .gross-amount-line span { position:absolute; right:2pt; top:3pt; }
  .tax-summary { border:0.7pt solid #000; font-size:7.2pt; }
  .tax-summary th, .tax-summary td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    text-align:center;
    padding:1pt 2pt;
    line-height:1.05;
    overflow:hidden;
  }
  .tax-summary th:last-child, .tax-summary td:last-child { border-right:0; border-left:0.7pt solid #000; }
  .tax-head { height:14pt; }
  .tax-subhead { height:13pt; }
  .tax-data { height:14pt; }
  .tax-data td:nth-child(2) { text-align:left; }
  .amount-summary {
    width:100%;
    border-collapse:collapse;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    font-size:8pt;
    table-layout:fixed;
  }
  .amount-summary td {
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    padding:2.5pt 5pt;
    height:15pt;
    vertical-align:middle;
  }
  .amount-summary td:last-child { border-right:0; text-align:right; }
  .amount-summary td:nth-child(2) { width:125pt; }
  .amount-summary td:nth-child(3) { width:68pt; }
  .amount-summary .words {
    width:264pt;
    vertical-align:top;
    text-align:left;
    line-height:1.25;
    padding-top:3pt;
  }
  .footer-separator { width:100%; height:9pt; border-top:0.7pt solid #000; border-bottom:0.7pt solid #000; }
  .terms-sign {
    width:100%;
    border-collapse:collapse;
    border-left:0.7pt solid #000;
    border-right:0.7pt solid #000;
    border-bottom:0.7pt solid #000;
    table-layout:fixed;
    font-size:8pt;
  }
  .terms-sign td {
    height:65pt;
    vertical-align:top;
    padding:5pt;
    border-right:0.7pt solid #000;
    position:relative;
  }
  .terms-sign td:last-child { border-right:0; }
  .terms { width:50%; line-height:1.45; }
  .sign { width:50%; line-height:1.25; }
  .terms-title, .sign-title { font-weight:bold; margin-bottom:3pt; }
  .terms-title { font-size:8.5pt; }
  .sign-title { font-size:9pt; }
  .eoe { position:absolute; right:7pt; bottom:4pt; }
  .signature { position:absolute; left:7pt; bottom:4pt; }
  @media screen {
    body { background:#ddd; padding:12px 0; }
    .page { margin:0 auto 12px auto; box-shadow:0 0 6px rgba(0,0,0,.25); }
  }
  @media print {
    body { background:#fff; }
    .page { margin:0; box-shadow:none; }
    .no-print { display:none !important; }
  }`;

  const isImg = ltrHtml.trimStart().startsWith('<img');
  const headerInner = isImg ? ltrHtml : '';

  // 8-column colgroup + thead (pkg layout)
  const pkgColgroup = `<colgroup>
      <col style="width:55px"><col style="width:120px"><col style="width:70px">
      <col style="width:58px"><col style="width:58px"><col style="width:50px">
      <col style="width:43px"><col style="width:68.5px">
    </colgroup>`;
  const pkgThead = `<thead>
      <tr style="height:30pt">
        <th>Lot No.</th><th>Item Name</th><th>Arrival Date<br>/ Quantity</th>
        <th>From Date</th><th>To Date</th><th>Goods<br>Billed</th>
        <th>Rate</th><th>Amount</th>
      </tr>
    </thead>`;

  // 2-column colgroup + thead (SPC-only layout)
  const spcColgroup = `<colgroup>
      <col style="width:454px"><col style="width:68.5px">
    </colgroup>`;
  const spcThead = `<thead>
      <tr style="height:30pt">
        <th>Particulars</th><th>Amount</th>
      </tr>
    </thead>`;

  const allPageDivs = [];

  for (const [, rows] of billMap) {
    const h = rows[0];

    const compGST    = esc(h.CompRegGSTNum || h.CompGST || h.BillGSTNo || '');
    const compState  = esc(h.CompStateName || '');
    const compCode   = esc(h.CompStateCode || '');
    const partyGST   = esc(h.PartyGSTNo || '');
    const partyState = esc(h.PartyStateName || '');
    const partyCode  = esc(h.PartyStateCode || '');

    const rawCompName = (h.CompName || '').trim().toUpperCase();
    const compForSign = (rawCompName === 'TEST' || rawCompName === 'TEST1')
      ? '' : esc(h.CompName || '');

    const grossAmt = parseFloat(h.GrossAmt) || 0;
    const tax1Rate = parseFloat(h.Tax1Rate) || 0;
    const tax1Amt  = parseFloat(h.Tax1Amt)  || 0;
    const tax2Rate = parseFloat(h.Tax2Rate) || 0;
    const tax2Amt  = parseFloat(h.Tax2Amt)  || 0;
    const tax3Rate = parseFloat(h.Tax3Rate) || 0;
    const tax3Amt  = parseFloat(h.Tax3Amt)  || 0;
    const netAmt   = parseFloat(h.NetAmt)   || 0;
    const roundOff = parseFloat(h.RoundOff) || 0;
    const totalTax = tax1Amt + tax2Amt + tax3Amt;
    const tax1Desc = esc(h.Tax1Desc || 'CGST');
    const tax2Desc = esc(h.Tax2Desc || 'SGST');
    const tax3Desc = esc(h.Tax3Desc || 'IGST');
    const hsnCode  = esc(h.HSNCode || '');
    const svcName  = esc(h.NameOfService || '');
    const bankName   = esc(h.bName || '');
    const bankAcNo   = esc(h.bAcNo || '');
    const bankIFSC   = esc(h.bIFSC || '');
    const bankBranch = esc(h.bBranch || '');

    const pkgRows = rows.filter(r => (r.iType || '').toUpperCase() !== 'SPC');
    const spcRows = rows.filter(r => (r.iType || '').toUpperCase() === 'SPC');
    const hasPkg  = pkgRows.length > 0;
    const allRows = hasPkg ? [...pkgRows, ...spcRows] : spcRows;

    // Chunk rows across pages
    let chunks;
    if (allRows.length <= MAX_LAST) {
      chunks = [allRows];
    } else {
      chunks = [];
      let ci = 0;
      while (allRows.length - ci > MAX_LAST) {
        const take = Math.min(ROWS_NON_LAST, allRows.length - ci);
        chunks.push(allRows.slice(ci, ci + take));
        ci += take;
      }
      chunks.push(allRows.slice(ci)); // may be empty — last page shows only tax summary
    }

    const totalPages = chunks.length;

    const metaHTML = `<table class="invoice-meta">
        <tr class="title-row"><td colspan="2">TAX INVOICE</td></tr>
        <tr>
          <td class="label-cell">State : ${compState}&nbsp;&nbsp;&nbsp;&nbsp; State Code : ${compCode}</td>
          <td class="label-cell">GSTIN No. : ${compGST}</td>
        </tr>
        <tr>
          <td class="label-cell">Reverse Charges : No</td>
          <td class="label-cell">Invoice No. : &nbsp;<b>${esc(h.BillNum)}</b></td>
        </tr>
        <tr>
          <td class="blank-cell"></td>
          <td class="label-cell">Invoice Date : ${printDate(h.BillDt)}</td>
        </tr>
        <tr class="party-row">
          <td>
            <div class="customer-name">M/S ${esc(h.pName)}</div>
            ${esc(h.pBillAdd || '').replace(/\n/g, '<br>')}
          </td>
          <td class="party-right-cell">
            <div class="party-gstin">GSTIN No. : ${partyGST}</div>
            <div class="party-state">State : ${partyState}&nbsp;&nbsp;&nbsp;&nbsp; State Code : ${partyCode}</div>
            <div class="party-empty"></div>
          </td>
        </tr>
      </table>`;

    chunks.forEach((chunk, idx) => {
      const isLast  = idx === totalPages - 1;
      const pageNum = idx + 1;

      const rowsHTML = chunk.map(r => {
        const isSpc = (r.iType || '').toUpperCase() === 'SPC';
        if (hasPkg) {
          // 8-column layout
          if (isSpc) {
            const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
            return `<tr style="height:20pt"><td colspan="7" style="text-align:left">${esc(spcDesc(r))}</td><td style="text-align:right">${printFmt(rowAmt, 2)}</td></tr>`;
          }
          const rowAmt  = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
          const iName   = [r.iName, r.ItemExtDesc].filter(Boolean).join(' ');
          return `<tr style="height:20pt"><td style="text-align:center">${esc(r.LotNum)}</td><td style="text-align:left">${esc(iName)}</td><td style="text-align:center">${printDate(r.OriTransDt)}<br>${printFmt(r.OriTransQty, 0)} ${esc(r.Packing)}</td><td style="text-align:center">${printDate(r.FromDt)}</td><td style="text-align:center">${printDate(r.ToDt)}</td><td style="text-align:center">${printFmt(r.BalQty, 2)}</td><td style="text-align:right">${printFmt(r.BillRate, 2)}</td><td style="text-align:right">${printFmt(rowAmt, 2)}</td></tr>`;
        } else {
          // 2-column SPC-only layout
          const rowAmt = (parseFloat(r.BalQty) || 0) * (parseFloat(r.BillRate) || 0);
          return `<tr style="height:20pt"><td style="text-align:left">${esc(spcDesc(r))}</td><td style="text-align:right">${printFmt(rowAmt, 2)}</td></tr>`;
        }
      }).join('');

      const colgroup = hasPkg ? pkgColgroup : spcColgroup;
      const thead    = hasPkg ? pkgThead    : spcThead;

      let lastPageFooter = '';
      if (isLast) {
        const bankTerm = bankName
          ? `Bank Name: ${bankName}, A/C No: ${bankAcNo}, IFSC: ${bankIFSC}, Branch: ${bankBranch}.`
          : '';

        lastPageFooter = `
          <div class="gross-amount-line"><span>${printFmt(grossAmt)}</span></div>
          <table class="tax-summary">
            <colgroup>
              <col style="width:29px"><col style="width:151px"><col style="width:54px">
              <col style="width:57px"><col style="width:39px"><col style="width:60px">
              <col style="width:39px"><col style="width:60px">
              <col style="width:39px"><col style="width:60px"><col style="width:68px">
            </colgroup>
            <tr class="tax-head">
              <th rowspan="2">Sr.<br>No.</th>
              <th rowspan="2">Name of Service</th>
              <th rowspan="2">HSN/<br>SAC</th>
              <th rowspan="2">Taxable<br>Value</th>
              <th colspan="2">${tax1Desc}</th>
              <th colspan="2">${tax2Desc}</th>
              <th colspan="2">${tax3Desc}</th>
              <th rowspan="2">Total<br>Amount</th>
            </tr>
            <tr class="tax-subhead">
              <th>Rate</th><th>Amount</th>
              <th>Rate</th><th>Amount</th>
              <th>Rate</th><th>Amount</th>
            </tr>
            <tr class="tax-data">
              <td>1</td><td>${svcName}</td><td>${hsnCode}</td>
              <td>${grossAmt.toFixed(2)}</td>
              <td>${tax1Rate.toFixed(2)}</td><td>${tax1Amt.toFixed(2)}</td>
              <td>${tax2Rate.toFixed(2)}</td><td>${tax2Amt.toFixed(2)}</td>
              <td>${tax3Rate.toFixed(2)}</td><td>${tax3Amt.toFixed(2)}</td>
              <td>${netAmt.toFixed(2)}</td>
            </tr>
          </table>
          <table class="amount-summary">
            <tr>
              <td rowspan="6" class="words"><b>Total Invoice Amount in Words</b><br><br>Rs.&nbsp;${esc(amountToWords(netAmt))}</td>
              <td>Total Amount Before Tax</td><td>${printFmt(grossAmt)}</td>
            </tr>
            <tr><td>Add: ${tax1Desc} @ ${tax1Rate.toFixed(2)}%</td><td>${printFmt(tax1Amt)}</td></tr>
            <tr><td>Add: ${tax2Desc} @ ${tax2Rate.toFixed(2)}%</td><td>${printFmt(tax2Amt)}</td></tr>
            <tr><td>Add: ${tax3Desc} @ ${tax3Rate.toFixed(2)}%</td><td>${printFmt(tax3Amt)}</td></tr>
            <tr><td>Tax Amount : GST</td><td>${printFmt(totalTax)}</td></tr>
            <tr><td>Rounding off</td><td>${printFmt(roundOff)}</td></tr>
            <tr>
              <td class="words"></td>
              <td><b>Total Amount After Tax</b></td>
              <td><b>${printFmt(netAmt)}</b></td>
            </tr>
          </table>
          <div class="footer-separator"></div>
          <table class="terms-sign">
            <colgroup><col style="width:50%;"><col style="width:50%;"></colgroup>
            <tr>
              <td class="terms">
                <div class="terms-title">Terms and Conditions</div>
                <div>1. Subject to Mumbai Jurisdiction</div>
                ${bankTerm ? `<div>2. ${bankTerm}</div>` : ''}
                <div class="eoe">E &amp; O.E.</div>
              </td>
              <td class="sign">
                <div class="sign-title">${compForSign ? `For ${compForSign}` : ''}</div>
                <div class="signature">Authorised Signeture</div>
              </td>
            </tr>
          </table>`;
      }

      allPageDivs.push(`<div class="page">
          <div class="${isImg ? 'header-space-img' : 'header-space'}">${headerInner}</div>
          <div class="invoice-box${isLast ? ' page6-box' : ''}">
            ${metaHTML}
            ${chunk.length > 0 ? `<table class="items">
              ${colgroup}
              ${thead}
              <tbody>${rowsHTML}</tbody>
            </table>` : ''}
            ${isLast ? '<div class="page6-spacer"></div>' : ''}
            ${lastPageFooter}
          </div>
          <div class="page-number">Page ${pageNum} of ${totalPages}</div>
        </div>`);
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GMS Bill</title>
<style>${css}</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
${allPageDivs.join('\n')}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

function generatePrintHTML(rows, billType, reportType, withLetterhead, compID = '') {
  const billMap = new Map();
  for (const row of rows) {
    if (!billMap.has(row.pkBillID)) billMap.set(row.pkBillID, []);
    billMap.get(row.pkBillID).push(row);
  }

  // Compute letterhead HTML: image when checked + image found; else 4cm gap spacer
  let ltrHtml;
  if (withLetterhead) {
    const b64 = getLetterheadB64(compID);
    ltrHtml = b64
      ? `<img src="${b64}" style="width:100%;max-height:130px;object-fit:contain;object-position:center top;margin-bottom:6px;display:block;" alt="">`
      : `<div style="height:4cm;display:block;"></div>`;
  } else {
    ltrHtml = `<div style="height:4cm;display:block;"></div>`;
  }

  // Era detection: BillDt >= 2017-07-01 â†’ GST format
  const firstRow = rows[0];
  const rawDt = firstRow?.BillDt;
  const billDt = rawDt instanceof Date ? rawDt : new Date((rawDt || '') + 'T00:00:00');
  const isGST = !isNaN(billDt.getTime()) && billDt >= new Date('2017-07-01T00:00:00');

  // HM + GST main bill â†’ page-fixed standalone document
  if (billType === 'HM' && isGST) {
    return generateHMMainGSTDoc(billMap, ltrHtml);
  }
  // GR + GST main bill â†’ same page-fixed standalone document format
  if (billType === 'GR' && isGST && reportType === 'main') {
    return generateGRMainGSTDoc(billMap, ltrHtml);
  }

  let body = '';
  if (billType === 'GR') {
    if (reportType === 'statement') {
      body = isGST
        ? buildGRStatementGSTHTML(billMap, ltrHtml, compID)
        : buildGRStatementHTML(billMap, ltrHtml);
    } else {
      body = isGST
        ? buildGRMainGSTHTML(billMap, ltrHtml)
        : buildGRMainHTML(billMap, ltrHtml);
    }
  } else {
    body = buildHMMainHTML(billMap, ltrHtml);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GMS Bill</title>
<style>${BILL_PRINT_CSS}</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
${body}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

// â”€â”€ fillMissingPartyData â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// For HM rows where mParty JOIN missed (party lives in a different company DB),
// look up the party in its home company's DB and fill the fields in-place.
async function fillMissingPartyData(rows) {
  const missing = rows.filter(r => r.pName == null && r.fkPartyID);
  if (!missing.length) return;

  const byPartyComp = new Map();
  for (const r of missing) {
    const partyCompID = r.fkPartyID.split('!')[0];
    if (!byPartyComp.has(partyCompID)) byPartyComp.set(partyCompID, new Set());
    byPartyComp.get(partyCompID).add(r.fkPartyID);
  }

  for (const [partyCompID, partyIDs] of byPartyComp) {
    const db = connectionManager.getDB(partyCompID);
    if (!db) {
      console.warn('[fillMissingPartyData] no DB for partyCompID=%s', partyCompID);
      continue;
    }
    const ids = [...partyIDs];
    const ph  = ids.map(() => '?').join(',');
    try {
      const [partyRows] = await db.query(
        `SELECT p.pkPartyID, p.pName, p.pBillAdd, p.GSTNo AS PartyGSTNo
         FROM mParty p WHERE p.pkPartyID IN (${ph})`,
        { replacements: ids }
      );
      const partyMap = new Map(partyRows.map(p => [p.pkPartyID, p]));
      for (const r of missing) {
        const party = partyMap.get(r.fkPartyID);
        if (party) {
          r.pName       = party.pName;
          r.pBillAdd    = party.pBillAdd;
          r.PartyGSTNo  = party.PartyGSTNo;
        }
      }
    } catch (e) {
      console.warn('[fillMissingPartyData] lookup failed partyCompID=%s: %s', partyCompID, e.message);
    }
  }
}

// â”€â”€ queryPrintRows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Shared by both /print and /email â€” runs the detail query for a list of bill IDs
// against one company DB and returns the raw rows.
async function queryPrintRows(db, billType, billIds) {
  const ph = billIds.map(() => '?').join(',');
  const sql = billType === 'GR' ? `
    SELECT STRAIGHT_JOIN
      b1.pkBillID, b1.fkCompID, b1.BillNum, b1.BillDt, b1.GrossAmt, b1.NetAmt,
      b1.Tax1Desc, b1.Tax1Rate, b1.Tax1Amt,
      b1.Tax2Desc, b1.Tax2Rate, b1.Tax2Amt,
      b1.Tax3Desc, b1.Tax3Rate, b1.Tax3Amt,
      b1.GSTNo AS BillGSTNo, b1.RoundOff,
      p.pName, p.pBillAdd, p.GSTNo AS PartyGSTNo,
      c.CompName, c.CompST, c.CompRegNum, c.CompGST,
      c.HSNCode, c.NameOfService,
      c.StateCode AS CompStateCode, c.StateName AS CompStateName,
      d.cpkSrno, d.BillRate, d.BalQty, d.FromDt, d.ToDt, d.BillDesc2,
      ts.LotNum, ts.OriTransDt, ts.OriTransQty, ts.Packing, ts.ItemExtDesc,
      COALESCE(ts.PackWght, 0) AS PackWght,
      im.iName, im.iType,
      ms.sName AS PartyStateName, ms.sCode AS PartyStateCode,
      bk.bName, bk.bAcNo, bk.bIFSC, bk.bBranch,
      (SELECT cr.RegNum
       FROM mCompRegDetail cr
       WHERE cr.fkCompID = b1.fkCompID
         AND cr.RegCode  = 'CompGST'
         AND b1.BillDt  >= cr.RegFromDt
         AND (cr.RegToDt IS NULL OR b1.BillDt <= cr.RegToDt)
       ORDER BY cr.RegFromDt DESC
       LIMIT 1) AS CompRegGSTNum
    FROM tBill1 b1
    JOIN tBill2 d        ON d.cpkBillID  = b1.pkBillID
    JOIN mParty p        ON p.pkPartyID  = b1.fkPartyID
    JOIN mCompany c      ON c.pkCompID   = b1.fkCompID
    LEFT JOIN mState ms  ON ms.pkStateID = p.fkStateID
    LEFT JOIN mBank bk   ON bk.fkCompID  = b1.fkCompID AND bk.bPrimeryFlg = 'Y'
    JOIN tStockEntry ts  ON ts.pfkLotID  = d.fkLotID AND ts.TransType = 'ARV'
    JOIN mItem im        ON im.pkItemID  = ts.fkItemID
    WHERE b1.pkBillID IN (${ph})
    ORDER BY b1.fkCompID, p.pName, b1.BillNum, d.cpkSrno`
  : `
    SELECT
      h1.pkBillID, h1.fkPartyID, h1.BillNum, h1.BillDt, h1.GrossAmt, h1.NetAmt,
      h1.Tax1Desc, h1.Tax1Rate, h1.Tax1Amt,
      h1.Tax2Desc, h1.Tax2Rate, h1.Tax2Amt,
      h1.Tax3Desc, h1.Tax3Rate, h1.Tax3Amt,
      h1.GSTNo AS BillGSTNo, h1.RoundOff,
      p.pName, p.pBillAdd, p.GSTNo AS PartyGSTNo,
      c.CompName, c.CompGST, c.HSNCode, c.NameOfService,
      c.StateCode AS CompStateCode, c.StateName AS CompStateName,
      d.cpkSrNo, d.RecdDt, d.LotNum, d.iName, d.TransQty, d.Packing,
      COALESCE(d.PackWght, 0) AS PackWght,
      d.HamaliFlg, d.BillRate, d.Amount, d.BillDesc2,
      ms.sName AS PartyStateName, ms.sCode AS PartyStateCode,
      bk.bName, bk.bAcNo, bk.bIFSC, bk.bBranch,
      (SELECT cr.RegNum
       FROM mCompRegDetail cr
       WHERE cr.fkCompID = h1.fkCompID
         AND cr.RegCode  = 'CompGST'
         AND h1.BillDt  >= cr.RegFromDt
         AND (cr.RegToDt IS NULL OR h1.BillDt <= cr.RegToDt)
       ORDER BY cr.RegFromDt DESC
       LIMIT 1) AS CompRegGSTNum
    FROM tBillTrHmGen1 h1
    JOIN tBillTrHmGen2 d  ON d.cpkBillID COLLATE utf8mb4_unicode_ci = h1.pkBillID  COLLATE utf8mb4_unicode_ci
    LEFT JOIN mParty p    ON p.pkPartyID  COLLATE utf8mb4_unicode_ci = h1.fkPartyID COLLATE utf8mb4_unicode_ci
    JOIN mCompany c       ON c.pkCompID   COLLATE utf8mb4_unicode_ci = h1.fkCompID  COLLATE utf8mb4_unicode_ci
    LEFT JOIN mState ms   ON ms.pkStateID COLLATE utf8mb4_unicode_ci = h1.fkStateID COLLATE utf8mb4_unicode_ci
    LEFT JOIN mBank bk    ON bk.fkCompID  COLLATE utf8mb4_unicode_ci = h1.fkCompID  COLLATE utf8mb4_unicode_ci AND bk.bPrimeryFlg = 'Y'
    WHERE h1.pkBillID IN (${ph})
    ORDER BY h1.BillDt, h1.BillNum, d.cpkSrNo`;

  const [rows] = await db.query(sql, { replacements: billIds });
  return rows;
}

// â”€â”€ POST /print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns browser-printable HTML for selected bills.
// Body: { bills, billType ('GR'|'HM'), reportType ('main'|'statement'), withLetterhead }
// The frontend opens the HTML in a new tab; the embedded script triggers window.print().
router.post('/print', requirePerm('BILL_REP', 'CanPrint'), async (req, res) => {
  try {
    const { bills = [], billType = 'GR', reportType = 'main', withLetterhead = false } = req.body;
    const { compID = '' } = req.user;
    if (!bills.length) return res.status(400).json({ error: 'No bills selected.' });

    // Group bill IDs by company so we can query each company DB
    const byComp = new Map();
    for (const b of bills) {
      if (!byComp.has(b.fkCompID)) byComp.set(b.fkCompID, []);
      byComp.get(b.fkCompID).push(b.pkBillID);
    }

    console.log('[print] billType=%s byComp=%s', billType,
      [...byComp.entries()].map(([k,v]) => `${k}(${v.length})`).join(','));

    const allRows = [];
    const diagLog = [];

    for (const [compID, billIds] of byComp) {
      const db = connectionManager.getDB(compID);
      if (!db) {
        diagLog.push(`compID=${compID} â†’ NO DB CONNECTION`);
        console.warn('[print] No DB for compID=%s', compID);
        continue;
      }
      const ph = billIds.map(() => '?').join(',');

      let rows;
      try {
        console.log('[print] compID=%s IDs=%s', compID, billIds.slice(0, 3).join(','));
        rows = await queryPrintRows(db, billType, billIds);
      } catch (qErr) {
        console.error('[print] SQL error compID=%s:', compID, qErr.message);
        diagLog.push(`compID=${compID} SQL_ERR=${qErr.message}`);
        continue;
      }

      console.log('[print] compID=%s rows=%d', compID, rows.length);
      diagLog.push(`compID=${compID} rows=${rows.length}`);
      allRows.push(...rows);
    }

    if (!allRows.length) {
      const diag = diagLog.length ? diagLog.join(' | ') : 'byComp empty (fkCompID missing?)';
      console.error('[print] No rows. diag:', diag);
      return res.status(404).json({
        error: `No detail data found for the selected bills. [${diag}]`,
      });
    }

    if (billType === 'HM') await fillMissingPartyData(allRows);

    const html = generatePrintHTML(allRows, billType, reportType, withLetterhead, compID);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[billReport] POST /print:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
