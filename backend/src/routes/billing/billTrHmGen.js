// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BILLING â€” Bill Generation for Transportation, Hamali & General
// /api/billing/bills
//
// VB6 Source: frmBillTrHmGen.frm
// Original Caption: "Bill Generation for Transportation, Hamali & General"
//
// TABLES (company DB):
//   tBillTrHmGen1  â€” bill header (one row per bill)
//   tBillTrHmGen2  â€” bill detail lines (TRAN / ITEM / GEN rows per bill)
//   tStockEntry    â€” source transaction data for "Add Transaction" popup
//   mParty         â€” party master for party selector
//   mCompany       â€” company selector
//   mTax           â€” tax rates for udfUptBillTot
//   FaYearInfo     â€” financial year date ranges for the View panel
//
// BILL TYPES:
//   HMLI = Hamali (handling charges)
//   TRSP = Transport (freight charges)
//   GEN  = General  (miscellaneous charges)
//
// DETAIL LINE TYPES (RecdType in tBillTrHmGen2):
//   TRAN = stock-entry row imported from tStockEntry (Add Transaction)
//   ITEM = manually added item row            (Add Item)
//   GEN  = manually added general charge row  (Add General)
//
// PERMISSIONS: BILLING module
//   CanView   â†’ GET  /form-data, GET /bills, GET /bills/:id, GET /transactions
//   CanAdd    â†’ POST /bills
//   CanEdit   â†’ PUT  /bills/:id
//   CanDelete â†’ DELETE /bills/:id
//
// TAX CALCULATION (udfUptBillTot) â€” single cascading flow, no date cutoff:
//   Tax1: SERVICE TAX (30% of gross) â†’ if rate=0, fallback to CGST (full gross)
//   Tax2: EDU CESS (on tax1 amt) â†’ if rate=0, try SBCESS (30% of gross) â†’ if still 0, try SGST (full gross)
//   Tax3: HGH EDU CESS (on tax1 amt) â†’ if rate=0, try KKCESS (30% of gross) â†’ if still 0, try IGST (full gross)
//   The era is determined entirely by which mTax rows are active for the bill date.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');
const connMgr     = require('../../config/connectionManager');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');

router.use(requireAuth);

// â”€â”€ Tax helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// VB6: gudfTaxRate(dTaxRate, sTaxDesc, sTaxCode, dDate, sCompID)
// Finds the most-recent mTax row effective on or before billDate.
// Returns { rate: number, desc: string } â€” rate = 0 if not found.
async function getTaxRate(db, taxCode, billDate, compID) {
  const [rows] = await db.query(
    `SELECT TaxRate, TaxDesc FROM mTax
     WHERE fkCompID = ? AND TaxCode = ?
       AND TaxFromDt <= ?
       AND (TaxToDt IS NULL OR TaxToDt >= ?)
     ORDER BY TaxFromDt DESC LIMIT 1`,
    { replacements: [compID, taxCode, billDate, billDate] }
  );
  if (!rows.length) return { rate: 0, desc: '' };
  return { rate: parseFloat(rows[0].TaxRate) || 0, desc: rows[0].TaxDesc || '' };
}

// VB6: udfUptBillTot() â€” single cascading flow; era is determined by mTax data, not a date cutoff.
// Returns { tax1, tax2, tax3, netAmt, roundOff } where each tax = { desc, rate, amt }.
async function calculateTaxes(db, grossAmt, billDate, compID) {
  let tax1 = { desc: '', rate: 0, amt: 0 };
  let tax2 = { desc: '', rate: 0, amt: 0 };
  let tax3 = { desc: '', rate: 0, amt: 0 };

  // Step 1: SERVICE TAX on 30% of gross (transport abatement â€” only 30% is taxable).
  // VB6: dTaxTotAmt1 = Round((mFv.dGrossBal * 0.3) * (dTaxRate1 / 100) + 0.5)
  const st = await getTaxRate(db, 'SERVICE TAX', billDate, compID);
  if (st.rate > 0) {
    tax1 = { desc: st.desc, rate: st.rate, amt: Math.round((grossAmt * 0.3) * (st.rate / 100) + 0.5) };
  }

  // Step 2: EDU CESS on the SERVICE TAX amount (not on gross).
  // VB6: dTaxTotAmt2 = Round(dTaxTotAmt1 * (dTaxRate2 / 100) + 0.5)
  const ec = await getTaxRate(db, 'EDU CESS', billDate, compID);
  if (ec.rate > 0) {
    tax2 = { desc: ec.desc, rate: ec.rate, amt: Math.round(tax1.amt * (ec.rate / 100) + 0.5) };
  }

  // Step 3: HGH EDU CESS also on the SERVICE TAX amount.
  const hec = await getTaxRate(db, 'HGH EDU CESS', billDate, compID);
  if (hec.rate > 0) {
    tax3 = { desc: hec.desc, rate: hec.rate, amt: Math.round(tax1.amt * (hec.rate / 100) + 0.5) };
  }

  // Step 4: If EDU CESS = 0, try SBCESS (Swachh Bharat Cess) on 30% of gross.
  // VB6: If dTaxRate2 = 0 Then gudfTaxRate(..., "SBCESS", ...) â†’ on 30% of gross
  if (tax2.rate === 0) {
    const sbc = await getTaxRate(db, 'SBCESS', billDate, compID);
    if (sbc.rate > 0) {
      tax2 = { desc: sbc.desc, rate: sbc.rate, amt: Math.round((grossAmt * 0.3) * (sbc.rate / 100) + 0.5) };
    }
  }

  // Step 5: If HGH EDU CESS = 0, try KKCESS (Krishi Kalyan Cess) on 30% of gross.
  // VB6: If dTaxRate3 = 0 Then gudfTaxRate(..., "KKCESS", ...) â†’ on 30% of gross
  if (tax3.rate === 0) {
    const kkc = await getTaxRate(db, 'KKCESS', billDate, compID);
    if (kkc.rate > 0) {
      tax3 = { desc: kkc.desc, rate: kkc.rate, amt: Math.round((grossAmt * 0.3) * (kkc.rate / 100) + 0.5) };
    }
  }

  // Step 6: If SERVICE TAX = 0 (GST era), try CGST on full gross.
  // VB6: If dTaxRate1 = 0 Then gudfTaxRate(..., "CGST", ...) â†’ Format(gross Ã— rate, "00.00")
  if (tax1.rate === 0) {
    const cgst = await getTaxRate(db, 'CGST', billDate, compID);
    if (cgst.rate > 0) {
      tax1 = { desc: cgst.desc, rate: cgst.rate, amt: parseFloat((grossAmt * (cgst.rate / 100)).toFixed(2)) };
    }
  }

  // Step 7: If tax2 still 0 (EDU CESS and SBCESS both 0), try SGST on full gross.
  // VB6: If dTaxRate2 = 0 Then gudfTaxRate(..., "SGST", ...)
  if (tax2.rate === 0) {
    const sgst = await getTaxRate(db, 'SGST', billDate, compID);
    if (sgst.rate > 0) {
      tax2 = { desc: sgst.desc, rate: sgst.rate, amt: parseFloat((grossAmt * (sgst.rate / 100)).toFixed(2)) };
    }
  }

  // Step 8: If tax3 still 0 (HGH EDU CESS and KKCESS both 0), try IGST on full gross.
  // VB6: If dTaxRate3 = 0 Then gudfTaxRate(..., "IGST", ...)
  if (tax3.rate === 0) {
    const igst = await getTaxRate(db, 'IGST', billDate, compID);
    if (igst.rate > 0) {
      tax3 = { desc: igst.desc, rate: igst.rate, amt: parseFloat((grossAmt * (igst.rate / 100)).toFixed(2)) };
    }
  }

  // VB6: dNetAmt = Round(mFv.dGrossBal + dTaxTotAmt1 + dTaxTotAmt2 + dTaxTotAmt3, 0)
  const rawNet   = grossAmt + tax1.amt + tax2.amt + tax3.amt;
  const netAmt   = Math.round(rawNet);
  const roundOff = parseFloat((netAmt - rawNet).toFixed(2));

  return { tax1, tax2, tax3, netAmt, roundOff };
}

