// HamaliCalReportPage.jsx — Hamali Calculation Report
// VB6 origin: frmHamaliCalEntryReport.frm
//
// Workflow:
//   1. Set date range → Go  → loads per-employee summary grid (POST /summary)
//   2. Select Report Type → View → opens a new browser tab with print-ready report
//                            User prints to PDF from the new tab (Ctrl+P)

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Alert, Box, Button, CircularProgress, Divider,
  FormControl, FormControlLabel, FormLabel, Paper,
  Radio, RadioGroup, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CancelIcon       from '@mui/icons-material/Cancel';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SearchIcon       from '@mui/icons-material/Search';
import VisibilityIcon   from '@mui/icons-material/Visibility';
import * as XLSX        from 'xlsx';
import api              from '../../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMonthDefaults() {
  const d    = new Date();
  const y    = d.getFullYear();
  const m    = String(d.getMonth() + 1).padStart(2, '0');
  const last = String(new Date(y, d.getMonth() + 1, 0).getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}

const todayStr = new Date().toISOString().slice(0, 10);
const f2       = n  => (parseFloat(n) || 0).toFixed(2);
const n2       = v  => parseFloat(v) || 0;
const fmtDate  = s  => s ? `${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}` : '';
const isoDate  = v  => !v ? '' : (typeof v === 'string' ? v.slice(0,10) : new Date(v).toISOString().slice(0,10));

// ── Print-window helpers (no React) ──────────────────────────────────────────
const f2h  = n  => (parseFloat(n) || 0).toFixed(2);
const fmth = s  => s ? `${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}` : '';
const isoh = v  => !v ? '' : (typeof v === 'string' ? v.slice(0,10) : new Date(v).toISOString().slice(0,10));

