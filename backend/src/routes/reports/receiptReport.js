// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// receiptReport.js  â€”  /api/reports/receipt-report
// VB6 Source: frmRecptReport.frm
//
// Three report modes (VB6: vfgRecpt cixRepType combo):
//   LDGREP   â€” Ledger Report (standard: 3-part UNION; ledger-format: 5-part UNION)
//   RECPTENT â€” Receipt Entry (header list + detail on click)
//   SUMREP   â€” Summary Report with aging buckets (+ detail on click)
//
// Multi-company: VB6 looped gDb.sDBName[] and built UNION ALL in SQL.
//   Here we iterate connectionManager.getGroupCompanyDetails(groupID), query each
//   company DB, and merge sorted results in JS â€” identical semantic behaviour.
//
// SQL notes vs VB6:
//   â€¢ ISNULL(x,y)               â†’ IFNULL(x,y)
//   â€¢ GETDATE()                 â†’ CURDATE()
//   â€¢ DATEDIFF(DD,d1,GETDATE()) â†’ DATEDIFF(CURDATE(),d1)  (MySQL arg order reversed)
//   â€¢ ADS.dbo.tRecpt2 bug       â†’ fixed to plain tRecpt2 (same company DB)
//   â€¢ vBillRegister             â†’ inline UNION ALL of tBill1 + tBillTrHmGen1
//   â€¢ vamParty                  â†’ mParty WHERE Active='Y'
//   â€¢ vInvoice_Recpt_Amt        â†’ used as-is (already a MySQL view in each company DB)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

'use strict';

const fs                = require('fs');
const path              = require('path');
const router            = require('express').Router();
const PDFDocument       = require('pdfkit');
const nodemailer        = require('nodemailer');
const requireAuth       = require('../../middleware/auth');
const requirePerm       = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');

// ── Letterhead image cache ────────────────────────────────────────────────────
// Matches the frontend print logic: BHW → ADS_LetterHead.png, VLCO → VLCO_LetterHead.png
const _ltrPathCache = {};
function getLetterheadPath(groupID) {
  if (_ltrPathCache[groupID] !== undefined) return _ltrPathCache[groupID];
  const filename = groupID === 'BHW'  ? 'ADS_Logo.png'
                 : groupID === 'VLCO' ? 'VLCO_LetterHead.png'
                 : null;
  if (!filename) return (_ltrPathCache[groupID] = null);
  const p = path.join(__dirname, '../../assets/letterheads', filename);
  return (_ltrPathCache[groupID] = fs.existsSync(p) ? p : null);
}

router.use(requireAuth);

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const localStr = d => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

function getSmtpConfig(groupID) {
  const g = (groupID || '').toUpperCase();
  const e = k => process.env[`SMTP_${g}_${k}`] || process.env[`SMTP_${k}`];
  const user = e('USER');
  const pass = e('PASS');
  if (!user || !pass) return null;
  const port   = parseInt(e('PORT') || '465');
  const secure = (e('SECURE') || 'true') !== 'false';
  return {
    host:     e('HOST')      || 'smtp.gmail.com',
    port, secure,
    auth:     { user, pass },
    fromName: e('FROM_NAME') || 'GMS Reports',
    fromAddr: e('FROM_ADDR') || user,
    compName: e('COMP_NAME') || process.env.COMPANY_NAME || 'GMS',
    website:  e('COMP_WEB')  || process.env.COMPANY_WEB  || 'www.adityaservices.co.in',
  };
}

