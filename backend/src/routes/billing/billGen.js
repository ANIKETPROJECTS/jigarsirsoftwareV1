// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BILLING â€” Godown Rent Bill Generation
// /api/billing/godrent
//
// VB6 Source: frmBillGen.frm
//
// TABLES (company DB):
//   tBill1        â€” bill header (one row per bill, BillType='GodRent')
//   tBill2        â€” bill detail lines (one row per lot per period)
//   tStockEntry   â€” source ARV lot data
//   mParty        â€” party master (StFlagGodRent drives eligibility)
//   mItem         â€” item master
//   mCompBillDate â€” billing period config (BillDay, from/to year-month)
//   mTax          â€” tax rates
//   VCSeriesMast / VCSeriesSrno â€” bill number series
//
// BILLING TYPES (pBillType in mParty):
//   MTH = Monthly
//   WKL = Weekly
//   LOT = Lot-wise (bill when lot is fully dispatched in period)
//   BMT = not implemented
//
// BILL NUMBER SERIES:
//   Pre-Jul-2017 : TBILL1_BILLNUM
//   Jul-2017+    : TBILL1_GST_BILLNUM
//
// TAX CASCADE (GodRent â€” applied on FULL grossAmt, no 30% abatement):
//   SERVICE TAX â†’ EDU CESS (on tax1) â†’ HGH EDU CESS (on tax1)
//   Fallbacks: SBCESS / KKCESS (on gross) â†’ CGST / SGST / IGST (on gross)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const requirePerm = require('../../middleware/permission');
const connMgr     = require('../../config/connectionManager');
const { gudfGenSerialID } = require('../../utils/serialID');

router.use(requireAuth);

// â”€â”€ Date helpers (VB6 DateAdd / DateDiff equivalents) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const localStr  = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const addDays   = (d, n) => new Date(d.getTime() + n * 86400000);
const addWeeks  = (d, n) => addDays(d, n * 7);
// VB6: DateDiff("m", d1, d2) â€” whole months from d1 to d2
const monthDiff = (d1, d2) =>
  (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());

// â”€â”€ Tax helpers (GodRent: full gross, no abatement) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTaxRate(db, taxCode, billDate, compID) {
  const [rows] = await db.query(
    `SELECT TaxRate, TaxDesc FROM mTax
     WHERE fkCompID = ? AND TaxCode = ?
       AND TaxFromDt <= ? AND (TaxToDt IS NULL OR TaxToDt >= ?)
     ORDER BY TaxFromDt DESC LIMIT 1`,
    { replacements: [compID, taxCode, billDate, billDate] }
  );
  if (!rows.length) return { rate: 0, desc: '' };
  return { rate: parseFloat(rows[0].TaxRate) || 0, desc: rows[0].TaxDesc || '' };
}

// VB6: udfTab3CalAmt â€” GodRent applies SERVICE TAX on full gross (unlike TRSP 30% abatement)
async function calcTaxes(db, grossAmt, billDate, compID) {
  let t1 = { desc: '', rate: 0, amt: 0 };
  let t2 = { desc: '', rate: 0, amt: 0 };
  let t3 = { desc: '', rate: 0, amt: 0 };

  const st = await getTaxRate(db, 'SERVICE TAX', billDate, compID);
  if (st.rate > 0) t1 = { ...st, amt: Math.round(grossAmt * (st.rate / 100) + 0.5) };

  const ec = await getTaxRate(db, 'EDU CESS', billDate, compID);
  if (ec.rate > 0) t2 = { ...ec, amt: Math.round(t1.amt * (ec.rate / 100) + 0.5) };

  const hec = await getTaxRate(db, 'HGH EDU CESS', billDate, compID);
  if (hec.rate > 0) t3 = { ...hec, amt: Math.round(t1.amt * (hec.rate / 100) + 0.5) };

  if (t2.rate === 0) {
    const sbc = await getTaxRate(db, 'SBCESS', billDate, compID);
    if (sbc.rate > 0) t2 = { ...sbc, amt: Math.round(grossAmt * (sbc.rate / 100) + 0.5) };
  }
  if (t3.rate === 0) {
    const kkc = await getTaxRate(db, 'KKCESS', billDate, compID);
    if (kkc.rate > 0) t3 = { ...kkc, amt: Math.round(grossAmt * (kkc.rate / 100) + 0.5) };
  }
  if (t1.rate === 0) {
    const cgst = await getTaxRate(db, 'CGST', billDate, compID);
    if (cgst.rate > 0) t1 = { ...cgst, amt: parseFloat((grossAmt * (cgst.rate / 100)).toFixed(2)) };
  }
  if (t2.rate === 0) {
    const sgst = await getTaxRate(db, 'SGST', billDate, compID);
    if (sgst.rate > 0) t2 = { ...sgst, amt: parseFloat((grossAmt * (sgst.rate / 100)).toFixed(2)) };
  }
  if (t3.rate === 0) {
    const igst = await getTaxRate(db, 'IGST', billDate, compID);
    if (igst.rate > 0) t3 = { ...igst, amt: parseFloat((grossAmt * (igst.rate / 100)).toFixed(2)) };
  }

  const rawNet = grossAmt + t1.amt + t2.amt + t3.amt;
  const netAmt = Math.round(rawNet);
  return { tax1: t1, tax2: t2, tax3: t3, netAmt, roundOff: parseFloat((netAmt - rawNet).toFixed(2)) };
}