const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #000; }
h2 { font-size: 15px; margin-bottom: 4px; font-weight: bold; }
.meta { font-size: 11px; color: #555; margin-bottom: 14px; }
hr { border: none; border-top: 1px solid #ccc; margin-bottom: 14px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
th { padding: 6px 8px; text-align: left; font-size: 11px; font-weight: bold; color: #fff; }
th.r, td.r { text-align: right; }
td { padding: 4px 8px; font-size: 11px; border-bottom: 1px solid #e0e0e0; }
tr:nth-child(even) td { background: #f9f9f9; }
.sub td { background: #e3f2fd !important; font-weight: bold; }
.grand td { background: #bbdefb !important; font-weight: bold; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; font-size: 12px;
       cursor: pointer; border: none; border-radius: 4px; background: #1565c0; color: #fff; margin-bottom: 14px; }
.btn:hover { background: #0d47a1; }
@page { margin: 12mm; }
@media print { .no-print { display: none !important; } body { padding: 0; } }
`;

const LABOUR_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 10px; padding: 12px; color: #000; }
h2 { font-size: 13px; margin-bottom: 3px; font-weight: bold; }
.meta { font-size: 10px; color: #555; margin-bottom: 10px; }
hr { border: none; border-top: 1px solid #ccc; margin-bottom: 10px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 11px;
       cursor: pointer; border: none; border-radius: 4px; background: #1565c0; color: #fff; margin-bottom: 10px; }
table { border-collapse: collapse; width: 100%; }
th { padding: 4px 6px; font-size: 9px; font-weight: bold;
     background: #1565c0; color: #fff; text-align: right; white-space: nowrap; }
th.l { text-align: left; }
td { padding: 3px 6px; font-size: 9px; border-bottom: 1px solid #e0e0e0; text-align: right; white-space: nowrap; }
td.l { text-align: left; }
tr:nth-child(even) td { background: #f9f9f9; }
tr.tot td { background: #bbdefb !important; font-weight: bold; }
@page { size: A4 landscape; margin: 8mm; }
@media print { .no-print { display: none !important; } body { padding: 0; } }
`;

function buildLabourHTML(rows, fd, td) {
  // Build pivot: date × eShortName → (tCashAmt + tOutStndAmt)
  const dateSet = new Set();
  const empSet  = new Set();
  const cell    = {};  // cell[date][emp] = amount

  for (const r of rows) {
    const date = isoh(r.tDate);
    const emp  = r.eShortName || '—';
    const amt  = n2(r.tOutStndAmt);
    dateSet.add(date);
    empSet.add(emp);
    if (!cell[date]) cell[date] = {};
    cell[date][emp] = (cell[date][emp] || 0) + amt;
  }

  const dates = [...dateSet].sort();
  const emps  = [...empSet].sort();

  // Column totals — one per employee (Total row at top)
  const colTot = {};
  for (const emp of emps) {
    colTot[emp] = dates.reduce((s, d) => s + (cell[d]?.[emp] || 0), 0);
  }
  const grandTot = emps.reduce((s, e) => s + colTot[e], 0);

  // Header
  let tbl = `<table>
<thead>
  <tr>
    <th class="l"></th>
    <th>Total</th>
    ${emps.map(e => `<th>${e}</th>`).join('')}
  </tr>
</thead>
<tbody>`;

  // Total row at top
  tbl += `<tr class="tot">
    <td class="l">Total</td>
    <td>${f2h(grandTot)}</td>
    ${emps.map(e => `<td>${f2h(colTot[e])}</td>`).join('')}
  </tr>`;

  // Date rows
  for (const date of dates) {
    const rowTot = emps.reduce((s, e) => s + (cell[date]?.[e] || 0), 0);
    tbl += `<tr>
    <td class="l">${fmth(date)}</td>
    <td>${f2h(rowTot)}</td>
    ${emps.map(e => `<td>${f2h(cell[date]?.[e] || 0)}</td>`).join('')}
  </tr>`;
  }

  tbl += `</tbody></table>`;
  return { css: LABOUR_CSS, body: tbl };
}

const BOARD_DEPO_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11px; padding: 16px; color: #000; }
h2 { font-size: 13px; margin-bottom: 3px; font-weight: bold; }
.meta { font-size: 10px; color: #555; margin-bottom: 10px; }
hr { border: none; border-top: 1px solid #ccc; margin-bottom: 10px; }
.grp-title { font-size: 11px; font-weight: bold; margin-bottom: 6px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 11px;
       cursor: pointer; border: none; border-radius: 4px; background: #1565c0; color: #fff; margin-bottom: 10px; }
table { border-collapse: collapse; }
th { padding: 5px 8px; font-size: 11px; font-weight: bold;
     border: 1px solid #000; text-align: right; }
th.l { text-align: left; }
td { padding: 4px 8px; font-size: 11px; border: 1px solid #000; text-align: right; }
td.l { text-align: left; }
tr.tot td { font-weight: bold; }
@page { size: A4 portrait; margin: 12mm; }
@media print { .no-print { display: none !important; } body { padding: 0; } }
`;

function buildBoardDepoHTML(rows) {
  if (!rows.length) return '<p>No data</p>';

  // Rates are constant for the period — take from first non-zero row
  const rateRow  = rows.find(r => n2(r.tBoardTonRate) > 0) || rows[0];
  const tonRate  = n2(rateRow.tBoardTonRate);
  const levyPct  = n2(rateRow.tBoardLeavyPerct);
  const divisor  = tonRate > 0 ? (1 + levyPct / 100) : 1;

  let totTon = 0, totC1 = 0, totC2 = 0, totAmt = 0;

  const bodyRows = rows.map(r => {
    const amt  = n2(r.tBoardDepoAmt);
    const c1   = tonRate > 0 ? amt / divisor           : 0;
    const ton  = tonRate > 0 ? c1  / tonRate           : 0;
    const c2   = amt - c1;
    totTon += ton; totC1 += c1; totC2 += c2; totAmt += amt;
    return `<tr>
      <td class="l">${fmth(r.tDate)}</td>
      <td>${f2h(ton)}</td>
      <td>${f2h(c1)}</td>
      <td>${f2h(c2)}</td>
      <td>${f2h(amt)}</td>
    </tr>`;
  }).join('');

  return `<p class="grp-title">Grocery Board Detail</p>
<table>
  <thead>
    <tr>
      <th class="l">Date</th>
      <th>Ton</th>
      <th>${f2h(tonRate)}</th>
      <th>${f2h(levyPct)}</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows}
    <tr class="tot">
      <td></td>
      <td>${f2h(totTon)}</td>
      <td>${f2h(totC1)}</td>
      <td>${f2h(totC2)}</td>
      <td>${f2h(totAmt)}</td>
    </tr>
  </tbody>
</table>`;
}

const BOARD_FORM_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; color: #000; }
h1 { font-size: 13px; font-weight: bold; text-align: center; margin-bottom: 2px; }
h2 { font-size: 11px; font-weight: normal; text-align: center; margin-bottom: 16px; }
.tbl { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
.tbl td { border: 1px solid #000; padding: 5px 8px; vertical-align: top; }
.tbl td.lbl { width: 48%; font-weight: normal; }
.tbl td.val { width: 52%; }
.sig { text-align: right; margin-top: 60px; font-size: 11px; line-height: 1.6; }
.btn { display:inline-flex;align-items:center;gap:6px;padding:6px 14px;font-size:11px;
       cursor:pointer;border:none;border-radius:4px;background:#1565c0;color:#fff;margin-bottom:14px; }
@page { size: A4 portrait; margin: 15mm; }
@media print { .no-print { display:none!important; } body { padding:0; } }
`;

function numToWords(n) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                 'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                 'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(x)   { return x < 20 ? ones[x] : tens[~~(x/10)] + (x%10 ? ' '+ones[x%10] : ''); }
  function three(x) { return x>=100 ? ones[~~(x/100)]+' Hundred'+(x%100?' '+two(x%100):'') : two(x); }
  n = Math.round(n);
  if (!n) return 'Zero';
  const c = ~~(n/10000000); n %= 10000000;
  const l = ~~(n/100000);   n %= 100000;
  const t = ~~(n/1000);     n %= 1000;
  let w = '';
  if (c) w += two(c)   + ' Crore ';
  if (l) w += two(l)   + ' Lakh ';
  if (t) w += two(t)   + ' Thousand ';
  if (n) w += three(n);
  return 'Rs. ' + w.trim() + ' Only';
}

function buildBoardFormHTML(rows, fd, td, utr, pd) {
  const amt = n2(rows[0]?.BoardAmt);

  // Board details — Grocery Workers Board (external regulatory body, static)
  const BOARD_NAME  = 'Grocery Markets &amp; Shops Board';
  const BOARD_ADDR  = "Rajdarshan 'B' wing, Dada Patil wadi, Gr. floor, Thane (W)";
  const BOARD_PHONE = '022-25402220';
  const BOARD_ACNO  = '0531100100001402';
  const BOARD_BANK  = 'Punjab National Bank, Turbhe Branch, Navi Mumbai';
  const BOARD_IFSC  = 'PUNB0053110';

  // Employer details — static for this company
  const empName  = 'PANKAJ PREMJI VISHRANI';
  const empRegNo = '6706';
  const empPhone = '';
  const empAddr  = 'DallMill Compound, Village - Purna, Bhiwandi, Thane - 421302.';
  const toliNum  = '2404';
  const bankName = 'Kotak Bank, Matunga Branch';
  const bankAcNo = '5346762612';

  const period = `${fmth(fd)} To ${fmth(td)}`;

  return `
<table class="tbl">
  <tr><td class="lbl">Name of Board</td><td class="val">${BOARD_NAME}</td></tr>
  <tr><td class="lbl">Board Address</td><td class="val">${BOARD_ADDR}</td></tr>
  <tr><td class="lbl">Board Phone No.</td><td class="val">${BOARD_PHONE}</td></tr>
  <tr><td class="lbl">Board Bank Account Number</td><td class="val">${BOARD_ACNO}</td></tr>
  <tr><td class="lbl">Board Bank Name &amp; Branch</td><td class="val">${BOARD_BANK}</td></tr>
  <tr><td class="lbl">Board Bank IFSC Code</td><td class="val">${BOARD_IFSC}</td></tr>
  <tr><td class="lbl">Amount (in figures) to be credited</td><td class="val">Rs. ${f2h(amt)}</td></tr>
  <tr><td class="lbl">Amount (in words) to be credited</td><td class="val">${numToWords(amt)}</td></tr>
  <tr><td class="lbl">Date of Payment</td><td class="val">${fmth(pd)}</td></tr>
</table>

<table class="tbl">
  <tr><td class="lbl">Name of Employee</td><td class="val">${empName}</td></tr>
  <tr><td class="lbl">Employer Register No.</td><td class="val">${empRegNo}</td></tr>
  <tr><td class="lbl">Mobile Phone Number of Employer</td><td class="val">${empPhone}</td></tr>
  <tr><td class="lbl">Address of the Employer</td><td class="val">${empAddr}</td></tr>
  <tr><td class="lbl">Toli No.</td><td class="val">${toliNum}</td></tr>
  <tr><td class="lbl">Wages &amp; Levy Paid for the Period</td><td class="val">${period}</td></tr>
  <tr><td class="lbl">Bank UTR No.</td><td class="val">${utr || ''}</td></tr>
  <tr><td class="lbl">Name of the Bank &amp; Branch (Employer)</td><td class="val">${bankName}</td></tr>
  <tr><td class="lbl">Bank Account Number (Employer)</td><td class="val">${bankAcNo}</td></tr>
</table>

<div class="sig">
  Signature of Authorised Signatory<br>
  With Rubber Stamp<br>
  (Employer)
</div>`;
}

function openReportWindow({ rows, reportType: rt, fromDate: fd, toDate: td, utrNo: utr, paymentDate: pd }) {
  const titles = { labour: 'Labour Wise Hamali Calculation', 'board-depo': 'Board Deposite Hamali Calculation', 'board-form': 'Board Deposite Form' };
  const title  = titles[rt] || rt;

  let css      = PRINT_CSS;
  let header   = `<h2>${title}</h2><p class="meta">Period: ${fmth(fd)} to ${fmth(td)}</p><hr>`;
  let bodyHTML = '';

  if (rt === 'labour') {
    const built = buildLabourHTML(rows, fd, td);
    css      = built.css;
    bodyHTML = built.body;
  } else if (rt === 'board-depo') {
    css      = BOARD_DEPO_CSS;
    bodyHTML = buildBoardDepoHTML(rows);
  } else {
    css      = BOARD_FORM_CSS;
    header   = `<h1>Form for Workers Wages &amp; Leavy Amount Transfer Through</h1>
<h2>_ Real Time Gross Settelment (RTGS) / _ National Electronic Funds Transfer (NEFT)</h2>`;
    bodyHTML = buildBoardFormHTML(rows, fd, td, utr, pd);
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
<body>
<div class="no-print">
  <button class="btn" onclick="window.print()">&#128424; Print / Save as PDF</button>
</div>
${header}
${bodyHTML}
<script>window.addEventListener('load', function(){ window.print(); });</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return 'blocked';
  win.document.write(html);
  win.document.close();
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
export default function HamaliCalReportPage() {
  const { can } = useAuth();
  const { from: defFrom, to: defTo } = useMemo(getMonthDefaults, []);

  const [fromDate,    setFromDate]    = useState(defFrom);
  const [toDate,      setToDate]      = useState(defTo);
  const [reportType,  setReportType]  = useState('labour');
  const [utrNo,       setUtrNo]       = useState('');
  const [paymentDate, setPaymentDate] = useState(todayStr);

  const [summaryData, setSummaryData] = useState(null);
  const [goLoading,   setGoLoading]   = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [alert,       setAlert]       = useState(null);

  function validateDates() {
    if (!fromDate || !toDate)                          return 'Please select From and To Dates.';
    if (fromDate > toDate)                             return 'From Date cannot be greater than To Date.';
    if (fromDate.slice(0, 7) !== toDate.slice(0, 7)) return 'Dates must be within the same month and year.';
    return null;
  }

  // ── Go: load per-employee summary ────────────────────────────────────────────
  const handleGo = useCallback(async () => {
    const err = validateDates();
    if (err) return setAlert({ type: 'warning', msg: err });
    setGoLoading(true); setAlert(null); setSummaryData(null);
    try {
      const { data } = await api.post('/reports/hamali-report/summary', { fromDate, toDate });
      if (data.empty) setAlert({ type: 'info', msg: 'No records found for the selected period.' });
      else            setSummaryData(data);
    } catch (e) {
      setAlert({ type: 'error', msg: e.response?.data?.error || 'Failed to load summary.' });
    } finally {
      setGoLoading(false);
    }
  }, [fromDate, toDate]);

  // ── View: open printable report in new tab ────────────────────────────────────
  const handleView = useCallback(async () => {
    const err = validateDates();
    if (err) return setAlert({ type: 'warning', msg: err });
    setViewLoading(true); setAlert(null);
    try {
      const { data } = await api.post('/reports/hamali-report/report', {
        reportType, fromDate, toDate, utrNo, paymentDate,
      });
      if (data.empty) {
        setAlert({ type: 'info', msg: 'No records found for the selected criteria.' });
        return;
      }
      const result = openReportWindow({ rows: data.rows, reportType, fromDate, toDate, utrNo, paymentDate });
      if (result === 'blocked') {
        setAlert({ type: 'warning', msg: 'Popup blocked. Please allow popups for this site to view the report.' });
      }
    } catch (e) {
      setAlert({ type: 'error', msg: e.response?.data?.error || 'Failed to generate report.' });
    } finally {
      setViewLoading(false);
    }
  }, [reportType, fromDate, toDate, utrNo, paymentDate]);

  const handleCancel = useCallback(() => {
    const { from, to } = getMonthDefaults();
    setFromDate(from); setToDate(to);
    setReportType('labour'); setUtrNo(''); setPaymentDate(todayStr);
    setSummaryData(null); setAlert(null);
  }, []);

  // ── Export summary grid to Excel ──────────────────────────────────────────────
  const handleExportGrid = useCallback(() => {
    if (!summaryData) return;
    const { empRows } = summaryData;
    const hdrs = ['Employee Name', 'Present', 'Cash Amt (₹)', 'O/S Amt (₹)', 'Grand Total (₹)'];
    const rows = empRows.map(r => [r.eName, r.Present, n2(r.CashAmt), n2(r.OutAmt), n2(r.CashAmt) + n2(r.OutAmt)]);
    const totRow = ['TOTAL', empRows.reduce((s, r) => s + (r.Present || 0), 0), empRows.reduce((s, r) => s + n2(r.CashAmt), 0), empRows.reduce((s, r) => s + n2(r.OutAmt), 0), empRows.reduce((s, r) => s + n2(r.CashAmt) + n2(r.OutAmt), 0)];
    const ws = XLSX.utils.aoa_to_sheet([
      [`Hamali Summary — ${fmtDate(fromDate)} to ${fmtDate(toDate)}`], [],
      hdrs, ...rows, totRow,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    XLSX.writeFile(wb, `HamaliSummary_${fromDate}_to_${toDate}.xlsx`);
  }, [summaryData, fromDate, toDate]);

  const isBoardForm = reportType === 'board-form';

  return (
    <Box sx={{ pb: 4 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Hamali Calculation Report
      </Typography>

      {alert && (
        <Alert severity={alert.type} onClose={() => setAlert(null)} sx={{ mb: 1.5 }}>
          {alert.msg}
        </Alert>
      )}

      {/* ── Date range + Go ──────────────────────────────────────────────────── */}
      <Paper elevation={1} sx={{ p: 2, mb: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="From Date" type="date" size="small" sx={{ width: 160 }}
            value={fromDate}
            onChange={e => { setFromDate(e.target.value); setSummaryData(null); }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To Date" type="date" size="small" sx={{ width: 160 }}
            value={toDate}
            onChange={e => { setToDate(e.target.value); setSummaryData(null); }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button
            variant="contained" size="small"
            startIcon={goLoading ? <CircularProgress size={14} color="inherit" /> : <SearchIcon />}
            onClick={handleGo} disabled={goLoading}
          >
            Go
          </Button>
          {summaryData && can('HAMALI_REP', 'CanExport') && (
            <Button variant="outlined" size="small" startIcon={<FileDownloadIcon />} onClick={handleExportGrid}>
              Export Excel
            </Button>
          )}
        </Box>
      </Paper>

      {/* ── Summary grid ─────────────────────────────────────────────────────── */}
      {summaryData && (
        <Paper elevation={1} sx={{ mb: 1.5 }}>
          <SummaryGrid
            empRows={summaryData.empRows}
          />
        </Paper>
      )}

      {/* ── Report type + View ────────────────────────────────────────────────── */}
      <Paper elevation={1} sx={{ p: 2 }}>
        <FormControl>
          <FormLabel sx={{ fontSize: '0.8rem', fontWeight: 600, mb: 0.5, color: 'text.primary' }}>
            Report Type
          </FormLabel>
          <RadioGroup
            row value={reportType}
            onChange={e => setReportType(e.target.value)}
          >
            <FormControlLabel value="labour"     control={<Radio size="small" />} label="Labour Wise Hamali Calculation" />
            <FormControlLabel value="board-depo" control={<Radio size="small" />} label="Board Deposite Hamali Calculation" />
            <FormControlLabel value="board-form" control={<Radio size="small" />} label="Board Deposite Form" />
          </RadioGroup>
        </FormControl>

        {isBoardForm && (
          <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            <TextField
              label="UTR No" size="small" sx={{ width: 230 }}
              value={utrNo} onChange={e => setUtrNo(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 50 } }}
            />
            <TextField
              label="Date of Payment" type="date" size="small" sx={{ width: 195 }}
              value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
          {can('HAMALI_REP', 'CanPrint') && (
            <Button
              variant="contained" color="secondary" size="small"
              startIcon={viewLoading ? <CircularProgress size={14} color="inherit" /> : <VisibilityIcon />}
              onClick={handleView} disabled={viewLoading}
            >
              View
            </Button>
          )}
          <Button variant="outlined" size="small" color="inherit" startIcon={<CancelIcon />} onClick={handleCancel}>
            Cancel
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

// ── Summary Grid ──────────────────────────────────────────────────────────────
// Shows per-employee present count, cash and outstanding amounts.
function SummaryGrid({ empRows }) {
  const totPresent = empRows.reduce((s, r) => s + (r.Present || 0), 0);
  const totCash    = empRows.reduce((s, r) => s + n2(r.CashAmt),    0);
  const totOut     = empRows.reduce((s, r) => s + n2(r.OutAmt),     0);

  const hdrSx  = { fontWeight: 700, fontSize: '0.72rem', p: '4px 8px', whiteSpace: 'nowrap', backgroundColor: '#1565c0', color: '#fff' };
  const cellSx = { fontSize: '0.72rem', p: '3px 8px' };
  const numSx  = { ...cellSx, textAlign: 'right' };
  const totSx  = { ...numSx, fontWeight: 700, backgroundColor: '#e3f2fd' };

  return (
    <TableContainer>
      <Table size="small" stickyHeader sx={{ minWidth: 520 }}>
        <TableHead>
          <TableRow>
            {['Employee Name', 'Present', 'Cash Amt (₹)', 'O/S Amt (₹)', 'Grand Total (₹)'].map(h => (
              <TableCell key={h} sx={hdrSx}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {empRows.map((r, i) => {
            const gc = n2(r.CashAmt) + n2(r.OutAmt);
            return (
              <TableRow key={i} sx={{ '&:nth-of-type(odd)': { bgcolor: 'action.hover' } }}>
                <TableCell sx={cellSx}>{r.eName}</TableCell>
                <TableCell sx={numSx}>{r.Present}</TableCell>
                <TableCell sx={numSx}>{f2(r.CashAmt)}</TableCell>
                <TableCell sx={numSx}>{f2(r.OutAmt)}</TableCell>
                <TableCell sx={numSx}>{f2(gc)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell sx={{ ...totSx, textAlign: 'left' }}>TOTAL</TableCell>
            <TableCell sx={totSx}>{totPresent}</TableCell>
            <TableCell sx={totSx}>{f2(totCash)}</TableCell>
            <TableCell sx={totSx}>{f2(totOut)}</TableCell>
            <TableCell sx={totSx}>{f2(totCash + totOut)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}