// Build correlated scalar subqueries for the opening balance row per party.
// stDate = the FROM date of the filter range (bills <= stDate qualify).
function buildOpeningBalSQL(billTypes, compID, branchID, stDate, partyIDs) {
  const hasGodrent = billTypes.includes('GODRENT');
  const otherTypes = billTypes.filter(t => t !== 'GODRENT');
  const partyPh    = partyIDs.map(() => '?').join(',');

  const billParts = [];
  const billPrms  = [];

  if (hasGodrent) {
    billParts.push(
      `IFNULL((SELECT SUM(IFNULL(b.NetAmt,b.GrossAmt)) FROM tBill1 b
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt<=? AND b.BillStatus='N'
                 AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    billPrms.push(compID, branchID, stDate);
  }

  if (otherTypes.length) {
    const tph = otherTypes.map(() => '?').join(',');
    billParts.push(
      `IFNULL((SELECT SUM(IFNULL(b.NetAmt,b.GrossAmt)) FROM tBillTrHmGen1 b
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt<=? AND b.BillStatus='N'
                 AND b.BillType IN (${tph}) AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    billPrms.push(compID, branchID, stDate, ...otherTypes);
  }

  const rcptParts = [];
  const rcptPrms  = [];

  if (hasGodrent) {
    rcptParts.push(
      `IFNULL((SELECT SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0))
               FROM tBill1 b JOIN tRecpt2 r2 ON r2.fkBillID COLLATE utf8mb4_unicode_ci=b.pkBillID AND r2.BillType='GODRENT'
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt<=? AND b.BillStatus='N'
                 AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    rcptPrms.push(compID, branchID, stDate);
  }

  if (otherTypes.length) {
    const tph = otherTypes.map(() => '?').join(',');
    rcptParts.push(
      `IFNULL((SELECT SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0))
               FROM tBillTrHmGen1 b JOIN tRecpt2 r2 ON r2.fkBillID COLLATE utf8mb4_unicode_ci=b.pkBillID AND r2.BillType COLLATE utf8mb4_unicode_ci=b.BillType
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt<=? AND b.BillStatus='N'
                 AND b.BillType IN (${tph}) AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    rcptPrms.push(compID, branchID, stDate, ...otherTypes);
  }

  const billExpr = billParts.length ? billParts.join(' + ') : '0';
  const rcptExpr = rcptParts.length ? rcptParts.join(' + ') : '0';

  // Drive from an inline party-ID table so cross-company party IDs (e.g. a TEST
  // party stored in ADS bills) are not silently dropped by a local mParty JOIN.
  const partyUnions = partyIDs.map(() => 'SELECT ? AS pkPartyID').join(' UNION ALL ');
  return {
    sql: `SELECT pm.pkPartyID AS fkPartyID,
                 (${billExpr}) - (${rcptExpr}) AS NetAmt
            FROM (${partyUnions}) pm
          HAVING NetAmt <> 0`,
    params: [...billPrms, ...rcptPrms, ...partyIDs],
  };
}

// Opening balance for LDGFMT: matches VB6 exactly.
// Bill cutoff: BillDt < stDate (strict <, so bills on fromDate appear in Sales).
// Receipt cutoff: r1.RecptDt < stDate (receipt date, not bill date).
function buildLdgfmtOpeningBalSQL(billTypes, compID, branchID, stDate, partyIDs) {
  const hasGodrent = billTypes.includes('GODRENT');
  const otherTypes = billTypes.filter(t => t !== 'GODRENT');
  const partyPh    = partyIDs.map(() => '?').join(',');

  const billParts = [];
  const billPrms  = [];

  if (hasGodrent) {
    billParts.push(
      `IFNULL((SELECT SUM(IFNULL(b.NetAmt,b.GrossAmt)) FROM tBill1 b
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt < ? AND b.BillStatus='N'
                 AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    billPrms.push(compID, branchID, stDate);
  }

  if (otherTypes.length) {
    const tph = otherTypes.map(() => '?').join(',');
    billParts.push(
      `IFNULL((SELECT SUM(IFNULL(b.NetAmt,b.GrossAmt)) FROM tBillTrHmGen1 b
               WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillDt < ? AND b.BillStatus='N'
                 AND b.BillType IN (${tph}) AND b.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    billPrms.push(compID, branchID, stDate, ...otherTypes);
  }

  // Receipts: filter by receipt date (r1.RecptDt < stDate), join tRecpt2 on BillType
  const rcptParts = [];
  const rcptPrms  = [];

  if (hasGodrent) {
    rcptParts.push(
      `IFNULL((SELECT SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0))
               FROM tRecpt1 r1
               JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
                               AND r2.BillType='GODRENT'
               WHERE r1.RecptDt < ? AND r1.fkCompID=? AND r1.fkBranchID=?
                 AND r1.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    rcptPrms.push(stDate, compID, branchID);
  }

  if (otherTypes.length) {
    const tph = otherTypes.map(() => '?').join(',');
    rcptParts.push(
      `IFNULL((SELECT SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0))
               FROM tRecpt1 r1
               JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
                               AND r2.BillType IN (${tph})
               WHERE r1.RecptDt < ? AND r1.fkCompID=? AND r1.fkBranchID=?
                 AND r1.fkPartyID COLLATE utf8mb4_unicode_ci=pm.pkPartyID), 0)`
    );
    rcptPrms.push(...otherTypes, stDate, compID, branchID);
  }

  const billExpr = billParts.length ? billParts.join(' + ') : '0';
  const rcptExpr = rcptParts.length ? rcptParts.join(' + ') : '0';

  // Drive from an inline party-ID table so cross-company party IDs (e.g. a TEST
  // party stored in ADS bills) are not silently dropped by a local mParty JOIN.
  const partyUnions = partyIDs.map(() => 'SELECT ? AS pkPartyID').join(' UNION ALL ');
  return {
    sql: `SELECT pm.pkPartyID AS fkPartyID,
                 (${billExpr}) - (${rcptExpr}) AS NetAmt
            FROM (${partyUnions}) pm
          HAVING NetAmt <> 0`,
    params: [...billPrms, ...rcptPrms, ...partyIDs],
  };
}

// Compute running BalAmt per party+company, modifying rows in place.
// SortOrd=0 (opening): BalAmt = NetAmt
// SortOrd=1 (bill+receipt): adds NetAmt once per bill, subtracts each receipt
// SortOrd=2 (excess advance): subtracts RecptAmt
function computeBalance(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.pName}||${r.fkCompID}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const grp of groups.values()) {
    let bal = 0;
    const seenBills = new Set();
    for (const r of grp) {
      if (r.SortOrd === 0) {
        bal = parseFloat(r.NetAmt) || 0;
      } else if (r.SortOrd === 1) {
        const bk = `${r.pkBillID}||${r.BillType}`;
        if (!seenBills.has(bk)) {
          seenBills.add(bk);
          bal += parseFloat(r.NetAmt) || 0;
        }
        bal -= (parseFloat(r.RecptAmt) || 0) + (parseFloat(r.TDSAmt) || 0) + (parseFloat(r.DiscAmt) || 0);
      } else if (r.SortOrd === 2) {
        bal -= parseFloat(r.RecptAmt) || 0;
      }
      r.BalAmt = bal;
    }
  }
  return rows;
}

// â”€â”€ GET /form-data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/form-data', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { compID, branchID, groupID, roleID } = req.user;
    const groupComps = connectionManager.getGroupCompanyDetails(groupID);
    const db = req.db;

    const allParties = [];
    for (const comp of groupComps) {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) continue;
      const [rows] = await cdb.query(
        `SELECT pkPartyID, pName, pCode, pEmail, pGroup, fkCompID
           FROM mParty WHERE fkCompID=? AND fkBranchID=? AND Active='Y' ORDER BY pName`,
        { replacements: [comp.pkCompID, branchID] }
      );
      allParties.push(...rows.map(r => ({ ...r, compAlias: comp.CompAlias })));
    }
    allParties.sort((a, b) => a.pName.localeCompare(b.pName));

    const groups = [...new Set(allParties.map(p => p.pGroup).filter(Boolean))].sort();

    let recptModes = [];
    try {
      const [m] = await db.query(
        `SELECT vcData AS label, vcCode AS value FROM vcComboData
          WHERE fkCompID=? AND fkBranchID=? AND vcActive='Y' AND vcPurpose='PmtRcptMode'
          ORDER BY vcSrtOrd`,
        { replacements: [compID, branchID] }
      );
      recptModes = m;
    } catch { }

    let recptTypes = [];
    try {
      const [t] = await db.query(
        `SELECT vcData AS label, vcCode AS value FROM vcComboData
          WHERE vcActive='Y' AND vcPurpose='RecptType' ORDER BY vcSrtOrd`
      );
      recptTypes = t;
    } catch { }

    const companies = groupComps.map(c => ({
      pkCompID: c.pkCompID, CompName: c.CompName, CompAlias: c.CompAlias,
    }));

    const permRows = await req.adminDB.query(
      `SELECT CanPrint FROM mPermission WHERE fkRoleID=? AND ModuleCode='RECEIPT_REP'`,
      { replacements: [roleID] }
    );
    const perm = permRows[0]?.[0] || {};

    let groupName = groupID;
    try {
      const [gRows] = await req.adminDB.query(
        'SELECT GroupName FROM mCompanyGroup WHERE pkGroupID=?',
        { replacements: [groupID] }
      );
      if (gRows[0]?.GroupName) groupName = gRows[0].GroupName;
    } catch {}

    res.json({ parties: allParties, groups, companies, recptModes, recptTypes, canPrint: perm.CanPrint === 'Y', groupName });
  } catch (e) {
    console.error('[receiptReport] GET /form-data:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LDGREP standard: 3-part per company (opening balance + bill/receipt rows + excess advances).
// VB6 equivalent: udfPopLedgerEnt
//
// Body: { fromDate, toDate, billTypes, billStatus, partyIDs, compIDs }
// billStatus: 'ALL' | 'PENDING' | 'RECEIPT'
router.post('/ledger', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;
    const { fromDate, toDate, billTypes = [], billStatus = 'ALL', partyIDs = [], compIDs = [] } = req.body;

    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required.' });
    if (!billTypes.length)    return res.status(400).json({ error: 'Select at least one bill type.' });
    if (!partyIDs.length)     return res.status(400).json({ error: 'Select at least one party.' });

    const groupComps  = connectionManager.getGroupCompanyDetails(groupID);
    const targetComps = compIDs.length ? groupComps.filter(c => compIDs.includes(c.pkCompID)) : groupComps;

    const hasGodrent   = billTypes.includes('GODRENT');
    const otherTypes   = billTypes.filter(t => t !== 'GODRENT');
    const allRows      = [];

    // Build cross-company party map so a party registered in one company (e.g. TEST)
    // but referenced in another company's bill tables (e.g. ADS tBillTrHmGen1) still
    // gets its pName/pCode/pEmail resolved correctly.
    const partyInfoMap = {};
    for (const comp of groupComps) {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) continue;
      try {
        const [pRows] = await cdb.query(
          `SELECT pkPartyID, pName, pCode, pEmail FROM mParty WHERE Active='Y' AND fkBranchID=?`,
          { replacements: [branchID] }
        );
        for (const p of pRows) {
          if (!partyInfoMap[p.pkPartyID]) partyInfoMap[p.pkPartyID] = p;
        }
      } catch {}
    }

    for (const comp of targetComps) {
      const db = connectionManager.getDB(comp.pkCompID);
      if (!db) continue;
      const compID = comp.pkCompID;
      const partyPh = partyIDs.map(() => '?').join(',');

      // â”€â”€ Part A: Opening balance per party â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const { sql: obSql, params: obParams } = buildOpeningBalSQL(billTypes, compID, branchID, fromDate, partyIDs);
      const [obRows] = await db.query(obSql, { replacements: obParams });
      for (const r of obRows) {
        const pInfo = partyInfoMap[r.fkPartyID] || {};
        allRows.push({
          SortOrd: 0, BillType: 'Opening', BillDt: fromDate, BillNum: null,
          GrossAmt: null, NetAmt: parseFloat(r.NetAmt) || 0, pkBillID: null,
          fkPartyID: r.fkPartyID, fkCompID: compID,
          pName: pInfo.pName || null, pCode: pInfo.pCode || null, pEmail: pInfo.pEmail || null,
          RecptDt: null, RecptAmt: null, TDSAmt: null, DiscAmt: null,
          RecptType: null, RecptMode: null, BankName: null, ChqNo: null, ChqDt: null,
          fkUserID: null, bName: null, rRemark: 'Opening Balance', cpkRecptID: null,
        });
      }

      // â”€â”€ Part B: Bill + receipt rows in date range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      {
        const billUnionParts = [];
        const billUnionPrms  = [];

        if (hasGodrent) {
          billUnionParts.push(
            `SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID,
                    'GODRENT' COLLATE utf8mb4_unicode_ci AS BillType,
                    fkPartyID COLLATE utf8mb4_unicode_ci AS fkPartyID,
                    fkCompID COLLATE utf8mb4_unicode_ci AS fkCompID,
                    fkBranchID COLLATE utf8mb4_unicode_ci AS fkBranchID,
                    BillDt, BillNum, GrossAmt, IFNULL(NetAmt,GrossAmt) AS NetAmt, AcknldgDt
               FROM tBill1
              WHERE fkCompID=? AND fkBranchID=? AND BillStatus='N'
                AND BillDt>=? AND BillDt<=? AND fkPartyID IN (${partyPh})`
          );
          billUnionPrms.push(compID, branchID, fromDate, toDate, ...partyIDs);
        }

        if (otherTypes.length) {
          const tph = otherTypes.map(() => '?').join(',');
          billUnionParts.push(
            `SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID,
                    BillType COLLATE utf8mb4_unicode_ci AS BillType,
                    fkPartyID COLLATE utf8mb4_unicode_ci AS fkPartyID,
                    fkCompID COLLATE utf8mb4_unicode_ci AS fkCompID,
                    fkBranchID COLLATE utf8mb4_unicode_ci AS fkBranchID,
                    BillDt, BillNum, GrossAmt, IFNULL(NetAmt,GrossAmt) AS NetAmt, AcknldgDt
               FROM tBillTrHmGen1
              WHERE fkCompID=? AND fkBranchID=? AND BillStatus='N'
                AND BillDt>=? AND BillDt<=? AND BillType IN (${tph}) AND fkPartyID IN (${partyPh})`
          );
          billUnionPrms.push(compID, branchID, fromDate, toDate, ...otherTypes, ...partyIDs);
        }

        if (billUnionParts.length) {
          let statusCond = '';
          if (billStatus === 'PENDING')  statusCond = 'AND (vbr.NetAmt - IFNULL(r2sum.TotalReceived,0)) <> 0';
          if (billStatus === 'RECEIPT')  statusCond = 'AND r2.cpkRecptID IS NOT NULL';

          const partBSql = `
            SELECT 1 AS SortOrd,
                   vbr.BillType, vbr.BillDt, vbr.BillNum, vbr.GrossAmt, vbr.NetAmt,
                   vbr.pkBillID, vbr.fkPartyID, vbr.fkCompID, vbr.AcknldgDt,
                   r2.RecptAmt, r2.TDSAmt, r2.DiscAmt, r2.rRemark, r2.cpkRecptID,
                   pm.pName, pm.pCode, pm.pEmail,
                   r1.RecptDt, vc1.vcData AS RecptType, COALESCE(vc2.vcData, r1.RecptMode) AS RecptMode,
                   r1.BankName, r1.ChqNo, r1.ChqDt, r1.fkUserID, mb.bName,
                   IFNULL(r2sum.TotalReceived,0) AS TotalReceived
              FROM (${billUnionParts.join(' UNION ALL ')}) vbr
              LEFT JOIN mParty pm ON pm.pkPartyID=vbr.fkPartyID AND pm.Active='Y'
              LEFT JOIN tRecpt2 r2 ON r2.fkBillID=vbr.pkBillID AND r2.BillType COLLATE utf8mb4_unicode_ci=vbr.BillType
              LEFT JOIN tRecpt1 r1 ON r1.pkRecptID=r2.cpkRecptID COLLATE utf8mb4_unicode_ci
              LEFT JOIN vcComboData vc1 ON vc1.vcCode=r1.RecptType COLLATE utf8mb4_unicode_ci AND vc1.vcPurpose='RecptType'
              LEFT JOIN vcComboData vc2 ON vc2.vcCode=r1.RecptMode COLLATE utf8mb4_unicode_ci AND vc2.vcPurpose='PmtRcptMode'
              LEFT JOIN mBank mb ON mb.pkBankID=r1.fkBankID COLLATE utf8mb4_unicode_ci
              LEFT JOIN (
                SELECT fkBillID, BillType,
                       SUM(IFNULL(RecptAmt,0)+IFNULL(TDSAmt,0)+IFNULL(DiscAmt,0)) AS TotalReceived
                  FROM tRecpt2 GROUP BY fkBillID, BillType
              ) r2sum ON r2sum.fkBillID=vbr.pkBillID AND r2sum.BillType COLLATE utf8mb4_unicode_ci=vbr.BillType
             WHERE 1=1 ${statusCond}
             ORDER BY vbr.BillDt, vbr.pkBillID, r2.cpkRecptID`;

          const [bRows] = await db.query(partBSql, { replacements: billUnionPrms });
          for (const r of bRows) {
            const pInfo = partyInfoMap[r.fkPartyID] || {};
            allRows.push({
              SortOrd: 1,
              BillType:   r.BillType, BillDt:  localStr(r.BillDt), BillNum: r.BillNum,
              GrossAmt:   parseFloat(r.GrossAmt) || 0, NetAmt: parseFloat(r.NetAmt) || 0,
              pkBillID:   r.pkBillID, fkPartyID: r.fkPartyID, fkCompID: r.fkCompID,
              pName:      r.pName  || pInfo.pName  || null,
              pCode:      r.pCode  || pInfo.pCode  || null,
              pEmail:     r.pEmail || pInfo.pEmail || null,
              RecptDt:    r.RecptDt ? localStr(r.RecptDt) : null,
              RecptAmt:   r.RecptAmt != null ? parseFloat(r.RecptAmt) : null,
              TDSAmt:     r.TDSAmt  != null ? parseFloat(r.TDSAmt)  : null,
              DiscAmt:    r.DiscAmt != null ? parseFloat(r.DiscAmt) : null,
              RecptType:  r.RecptType  || null, RecptMode: r.RecptMode || null,
              BankName:   r.BankName   || null, ChqNo:     r.ChqNo    || null,
              ChqDt:      r.ChqDt ? localStr(r.ChqDt) : null,
              fkUserID:   r.fkUserID   || null, bName:     r.bName    || null,
              rRemark:    r.rRemark    || null, cpkRecptID: r.cpkRecptID || null,
              TotalReceived: parseFloat(r.TotalReceived) || 0,
              AcknldgDt: r.AcknldgDt instanceof Date ? localStr(r.AcknldgDt) : (r.AcknldgDt || null),
            });
          }
        }
      }

      // â”€â”€ Part C: Excess / advance receipts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Receipts where RecptAmt > total allocated to bills (unallocated advance)
      {
        const partCSql = `
          SELECT 2 AS SortOrd,
                 r1.pkRecptID AS cpkRecptID, r1.fkPartyID,
                 r1.RecptDt, r1.fkCompID,
                 r1.RecptAmt - IFNULL(SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0)),0) AS RecptAmt,
                 vc1.vcData AS RecptType, COALESCE(vc2.vcData, r1.RecptMode) AS RecptMode,
                 r1.BankName, r1.ChqNo, r1.ChqDt, r1.fkUserID, mb.bName,
                 pm.pName, pm.pCode, pm.pEmail,
                 'Excess receipt not allocated to bills' AS rRemark
            FROM tRecpt1 r1
            LEFT JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
            LEFT JOIN vcComboData vc1 ON vc1.vcCode=r1.RecptType COLLATE utf8mb4_unicode_ci AND vc1.vcPurpose='RecptType'
            LEFT JOIN vcComboData vc2 ON vc2.vcCode=r1.RecptMode COLLATE utf8mb4_unicode_ci AND vc2.vcPurpose='PmtRcptMode'
            LEFT JOIN mBank mb ON mb.pkBankID=r1.fkBankID COLLATE utf8mb4_unicode_ci
            LEFT JOIN mParty pm ON pm.pkPartyID=r1.fkPartyID COLLATE utf8mb4_unicode_ci
           WHERE r1.fkCompID=? AND r1.fkBranchID=?
             AND r1.fkPartyID IN (${partyPh})
           GROUP BY r1.pkRecptID, r1.RecptAmt, r1.fkPartyID, r1.RecptDt, r1.fkCompID,
                    r1.RecptType, r1.RecptMode, r1.BankName, r1.ChqNo, r1.ChqDt, r1.fkUserID,
                    mb.bName, pm.pName, pm.pCode, pm.pEmail, vc1.vcData, vc2.vcData
          HAVING r1.RecptAmt > IFNULL(SUM(IFNULL(r2.RecptAmt,0)),0)`;

        const [cRows] = await db.query(partCSql, { replacements: [compID, branchID, ...partyIDs] });
        for (const r of cRows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({
            SortOrd:    2, BillType: null, BillDt: null, BillNum: null,
            GrossAmt:   null, NetAmt: null, pkBillID: null,
            fkPartyID:  r.fkPartyID, fkCompID: r.fkCompID,
            pName:      r.pName  || pInfo.pName  || null,
            pCode:      r.pCode  || pInfo.pCode  || null,
            pEmail:     r.pEmail || pInfo.pEmail || null,
            RecptDt:    r.RecptDt ? localStr(r.RecptDt) : null,
            RecptAmt:   parseFloat(r.RecptAmt) || 0,
            TDSAmt:     null, DiscAmt: null,
            RecptType:  r.RecptType || null, RecptMode: r.RecptMode || null,
            BankName:   r.BankName  || null, ChqNo:     r.ChqNo    || null,
            ChqDt:      r.ChqDt ? localStr(r.ChqDt) : null,
            fkUserID:   r.fkUserID  || null, bName:     r.bName    || null,
            rRemark:    r.rRemark, cpkRecptID: r.cpkRecptID,
          });
        }
      }
    }

    // Sort: party name â†’ company â†’ SortOrd â†’ date â†’ bill PK â†’ receipt PK
    allRows.sort((a, b) => {
      if (a.pName    < b.pName)    return -1;
      if (a.pName    > b.pName)    return  1;
      if (a.fkCompID < b.fkCompID) return -1;
      if (a.fkCompID > b.fkCompID) return  1;
      if (a.SortOrd  < b.SortOrd)  return -1;
      if (a.SortOrd  > b.SortOrd)  return  1;
      const da = a.BillDt || a.RecptDt || '';
      const db2 = b.BillDt || b.RecptDt || '';
      if (da < db2) return -1;
      if (da > db2) return  1;
      return 0;
    });

    computeBalance(allRows);
    res.json({ rows: allRows });
  } catch (e) {
    console.error('[receiptReport] POST /ledger:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /ledger-format â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LDGREP ledger format (VB6: udfShowRep when chkLdgOp checked).
// 5-part UNION per company: opening + sales + receipts + excess + TDS
// Body same as /ledger
router.post('/ledger-format', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;
    const { fromDate, toDate, billTypes = [], partyIDs = [], compIDs = [] } = req.body;

    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required.' });
    if (!billTypes.length)    return res.status(400).json({ error: 'Select at least one bill type.' });
    if (!partyIDs.length)     return res.status(400).json({ error: 'Select at least one party.' });

    const groupComps  = connectionManager.getGroupCompanyDetails(groupID);
    const targetComps = compIDs.length ? groupComps.filter(c => compIDs.includes(c.pkCompID)) : groupComps;

    const hasGodrent = billTypes.includes('GODRENT');
    const otherTypes = billTypes.filter(t => t !== 'GODRENT');
    const allRows    = [];

    const partyInfoMap = {};
    for (const comp of groupComps) {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) continue;
      try {
        const [pRows] = await cdb.query(
          `SELECT pkPartyID, pName, pCode, pEmail FROM mParty WHERE Active='Y' AND fkBranchID=?`,
          { replacements: [branchID] }
        );
        for (const p of pRows) {
          if (!partyInfoMap[p.pkPartyID]) partyInfoMap[p.pkPartyID] = p;
        }
      } catch {}
    }

    for (const comp of targetComps) {
      const db = connectionManager.getDB(comp.pkCompID);
      if (!db) continue;
      const compID  = comp.pkCompID;
      const partyPh = partyIDs.map(() => '?').join(',');

      // â”€â”€ Part 1: Opening balance (VB6: BillDt < fromDate, RecptDt < fromDate) â”€â”€
      {
        const { sql: obSql, params: obParams } = buildLdgfmtOpeningBalSQL(billTypes, compID, branchID, fromDate, partyIDs);
        const [obRows] = await db.query(obSql, { replacements: obParams });
        for (const r of obRows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({
            EntryType: 'Opening', EntryDate: fromDate, DocNo: null, BillType: null,
            TotalBill: 0, Receipt: 0, TotalReceipt: 0,
            Balance: parseFloat(r.NetAmt) || 0,
            pName: pInfo.pName || null, pCode: pInfo.pCode || null, pEmail: pInfo.pEmail || null,
            fkPartyID: r.fkPartyID, fkCompID: compID, bName: null,
          });
        }
      }

      // â”€â”€ Part 2: Sales (bills in date range) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (hasGodrent) {
        const [rows] = await db.query(
          `SELECT 'Sales' AS EntryType, BillDt AS EntryDate, BillNum AS DocNo,
                  'GODRENT' AS BillType, IFNULL(NetAmt,GrossAmt) AS TotalBill,
                  0 AS Receipt, 0 AS TotalReceipt, 0 AS Balance,
                  pm.pName, pm.pCode, pm.pEmail, b.fkPartyID, b.fkCompID, NULL AS bName,
                  b.AcknldgDt
             FROM tBill1 b LEFT JOIN mParty pm ON pm.pkPartyID=b.fkPartyID COLLATE utf8mb4_unicode_ci AND pm.Active='Y'
            WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillStatus='N'
              AND b.BillDt BETWEEN ? AND ? AND b.fkPartyID IN (${partyPh})`,
          { replacements: [compID, branchID, fromDate, toDate, ...partyIDs] }
        );
        for (const r of rows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({ ...r, BillDt: null, EntryDate: localStr(r.EntryDate),
            AcknldgDt: r.AcknldgDt instanceof Date ? localStr(r.AcknldgDt) : (r.AcknldgDt || null),
            pName: r.pName || pInfo.pName || null,
            pCode: r.pCode || pInfo.pCode || null,
            pEmail: r.pEmail || pInfo.pEmail || null,
          });
        }
      }

      if (otherTypes.length) {
        const tph = otherTypes.map(() => '?').join(',');
        const [rows] = await db.query(
          `SELECT 'Sales' AS EntryType, BillDt AS EntryDate, BillNum AS DocNo,
                  BillType, IFNULL(NetAmt,GrossAmt) AS TotalBill,
                  0 AS Receipt, 0 AS TotalReceipt, 0 AS Balance,
                  pm.pName, pm.pCode, pm.pEmail, b.fkPartyID, b.fkCompID, NULL AS bName,
                  b.AcknldgDt
             FROM tBillTrHmGen1 b LEFT JOIN mParty pm ON pm.pkPartyID=b.fkPartyID COLLATE utf8mb4_unicode_ci AND pm.Active='Y'
            WHERE b.fkCompID=? AND b.fkBranchID=? AND b.BillStatus='N'
              AND b.BillDt BETWEEN ? AND ? AND b.BillType IN (${tph}) AND b.fkPartyID IN (${partyPh})`,
          { replacements: [compID, branchID, fromDate, toDate, ...otherTypes, ...partyIDs] }
        );
        for (const r of rows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({ ...r, BillDt: null, EntryDate: localStr(r.EntryDate),
            AcknldgDt: r.AcknldgDt instanceof Date ? localStr(r.AcknldgDt) : (r.AcknldgDt || null),
            pName: r.pName || pInfo.pName || null,
            pCode: r.pCode || pInfo.pCode || null,
            pEmail: r.pEmail || pInfo.pEmail || null,
          });
        }
      }

      // â”€â”€ Part 3: Receipts + pure Advance (r2 IS NULL) in date range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      {
        const [rows] = await db.query(
          `SELECT CASE WHEN r2.cpkRecptID IS NULL THEN 'Advance' ELSE 'Receipt' END AS EntryType,
                  r1.RecptDt AS EntryDate,
                  IFNULL(vbr.BillNum,'') AS DocNo, NULL AS BillType,
                  IFNULL(r2.DiscAmt,0) AS TotalBill,
                  IFNULL(r2.RecptAmt, r1.RecptAmt) AS Receipt,
                  r1.RecptAmt + IFNULL((
                    SELECT SUM(IFNULL(r2s.DiscAmt,0)) FROM tRecpt2 r2s WHERE r2s.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
                  ),0) AS TotalReceipt,
                  0 AS Balance, pm.pName, pm.pCode, pm.pEmail, r1.fkPartyID, r1.fkCompID, mb.bName
             FROM tRecpt1 r1
             LEFT JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
             LEFT JOIN (
               SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, 'GODRENT' COLLATE utf8mb4_unicode_ci AS BillType, BillNum FROM tBill1 WHERE fkCompID=? AND fkBranchID=?
               UNION ALL
               SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, BillType COLLATE utf8mb4_unicode_ci AS BillType, BillNum FROM tBillTrHmGen1 WHERE fkCompID=? AND fkBranchID=?
             ) vbr ON vbr.pkBillID=r2.fkBillID AND vbr.BillType=r2.BillType COLLATE utf8mb4_unicode_ci
             LEFT JOIN mParty pm ON pm.pkPartyID=r1.fkPartyID COLLATE utf8mb4_unicode_ci
             LEFT JOIN mBank mb ON mb.pkBankID=r1.fkBankID COLLATE utf8mb4_unicode_ci
            WHERE r1.fkCompID=? AND r1.fkBranchID=?
              AND r1.RecptDt BETWEEN ? AND ?
              AND r1.fkPartyID IN (${partyPh})`,
          { replacements: [compID, branchID, compID, branchID, compID, branchID, fromDate, toDate, ...partyIDs] }
        );
        for (const r of rows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({ ...r, EntryDate: localStr(r.EntryDate), BillDt: null,
            pName: r.pName || pInfo.pName || null,
            pCode: r.pCode || pInfo.pCode || null,
            pEmail: r.pEmail || pInfo.pEmail || null,
          });
        }
      }

      // â”€â”€ Part 4: Excess advance (RecptAmt > sum of allocated r2 amounts) â”€â”€â”€â”€â”€â”€
      // VB6: shown as EntryType='Receipt', DocNo='Advance' when leftover amount exists
      {
        const [exRows] = await db.query(
          `SELECT 'Receipt' AS EntryType, r1.RecptDt AS EntryDate, 'Advance' AS DocNo, NULL AS BillType,
                  0 AS TotalBill,
                  r1.RecptAmt - IFNULL(SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0)), 0) AS Receipt,
                  0 AS TotalReceipt, 0 AS Balance,
                  pm.pName, pm.pCode, pm.pEmail, r1.fkPartyID, r1.fkCompID, NULL AS bName
             FROM tRecpt1 r1
             LEFT JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
             LEFT JOIN mParty pm ON pm.pkPartyID COLLATE utf8mb4_unicode_ci=r1.fkPartyID
            WHERE r1.fkCompID=? AND r1.fkBranchID=?
              AND r1.RecptDt BETWEEN ? AND ?
              AND r1.fkPartyID IN (${partyPh})
              AND r2.cpkRecptID IS NOT NULL
            GROUP BY r1.pkRecptID, r1.RecptDt, r1.RecptAmt, pm.pName, pm.pCode, pm.pEmail, r1.fkPartyID, r1.fkCompID
           HAVING r1.RecptAmt > IFNULL(SUM(IFNULL(r2.RecptAmt,0)+IFNULL(r2.TDSAmt,0)+IFNULL(r2.DiscAmt,0)), 0)`,
          { replacements: [compID, branchID, fromDate, toDate, ...partyIDs] }
        );
        for (const r of exRows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({ ...r, EntryDate: localStr(r.EntryDate), BillDt: null,
            pName: r.pName || pInfo.pName || null,
            pCode: r.pCode || pInfo.pCode || null,
            pEmail: r.pEmail || pInfo.pEmail || null,
          });
        }
      }

      // â”€â”€ Part 5: TDS entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      {
        const [rows] = await db.query(
          `SELECT 'TDS' AS EntryType, r1.RecptDt AS EntryDate,
                  IFNULL(vbr.BillNum, r1.pkRecptID) AS DocNo, NULL AS BillType,
                  0 AS TotalBill, r2.TDSAmt AS Receipt,
                  (SELECT SUM(IFNULL(r2s.TDSAmt,0)) FROM tRecpt2 r2s WHERE r2s.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID) AS TotalReceipt,
                  0 AS Balance, pm.pName, pm.pCode, pm.pEmail, r1.fkPartyID, r1.fkCompID, NULL AS bName
             FROM tRecpt1 r1
             JOIN tRecpt2 r2 ON r2.cpkRecptID COLLATE utf8mb4_unicode_ci=r1.pkRecptID
             LEFT JOIN (
               SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, 'GODRENT' COLLATE utf8mb4_unicode_ci AS BillType, BillNum FROM tBill1 WHERE fkCompID=? AND fkBranchID=?
               UNION ALL
               SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, BillType COLLATE utf8mb4_unicode_ci AS BillType, BillNum FROM tBillTrHmGen1 WHERE fkCompID=? AND fkBranchID=?
             ) vbr ON vbr.pkBillID=r2.fkBillID AND vbr.BillType=r2.BillType COLLATE utf8mb4_unicode_ci
             LEFT JOIN mParty pm ON pm.pkPartyID=r1.fkPartyID COLLATE utf8mb4_unicode_ci
            WHERE r1.fkCompID=? AND r1.fkBranchID=?
              AND r1.RecptDt BETWEEN ? AND ?
              AND r1.fkPartyID IN (${partyPh})
              AND IFNULL(r2.TDSAmt,0) > 0`,
          { replacements: [compID, branchID, compID, branchID, compID, branchID, fromDate, toDate, ...partyIDs] }
        );
        for (const r of rows) {
          const pInfo = partyInfoMap[r.fkPartyID] || {};
          allRows.push({ ...r, EntryDate: localStr(r.EntryDate), BillDt: null,
            pName: r.pName || pInfo.pName || null,
            pCode: r.pCode || pInfo.pCode || null,
            pEmail: r.pEmail || pInfo.pEmail || null,
          });
        }
      }
    }

    allRows.sort((a, b) => {
      if (a.pName    < b.pName)    return -1;
      if (a.pName    > b.pName)    return  1;
      if (a.fkCompID < b.fkCompID) return -1;
      if (a.fkCompID > b.fkCompID) return  1;
      const da = a.EntryDate || '';
      const db2 = b.EntryDate || '';
      if (da < db2) return -1;
      if (da > db2) return  1;
      if (a.EntryType < b.EntryType) return -1;
      if (a.EntryType > b.EntryType) return  1;
      return 0;
    });

    res.json({ rows: allRows });
  } catch (e) {
    console.error('[receiptReport] POST /ledger-format:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /receipt-entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RECPTENT: receipt header list.
// VB6 equivalent: udfPopReceiptEnt
// Body: { fromDate, toDate, billTypes, partyIDs, compIDs, recptType, recptMode }
router.post('/receipt-entry', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;
    const { fromDate, toDate, partyIDs = [], compIDs = [], recptType = '', recptMode = '' } = req.body;

    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required.' });
    if (!partyIDs.length)     return res.status(400).json({ error: 'Select at least one party.' });

    const groupComps  = connectionManager.getGroupCompanyDetails(groupID);
    const targetComps = compIDs.length ? groupComps.filter(c => compIDs.includes(c.pkCompID)) : groupComps;
    const allRows     = [];

    // Build cross-company party name map so receipts whose fkPartyID was registered
    // in a different company's mParty are still resolved (mirrors /ledger pattern).
    const partyInfoMap = {};
    for (const comp of groupComps) {
      const cdb = connectionManager.getDB(comp.pkCompID);
      if (!cdb) continue;
      try {
        const [pRows] = await cdb.query(
          `SELECT pkPartyID, pName FROM mParty WHERE Active='Y' AND fkBranchID=?`,
          { replacements: [branchID] }
        );
        for (const p of pRows) {
          if (!partyInfoMap[p.pkPartyID]) partyInfoMap[p.pkPartyID] = p.pName;
        }
      } catch {}
    }

    for (const comp of targetComps) {
      const db = connectionManager.getDB(comp.pkCompID);
      if (!db) continue;
      const compID  = comp.pkCompID;
      const partyPh = partyIDs.map(() => '?').join(',');
      const params  = [compID, branchID, fromDate, toDate, ...partyIDs];

      // LEFT JOIN mParty so receipts whose fkPartyID belongs to another company's
      // mParty are not silently dropped by an INNER JOIN failure.
      let sql = `
        SELECT r1.fkPartyID, pm.pName, r1.RecptDt, r1.RecptAmt AS TotRecptAmt, r1.pkRecptID,
               vc1.vcData AS RecptType, vc2.vcData AS RecptMode,
               r1.BankName, r1.ChqNo, r1.ChqDt, r1.fkUserID, r1.fkCompID, mb.bName
          FROM tRecpt1 r1
          LEFT JOIN mParty pm ON pm.pkPartyID=r1.fkPartyID COLLATE utf8mb4_unicode_ci AND pm.Active='Y'
          LEFT JOIN vcComboData vc1 ON vc1.vcCode=r1.RecptType COLLATE utf8mb4_unicode_ci AND vc1.vcPurpose='RecptType'
          LEFT JOIN vcComboData vc2 ON vc2.vcCode=r1.RecptMode COLLATE utf8mb4_unicode_ci AND vc2.vcPurpose='PmtRcptMode'
          LEFT JOIN mBank mb ON mb.pkBankID=r1.fkBankID COLLATE utf8mb4_unicode_ci
         WHERE r1.fkCompID=? AND r1.fkBranchID=?
           AND r1.RecptDt >= ? AND r1.RecptDt <= ?
           AND r1.fkPartyID IN (${partyPh})`;

      if (recptType) { sql += ' AND r1.RecptType=?'; params.push(recptType); }
      if (recptMode) { sql += ' AND r1.RecptMode=?'; params.push(recptMode); }
      sql += ' ORDER BY r1.RecptDt, pm.pName';

      const [rows] = await db.query(sql, { replacements: params });
      allRows.push(...rows.map(r => ({
        ...r,
        pName:      r.pName || partyInfoMap[r.fkPartyID] || r.fkPartyID,
        RecptDt:    localStr(r.RecptDt),
        ChqDt:      r.ChqDt ? localStr(r.ChqDt) : null,
        TotRecptAmt: parseFloat(r.TotRecptAmt) || 0,
        compAlias:  comp.CompAlias,
      })));
    }

    allRows.sort((a, b) => {
      if (a.RecptDt < b.RecptDt) return -1;
      if (a.RecptDt > b.RecptDt) return  1;
      return (a.pName || '').localeCompare(b.pName || '');
    });

    res.json({ rows: allRows });
  } catch (e) {
    console.error('[receiptReport] POST /receipt-entry:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /receipt-entry-detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RECPTENT detail for one receipt (VB6: udfPopDetailEnt on row click)
// Body: { pkRecptID, compID }
router.post('/receipt-entry-detail', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID } = req.user;
    const { pkRecptID, compID } = req.body;
    if (!pkRecptID || !compID) return res.status(400).json({ error: 'pkRecptID and compID are required.' });

    const db = connectionManager.getDB(compID);
    if (!db) return res.status(400).json({ error: `No DB for company ${compID}` });

    const [rows] = await db.query(
      `SELECT r2.BillType, r2.RecptAmt, r2.TDSAmt, r2.DiscAmt, r2.rRemark,
              vbr.BillDt, vbr.BillNum, vbr.NetAmt
         FROM tRecpt2 r2
         JOIN (
           SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, 'GODRENT' COLLATE utf8mb4_unicode_ci AS BillType, BillNum, BillDt, NetAmt
             FROM tBill1 WHERE fkCompID=? AND fkBranchID=?
           UNION ALL
           SELECT pkBillID COLLATE utf8mb4_unicode_ci AS pkBillID, BillType COLLATE utf8mb4_unicode_ci AS BillType, BillNum, BillDt, NetAmt
             FROM tBillTrHmGen1 WHERE fkCompID=? AND fkBranchID=?
         ) vbr ON vbr.pkBillID=r2.fkBillID AND vbr.BillType=r2.BillType COLLATE utf8mb4_unicode_ci
        WHERE r2.cpkRecptID=?
        ORDER BY vbr.BillDt, vbr.BillNum`,
      { replacements: [compID, branchID, compID, branchID, pkRecptID] }
    );

    res.json({ rows: rows.map(r => ({
      ...r,
      BillDt:   localStr(r.BillDt),
      NetAmt:   parseFloat(r.NetAmt)   || 0,
      RecptAmt: parseFloat(r.RecptAmt) || 0,
      TDSAmt:   parseFloat(r.TDSAmt)   || 0,
      DiscAmt:  parseFloat(r.DiscAmt)  || 0,
      TotBillAmt: (parseFloat(r.RecptAmt)||0) + (parseFloat(r.TDSAmt)||0) + (parseFloat(r.DiscAmt)||0),
      BalAmt:   (parseFloat(r.NetAmt)||0) - ((parseFloat(r.RecptAmt)||0) + (parseFloat(r.TDSAmt)||0) + (parseFloat(r.DiscAmt)||0)),
    })) });
  } catch (e) {
    console.error('[receiptReport] POST /receipt-entry-detail:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SUMREP: aging buckets per party.
// VB6 equivalent: udfPopSumRep â€” uses vInvoice_Recpt_Amt view.
// Body: { fromDate, toDate, billTypes, partyIDs, compIDs }
router.post('/summary', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID, groupID } = req.user;
    const { fromDate, toDate, billTypes = [], partyIDs = [], compIDs = [] } = req.body;

    if (!toDate)          return res.status(400).json({ error: 'toDate is required.' });
    if (!billTypes.length) return res.status(400).json({ error: 'Select at least one bill type.' });
    if (!partyIDs.length)  return res.status(400).json({ error: 'Select at least one party.' });

    const groupComps  = connectionManager.getGroupCompanyDetails(groupID);
    const targetComps = compIDs.length ? groupComps.filter(c => compIDs.includes(c.pkCompID)) : groupComps;
    const allRows     = [];
    const typePh      = billTypes.map(() => '?').join(',');

    for (const comp of targetComps) {
      const db = connectionManager.getDB(comp.pkCompID);
      if (!db) continue;
      const compID  = comp.pkCompID;
      const partyPh = partyIDs.map(() => '?').join(',');
      const params  = [compID, branchID, ...billTypes, toDate];
      if (fromDate) params.push(fromDate);
      params.push(...partyIDs);

      const [rows] = await db.query(
        `SELECT vra.fkCompID, vra.fkPartyID, pm.pName,
                SUM(vra.BalanceAmt) AS BalAmt,
                SUM(CASE WHEN DATEDIFF(CURDATE(),vra.BillDt) <= 30  THEN vra.BalanceAmt ELSE 0 END) AS BalAmt_30,
                SUM(CASE WHEN DATEDIFF(CURDATE(),vra.BillDt) BETWEEN 31 AND 90  THEN vra.BalanceAmt ELSE 0 END) AS BalAmt_3190,
                SUM(CASE WHEN DATEDIFF(CURDATE(),vra.BillDt) BETWEEN 91 AND 180 THEN vra.BalanceAmt ELSE 0 END) AS BalAmt_91180,
                SUM(CASE WHEN DATEDIFF(CURDATE(),vra.BillDt) > 180 THEN vra.BalanceAmt ELSE 0 END) AS BalAmt_180
           FROM vInvoice_Recpt_Amt vra
           JOIN mParty pm ON pm.pkPartyID=vra.fkPartyID COLLATE utf8mb4_unicode_ci AND pm.Active='Y'
          WHERE vra.fkCompID=? AND vra.fkBranchID=?
            AND vra.BillStatus='N' AND vra.BalanceAmt <> 0
            AND vra.BillType IN (${typePh}) AND vra.BillDt <= ?
            ${fromDate ? 'AND vra.BillDt >= ?' : ''}
            AND vra.fkPartyID IN (${partyPh})
          GROUP BY vra.fkCompID, vra.fkPartyID, pm.pName
          ORDER BY pm.pName`,
        { replacements: params }
      );

      allRows.push(...rows.map(r => ({
        fkCompID:   r.fkCompID,
        fkPartyID:  r.fkPartyID,
        pName:      r.pName,
        compAlias:  comp.CompAlias,
        BalAmt:     parseFloat(r.BalAmt)       || 0,
        BalAmt_30:  parseFloat(r.BalAmt_30)    || 0,
        BalAmt_3190:parseFloat(r.BalAmt_3190)  || 0,
        BalAmt_91180:parseFloat(r.BalAmt_91180)|| 0,
        BalAmt_180: parseFloat(r.BalAmt_180)   || 0,
      })));
    }

    allRows.sort((a, b) => a.pName.localeCompare(b.pName) || a.fkCompID.localeCompare(b.fkCompID));
    res.json({ rows: allRows });
  } catch (e) {
    console.error('[receiptReport] POST /summary:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /summary-detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SUMREP detail for one party (VB6: udfPopSumRepDetailEnt on row click)
// Body: { fkPartyID, compID, fromDate, toDate, billTypes }
router.post('/summary-detail', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { branchID } = req.user;
    const { fkPartyID, compID, fromDate, toDate, billTypes = [] } = req.body;
    if (!fkPartyID || !compID) return res.status(400).json({ error: 'fkPartyID and compID are required.' });
    if (!billTypes.length)     return res.status(400).json({ error: 'Select at least one bill type.' });

    const db = connectionManager.getDB(compID);
    if (!db) return res.status(400).json({ error: `No DB for company ${compID}` });

    const typePh = billTypes.map(() => '?').join(',');
    const params = [compID, branchID, fkPartyID, ...billTypes];
    if (toDate)   params.push(toDate);
    if (fromDate) params.push(fromDate);

    const [rows] = await db.query(
      `SELECT BillType, BillDt, BillNum, GrossAmt, NetAmt, BalanceAmt
         FROM vInvoice_Recpt_Amt
        WHERE fkCompID=? AND fkBranchID=? AND BillStatus='N' AND BalanceAmt <> 0
          AND fkPartyID=? AND BillType IN (${typePh})
          ${toDate   ? 'AND BillDt <= ?' : ''}
          ${fromDate ? 'AND BillDt >= ?' : ''}
        ORDER BY BillDt, BillNum`,
      { replacements: params }
    );

    res.json({ rows: rows.map(r => ({
      ...r,
      BillDt:     localStr(r.BillDt),
      GrossAmt:   parseFloat(r.GrossAmt)   || 0,
      NetAmt:     parseFloat(r.NetAmt)     || 0,
      BalanceAmt: parseFloat(r.BalanceAmt) || 0,
    })) });
  } catch (e) {
    console.error('[receiptReport] POST /summary-detail:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Report HTML generators (for email attachments) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const _fmtDt = s => {
  if (!s) return '';
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).substring(0, 10);
};

const _fN = n => {
  const v = parseFloat(n);
  if (isNaN(v)) return '';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const REPORT_CSS = `
  body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
  .pg-hdr{text-align:center;border:1px solid #bbb;padding:8px 12px;margin-bottom:14px}
  .pg-hdr .grp{font-size:18px;font-weight:bold;letter-spacing:3px;text-transform:uppercase}
  .pg-hdr .ttl{font-size:13px;margin-top:4px}
  .pg-hdr .dts{font-size:12px}
  .pty{font-weight:bold;font-size:12px;margin:12px 0 3px}
  table{border-collapse:collapse;width:100%;margin-bottom:2px}
  th{border:1px solid #999;padding:4px 7px;background:#f0f0f0;font-weight:bold}
  td{border:1px solid #ccc;padding:3px 7px}
  .r{text-align:right}.c{text-align:center}
  .ob td{font-style:italic}
  .tot td{font-weight:bold;background:#f5f5f5}
`;

function _wrapHtml(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}

// Generates "Outstanding Party wise Report" HTML â€” matches the VB6 PDF format.
// Aggregates multiple receipt rows into one bill row each.
function buildLdgrepHtml(groupName, fromDate, toDate, groupRows) {
  const byParty = new Map();
  for (const r of groupRows) {
    if (r.SortOrd === 2) continue;
    const pk = `${r.pName}||${r.fkCompID}`;
    if (!byParty.has(pk)) byParty.set(pk, { pName: r.pName, openingBal: 0, bills: new Map() });
    const entry = byParty.get(pk);
    if (r.SortOrd === 0) { entry.openingBal = parseFloat(r.NetAmt) || 0; continue; }
    if (!r.BillNum) continue;
    const bk = `${r.pkBillID || r.BillNum}||${r.BillType}`;
    if (!entry.bills.has(bk)) {
      entry.bills.set(bk, { BillDt: r.BillDt, BillNum: r.BillNum, NetAmt: parseFloat(r.NetAmt)||0,
        rcptAmt: 0, tdsAmt: 0, discAmt: 0, lastRcptDt: null });
    }
    const b = entry.bills.get(bk);
    if (r.RecptAmt != null) b.rcptAmt += parseFloat(r.RecptAmt)||0;
    if (r.TDSAmt   != null) b.tdsAmt  += parseFloat(r.TDSAmt)  ||0;
    if (r.DiscAmt  != null) b.discAmt += parseFloat(r.DiscAmt) ||0;
    if (r.RecptDt) b.lastRcptDt = r.RecptDt;
  }

  let body = `<div class="pg-hdr">
    <div class="grp">${(groupName||'').toUpperCase()}</div>
    <div class="ttl">Outstanding Party wise Report</div>
    <div class="dts">From : ${_fmtDt(fromDate)}&nbsp;&nbsp;&nbsp;To : ${_fmtDt(toDate)}</div>
  </div>`;

  for (const { pName, openingBal, bills } of byParty.values()) {
    let totalPending = 0;
    body += `<div class="pty">${pName}</div><table><tr>
      <th>Bill Date</th><th>Bill No.</th><th class="r">Net Amount</th>
      <th>Received Date</th><th class="r">Received Amount</th>
      <th class="r">TDS Amount</th><th class="r">Pending Amount</th></tr>`;
    if (openingBal) {
      totalPending += openingBal;
      body += `<tr class="ob"><td></td><td>Opening Balance</td>
        <td></td><td></td><td></td><td></td>
        <td class="r">${_fN(openingBal)}</td></tr>`;
    }
    for (const b of bills.values()) {
      const pending = Math.max(0, b.NetAmt - b.rcptAmt - b.tdsAmt - b.discAmt);
      totalPending += pending;
      const hasRcpt = b.rcptAmt > 0 || b.tdsAmt > 0;
      body += `<tr>
        <td class="c">${_fmtDt(b.BillDt)}</td><td>${b.BillNum}</td>
        <td class="r">${_fN(b.NetAmt)}</td>
        <td class="c">${hasRcpt ? _fmtDt(b.lastRcptDt) : ''}</td>
        <td class="r">${hasRcpt ? _fN(b.rcptAmt) : ''}</td>
        <td class="r">${hasRcpt && b.tdsAmt ? _fN(b.tdsAmt) : ''}</td>
        <td class="r">${_fN(pending)}</td></tr>`;
    }
    body += `<tr class="tot"><td colspan="6">Total Bill Pending</td>
      <td class="r">${_fN(totalPending)}</td></tr></table>`;
  }
  return _wrapHtml('Outstanding Party wise Report', body);
}

// Generates "Ledger Format Report" HTML for LDGFMT report type.
function buildLdgfmtHtml(groupName, fromDate, toDate, groupRows) {
  const byParty = new Map();
  for (const r of groupRows) {
    const pk = `${r.pName}||${r.fkCompID}`;
    if (!byParty.has(pk)) byParty.set(pk, { pName: r.pName, rows: [] });
    byParty.get(pk).rows.push(r);
  }

  let body = `<div class="pg-hdr">
    <div class="grp">${(groupName||'').toUpperCase()}</div>
    <div class="ttl">Ledger Format Report</div>
    <div class="dts">From : ${_fmtDt(fromDate)}&nbsp;&nbsp;&nbsp;To : ${_fmtDt(toDate)}</div>
  </div>`;

  for (const { pName, rows: pRows } of byParty.values()) {
    body += `<div class="pty">${pName}</div><table><tr>
      <th>Entry Type</th><th>Date</th><th>Doc No</th><th>Bill Type</th>
      <th class="r">Bill Amt</th><th class="r">Rcpt Amt</th>
      <th class="r">Total Rcpt</th><th class="r">Balance</th></tr>`;
    for (const r of pRows) {
      body += `<tr class="${r.EntryType==='Opening'?'ob':''}">
        <td class="c">${r.EntryType||''}</td>
        <td class="c">${_fmtDt(r.EntryDate)}</td>
        <td class="c">${r.DocNo||''}</td>
        <td class="c">${r.BillType||''}</td>
        <td class="r">${r.TotalBill ? _fN(r.TotalBill) : ''}</td>
        <td class="r">${r.Receipt   ? _fN(r.Receipt)   : ''}</td>
        <td class="r">${r.TotalReceipt ? _fN(r.TotalReceipt) : ''}</td>
        <td class="r"><b>${r.Balance != null ? _fN(r.Balance) : ''}</b></td></tr>`;
    }
    body += `</table>`;
  }
  return _wrapHtml('Ledger Format Report', body);
}

// â”€â”€ PDF generators (for email attachments) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildLdgrepPdf(groupName, fromDate, toDate, groupRows, compName = '', logoPath = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const MG   = 40;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const usW   = pageW - MG * 2;
    const x0    = MG;
    let y        = MG;
    const bot    = pageH - MG;

    const raw  = [72, 140, 108, 72, 122, 100, 148];
    const rawS = raw.reduce((s, w) => s + w, 0);
    const cw   = raw.map(w => Math.round(w * usW / rawS));
    cw[cw.length - 1] += usW - cw.reduce((s, w) => s + w, 0);

    const colDefs  = ['Bill Date', 'Bill No.', 'Net Amount', 'Received Date', 'Received Amount', 'TDS Amount', 'Pending Amount'];
    const colAlign = ['center', 'left', 'right', 'center', 'right', 'right', 'right'];
    const ROW_H = 14, HDR_H = 18;

    const LOGO_TOP = 14; // 5mm from page top (5 × 72/25.4 ≈ 14pt)
    const drawPageHdr = () => {
      if (logoPath) {
        try {
          doc.image(logoPath, x0, LOGO_TOP, { fit: [usW, 50], align: 'center', valign: 'top' });
          y = LOGO_TOP + 50 + 8; // logo top + max height + gap
        } catch (_e) {
          if (compName) { doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text(compName.toUpperCase(), x0, y, { width: usW, align: 'center', characterSpacing: 1.5 }); y += 22; }
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text((groupName || '').toUpperCase(), x0, y, { width: usW, align: 'center' }); y += 16;
        }
      } else {
        if (compName) { doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text(compName.toUpperCase(), x0, y, { width: usW, align: 'center', characterSpacing: 1.5 }); y += 22; }
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text((groupName || '').toUpperCase(), x0, y, { width: usW, align: 'center' }); y += 16;
      }
      doc.fontSize(11).font('Helvetica')
         .text('Outstanding Party wise Report', x0, y, { width: usW, align: 'center' });
      y += 14;
      doc.fontSize(9)
         .text(`From : ${_fmtDt(fromDate)}   To : ${_fmtDt(toDate)}`, x0, y, { width: usW, align: 'center' });
      y += 18;
    };

    const drawHdr = () => {
      doc.save().fillColor('#e0e0e0').rect(x0, y, usW, HDR_H).fill().restore();
      let cx = x0;
      for (let i = 0; i < colDefs.length; i++) {
        doc.strokeColor('#999999').rect(cx, y, cw[i], HDR_H).stroke();
        doc.fillColor('#000000').fontSize(7.5).font('Helvetica-Bold')
           .text(colDefs[i], cx + 2, y + (HDR_H - 8) / 2, { width: cw[i] - 4, align: colAlign[i], lineBreak: false });
        cx += cw[i];
      }
      y += HDR_H;
    };

    const drawRow = (cells, opts = {}) => {
      const { bg, italic } = opts;
      if (bg) doc.save().fillColor(bg).rect(x0, y, usW, ROW_H).fill().restore();
      let cx = x0;
      for (let i = 0; i < cells.length; i++) {
        const cell  = cells[i];
        const text  = cell?.text ?? String(cell ?? '');
        const align = cell?.align ?? colAlign[i];
        doc.strokeColor('#cccccc').rect(cx, y, cw[i], ROW_H).stroke();
        if (text) {
          doc.fillColor('#000000').fontSize(7.5)
             .font(italic ? 'Helvetica-Oblique' : 'Helvetica')
             .text(text, cx + 2, y + (ROW_H - 8) / 2, { width: cw[i] - 4, align, lineBreak: false });
        }
        cx += cw[i];
      }
      y += ROW_H;
    };

    const drawTotRow = (pending) => {
      const lastW  = cw[cw.length - 1];
      const otherW = usW - lastW;
      doc.save().fillColor('#f0f0f0').rect(x0, y, usW, ROW_H).fill().restore();
      doc.strokeColor('#999999').rect(x0, y, usW, ROW_H).stroke();
      doc.fillColor('#000000').fontSize(7.5).font('Helvetica-Bold')
         .text('Total Bill Pending', x0 + 2, y + (ROW_H - 8) / 2, { width: otherW - 4, align: 'right', lineBreak: false });
      doc.fillColor('#000000').fontSize(7.5).font('Helvetica-Bold')
         .text(_fN(pending), x0 + otherW + 2, y + (ROW_H - 8) / 2, { width: lastW - 4, align: 'right', lineBreak: false });
      y += ROW_H;
    };

    const byParty = new Map();
    for (const r of groupRows) {
      if (r.SortOrd === 2) continue;
      const pk = `${r.pName}||${r.fkCompID}`;
      if (!byParty.has(pk)) byParty.set(pk, { pName: r.pName, openingBal: 0, bills: new Map() });
      const entry = byParty.get(pk);
      if (r.SortOrd === 0) { entry.openingBal = parseFloat(r.NetAmt) || 0; continue; }
      if (!r.BillNum) continue;
      const bk = `${r.pkBillID || r.BillNum}||${r.BillType}`;
      if (!entry.bills.has(bk)) {
        entry.bills.set(bk, { BillDt: r.BillDt, BillNum: r.BillNum, NetAmt: parseFloat(r.NetAmt) || 0,
          rcptAmt: 0, tdsAmt: 0, discAmt: 0, lastRcptDt: null });
      }
      const b = entry.bills.get(bk);
      if (r.RecptAmt != null) b.rcptAmt += parseFloat(r.RecptAmt) || 0;
      if (r.TDSAmt   != null) b.tdsAmt  += parseFloat(r.TDSAmt)   || 0;
      if (r.DiscAmt  != null) b.discAmt += parseFloat(r.DiscAmt)  || 0;
      if (r.RecptDt) b.lastRcptDt = r.RecptDt;
    }

    drawPageHdr();

    for (const { pName, openingBal, bills } of byParty.values()) {
      if (y + 13 + HDR_H + ROW_H + ROW_H > bot) { doc.addPage(); y = MG; drawPageHdr(); }

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
         .text(pName, x0, y, { width: usW, lineBreak: false });
      y += 13;
      drawHdr();

      let totalPending = 0;

      if (openingBal) {
        totalPending += openingBal;
        if (y + ROW_H > bot) { doc.addPage(); y = MG; drawHdr(); }
        drawRow(['', 'Opening Balance', '', '', '', '', { text: _fN(openingBal), align: 'right' }], { bg: '#fffde7', italic: true });
      }

      for (const b of bills.values()) {
        if (y + ROW_H > bot) { doc.addPage(); y = MG; drawHdr(); }
        const pending = Math.max(0, b.NetAmt - b.rcptAmt - b.tdsAmt - b.discAmt);
        totalPending += pending;
        const hasRcpt = b.rcptAmt > 0 || b.tdsAmt > 0;
        drawRow([
          { text: _fmtDt(b.BillDt),                          align: 'center' },
          { text: b.BillNum || '',                            align: 'left'   },
          { text: _fN(b.NetAmt),                              align: 'right'  },
          { text: hasRcpt ? _fmtDt(b.lastRcptDt) : '',       align: 'center' },
          { text: hasRcpt ? _fN(b.rcptAmt) : '',              align: 'right'  },
          { text: hasRcpt && b.tdsAmt ? _fN(b.tdsAmt) : '',   align: 'right'  },
          { text: _fN(pending),                               align: 'right'  },
        ]);
      }

      if (y + ROW_H > bot) { doc.addPage(); y = MG; }
      drawTotRow(totalPending);
      y += 8;
    }

    doc.end();
  });
}

function buildLdgfmtPdf(groupName, fromDate, toDate, groupRows, compName = '', logoPath = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const MG    = 40;
    const pageW = doc.page.width;   // 595.28
    const pageH = doc.page.height;  // 841.89
    const usW   = pageW - MG * 2;
    const x0    = MG;
    let y        = MG;
    const bot    = pageH - MG;

    // Columns: Date | Particulars | EntryType | Debit | Credit
    const raw  = [75, 215, 60, 82, 83];
    const rawS = raw.reduce((s, w) => s + w, 0);
    const cw   = raw.map(w => Math.round(w * usW / rawS));
    cw[cw.length - 1] += usW - cw.reduce((s, w) => s + w, 0);

    const MROW_H = 14, SROW_H = 11, HDR_H = 18;
    const newPage = () => { doc.addPage(); y = MG; };

    const billLabel = bt => ({ GODRENT: 'GODOWN RENT BILL', HMLI: 'HAMALI BILL',
      TRSP: 'TRANSPORT BILL', GEN: 'GENERAL BILL' }[bt] || bt || 'BILL');

    // Aggregate raw rows into structured party events
    const byParty = new Map();
    const evtMap  = new Map();
    for (const r of groupRows) {
      const pk = `${r.pName}||${r.fkCompID}`;
      if (!byParty.has(pk)) byParty.set(pk, { pName: r.pName, events: [] });
      const party = byParty.get(pk);
      if (r.EntryType === 'Opening') {
        party.events.push({ type: 'Opening', date: r.EntryDate, balance: parseFloat(r.Balance) || 0 });
      } else if (r.EntryType === 'Sales') {
        party.events.push({ type: 'Sales', date: r.EntryDate, label: billLabel(r.BillType),
          docNo: r.DocNo || '', amount: parseFloat(r.TotalBill) || 0 });
      } else if (r.EntryType === 'Receipt' || r.EntryType === 'Advance') {
        const gk = `${pk}||RCV||${r.EntryDate}||${r.bName || ''}||${r.TotalReceipt}`;
        if (!evtMap.has(gk)) {
          const evt = { type: 'Receipt', date: r.EntryDate, bName: r.bName || '',
            total: parseFloat(r.TotalReceipt) || 0, subs: [] };
          party.events.push(evt); evtMap.set(gk, evt);
        }
        evtMap.get(gk).subs.push({ docNo: r.DocNo || '', amt: parseFloat(r.Receipt) || 0 });
      } else if (r.EntryType === 'TDS') {
        const gk = `${pk}||TDS||${r.EntryDate}||${r.TotalReceipt}`;
        if (!evtMap.has(gk)) {
          const evt = { type: 'TDS', date: r.EntryDate, total: parseFloat(r.TotalReceipt) || 0, subs: [] };
          party.events.push(evt); evtMap.set(gk, evt);
        }
        evtMap.get(gk).subs.push({ docNo: r.DocNo || '', amt: parseFloat(r.Receipt) || 0 });
      }
    }

    const LOGO_TOP = 14; // 5mm from page top (5 × 72/25.4 ≈ 14pt)
    const drawPartyHdr = (pName) => {
      if (logoPath) {
        try {
          doc.image(logoPath, x0, LOGO_TOP, { fit: [usW, 50], align: 'center', valign: 'top' });
          y = LOGO_TOP + 50 + 8; // logo top + max height + gap
        } catch (_e) {
          if (compName) { doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text(compName.toUpperCase(), x0, y, { width: usW, align: 'center', characterSpacing: 1.5 }); y += 22; }
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text((groupName || '').toUpperCase(), x0, y, { width: usW, align: 'center' }); y += 16;
        }
      } else {
        if (compName) { doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text(compName.toUpperCase(), x0, y, { width: usW, align: 'center', characterSpacing: 1.5 }); y += 22; }
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text((groupName || '').toUpperCase(), x0, y, { width: usW, align: 'center' }); y += 16;
      }
      doc.fontSize(12).font('Helvetica-Bold')
         .text(pName, x0, y, { width: usW, align: 'center' });
      y += 16;
      doc.fontSize(11).font('Helvetica')
         .text('Ledger Account', x0, y, { width: usW, align: 'center' });
      y += 14;
      doc.fontSize(9)
         .text(`${_fmtDt(fromDate)} to ${_fmtDt(toDate)}`, x0, y, { width: usW, align: 'center' });
      y += 16;
    };

    const drawTableHdr = () => {
      doc.save().fillColor('#f0f0f0').rect(x0, y, usW, HDR_H).fill().restore();
      const labels = ['Date', 'Particulars', '', 'Debit', 'Credit'];
      let cx = x0;
      for (let i = 0; i < cw.length; i++) {
        doc.strokeColor('#999999').rect(cx, y, cw[i], HDR_H).stroke();
        const align = i >= 3 ? 'right' : 'left';
        doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
           .text(labels[i], cx + 3, y + (HDR_H - 8) / 2, { width: cw[i] - 6, align, lineBreak: false });
        cx += cw[i];
      }
      y += HDR_H;
    };

    const drawMainRow = (cells, bg) => {
      if (bg) doc.save().fillColor(bg).rect(x0, y, usW, MROW_H).fill().restore();
      let cx = x0;
      for (let i = 0; i < cw.length; i++) {
        const cell   = cells[i] || {};
        const text   = cell.text   || '';
        const align  = cell.align  || (i >= 3 ? 'right' : 'left');
        const bold   = cell.bold   || false;
        const italic = cell.italic || false;
        doc.strokeColor('#cccccc').rect(cx, y, cw[i], MROW_H).stroke();
        if (text) {
          doc.fillColor('#000000').fontSize(8)
             .font(bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica')
             .text(text, cx + 3, y + (MROW_H - 8) / 2, { width: cw[i] - 6, align, lineBreak: false });
        }
        cx += cw[i];
      }
      y += MROW_H;
    };

    const drawSubRow = (particularsText) => {
      let cx = x0;
      for (const w of cw) { doc.strokeColor('#e0e0e0').rect(cx, y, w, SROW_H).stroke(); cx += w; }
      const indentX = x0 + cw[0] + 12;
      const indentW = cw[1] - 16;
      doc.fillColor('#444444').fontSize(7).font('Helvetica')
         .text(particularsText, indentX, y + (SROW_H - 7) / 2, { width: indentW, lineBreak: false });
      y += SROW_H;
    };

    const drawFooter = (totalDr, totalCr) => {
      const closingBal = totalDr - totalCr;
      // Subtotals
      drawMainRow([{}, {}, {},
        { text: _fN(totalDr), bold: true },
        { text: _fN(totalCr), bold: true },
      ], '#f8f8f8');
      // Closing balance
      if (closingBal >= 0) {
        drawMainRow([{}, { text: 'Closing Balance', bold: true }, {}, {},
          { text: _fN(closingBal), bold: true },
        ], '#f0f0f0');
        drawMainRow([{}, {}, {},
          { text: _fN(totalDr), bold: true },
          { text: _fN(totalDr), bold: true },
        ], '#f8f8f8');
      } else {
        drawMainRow([{}, { text: 'Closing Balance', bold: true }, {},
          { text: _fN(Math.abs(closingBal)), bold: true }, {},
        ], '#f0f0f0');
        drawMainRow([{}, {}, {},
          { text: _fN(totalCr), bold: true },
          { text: _fN(totalCr), bold: true },
        ], '#f8f8f8');
      }
    };

    let isFirst = true;
    for (const { pName, events } of byParty.values()) {
      if (!isFirst) { newPage(); }
      isFirst = false;
      drawPartyHdr(pName);
      drawTableHdr();

      let totalDr = 0, totalCr = 0;

      for (const evt of events) {
        const needed = MROW_H + (evt.type === 'Sales' ? SROW_H : (evt.subs?.length || 0) * SROW_H);
        if (y + needed > bot) { newPage(); drawTableHdr(); }

        if (evt.type === 'Opening') {
          totalDr += evt.balance;
          drawMainRow([
            { text: _fmtDt(evt.date) },
            { text: 'Opening Balance', bold: true },
            {}, { text: _fN(evt.balance), bold: true }, {},
          ], '#fff8e7');
        } else if (evt.type === 'Sales') {
          totalDr += evt.amount;
          drawMainRow([
            { text: _fmtDt(evt.date) },
            { text: evt.label, bold: true },
            { text: 'Sales', italic: true, align: 'right' },
            { text: _fN(evt.amount), bold: true }, {},
          ]);
          if (y + SROW_H > bot) { newPage(); drawTableHdr(); }
          drawSubRow(evt.docNo);
        } else if (evt.type === 'Receipt') {
          totalCr += evt.total;
          drawMainRow([
            { text: _fmtDt(evt.date) },
            { text: evt.bName || 'BANK', bold: true },
            { text: 'Receipt', italic: true, align: 'right' },
            {}, { text: _fN(evt.total), bold: true },
          ]);
          for (const s of evt.subs) {
            if (y + SROW_H > bot) { newPage(); drawTableHdr(); }
            drawSubRow(`${s.docNo}   ${_fN(s.amt)}`);
          }
        } else if (evt.type === 'TDS') {
          totalCr += evt.total;
          drawMainRow([
            { text: _fmtDt(evt.date) },
            {},
            { text: 'TDS', italic: true, align: 'right' },
            {}, { text: _fN(evt.total), bold: true },
          ]);
          for (const s of evt.subs) {
            if (y + SROW_H > bot) { newPage(); drawTableHdr(); }
            drawSubRow(`${s.docNo}   ${_fN(s.amt)}`);
          }
        }
      }

      if (y + MROW_H * 3 > bot) { newPage(); }
      drawFooter(totalDr, totalCr);
    }

    doc.end();
  });
}

// â”€â”€ POST /email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Bulk email â€” one email per pGroup (combines all parties in same group).
// Attaches the full report HTML (LDGREP or LDGFMT format).
// Body: { rows, fromDate, toDate, repType, groupName, partyMap }
//       partyMap: { [pkPartyID]: { pGroup, pEmail } }
router.post('/email', requirePerm('RECEIPT_REP', 'CanView'), async (req, res) => {
  try {
    const { groupID } = req.user;
    const { rows = [], fromDate, toDate,
            repType = 'LDGREP', groupName = '', partyMap = {} } = req.body;
    if (!rows.length) return res.status(400).json({ error: 'No data rows provided.' });

    const smtpConf = getSmtpConfig(groupID);
    if (!smtpConf) {
      return res.status(500).json({
        error: `SMTP not configured for group "${groupID}". Add SMTP_${(groupID||'').toUpperCase()}_USER/PASS to .env.`,
      });
    }

    const transporter = nodemailer.createTransport({
      host:       smtpConf.host, port: smtpConf.port, secure: smtpConf.secure,
      auth:       smtpConf.auth,
      tls:        { rejectUnauthorized: false },
    });

    // Group rows by pGroup; collect distinct email addresses per group
    const byGroup = new Map();
    for (const r of rows) {
      const pm = partyMap[r.fkPartyID] || {};
      // Parties sharing the same pGroup get one combined report & email
      const grpKey = pm.pGroup ? `grp:${pm.pGroup}` : `pty:${r.fkPartyID}`;
      if (!byGroup.has(grpKey)) {
        byGroup.set(grpKey, { rows: [], emails: new Set(), partyNames: new Set() });
      }
      const entry = byGroup.get(grpKey);
      entry.rows.push(r);
      const email = (pm.pEmail || r.pEmail || '').trim();
      if (email) entry.emails.add(email);
      if (r.pName) entry.partyNames.add(r.pName);
    }

    const { fromName, fromAddr, compName: smtpCompName, website } = smtpConf;

    // Primary company name + letterhead image (matches frontend print logic)
    const _primaryCompID  = connectionManager.getPrimaryCompID(groupID);
    const _primaryDetails = _primaryCompID
      ? connectionManager.getCompanyInfo(_primaryCompID)
      : connectionManager.getGroupCompanyDetails(groupID)[0];
    const letterheadName  = _primaryDetails?.CompName || smtpCompName || '';
    const logoPath        = getLetterheadPath(groupID);

    const fallbackAddr = process.env.FALLBACK_EMAIL || fromAddr;
    const isLdgfmt = repType === 'LDGFMT';
    const sent = [], errors = [];

    for (const { rows: grpRows, emails, partyNames } of byGroup.values()) {
      const toAddrs   = [...emails];
      const recipient = toAddrs.length ? toAddrs.join(', ') : fallbackAddr;
      const noEmail   = toAddrs.length === 0;
      const namesStr  = [...partyNames].join(', ');

      // Generate per-group report PDF attachment
      const reportBuf = await (isLdgfmt
        ? buildLdgfmtPdf(groupName, fromDate, toDate, grpRows, letterheadName, logoPath)
        : buildLdgrepPdf(groupName, fromDate, toDate, grpRows, letterheadName, logoPath));
      const reportFilename = isLdgfmt ? 'Ledger_Report.pdf' : 'Outstanding_Report.pdf';

      // Format yyyy-mm-dd â†’ dd/mm/yyyy for email display
      const fmtD = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

      // Summary table per party in email body
      const summaryRows = [...partyNames].map(pName => {
        const pRows = grpRows.filter(r => r.pName === pName);
        let bal = 0;
        if (isLdgfmt) {
          // Closing balance = totalDr - totalCr, summed row-by-row (no deduplication needed)
          // Openingâ†’Debit, Salesâ†’Debit, Receipt/Advanceâ†’Credit (Receipt+DiscAmt), TDSâ†’Credit
          let totalDr = 0, totalCr = 0;
          for (const r of pRows) {
            if (r.EntryType === 'Opening') {
              totalDr += parseFloat(r.Balance) || 0;
            } else if (r.EntryType === 'Sales') {
              totalDr += parseFloat(r.TotalBill) || 0;
            } else if (r.EntryType === 'Receipt' || r.EntryType === 'Advance') {
              totalCr += (parseFloat(r.Receipt) || 0) + (parseFloat(r.TotalBill) || 0);
            } else if (r.EntryType === 'TDS') {
              totalCr += parseFloat(r.Receipt) || 0;
            }
          }
          bal = totalDr - totalCr;
        } else {
          const last = [...pRows].reverse().find(r => r.BalAmt !== undefined);
          bal = parseFloat(last?.BalAmt) || 0;
        }
        const balFmt = bal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<tr>
          <td style="font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:10px 14px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">${pName}</td>
          <td style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1e293b;padding:10px 14px;text-align:right;border-bottom:1px solid #e2e8f0;">Rs.${balFmt}/-</td>
        </tr>`;
      }).join('');

      const TH = 'font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1a0a00;padding:10px 14px;text-align:left;';
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
    <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;">${letterheadName}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#0d1b3e;">Outstanding Bill Reminder</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:20px 28px 4px;">
    <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;color:#334155;">Dear Sir/Madam,</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#334155;">Greetings from <b style="color:#1565C0;">${letterheadName}</b></p>
  </td></tr>

  <!-- Main message -->
  <tr><td style="padding:12px 28px 0;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#334155;">As Our records we find that following amount is outstanding.</p>
  </td></tr>

  <!-- Summary table -->
  <tr><td style="padding:16px 28px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
      <tr style="background:#f47920;">
        <th style="${TH}border-right:1px solid rgba(255,255,255,0.35);">Party Name</th>
        <th style="${TH}text-align:right;">Bill Amount</th>
      </tr>
      ${summaryRows}
    </table>
  </td></tr>

  <!-- Sub messages -->
  <tr><td style="padding:0 28px 18px;">
    <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#475569;">The details are enclosed here with for ready reference.</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#475569;">We request you to look in to above and clear the due as early as possible.</p>
  </td></tr>

  <!-- Thanks -->
  <tr><td style="padding:16px 28px;border-top:1px solid #f0f4f8;">
    <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;color:#334155;">Thanks &amp; Regards,</p>
    <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;color:#334155;">---</p>
    <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#1565C0;">${letterheadName}</p>
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

      try {
        await transporter.sendMail({
          from:    `"${fromName}" <${fromAddr}>`,
          to:      recipient,
          subject: 'Reminder : Outstanding Bill Statement',
          html:    htmlBody,
          attachments: [{
            filename:    reportFilename,
            content:     reportBuf,
            contentType: 'application/pdf',
          }],
        });
        for (const name of partyNames) sent.push({ pName: name, noEmail });
      } catch (mailErr) {
        for (const name of partyNames) errors.push({ pName: name, error: mailErr.message });
      }
    }

    res.json({ sent, errors });
  } catch (e) {
    console.error('[receiptReport] POST /email:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