// â”€â”€ Detail line validator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// VB6: udfValTransGrid() â€” validates each line before saving.
function validateLines(lines, billType) {
  const errs = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    // All rows: Amount required
    if (line.amount === null || line.amount === undefined || line.amount === '') {
      errs.push(`Row ${n}: Amount is required`);
    }
    // TRSP + TRAN rows: FromDest and ToDest required
    if (billType === 'TRSP' && line.recdType === 'TRAN') {
      if (!line.fromDest) errs.push(`Row ${n}: From Destination required`);
      if (!line.toDest)   errs.push(`Row ${n}: To Destination required`);
    }
    // ITEM rows: Date, IName, Qty, Packing, Weight required
    if (line.recdType === 'ITEM') {
      if (!line.recdDt)                                          errs.push(`Row ${n}: Date required`);
      if (!line.iName)                                           errs.push(`Row ${n}: Item Name required`);
      if (line.transQty === null || line.transQty === undefined || line.transQty === '') errs.push(`Row ${n}: Quantity required`);
      if (!line.packing)                                         errs.push(`Row ${n}: Packing required`);
      if (line.packWght === null || line.packWght === undefined || line.packWght === '') errs.push(`Row ${n}: Weight required`);
    }
    // GEN rows: Description required
    if (line.recdType === 'GEN') {
      if (!line.billDesc2) errs.push(`Row ${n}: Description required`);
    }
    // HMLI + TRAN/ITEM rows: Hamali direction required
    if (billType === 'HMLI' && ['TRAN', 'ITEM'].includes(line.recdType)) {
      if (!line.hamaliFlg) errs.push(`Row ${n}: Hamali direction required`);
    }
  });
  return errs;
}

// â”€â”€ Bill Number Generator (VCSeriesMast / VCSeriesSrno) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// VB6: gudfGetFaYear() â€” find the FA Year string for a given date.
// Returns e.g. "2025-2026" or "0000-0000" on failure.
async function getFaYear(db, billDate, compID, faNorAlt, t) {
  const [rows] = await db.query(
    `SELECT FaYear FROM FaYearInfo
     WHERE fkCompID = ? AND Active = 'Y' AND Nor_Alt = ?
       AND StartDate <= ? AND EndDate >= ?
     ORDER BY StartDate DESC LIMIT 1`,
    { replacements: [compID, faNorAlt || 'N', billDate, billDate], transaction: t }
  );
  return rows.length ? rows[0].FaYear : '0000-0000';
}

// VB6: format-string parser inside gudfGenSeriesNo.
// FormatStr tokens:
//   yyyy/yy/y  â†’ calendar year (4/2/1 digit)
//   mm/m       â†’ calendar month
//   MM/M       â†’ FA month (April=01, May=02, ..., March=12)
//   dd/d       â†’ day
//   ffff/ff    â†’ first half of FA year (e.g. "2025"/"25" from "2025-2026")
//   FFFF/FF    â†’ second half (e.g. "2026"/"26")
//   \x         â†’ literal character x
//   N          â†’ running number (no padding)
//   nâ€¦n        â†’ running number zero-padded to k digits (k = count of n's)
//   anything else â†’ literal
function buildSeriesNo(formatStr, dt, faYear, runningNum) {
  const yyyy     = String(dt.getFullYear());
  const yy       = yyyy.slice(-2);
  const mm       = String(dt.getMonth() + 1).padStart(2, '0');
  const m        = String(dt.getMonth() + 1);
  const dd       = String(dt.getDate()).padStart(2, '0');
  const d        = String(dt.getDate());

  // FA month: DateAdd("m", -3, date) then take the month (Aprâ†’01, Mayâ†’02, ..., Marâ†’12)
  const dtFA     = new Date(dt);
  dtFA.setMonth(dtFA.getMonth() - 3);
  const faMM     = String(dtFA.getMonth() + 1).padStart(2, '0');
  const faM      = String(dtFA.getMonth() + 1);

  // FA year parts â€” faYear format is "2025-2026"
  const faFirst4  = faYear.slice(0, 4);   // "2025"
  const faFirst2  = faYear.slice(2, 4);   // "25"
  const faSecond4 = faYear.slice(5, 9);   // "2026"
  const faSecond2 = faYear.slice(7, 9);   // "26"

  let result = '';
  let i = 0;
  while (i < formatStr.length) {
    const ch = formatStr[i];
    if (formatStr.slice(i, i + 4) === 'yyyy')       { result += yyyy;      i += 4; }
    else if (formatStr.slice(i, i + 2) === 'yy')    { result += yy;        i += 2; }
    else if (ch === 'y')                             { result += yyyy.slice(-1); i += 1; }
    else if (formatStr.slice(i, i + 2) === 'mm')    { result += mm;        i += 2; }
    else if (ch === 'm')                             { result += m;         i += 1; }
    else if (formatStr.slice(i, i + 2) === 'MM')    { result += faMM;      i += 2; }
    else if (ch === 'M')                             { result += faM;       i += 1; }
    else if (formatStr.slice(i, i + 2) === 'dd')    { result += dd;        i += 2; }
    else if (ch === 'd')                             { result += d;         i += 1; }
    else if (formatStr.slice(i, i + 4) === 'ffff')  { result += faFirst4;  i += 4; }
    else if (formatStr.slice(i, i + 2) === 'ff')    { result += faFirst2;  i += 2; }
    else if (formatStr.slice(i, i + 4) === 'FFFF')  { result += faSecond4; i += 4; }
    else if (formatStr.slice(i, i + 2) === 'FF')    { result += faSecond2; i += 2; }
    else if (ch === '\\') {
      if (i + 1 < formatStr.length) { result += formatStr[i + 1]; i += 2; }
      else { i += 1; }
    } else if (ch === 'N') {
      // Unpadded running number
      result += String(runningNum);
      i += 1;
    } else if (ch === 'n') {
      // Count consecutive n's â†’ zero-padded width
      let k = 0;
      while (i + k < formatStr.length && formatStr[i + k] === 'n') k++;
      result += String(runningNum).padStart(k, '0');
      i += k;
    } else {
      result += ch;
      i += 1;
    }
  }
  return result;
}