// â”€â”€ Bill number generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VB6: if BillDt <= 30-Jun-2017 â†’ TBILL1_BILLNUM, else â†’ TBILL1_GST_BILLNUM
// Mirrors gudfGenSeriesNo from billTrHmGen.js
function buildSeriesNo(formatStr, dt, faYear, num) {
  const yyyy = String(dt.getFullYear());
  const yy   = yyyy.slice(-2);
  const mm   = String(dt.getMonth() + 1).padStart(2, '0');
  const m    = String(dt.getMonth() + 1);
  const dd   = String(dt.getDate()).padStart(2, '0');
  const d    = String(dt.getDate());
  const dtFA = new Date(dt); dtFA.setMonth(dtFA.getMonth() - 3);
  const faMM = String(dtFA.getMonth() + 1).padStart(2, '0');
  const faM  = String(dtFA.getMonth() + 1);
  const f4   = faYear.slice(0, 4);
  const f2   = faYear.slice(2, 4);
  const F4   = faYear.slice(5, 9) || faYear.slice(0, 4);
  const F2   = faYear.slice(7, 9) || faYear.slice(2, 4);

  let result = '', i = 0;
  while (i < formatStr.length) {
    const ch = formatStr[i];
    if (formatStr.slice(i,i+4)==='yyyy')      { result+=yyyy; i+=4; }
    else if (formatStr.slice(i,i+2)==='yy')   { result+=yy;   i+=2; }
    else if (ch==='y')                         { result+=yyyy.slice(-1); i+=1; }
    else if (formatStr.slice(i,i+2)==='mm')   { result+=mm;   i+=2; }
    else if (ch==='m')                         { result+=m;    i+=1; }
    else if (formatStr.slice(i,i+2)==='MM')   { result+=faMM; i+=2; }
    else if (ch==='M')                         { result+=faM;  i+=1; }
    else if (formatStr.slice(i,i+2)==='dd')   { result+=dd;   i+=2; }
    else if (ch==='d')                         { result+=d;    i+=1; }
    else if (formatStr.slice(i,i+4)==='ffff') { result+=f4;   i+=4; }
    else if (formatStr.slice(i,i+2)==='ff')   { result+=f2;   i+=2; }
    else if (formatStr.slice(i,i+4)==='FFFF') { result+=F4;   i+=4; }
    else if (formatStr.slice(i,i+2)==='FF')   { result+=F2;   i+=2; }
    else if (ch==='\\') { if (i+1<formatStr.length){result+=formatStr[i+1];i+=2;}else i++; }
    else if (ch==='N')  { result+=String(num); i++; }
    else if (ch==='n')  {
      let k=0; while(i+k<formatStr.length && formatStr[i+k]==='n') k++;
      result+=String(num).padStart(k,'0'); i+=k;
    } else { result+=ch; i++; }
  }
  return result;
}

async function genBillNumber(db, billDate, compID, branchID) {
  const seriesCode = new Date(billDate) <= new Date('2017-06-30')
    ? 'TBILL1_BILLNUM' : 'TBILL1_GST_BILLNUM';

  const t = await db.transaction();
  try {
    const [mastRows] = await db.query(
      `SELECT pkSeriesID, Series, SeriesType, FormatStr, FA_Nor_Alt
       FROM VCSeriesMast
       WHERE fkCompID = ? AND fkBranchID = ? AND SeriesCode = ? AND Active = 'Y' LIMIT 1`,
      { replacements: [compID, branchID, seriesCode], transaction: t }
    );
    if (!mastRows.length) { await t.rollback(); return null; }
    const mast = mastRows[0];

    const dt   = new Date(billDate);
    const yyyy = String(dt.getFullYear());
    const mm   = String(dt.getMonth() + 1).padStart(2, '0');
    const dd   = String(dt.getDate()).padStart(2, '0');

    let faYear = '0000-0000', seriesDate = '00000000';
    const getFY = async () => {
      const [r] = await db.query(
        `SELECT FaYear FROM FaYearInfo
         WHERE fkCompID=? AND Active='Y' AND Nor_Alt=?
           AND StartDate<=? AND EndDate>=?
         ORDER BY StartDate DESC LIMIT 1`,
        { replacements: [compID, mast.FA_Nor_Alt||'N', billDate, billDate], transaction: t }
      );
      return r.length ? r[0].FaYear : '0000-0000';
    };

    if (mast.SeriesType === 'FY')      { faYear = await getFY(); }
    else if (mast.SeriesType === 'L')  { /* faYear stays default */ }
    else if (mast.SeriesType === 'CY') { faYear = `${yyyy}-${yyyy}`; seriesDate = `${yyyy}0000`; }
    else if (mast.SeriesType === 'M')  { faYear = await getFY(); seriesDate = `${yyyy}${mm}00`; }
    else if (mast.SeriesType === 'D')  { faYear = await getFY(); seriesDate = `${yyyy}${mm}${dd}`; }

    const [srRows] = await db.query(
      `SELECT LastNo FROM VCSeriesSrno
       WHERE fkSeriesID=? AND fkCompID=? AND fkBranchID=? AND FaYear=? AND SeriesDate=?
       FOR UPDATE`,
      { replacements: [mast.pkSeriesID, compID, branchID, faYear, seriesDate], transaction: t }
    );
    let lastNo;
    if (!srRows.length) {
      await db.query(
        `INSERT INTO VCSeriesSrno (fkSeriesID, fkCompID, fkBranchID, SeriesID, FaYear, SeriesDate, LastNo)
         VALUES (?,?,?,?,?,?,1)`,
        { replacements: [mast.pkSeriesID, compID, branchID, mast.Series, faYear, seriesDate], transaction: t }
      );
      lastNo = 1;
    } else {
      lastNo = Number(srRows[0].LastNo) + 1;
      await db.query(
        `UPDATE VCSeriesSrno SET LastNo=?
         WHERE fkSeriesID=? AND fkCompID=? AND fkBranchID=? AND FaYear=? AND SeriesDate=?`,
        { replacements: [lastNo, mast.pkSeriesID, compID, branchID, faYear, seriesDate], transaction: t }
      );
    }
    const num = buildSeriesNo(mast.FormatStr, dt, faYear, lastNo);
    await t.commit();
    return num;
  } catch (err) {
    try { await t.rollback(); } catch {}
    console.error('[billGen] genBillNumber error:', err);
    return null;
  }
}