// VB6: gudfGenSeriesNo() â€” reads VCSeriesMast for format, increments VCSeriesSrno, returns formatted number.
// Uses its own mini-transaction so the counter commit is independent of the outer bill insert.
async function gudfGenSeriesNo(db, seriesCode, billDate, compID, branchID) {
  const t = await db.transaction();
  try {
    // 1. Fetch series master
    const [mastRows] = await db.query(
      `SELECT pkSeriesID, Series, SeriesType, FormatStr, FA_Nor_Alt
       FROM VCSeriesMast
       WHERE fkCompID = ? AND fkBranchID = ? AND SeriesCode = ? AND Active = 'Y'
       LIMIT 1`,
      { replacements: [compID, branchID, seriesCode], transaction: t }
    );
    if (!mastRows.length) {
      await t.rollback();
      return null; // series not configured in VCSeriesMast
    }
    const mast = mastRows[0];

    // 2. Derive FaYear and SeriesDate based on SeriesType
    const dt    = new Date(billDate);
    const yyyy  = String(dt.getFullYear());
    const mm    = String(dt.getMonth() + 1).padStart(2, '0');
    const dd    = String(dt.getDate()).padStart(2, '0');
    let sSeriesFaYear = '0000-0000';
    let sSeriesDate   = '00000000';

    if (mast.SeriesType === 'L' || mast.SeriesType === 'FY') {
      if (mast.SeriesType === 'FY') {
        sSeriesFaYear = await getFaYear(db, billDate, compID, mast.FA_Nor_Alt, t);
      }
      sSeriesDate = '00000000';
    } else if (mast.SeriesType === 'CY') {
      sSeriesFaYear = `${yyyy}-${yyyy}`;
      sSeriesDate   = `${yyyy}0000`;
    } else if (mast.SeriesType === 'M') {
      sSeriesFaYear = await getFaYear(db, billDate, compID, mast.FA_Nor_Alt, t);
      sSeriesDate   = `${yyyy}${mm}00`;
    } else if (mast.SeriesType === 'D') {
      sSeriesFaYear = await getFaYear(db, billDate, compID, mast.FA_Nor_Alt, t);
      sSeriesDate   = `${yyyy}${mm}${dd}`;
    }

    // 3. Lock the VCSeriesSrno row and increment LastNo
    const [srnoRows] = await db.query(
      `SELECT LastNo FROM VCSeriesSrno
       WHERE fkSeriesID = ? AND fkCompID = ? AND fkBranchID = ? AND FaYear = ? AND SeriesDate = ?
       FOR UPDATE`,
      { replacements: [mast.pkSeriesID, compID, branchID, sSeriesFaYear, sSeriesDate], transaction: t }
    );

    let lastNo;
    if (!srnoRows.length) {
      await db.query(
        `INSERT INTO VCSeriesSrno (fkSeriesID, fkCompID, fkBranchID, SeriesID, FaYear, SeriesDate, LastNo)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        { replacements: [mast.pkSeriesID, compID, branchID, mast.Series, sSeriesFaYear, sSeriesDate], transaction: t }
      );
      lastNo = 1;
    } else {
      lastNo = Number(srnoRows[0].LastNo) + 1;
      await db.query(
        `UPDATE VCSeriesSrno SET LastNo = ?
         WHERE fkSeriesID = ? AND fkCompID = ? AND fkBranchID = ? AND FaYear = ? AND SeriesDate = ?`,
        { replacements: [lastNo, mast.pkSeriesID, compID, branchID, sSeriesFaYear, sSeriesDate], transaction: t }
      );
    }

    // 4. Build the formatted bill number from VCSeriesMast.FormatStr
    const seriesNo = buildSeriesNo(mast.FormatStr, dt, sSeriesFaYear, lastNo);
    await t.commit();
    return seriesNo;
  } catch (err) {
    try { await t.rollback(); } catch {}
    console.error('gudfGenSeriesNo error:', err);
    return null;
  }
}

// VB6: gudfGenSeriesNo() â€” series codes match VB6 exactly; format comes from VCSeriesMast.FormatStr.
async function genBillNumber(db, billType, billDate, compID, branchID) {
  const GST_CUTOFF = new Date('2017-07-01');
  const isGst = new Date(billDate) >= GST_CUTOFF; // July 1 2017 onwards = GST era

  const seriesMap = {
    'HMLI': isGst ? 'TBILL1_HM_GST_BILLNUM'  : 'TBILL1_HM_BILLNUM',
    'TRSP': isGst ? 'TBILL1_TR_GST_BILLNUM'  : 'TBILL1_TR_BILLNUM',
    'GEN':  isGst ? 'TBILL1_GEN_GST_BILLNUM' : 'TBILL1_GEN_BILLNUM',
  };
  const seriesCode = seriesMap[billType];
  if (!seriesCode) return null;

  return gudfGenSeriesNo(db, seriesCode, billDate, compID, branchID);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/bills/form-data
// Returns all data needed to populate the Party Selection tab selectors.
// VB6 equivalent: udfFillGridCombo() called from Form_Load.
//
// Returns:
//   billTypes : [{ code, label }]            â€” HMLI/TRSP/GEN
//   parties   : [{ pkPartyID, pName, pCode, fkCompID, fkBranchID, StFlagTrans, GSTNo, fkStateID }]
//   companies : [{ pkCompID, CompName }]     â€” all active companies in group
//   faYears   : [{ FaYear, startDate, endDate }]
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/form-data', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID, compID } = req.user;
    const db = req.db;

    // Bill type lookup table (VB6 hard-coded combo in udfFillGridCombo)
    const billTypes = [
      { code: 'HMLI', label: 'Hamali' },
      { code: 'TRSP', label: 'Transport' },
      { code: 'GEN',  label: 'General' },
    ];

    // Party list â€” VB6: SELECT pName, pCode, ... FROM vamParty WHERE Active='Y' ORDER BY pName
    // vamParty spans all companies in the group; selecting a party drives the company.
    const [parties] = await db.query(
      `SELECT pkPartyID, pName, pCode, fkCompID, fkBranchID,
              COALESCE(NULLIF(StFlagTrans,''),'N') AS StFlagTrans,
              COALESCE(NULLIF(GSTNo,''),' ')       AS GSTNo,
              fkStateID
       FROM vamParty
       WHERE Active = 'Y'
       ORDER BY pName`
    );

    // Company list â€” VB6: UNION ALL across all group DBs for mCompany WHERE Active='Y'
    const companies = connMgr.getGroupCompanyDetails(groupID);
    const compList  = companies.map(c => ({ pkCompID: c.pkCompID, CompName: c.CompName, CompAlias: c.CompAlias || c.pkCompID }));

    // Financial years â€” VB6 udfFillFaYear / cobFaYear
    const [faYears] = await db.query(
      `SELECT FaYear,
              DATE_FORMAT(StartDate,'%Y-%m-%d') AS startDate,
              DATE_FORMAT(EndDate,  '%Y-%m-%d') AS endDate
       FROM FaYearInfo
       WHERE fkBranchID = ? AND Active = 'Y'
       ORDER BY FaYear DESC`,
      { replacements: [branchID] }
    );

    // Default bill period dates â€” VB6: gudfGetBillToDay(mImp.nBillToDay, today) + udfDatePeriod()
    // Queries mCompBillDate for the BillDay configured for the current company and month,
    // then computes:
    //   ToDate   = DateSerial(year, month, billDay)           â€” capped at last day of month
    //   FromDate = DateAdd("m", -1, ToDate) + 1              â€” next day after prev month's BillDay
    const today  = new Date();
    const yyyymm = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const [bdRows] = await db.query(
      `SELECT BillDay FROM mCompBillDate
       WHERE fkCompID = ?
         AND FromYearMonth <= ?
         AND (ToYearMonth >= ? OR ToYearMonth IS NULL)
       ORDER BY FromYearMonth DESC LIMIT 1`,
      { replacements: [compID, yyyymm, yyyymm] }
    );

    let defaultDates = null;
    if (bdRows.length) {
      const billDay        = parseInt(bdRows[0].BillDay);
      const yr             = today.getFullYear();
      const mo             = today.getMonth() + 1; // 1-12

      // Format using LOCAL date parts â€” never toISOString() which converts to UTC
      // (UTC conversion shifts midnight IST back by one day, causing off-by-one errors)
      const localDate = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // ToDate = current month's BillDay (capped to last day of current month)
      const lastDayCurrent   = new Date(yr, mo, 0).getDate();
      const effectiveBillDay = Math.min(billDay, lastDayCurrent);
      const toDate = `${yr}-${String(mo).padStart(2, '0')}-${String(effectiveBillDay).padStart(2, '0')}`;

      // FromDate = DateAdd("m", -1, ToDate) + 1  [VB6: frmBillTrHmGen.frm udfDatePeriod]
      // DateAdd("m",-1) = same day in prev month, capped to prev month's last day if needed.
      // Use effectiveBillDay (already capped to current month) â€” not raw billDay â€” for the cap.
      const lastDayPrev          = new Date(yr, mo - 1, 0).getDate(); // last day of previous month
      const effectivePrevBillDay = Math.min(effectiveBillDay, lastDayPrev);
      const fromDate = localDate(new Date(yr, mo - 2, effectivePrevBillDay + 1));

      defaultDates = { fromDate, toDate, billDay };
    }

    // Packing types from VCComboData â€” shown as dropdown in ITEM rows
    const [packingRows] = await db.query(
      `SELECT VCData FROM VCComboData
       WHERE VCPurpose = 'PackingType' AND fkCompID = ? AND fkBranchID = ? AND VCActive = 'Y'
       ORDER BY VCSrtOrd`,
      { replacements: [compID, branchID] }
    );
    const packingList = packingRows.map((r) => r.VCData).filter(Boolean);

    res.json({ billTypes, parties, companies: compList, faYears, defaultDates, packingList });
  } catch (err) {
    console.error('GET /form-data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/bills
// Lists bills for the View panel (fraBillView / vfgBillView grid).
// VB6 equivalent: udfFillBillView()
//
// Query params:
//   faYear    {string}   '2526' â€” financial year code
//   partyID   {string}   optional â€” filter by specific party
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID }          = req.user;
    const { faYear, partyID, compID: qCompID } = req.query;

    // If compID supplied, query only that company; otherwise query all group companies.
    const allCompanies = connMgr.getGroupCompanyDetails(groupID);
    const companies    = qCompID ? allCompanies.filter(c => c.pkCompID === qCompID) : allCompanies;

    const allBills = await Promise.all(
      companies.map(async (c) => {
        const db = connMgr.getDB(c.pkCompID);
        if (!db) return [];

        // Get the FA year's date range from FaYearInfo for this company's DB.
        // VB6: mFv.dYearStart / mFv.dYearEnd from vfgFaYear.Cell(flexcpTextDisplay, ...)
        let yearStart = '2000-01-01';
        let yearEnd   = '2099-12-31';
        if (faYear) {
          const [fyRows] = await db.query(
            `SELECT DATE_FORMAT(StartDate,'%Y-%m-%d') AS s,
                    DATE_FORMAT(EndDate,'%Y-%m-%d')   AS e
             FROM FaYearInfo WHERE fkBranchID = ? AND FaYear = ? AND Active = 'Y' LIMIT 1`,
            { replacements: [branchID, faYear] }
          );
          if (fyRows.length) { yearStart = fyRows[0].s; yearEnd = fyRows[0].e; }
        }

        // VB6 SQL: FROM tBillTrHmGen1 b1, vamParty vp WHERE b1.fkPartyID = vp.pkPartyID
        // LEFT JOIN: party may belong to a different company's mParty (cross-company bills).
        // No fkBranchID filter: scoping is per-company DB (fkCompID), not per-branch.
        let sql = `
          SELECT STRAIGHT_JOIN
                 b1.pkBillID, b1.BillNum, b1.BillType, b1.BillDt,
                 b1.GrossAmt, b1.NetAmt, b1.fkCompID, b1.fkPartyID, b1.BillStatus,
                 COALESCE(p.pName, b1.fkPartyID) AS pName
          FROM tBillTrHmGen1 b1
          LEFT JOIN mParty p ON b1.fkPartyID = p.pkPartyID
          WHERE b1.fkCompID = ?
            AND b1.BillDt >= ? AND b1.BillDt <= ?
        `;
        const rp = [c.pkCompID, yearStart, yearEnd];
        if (partyID) { sql += ' AND b1.fkPartyID = ?'; rp.push(partyID); }
        sql += ' ORDER BY b1.BillDt DESC, b1.BillNum DESC';

        const [rows] = await db.query(sql, { replacements: rp });
        return rows.map(r => ({ ...r, compAlias: c.CompAlias }));
      })
    );

    const merged = allBills
      .flat()
      .sort((a, b) => new Date(b.BillDt) - new Date(a.BillDt));

    // Resolve party names for cross-company bills where LEFT JOIN returned no match.
    // pName falls back to fkPartyID when the party lives in a different company's DB.
    const unknownIDs = [...new Set(
      merged.filter(b => b.pName === b.fkPartyID).map(b => b.fkPartyID)
    )];
    if (unknownIDs.length > 0) {
      const partyMap = {};
      const ph = unknownIDs.map(() => '?').join(',');
      for (const c of allCompanies) {
        const cdb = connMgr.getDB(c.pkCompID);
        if (!cdb) continue;
        try {
          const [pRows] = await cdb.query(
            `SELECT pkPartyID, pName FROM mParty WHERE pkPartyID IN (${ph})`,
            { replacements: unknownIDs }
          );
          for (const p of pRows) partyMap[p.pkPartyID] = p.pName;
        } catch { /* skip unreachable DB */ }
      }
      merged.forEach(b => {
        if (b.pName === b.fkPartyID && partyMap[b.fkPartyID]) b.pName = partyMap[b.fkPartyID];
      });
    }

    res.json(merged);
  } catch (err) {
    console.error('GET /bills error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/bills/transactions
// MUST be defined BEFORE GET /:id so Express does not swallow it as id='transactions'.
// Fetches billable stock entries for the "Add Transaction" popup.
// VB6 equivalent: udfOpRecSet() + udfPopRecd()
//
// Query params (all required):
//   partyID   {string}   mImp.fkPartyID
//   compID    {string}   mImp.sCurrDB
//   branchID  {string}   mImp.sCurrBranch
//   fromDate  {string}   mFv.dFromDate  YYYY-MM-DD
//   toDate    {string}   mFv.dToDate    YYYY-MM-DD
//
// Filters (VB6 WHERE clause):
//   HmlBillAmt <> 0 AND OpFlg = 'N'  â€” only unbilled, non-reversed entries
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/transactions', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { partyID, compID: qCompID, branchID: qBranch, fromDate, toDate } = req.query;

    if (!partyID || !qCompID || !qBranch || !fromDate || !toDate) {
      return res.status(400).json({ error: 'partyID, compID, branchID, fromDate, toDate required' });
    }

    const db = connMgr.getDB(qCompID);
    if (!db) return res.status(400).json({ error: `No DB for company ${qCompID}` });

    // VB6 SQL (translated from T-SQL comma-join to MySQL JOIN syntax):
    //   SELECT ts.TransDt, ts1.LotNum, ts.DoNum, ts.TransQty,
    //          ts1.Packing, ts1.PackWght, ts.pkTransID, ts.pfkLotID,
    //          ts1.ItemExtDesc, ts.TransType,
    //          ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode,
    //          im.iName
    //   FROM tStockEntry ts, tStockEntry ts1, mItem im
    //   WHERE ts.pfkLotID = ts1.pfkLotID
    //     AND ts.fkItemID = im.pkItemID
    //     AND ts.fkPartyID = ? AND ts.fkCompID = ? AND ts.fkBranchID = ?
    //     AND ts.TransDt >= ? AND ts.TransDt <= ?
    //     AND ts1.TransType = 'ARV'
    //     AND ts.HmlBillAmt <> 0 AND ts.OpFlg = 'N'
    //   ORDER BY TransDt
    const [rows] = await db.query(
      `SELECT STRAIGHT_JOIN
         DATE_FORMAT(ts.TransDt, '%Y-%m-%d') AS TransDt,
         ts1.LotNum,
         ts.DoNum,
         ABS(ts.TransQty)                     AS TransQty,
         ts1.Packing,
         ts1.PackWght,
         ts.pkTransID,
         ts.pfkLotID,
         CONCAT(im.iName, IF(ts1.ItemExtDesc <> '', CONCAT(' ', ts1.ItemExtDesc), '')) AS ItemName,
         ts.TransType,
         ts.HamaliRecd,
         ts.HamaliAmt,
         ts.HmlBillAmt,
         ts.HamaliCode
       FROM tStockEntry ts
       JOIN tStockEntry ts1
         ON ts1.pfkLotID = ts.pfkLotID AND ts1.TransType = 'ARV'
       JOIN mItem im ON im.pkItemID = ts.fkItemID
       WHERE ts.fkPartyID  = ?
         AND ts.fkCompID   = ?
         AND ts.fkBranchID = ?
         AND ts.TransDt   >= ?
         AND ts.TransDt   <= ?
         AND ts.HmlBillAmt <> 0
         AND ts.OpFlg      = 'N'
       ORDER BY ts.TransDt ASC`,
      { replacements: [partyID, qCompID, qBranch, fromDate, toDate] }
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/bills/:id
// Fetch one bill header + its detail lines (for Modify mode).
// VB6 equivalent: udfInitialiseControls() when enEditMode = Modify
//
// Returns:
//   header : tBillTrHmGen1 row
//   lines  : tBillTrHmGen2 rows ordered by RecdSrNo
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/:id', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const { id }                = req.params;

    const companies = connMgr.getGroupCompanyDetails(groupID);
    let header = null;
    let lines  = [];

    for (const c of companies) {
      const db = connMgr.getDB(c.pkCompID);
      if (!db) continue;

      const [h] = await db.query(
        `SELECT * FROM tBillTrHmGen1 WHERE pkBillID = ? AND fkBranchID = ? LIMIT 1`,
        { replacements: [id, branchID] }
      );
      if (h.length) {
        header = h[0];
        const [l] = await db.query(
          // Alias cpkSrnoâ†’cpkSrNo for consistent JS property access (schema uses lowercase n)
          `SELECT cpkBillID, cpkSrno AS cpkSrNo, RecdSrNo, RecdType, VochrNo,
                  HamaliFlg, RecdDt, pfkLotID, LotNum, iName,
                  TransQty, Packing, PackWght, Tons,
                  BillDesc2, FromDest, ToDest, BillRate, Amount
           FROM tBillTrHmGen2
           WHERE cpkBillID = ?
           ORDER BY RecdSrNo ASC`,
          { replacements: [id] }
        );
        lines = l;
        break;
      }
    }

    if (!header) return res.status(404).json({ error: 'Bill not found' });
    res.json({ header, lines });
  } catch (err) {
    console.error('GET /bills/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/bills
// Generates a new bill (Add mode).
// VB6 equivalent: udfGenBill() when mImp.enEditMode = Add
//
// Body:
//   billType    {string}   'HMLI'|'TRSP'|'GEN'
//   fkPartyID   {string}
//   fkCompID    {string}   billing company
//   billFrom    {string}   YYYY-MM-DD
//   billTo      {string}   YYYY-MM-DD  â€” also used as billDt
//   kgTonFlg    {string}   'K'|'T'
//   billDesc1   {string}   description field (txtDesc1)
//   billNote    {string}   note field (txtNote)
//   stFlagTrans {string}   'Y'|'N' â€” interstate flag (Transport only)
//   gstNo       {string}
//   fkStateID   {string}
//   grossAmt    {number}   calculated total from line items
//   lines       {Array}    detail line rows (vfgTransEnt data)
//     Each line:
//       recdType   {string}   'TRAN'|'ITEM'|'GEN'
//       recdSrNo   {number}
//       recdDt     {string}   YYYY-MM-DD (null for GEN rows)
//       pfkLotID   {string}
//       lotNum     {string}
//       iName      {string}
//       transQty   {number}
//       packing    {string}
//       packWght   {number}
//       tons       {number}
//       billDesc2  {string}
//       fromDest   {string}
//       toDest     {string}
//       hamaliFlg  {string}   'Loading'|'Unloading'
//       billRate   {number}
//       amount     {number}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', requirePerm('BILL_GEN', 'CanAdd'), async (req, res) => {
  const { branchID, userId } = req.user;
  const {
    billType, fkPartyID, fkCompID, billFrom, billTo,
    kgTonFlg, billDesc1, billNote, stFlagTrans, gstNo, fkStateID,
    grossAmt, lines,
  } = req.body;

  if (!billType || !fkPartyID || !fkCompID || !billTo || !lines?.length) {
    return res.status(400).json({ error: 'billType, fkPartyID, fkCompID, billTo, lines required' });
  }

  // VB6: udfValTransGrid()
  const lineErrs = validateLines(lines, billType);
  if (lineErrs.length) return res.status(400).json({ error: lineErrs.join('; ') });

  const db = connMgr.getDB(fkCompID);
  if (!db) return res.status(400).json({ error: `No DB for company ${fkCompID}` });

  // â”€â”€ Sync SerialID counter with existing VB6 data (runs BEFORE outer txn) â”€â”€
  // The VB6 system may have pre-existing bills. If the SerialID row is missing or
  // behind the actual max pkBillID in the table, every new bill INSERT will collide.
  // ON DUPLICATE KEY UPDATE uses GREATEST so it never moves the counter backward.
  const pkKey = `${fkCompID}!${branchID}!tBillTrHmGen!cpkBillId`;
  try {
    const [maxRows] = await db.query(
      `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(pkBillID, '!', -1) AS UNSIGNED)), 0) AS maxN
       FROM tBillTrHmGen1
       WHERE fkCompID = ? AND fkBranchID = ?`,
      { replacements: [fkCompID, branchID] }
    );
    const maxN = Number(maxRows[0]?.maxN) || 0;
    if (maxN > 0) {
      await db.query(
        `INSERT INTO SerialID (pkSerialID, LastID, SerialDesc)
         VALUES (?, ?, 'BillTrHmGen Entry - cpkBillId(Primary Key)')
         ON DUPLICATE KEY UPDATE LastID = GREATEST(LastID, VALUES(LastID))`,
        { replacements: [pkKey, maxN] }
      );
    }
  } catch { /* SerialID table may not need syncing â€” proceed */ }

  const txn = await db.transaction();
  try {
    // â”€â”€ Step 1: Generate Bill ID (pkBillID) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VB6: gudfGenSerialID(compID & "!" & branchID & "!" & "tBillTrHmGen" & "!" & "cpkBillId")
    // PK format: CompID!BranchID!N  (e.g. "ADS!HO!42")
    const billLID = await gudfGenSerialID(db, pkKey, 'BillTrHmGen Entry - cpkBillId(Primary Key)', 'Y');
    if (billLID <= 0) throw new Error('Cannot generate Bill ID');
    const pkBillID = buildSerialKey(fkCompID, branchID, billLID);

    // â”€â”€ Step 2: Generate Bill Number â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VB6: gudfGenSeriesNo(mFv.sBillNum, sBilTypCode, ...) â€” series chosen by type & GST era
    const billNum = await genBillNumber(db, billType, billTo, fkCompID, branchID);
    if (!billNum) throw new Error('Cannot generate Bill Number');

    // â”€â”€ Step 3: Calculate taxes (udfUptBillTot) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const gross  = parseFloat(grossAmt) || 0;
    const taxes  = await calculateTaxes(db, gross, billTo, fkCompID);

    // â”€â”€ Step 4: INSERT into tBillTrHmGen1 (header) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VB6: mRs.rsBillType.AddNew ... mRs.rsBillType.Update (Add mode)
    await db.query(
      `INSERT INTO tBillTrHmGen1
         (pkBillID, fkCompID, fkBranchID, BillType, BillNum, fkPartyID,
          BillStatus, BillDt, BillFrom, BillTo, GrossAmt,
          Tax1Desc, Tax1Rate, Tax1Amt, Tax2Desc, Tax2Rate, Tax2Amt,
          Tax3Desc, Tax3Rate, Tax3Amt, NetAmt, RoundOff,
          KgTonFlg, UserID, BillDesc1, BillNote, StFlagTrans, GSTNo, fkStateID, LtrFlg)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      {
        replacements: [
          pkBillID, fkCompID, branchID, billType, billNum, fkPartyID,
          'N',            // BillStatus â€” 'N' = not paid/confirmed
          billTo,         // BillDt = billTo date (same as period end)
          billFrom || billTo,
          billTo,
          gross,
          taxes.tax1.desc, taxes.tax1.rate, taxes.tax1.amt,
          taxes.tax2.desc, taxes.tax2.rate, taxes.tax2.amt,
          taxes.tax3.desc, taxes.tax3.rate, taxes.tax3.amt,
          taxes.netAmt, taxes.roundOff,
          kgTonFlg || 'K',
          userId,
          billDesc1 || '',
          billNote  || '',
          billType === 'TRSP' ? (stFlagTrans || 'N') : 'N', // StFlagTrans only meaningful for Transport
          gstNo     || '',
          fkStateID || '',
          'N',            // LtrFlg = Letter printed flag
        ],
        transaction: txn,
      }
    );

    // â”€â”€ Step 5: INSERT detail lines into tBillTrHmGen2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // VB6: udfAddBill2Detail() â€” loops vfgTransEnt rows, skips new+Delete and None
    for (const line of lines) {
      // Generate a serial PK for each detail line (cpkSrNo)
      // VB6: gudfGenSerialID(..., "cpkSrNo") â€” per-bill sequence
      const srnoKey  = `${pkBillID}!cpkSrNo`;
      const srnoLID  = await gudfGenSerialID(db, srnoKey, `Bill ${pkBillID} detail Sr`, 'Y');
      if (srnoLID <= 0) throw new Error('Cannot generate detail Sr No');

      // For Hamali bills, generate a Voucher Number for TRAN and ITEM rows.
      // VB6: gudfGenSeriesNo(mFv.nVochrNo, "VOUCHER_NUM", ...)
      let vochrNo = 0;
      if (billType === 'HMLI' && line.recdType !== 'GEN') {
        const vKey = `${fkCompID}!${branchID}!VOUCHER_NUM`;
        const vID  = await gudfGenSerialID(db, vKey, 'Hamali Voucher Number', 'Y');
        if (vID > 0) vochrNo = vID;
      }

      await db.query(
        `INSERT INTO tBillTrHmGen2
           (cpkBillID, cpkSrNo, VochrNo, RecdSrNo, RecdType, RecdDt,
            pfkLotID, LotNum, iName, TransQty, Packing, PackWght, Tons,
            BillDesc2, FromDest, ToDest, HamaliFlg, BillRate, Amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        {
          replacements: [
            pkBillID,
            srnoLID,
            vochrNo,
            line.recdSrNo   || 0,
            line.recdType   || 'GEN',
            ['TRAN','ITEM'].includes(line.recdType) ? (line.recdDt || null) : null,
            line.pfkLotID   || '',
            line.lotNum     || '',
            line.iName      || '',
            parseFloat(line.transQty) || 0,
            line.packing    || '',
            parseFloat(line.packWght) || 0,
            parseFloat(line.tons)     || 0,
            line.billDesc2  || '',
            line.fromDest   || '',
            line.toDest     || '',
            line.hamaliFlg  || '',
            parseFloat(line.billRate) || 0,
            parseFloat(line.amount)   || 0,
          ],
          transaction: txn,
        }
      );
    }

    await txn.commit();

    res.status(201).json({
      pkBillID,
      billNum,
      grossAmt: gross,
      netAmt:   taxes.netAmt,
      tax1:     taxes.tax1,
      tax2:     taxes.tax2,
      tax3:     taxes.tax3,
    });
  } catch (err) {
    await txn.rollback();
    console.error('POST /bills error:', err);
    const detail = (err.errors && err.errors.length)
      ? err.errors.map((e) => e.message).join('; ')
      : (err.parent?.sqlMessage || err.original?.sqlMessage || err.message);
    res.status(500).json({ error: detail });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUT /api/billing/bills/:id
// Modifies an existing bill (Modify mode).
// VB6 equivalent: udfGenBill() when mImp.enEditMode = Modify
//
// Body: same as POST, plus:
//   lines[].cpkSrNo     {number}   existing detail row PK (0 = new row)
//   lines[].rowAction   {string}   'add'|'modify'|'delete'
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/:id', requirePerm('BILL_GEN', 'CanEdit'), async (req, res) => {
  const { branchID, userId } = req.user;
  const { id }               = req.params;
  const {
    fkCompID, billFrom, billTo, kgTonFlg, billDesc1, billNote,
    stFlagTrans, gstNo, fkStateID, grossAmt, billType, lines,
  } = req.body;

  if (!fkCompID || !billTo || !lines) {
    return res.status(400).json({ error: 'fkCompID, billTo, lines required' });
  }

  // VB6: udfValTransGrid() â€” validate non-deleted lines
  const activeLines = (lines || []).filter(l => (l.rowAction || 'modify') !== 'delete');
  if (activeLines.length) {
    const lineErrs = validateLines(activeLines, billType);
    if (lineErrs.length) return res.status(400).json({ error: lineErrs.join('; ') });
  }

  const db = connMgr.getDB(fkCompID);
  if (!db) return res.status(400).json({ error: `No DB for company ${fkCompID}` });

  const txn = await db.transaction();
  try {
    const gross = parseFloat(grossAmt) || 0;
    const taxes = await calculateTaxes(db, gross, billTo, fkCompID);

    // UPDATE the bill header (tBillTrHmGen1)
    // VB6: In Modify mode, AddNew is skipped; only .Update fields change
    await db.query(
      `UPDATE tBillTrHmGen1 SET
         BillDt = ?, BillFrom = ?, BillTo = ?, GrossAmt = ?,
         Tax1Desc=?, Tax1Rate=?, Tax1Amt=?,
         Tax2Desc=?, Tax2Rate=?, Tax2Amt=?,
         Tax3Desc=?, Tax3Rate=?, Tax3Amt=?,
         NetAmt=?, RoundOff=?, KgTonFlg=?, UserID=?,
         BillDesc1=?, BillNote=?,
         StFlagTrans=?, GSTNo=?, fkStateID=?
       WHERE pkBillID = ? AND fkCompID = ? AND fkBranchID = ?`,
      {
        replacements: [
          billTo, billFrom || billTo, billTo, gross,
          taxes.tax1.desc, taxes.tax1.rate, taxes.tax1.amt,
          taxes.tax2.desc, taxes.tax2.rate, taxes.tax2.amt,
          taxes.tax3.desc, taxes.tax3.rate, taxes.tax3.amt,
          taxes.netAmt, taxes.roundOff,
          kgTonFlg || 'K',
          userId,
          billDesc1 || '',
          billNote  || '',
          billType === 'TRSP' ? (stFlagTrans || 'N') : 'N',
          gstNo || '',
          fkStateID || '',
          id, fkCompID, branchID,
        ],
        transaction: txn,
      }
    );

    // Process each detail line based on rowAction.
    // VB6 udfAddBill2Detail() decides action from NewRowFlg + RowState flags.
    for (const line of lines) {
      const action = (line.rowAction || 'modify').toLowerCase();

      if (action === 'delete') {
        // VB6: DELETE FROM tBillTrHmGen2 WHERE cpkBillID=? AND cpkSrNo=?
        await db.query(
          `DELETE FROM tBillTrHmGen2 WHERE cpkBillID = ? AND cpkSrNo = ?`,
          { replacements: [id, line.cpkSrNo], transaction: txn }
        );
      } else if (action === 'add') {
        const srnoKey = `${id}!cpkSrNo`;
        const srnoLID = await gudfGenSerialID(db, srnoKey, `Bill ${id} detail Sr`, 'Y');
        if (srnoLID <= 0) throw new Error('Cannot generate detail Sr No');

        let vochrNo = 0;
        if (billType === 'HMLI' && line.recdType !== 'GEN') {
          const vKey = `${fkCompID}!${branchID}!VOUCHER_NUM`;
          const vID  = await gudfGenSerialID(db, vKey, 'Hamali Voucher Number', 'Y');
          if (vID > 0) vochrNo = vID;
        }

        await db.query(
          `INSERT INTO tBillTrHmGen2
             (cpkBillID, cpkSrNo, VochrNo, RecdSrNo, RecdType, RecdDt,
              pfkLotID, LotNum, iName, TransQty, Packing, PackWght, Tons,
              BillDesc2, FromDest, ToDest, HamaliFlg, BillRate, Amount)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          {
            replacements: [
              id, srnoLID, vochrNo,
              line.recdSrNo || 0,
              line.recdType || 'GEN',
              ['TRAN','ITEM'].includes(line.recdType) ? (line.recdDt || null) : null,
              line.pfkLotID || '', line.lotNum || '', line.iName || '',
              parseFloat(line.transQty) || 0, line.packing || '',
              parseFloat(line.packWght) || 0, parseFloat(line.tons) || 0,
              line.billDesc2 || '', line.fromDest || '', line.toDest || '',
              line.hamaliFlg || '', parseFloat(line.billRate) || 0,
              parseFloat(line.amount) || 0,
            ],
            transaction: txn,
          }
        );
      } else {
        // modify â€” update existing line
        await db.query(
          `UPDATE tBillTrHmGen2 SET
             RecdSrNo=?, RecdDt=?, pfkLotID=?, LotNum=?, iName=?,
             TransQty=?, Packing=?, PackWght=?, Tons=?,
             BillDesc2=?, FromDest=?, ToDest=?, HamaliFlg=?, BillRate=?, Amount=?
           WHERE cpkBillID = ? AND cpkSrNo = ?`,
          {
            replacements: [
              line.recdSrNo || 0,
              ['TRAN','ITEM'].includes(line.recdType) ? (line.recdDt || null) : null,
              line.pfkLotID || '', line.lotNum || '', line.iName || '',
              parseFloat(line.transQty) || 0, line.packing || '',
              parseFloat(line.packWght) || 0, parseFloat(line.tons) || 0,
              line.billDesc2 || '', line.fromDest || '', line.toDest || '',
              line.hamaliFlg || '', parseFloat(line.billRate) || 0,
              parseFloat(line.amount) || 0,
              id, line.cpkSrNo,
            ],
            transaction: txn,
          }
        );
      }
    }

    await txn.commit();
    res.json({ pkBillID: id, grossAmt: gross, netAmt: taxes.netAmt });
  } catch (err) {
    await txn.rollback();
    console.error('PUT /bills/:id error:', err);
    const detail = (err.errors && err.errors.length)
      ? err.errors.map((e) => e.message).join('; ')
      : (err.parent?.sqlMessage || err.original?.sqlMessage || err.message);
    res.status(500).json({ error: detail });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DELETE /api/billing/bills/:id
// Deletes a bill and all its detail lines.
// VB6 equivalent: cmdDelete_Click()
//
// Body: { fkCompID: string }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', requirePerm('BILL_GEN', 'CanDelete'), async (req, res) => {
  const { branchID } = req.user;
  const { id }       = req.params;
  const { fkCompID } = req.body;

  if (!fkCompID) return res.status(400).json({ error: 'fkCompID required in body' });

  const db = connMgr.getDB(fkCompID);
  if (!db) return res.status(400).json({ error: `No DB for company ${fkCompID}` });

  const txn = await db.transaction();
  try {
    // VB6: DELETE FROM tBillTrHmGen1 WHERE pkBillID = '...'
    await db.query(
      `DELETE FROM tBillTrHmGen1 WHERE pkBillID = ? AND fkCompID = ? AND fkBranchID = ?`,
      { replacements: [id, fkCompID, branchID], transaction: txn }
    );

    // VB6: DELETE FROM tBillTrHmGen2 WHERE cpkBillID = '...'
    await db.query(
      `DELETE FROM tBillTrHmGen2 WHERE cpkBillID = ?`,
      { replacements: [id], transaction: txn }
    );

    await txn.commit();
    res.json({ deleted: id });
  } catch (err) {
    await txn.rollback();
    console.error('DELETE /bills/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