// â”€â”€ mCompBillDate: compute bill period for a given date â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VB6: udfGetBillDay + udfGetBillPeriod
async function getBillPeriod(db, compID, billDate) {
  const d   = new Date(billDate);
  const yr  = d.getFullYear();
  const mo  = d.getMonth() + 1;
  const ym  = `${yr}${String(mo).padStart(2, '0')}`;

  const [rows] = await db.query(
    `SELECT BillDay, FromYearMonth, ToYearMonth, NextYearMonth
     FROM mCompBillDate
     WHERE fkCompID = ? AND FromYearMonth <= ?
       AND (ToYearMonth >= ? OR ToYearMonth IS NULL)
     ORDER BY FromYearMonth DESC LIMIT 1`,
    { replacements: [compID, ym, ym] }
  );
  if (!rows.length) return null;

  const row = rows[0];
  const lastDay     = new Date(yr, mo, 0).getDate();
  const cappedDay   = Math.min(row.BillDay, lastDay);
  const billTo      = `${yr}-${String(mo).padStart(2,'0')}-${String(cappedDay).padStart(2,'0')}`;
  const nextYearMonth = row.NextYearMonth || '';

  // nFromBillDay = Day(DateAdd("m",-1, DateAdd("d",1, DateSerial(yr,mo,cappedDay))))
  const toPlus1     = new Date(yr, mo - 1, cappedDay + 1);
  const prevOfTo1   = new Date(toPlus1.getFullYear(), toPlus1.getMonth() - 1, toPlus1.getDate());
  const billFromDay = prevOfTo1.getDate();

  let billFrom;
  if (row.FromYearMonth === ym) {
    // Billing cycle transition month: use prev config's end+1
    const [prevRows] = await db.query(
      `SELECT BillDay, ToYearMonth FROM mCompBillDate
       WHERE fkCompID = ? AND NextYearMonth = ? LIMIT 1`,
      { replacements: [compID, row.FromYearMonth] }
    );
    if (prevRows.length) {
      const pym  = prevRows[0].ToYearMonth;
      const pYr  = parseInt(pym.slice(0, 4));
      const pMo  = parseInt(pym.slice(4, 6));
      const pLast = new Date(pYr, pMo, 0).getDate();
      const pCap  = Math.min(prevRows[0].BillDay, pLast);
      billFrom = localStr(new Date(pYr, pMo - 1, pCap + 1));
    } else {
      billFrom = localStr(new Date(toPlus1.getFullYear(), toPlus1.getMonth() - 1, toPlus1.getDate()));
    }
  } else {
    // Normal: DateAdd("m",-1, billToDt+1)
    billFrom = localStr(new Date(toPlus1.getFullYear(), toPlus1.getMonth() - 1, toPlus1.getDate()));
  }

  return { billTo, billFrom, billFromDay, nextYearMonth };
}

// â”€â”€ Lot billing period computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VB6: udfTab2MTH / udfTab2WKL / udfTab2LOT + udfTab2Fill
//
// txnMap: pre-fetched { pfkOriLotID => [{dt, qty}] } for in-memory balance calculation
// (avoids NÃ—M DB queries â€” one pre-fetch per party covers all lot periods)
function getBalance(txnMap, pfkOriLotID, beforeDate) {
  const entries = txnMap[pfkOriLotID] || [];
  let total = 0;
  for (const e of entries) { if (e.dt < beforeDate) total += e.qty; }
  return total !== 0 ? total : null; // null = no balance (VB6 CalBal = False)
}

function processLotPeriods(arv, billFromDt, billToDt, billFromDay, nextYearMonth, txnMap) {
  const lots   = [];
  const arvDt  = new Date(arv.OriTransDt);
  const oriQty = Number(arv.OriTransQty);
  const rate   = Number(arv.RentRate);

  const base = {
    partyID:     arv.fkPartyID,
    pName:       arv.pName,
    pBillType:   arv.pBillType,
    stFlag:      arv.StFlagGodRent,
    gstNo:       arv.GSTNo,
    fkStateID:   arv.fkStateID,
    lotNum:      arv.LotNum,
    pfkLotID:    arv.pfkLotID,
    pfkOriLotID: arv.pfkOriLotID,
    oriTransDt:  localStr(new Date(arv.OriTransDt)),
    oriTransQty: oriQty,
    iName:       `${arv.iName || ''} ${arv.ItemExtDesc || ''}`.trim(),
    packing:     arv.Packing,
    packWght:    Number(arv.PackWght) || 0,
    rentRate:    rate,
    fkItemID:    arv.fkItemID,
  };

  const push = (fromDt, toDt, balQty) => {
    lots.push({ ...base, fromDt: localStr(fromDt), toDt: localStr(toDt), balQty, amount: balQty * rate });
  };

  // Effective balance at a period start â€” matches VB6 udfTab2Fill logic:
  //   if OriTransDt = LotFromDt â†’ use OriTransQty (first billing of newly-arrived lot)
  //   else â†’ use computed balance
  const effBal = (fromDt, bal) => {
    if (arvDt.getTime() === fromDt.getTime()) return oriQty;
    return bal;
  };

  // VB6 udfTab2Gen: nDtDiff = DateDiff("m", arvDt, billFromDt) + adjustment for billing day
  let nDtDiff = monthDiff(arvDt, billFromDt);
  if (arvDt.getDate() < billFromDay) nDtDiff++;
  let dFrom = addMonths(arvDt, nDtDiff);
  let dTo   = addDays(addMonths(dFrom, 1), -1);

  // Transition month check: billing cycle changes this month (special loop required)
  const billToYM = `${billToDt.getFullYear()}${String(billToDt.getMonth()+1).padStart(2,'0')}`;
  const isTransition = nextYearMonth !== '' && billToYM === nextYearMonth;

  switch (arv.pBillType) {
    case 'MTH': {
      if (isTransition) {
        // Loop all missed periods up to billToDt (cycle catch-up)
        while (localStr(dFrom) <= localStr(billToDt)) {
          dTo = addDays(addMonths(dFrom, 1), -1);
          const bal = getBalance(txnMap, arv.pfkOriLotID, dFrom);
          const qty = effBal(dFrom, bal);
          if (qty && qty > 0) push(dFrom, dTo, qty);
          else if (bal === null && nDtDiff === 0) push(dFrom, dTo, oriQty);
          dFrom = addDays(dTo, 1);
          nDtDiff = 1; // subsequent iterations are not nDtDiff=0
        }
      } else {
        // Normal: single billing period
        const bal = getBalance(txnMap, arv.pfkOriLotID, dFrom);
        if (bal !== null) {
          push(dFrom, dTo, effBal(dFrom, bal));
        } else if (nDtDiff === 0) {
          push(dFrom, dTo, oriQty); // Just arrived this billing month
        }
      }
      break;
    }

    case 'WKL': {
      // nWeekDiff = Round(((billFromDt - arvDt) / 7) + 0.49, 0)
      const daysDiff = (billFromDt - arvDt) / 86400000;
      const nWkDiff  = Math.round((daysDiff / 7) + 0.49);
      dFrom = arvDt < billFromDt ? addWeeks(arvDt, nWkDiff) : new Date(arvDt);
      while (localStr(dFrom) <= localStr(billToDt)) {
        dTo = addDays(addWeeks(dFrom, 1), -1);
        const bal = getBalance(txnMap, arv.pfkOriLotID, dFrom);
        if (bal !== null) {
          push(dFrom, dTo, effBal(dFrom, bal));
        } else if (dFrom.getTime() === arvDt.getTime()) {
          push(dFrom, dTo, oriQty); // Arrived on period start
        }
        dFrom = addDays(dTo, 1);
      }
      break;
    }

    case 'LOT': {
      // Bill only if lot has balance at billFrom AND no balance at billTo (fully dispatched)
      const balAtFrom    = getBalance(txnMap, arv.pfkOriLotID, billFromDt);
      const balAfterTo   = getBalance(txnMap, arv.pfkOriLotID, addDays(billToDt, 1));
      if (balAtFrom === null || balAfterTo !== null) break;
      // Loop monthly from arrival date through billing period
      dFrom = new Date(arvDt);
      while (dFrom < billToDt) {
        dTo = addDays(addMonths(dFrom, 1), -1);
        const bal = getBalance(txnMap, arv.pfkOriLotID, dFrom);
        const qty = arvDt.getTime() === dFrom.getTime() ? oriQty : (bal || 0);
        if (qty > 0) push(dFrom, dTo, qty);
        dFrom = addDays(dTo, 1);
      }
      break;
    }
  }

  return lots;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/godrent/form-data?compID=X&billDate=YYYY-MM-DD
// Returns parties, companies, and bill period for given company + date.
// VB6: Form_Load â†’ udfTab1Pop + udfGetBillDay
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/form-data', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const billDate = req.query.billDate || localStr(new Date());
    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    // Active parties in the login company eligible for GodownRent billing
    const [parties] = await db.query(
      `SELECT pkPartyID, pName, pCode, pBillType, pGroup,
              StFlagGodRent, GSTNo, fkStateID
       FROM mParty
       WHERE fkCompID = ?
         AND Active = 'Y'
         AND StFlagGodRent IS NOT NULL AND StFlagGodRent <> ''
       ORDER BY pName`,
      { replacements: [compID] }
    );

    const period = await getBillPeriod(db, compID, billDate);

    res.json({ parties, period });
  } catch (err) {
    console.error('[billGen] form-data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/godrent/lots
// Loads ARV lots for selected parties with billing periods and balances.
// VB6: udfTab2Pop â†’ udfTab2Gen â†’ udfTab2MTH/WKL/LOT + udfTab2CalBal + udfTab2Fill
//
// Body: { compID, billDate, partyIDs: [], billable: 'Y'|'N' }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/lots', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const { billDate, partyIDs, billable } = req.body;

    if (!billDate || !Array.isArray(partyIDs) || partyIDs.length === 0) {
      return res.status(400).json({ error: 'billDate and partyIDs required' });
    }

    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    const period = await getBillPeriod(db, compID, billDate);
    if (!period) return res.status(400).json({ error: 'No billing period configured for this company and date' });

    const { billTo, billFrom, billFromDay, nextYearMonth } = period;
    const billFlg = billable === 'N' ? 'N' : 'Y';

    // Get FaYear and prevFaYear for the bill date
    const [fyRows] = await db.query(
      `SELECT FaYear, StartDate FROM FaYearInfo
       WHERE fkCompID = ? AND Active = 'Y' AND Nor_Alt = 'N'
         AND StartDate <= ? AND EndDate >= ?
       ORDER BY StartDate DESC LIMIT 1`,
      { replacements: [compID, billTo, billTo] }
    );
    const faYear = fyRows[0]?.FaYear;
    if (!faYear) return res.status(400).json({ error: 'Financial year not found for bill date' });

    const [prevFyRows] = await db.query(
      `SELECT FaYear FROM FaYearInfo
       WHERE fkCompID = ? AND Active = 'Y' AND Nor_Alt = 'N' AND EndDate < ?
       ORDER BY EndDate DESC LIMIT 1`,
      { replacements: [compID, fyRows[0].StartDate] }
    );
    const prevFaYear = prevFyRows[0]?.FaYear || null;

    const billFromDt = new Date(billFrom);
    const billToDt   = new Date(billTo);
    const allLots    = [];

    // Build IN(...) placeholders â€” one query for ALL parties instead of N queries
    const ph = partyIDs.map(() => '?').join(',');

    // Query 1: ARV lots for all parties (current FaYear)
    let arvSql = `
      SELECT STRAIGHT_JOIN
             pm.pName, pm.pBillType, pm.StFlagGodRent, pm.GSTNo, pm.fkStateID,
             im.iName, ts.LotNum, ts.TransDt, ts.pfkLotID, ts.pfkOriLotID,
             ts.OriTransDt, ts.OriTransQty, ts.fkPartyID, ts.fkItemID,
             ts.TransQty, ts.RentRate, ts.Packing, ts.ItemExtDesc, ts.LotBillFlg, ts.PackWght
      FROM tStockEntry ts
      JOIN mParty pm ON pm.pkPartyID = ts.fkPartyID
      JOIN mItem  im ON im.pkItemID  = ts.fkItemID
      WHERE ts.fkCompID   = ?
        AND ts.fkBranchID = ?
        AND ts.fkPartyID  IN (${ph})
        AND ts.TransType  = 'ARV'
        AND ts.TransDt   <= ?
        AND ts.FaYear     = ?
        AND ts.LotBillFlg = ?`;
    const arvParams = [compID, branchID, ...partyIDs, billTo, faYear, billFlg];

    if (prevFaYear) {
      arvSql += `
      UNION ALL
      SELECT STRAIGHT_JOIN
             pm.pName, pm.pBillType, pm.StFlagGodRent, pm.GSTNo, pm.fkStateID,
             im.iName, ts.LotNum, ts.TransDt, ts.pfkLotID, ts.pfkOriLotID,
             ts.OriTransDt, ts.OriTransQty, ts.fkPartyID, ts.fkItemID,
             ts.TransQty, ts.RentRate, ts.Packing, ts.ItemExtDesc, ts.LotBillFlg, ts.PackWght
      FROM tStockEntry ts
      JOIN mParty pm ON pm.pkPartyID = ts.fkPartyID
      JOIN mItem  im ON im.pkItemID  = ts.fkItemID
      WHERE ts.fkCompID   = ?
        AND ts.fkBranchID = ?
        AND ts.fkPartyID  IN (${ph})
        AND ts.FaYear     = ?
        AND ts.TransDt   >= ?
        AND ts.LotBillFlg = ?
        AND ts.pfkLotID NOT IN (
          SELECT pfkOriLotID FROM tStockEntry
          WHERE fkCompID   = ?
            AND fkBranchID = ?
            AND fkPartyID  IN (${ph})
            AND TransType  = 'ARV'
            AND OpFlg      = 'Y'
            AND FaYear     = ?
        )`;
      arvParams.push(compID, branchID, ...partyIDs, prevFaYear, billFrom, billFlg,
                     compID, branchID, ...partyIDs, faYear);
    }

    arvSql += '\nORDER BY LotNum';

    // Query 2: all OpFlg='N' transactions for all parties (balance calc)
    const [arvRows, txnRowsResult] = await Promise.all([
      db.query(arvSql, { replacements: arvParams }),
      db.query(
        `SELECT pfkOriLotID, TransDt, TransQty
         FROM tStockEntry
         WHERE fkCompID = ? AND fkBranchID = ? AND fkPartyID IN (${ph}) AND OpFlg = 'N'`,
        { replacements: [compID, branchID, ...partyIDs] }
      ),
    ]);

    const txnMap = {};
    for (const t of txnRowsResult[0]) {
      if (!txnMap[t.pfkOriLotID]) txnMap[t.pfkOriLotID] = [];
      txnMap[t.pfkOriLotID].push({ dt: new Date(t.TransDt), qty: Number(t.TransQty) });
    }

    for (const arv of arvRows[0]) {
      const lotPeriods = processLotPeriods(arv, billFromDt, billToDt, billFromDay, nextYearMonth, txnMap);
      allLots.push(...lotPeriods);
    }

    res.json({ lots: allLots, billFrom, billTo });
  } catch (err) {
    console.error('[billGen] lots error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/godrent/validate
// Check which selected parties already have a bill for the given date.
// VB6: udfTab1ErrorList
//
// Body: { compID, billDate, partyIDs: [] }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/validate', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const { billDate, partyIDs } = req.body;
    if (!billDate || !Array.isArray(partyIDs)) {
      return res.status(400).json({ error: 'billDate and partyIDs required' });
    }
    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    const duplicates = [];
    for (const partyID of partyIDs) {
      const [rows] = await db.query(
        `SELECT b.pkBillID, b.BillNum, b.BillDt, b.GrossAmt, b.NetAmt, b.fkPartyID,
                COALESCE(p.pName, b.fkPartyID) AS pName
         FROM tBill1 b
         LEFT JOIN mParty p ON p.pkPartyID = b.fkPartyID
         WHERE b.fkCompID = ? AND b.fkBranchID = ?
           AND b.BillType = 'GodRent'
           AND DATE(b.BillDt) = ?
           AND b.fkPartyID = ?
         LIMIT 1`,
        { replacements: [compID, branchID, billDate, partyID] }
      );
      if (rows.length) duplicates.push(rows[0]);
    }
    res.json({ duplicates });
  } catch (err) {
    console.error('[billGen] validate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/godrent/generate
// Generate bills: tBill1 header + tBill2 detail lines per party.
// VB6: udfTab3Pop â†’ udfTab3Gen + udfTab3GenSrNo + udfTab3CalAmt + udfTab3ReGenSrNo
//
// Body: {
//   compID, billDate, billFrom, billTo,
//   lots: [{ partyID, pName, stFlag, gstNo, fkStateID,
//             pfkLotID, pfkOriLotID, fromDt, toDt, balQty, rentRate }]
// }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/generate', requirePerm('BILL_GEN', 'CanAdd'), async (req, res) => {
  try {
    const { compID, branchID } = req.user;
    const { billDate, billFrom, billTo, lots, existingBills = {} } = req.body;

    if (!billDate || !Array.isArray(lots) || lots.length === 0) {
      return res.status(400).json({ error: 'billDate and lots required' });
    }

    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    // Group lots by partyID (preserving order â€” VB6 processes in order)
    const byParty = {};
    const partyOrder = [];
    for (const lot of lots) {
      if (!byParty[lot.partyID]) {
        byParty[lot.partyID] = [];
        partyOrder.push(lot.partyID);
      }
      byParty[lot.partyID].push(lot);
    }

    const generated = [];

    for (const partyID of partyOrder) {
      const partyLots = byParty[partyID];
      const first     = partyLots[0];

      // existingBills[partyID] is set when user proceeded after the "already billed" warning.
      // In that case we UPDATE the existing bill and keep the original BillNum / pkBillID.
      const existing = existingBills[partyID] || null;

      let pkBillID, billNum;

      if (existing) {
        // MODIFY: reuse existing IDs â€” no new bill number consumed
        pkBillID = existing.pkBillID;
        billNum  = existing.billNum;
      } else {
        // NEW: generate bill ID and bill number
        const pkKey = `${compID}!${branchID}!tBill!cpkBillId`;
        try {
          const [maxRows] = await db.query(
            `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(pkBillID, '!', -1) AS UNSIGNED)), 0) AS maxN
             FROM tBill1 WHERE fkCompID = ? AND fkBranchID = ?`,
            { replacements: [compID, branchID] }
          );
          const maxN = Number(maxRows[0]?.maxN) || 0;
          if (maxN > 0) {
            await db.query(
              `INSERT INTO SerialID (pkSerialID, LastID, SerialDesc)
               VALUES (?, ?, 'GodRent Bill - cpkBillId')
               ON DUPLICATE KEY UPDATE LastID = GREATEST(LastID, VALUES(LastID))`,
              { replacements: [pkKey, maxN] }
            );
          }
        } catch { /* non-fatal */ }

        const billIDN = await gudfGenSerialID(db, pkKey, 'GodRent Bill - cpkBillId', 'Y');
        if (billIDN <= 0) {
          return res.status(500).json({ error: `Cannot generate Bill ID for party ${partyID}` });
        }
        pkBillID = `${compID}!${branchID}!${billIDN}`;

        billNum = await genBillNumber(db, billDate, compID, branchID);
        if (!billNum) {
          return res.status(500).json({ error: `Cannot generate Bill Number for party ${partyID}` });
        }
      }

      const txn = await db.transaction();
      try {
        const grossAmt = partyLots.reduce((s, lot) => s + (Number(lot.balQty) * Number(lot.rentRate)), 0);

        if (existing) {
          // MODIFY: wipe old detail lines then reset header amounts (taxes recalculated below)
          await db.query(
            `DELETE FROM tBill2 WHERE cpkBillID = ?`,
            { replacements: [pkBillID], transaction: txn }
          );
          await db.query(
            `UPDATE tBill1 SET
               BillDt=?, BillFrom=?, BillTo=?,
               StFlagGodRent=?, GSTNo=?, fkStateID=?,
               GrossAmt=0, NetAmt=0, RoundOff=0,
               Tax1Desc='', Tax1Rate=0, Tax1Amt=0,
               Tax2Desc='', Tax2Rate=0, Tax2Amt=0,
               Tax3Desc='', Tax3Rate=0, Tax3Amt=0
             WHERE pkBillID=? AND fkCompID=? AND fkBranchID=?`,
            {
              replacements: [
                billDate, billFrom || billDate, billTo || billDate,
                first.stFlag || '', first.gstNo || '', first.fkStateID || '',
                pkBillID, compID, branchID,
              ],
              transaction: txn,
            }
          );
        } else {
          // NEW: insert bill header with zero amounts (taxes filled in below)
          await db.query(
            `INSERT INTO tBill1
               (pkBillID, BillStatus, fkCompID, fkBranchID, BillType, BillNum,
                BillDt, BillFrom, BillTo, fkPartyID, GrossAmt, NetAmt,
                Tax1Desc, Tax1Rate, Tax1Amt,
                Tax2Desc, Tax2Rate, Tax2Amt,
                Tax3Desc, Tax3Rate, Tax3Amt,
                RoundOff, StFlagGodRent, GSTNo, fkStateID, LtrFlg)
             VALUES (?,?,?,?,?,?,?,?,?,?,0,0,'',0,0,'',0,0,'',0,0,0,?,?,?,'N')`,
            {
              replacements: [
                pkBillID, 'N', compID, branchID, 'GodRent', billNum,
                billDate, billFrom || billDate, billTo || billDate, partyID,
                first.stFlag || '', first.gstNo || '', first.fkStateID || '',
              ],
              transaction: txn,
            }
          );
        }

        // Insert detail lines (identical for new and modify)
        let srNo = 0;
        for (const lot of partyLots) {
          srNo++;
          await db.query(
            `INSERT INTO tBill2 (cpkBillID, cpkSrNo, fkLotID, BillRate, BalQty, FromDt, ToDt)
             VALUES (?,?,?,?,?,?,?)`,
            {
              replacements: [
                pkBillID, srNo, lot.pfkLotID,
                Number(lot.rentRate), Number(lot.balQty),
                lot.fromDt, lot.toDt,
              ],
              transaction: txn,
            }
          );
        }

        // Calculate taxes and update tBill1 (identical for new and modify)
        const taxes = await calcTaxes(db, grossAmt, billDate, compID);
        await db.query(
          `UPDATE tBill1 SET
             GrossAmt=?, NetAmt=?, RoundOff=?,
             Tax1Desc=?, Tax1Rate=?, Tax1Amt=?,
             Tax2Desc=?, Tax2Rate=?, Tax2Amt=?,
             Tax3Desc=?, Tax3Rate=?, Tax3Amt=?
           WHERE pkBillID=?`,
          {
            replacements: [
              grossAmt, taxes.netAmt, taxes.roundOff,
              taxes.tax1.desc, taxes.tax1.rate, taxes.tax1.amt,
              taxes.tax2.desc, taxes.tax2.rate, taxes.tax2.amt,
              taxes.tax3.desc, taxes.tax3.rate, taxes.tax3.amt,
              pkBillID,
            ],
            transaction: txn,
          }
        );

        await txn.commit();

        generated.push({
          pkBillID, billNum,
          partyID, pName: first.pName,
          lotCount: srNo,
          grossAmt, netAmt: taxes.netAmt,
          billDate, billFrom, billTo,
          isUpdate: !!existing,
        });
      } catch (err) {
        try { await txn.rollback(); } catch {}
        throw err;
      }
    }

    res.json({ generated });
  } catch (err) {
    console.error('[billGen] generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/godrent/bills
// List GodRent bills for a company and financial year.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/bills', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { branchID, compID: userCompID } = req.user;
    const compID = req.query.compID || userCompID;
    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    const { faYear, partyID } = req.query;

    // Default to current FaYear date range if faYear param given
    let yearStart = '1900-01-01', yearEnd = '9999-12-31';
    if (faYear) {
      const [fyRows] = await db.query(
        `SELECT DATE_FORMAT(StartDate,'%Y-%m-%d') AS s, DATE_FORMAT(EndDate,'%Y-%m-%d') AS e
         FROM FaYearInfo WHERE fkCompID=? AND FaYear=? AND Active='Y' AND Nor_Alt='N' LIMIT 1`,
        { replacements: [compID, faYear] }
      );
      if (fyRows.length) { yearStart = fyRows[0].s; yearEnd = fyRows[0].e; }
    }

    let sql = `
      SELECT b.pkBillID, b.BillNum, b.BillDt, b.BillFrom, b.BillTo,
             b.BillType, b.BillStatus, b.GrossAmt, b.NetAmt,
             b.fkPartyID, b.fkCompID,
             COALESCE(p.pName, b.fkPartyID) AS pName
      FROM tBill1 b
      LEFT JOIN mParty p ON p.pkPartyID = b.fkPartyID
      WHERE b.fkCompID = ? AND b.fkBranchID = ? AND b.BillType = 'GodRent'
        AND b.BillDt >= ? AND b.BillDt <= ?`;
    const rp = [compID, branchID, yearStart, yearEnd];
    if (partyID) { sql += ' AND b.fkPartyID = ?'; rp.push(partyID); }
    sql += ' ORDER BY b.BillDt DESC, b.BillNum DESC';

    const [bills] = await db.query(sql, { replacements: rp });
    res.json({ bills });
  } catch (err) {
    console.error('[billGen] bills list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/billing/godrent/bills/:id
// Single GodRent bill with tBill2 detail lines.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/bills/:id', requirePerm('BILL_GEN', 'CanView'), async (req, res) => {
  try {
    const { branchID, compID: userCompID } = req.user;
    const compID = req.query.compID || userCompID;
    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    const [bills] = await db.query(
      `SELECT b.*, COALESCE(p.pName, b.fkPartyID) AS pName
       FROM tBill1 b LEFT JOIN mParty p ON p.pkPartyID = b.fkPartyID
       WHERE b.pkBillID = ? AND b.fkCompID = ? AND b.fkBranchID = ?`,
      { replacements: [req.params.id, compID, branchID] }
    );
    if (!bills.length) return res.status(404).json({ error: 'Bill not found' });

    const [lines] = await db.query(
      `SELECT d.*, ts.LotNum, im.iName
       FROM tBill2 d
       LEFT JOIN tStockEntry ts ON ts.pfkLotID = d.fkLotID
       LEFT JOIN mItem im ON im.pkItemID = ts.fkItemID
       WHERE d.cpkBillID = ?
       ORDER BY d.cpkSrNo`,
      { replacements: [req.params.id] }
    );

    res.json({ bill: bills[0], lines });
  } catch (err) {
    console.error('[billGen] bill detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DELETE /api/billing/godrent/bills/:id
// Cancel (delete) a GodRent bill.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/bills/:id', requirePerm('BILL_GEN', 'CanDelete'), async (req, res) => {
  try {
    const { branchID, compID: userCompID } = req.user;
    const compID = req.query.compID || userCompID;
    const db = connMgr.getDB(compID);
    if (!db) return res.status(400).json({ error: 'Company not found' });

    const [bills] = await db.query(
      `SELECT pkBillID FROM tBill1
       WHERE pkBillID = ? AND fkCompID = ? AND fkBranchID = ? AND BillType = 'GodRent'`,
      { replacements: [req.params.id, compID, branchID] }
    );
    if (!bills.length) return res.status(404).json({ error: 'Bill not found' });

    const txn = await db.transaction();
    try {
      await db.query(`DELETE FROM tBill2 WHERE cpkBillID = ?`, { replacements: [req.params.id], transaction: txn });
      await db.query(`DELETE FROM tBill1 WHERE pkBillID = ?`, { replacements: [req.params.id], transaction: txn });
      await txn.commit();
      res.json({ success: true });
    } catch (err) {
      try { await txn.rollback(); } catch {}
      throw err;
    }
  } catch (err) {
    console.error('[billGen] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
