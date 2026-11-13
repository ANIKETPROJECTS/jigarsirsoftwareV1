import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, FormControlLabel, FormGroup, FormLabel, IconButton,
  InputLabel, MenuItem, Paper, Radio, RadioGroup, Select,
  Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import {
  Email as EmailIcon,
  FileDownload as FileDownloadIcon,
  FilterList as FilterListIcon,
  PlayArrow as PlayArrowIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Print as PrintIcon,
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { ADITYA_LOGO_B64 } from '../../assets/adityaLogo';
import { VLCO_LOGO_B64 }   from '../../assets/vlcoLogo';

// ── Formatters ─────────────────────────────────────────────────────────────────
const f2  = n  => (parseFloat(n) || 0).toFixed(2);
const fN  = n  => { const v = parseFloat(n); return isNaN(v) ? '' : parseFloat(v.toFixed(2)).toLocaleString('en-IN'); };
const fmtDt = s => {
  if (!s) return '';
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

const BILL_TYPES = [
  { value: 'GODRENT', label: 'Godown Rent' },
  { value: 'HMLI',    label: 'Hamali' },
  { value: 'TRSP',    label: 'Transport' },
  { value: 'GEN',     label: 'General' },
];

const REPORT_TYPES = [
  { value: 'LDGREP',   label: 'Ledger Report' },
  { value: 'LDGFMT',   label: 'Ledger Format' },
  { value: 'RECPTENT', label: 'Receipt Entry' },
  { value: 'SUMREP',   label: 'Summary (Aging)' },
];

// ── TC / TR helper cells ───────────────────────────────────────────────────────
const TC = ({ children, sx, ...p }) => (
  <TableCell align="center" sx={{ py: 0.5, px: 1, fontSize: '0.75rem', ...sx }} {...p}>{children}</TableCell>
);
const TR = ({ children, sx, ...p }) => (
  <TableCell align="right"  sx={{ py: 0.5, px: 1, fontSize: '0.75rem', ...sx }} {...p}>{children}</TableCell>
);
const TL = ({ children, sx, ...p }) => (
  <TableCell align="left"   sx={{ py: 0.5, px: 1, fontSize: '0.75rem', ...sx }} {...p}>{children}</TableCell>
);
const TH = ({ children, sx, ...p }) => (
  <TableCell sx={{ py: 0.5, px: 1, fontSize: '0.72rem', fontWeight: 'bold', bgcolor: 'action.hover', whiteSpace: 'nowrap', ...sx }} {...p}>{children}</TableCell>
);

// ── Today as YYYY-MM-DD ───────────────────────────────────────────────────────
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ── Start of current Financial Year (April 1) ─────────────────────────────────
const faYearStart = () => {
  const d = new Date();
  const yr = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${yr}-04-01`;
};

export default function ReceiptReportPage() {
  const { user, can } = useAuth();

  // ── Form-data state ─────────────────────────────────────────────────────────
  const [parties,    setParties]    = useState([]);
  const [groups,     setGroups]     = useState([]);
  const [companies,  setCompanies]  = useState([]);
  const [recptModes, setRecptModes] = useState([]);
  const [recptTypes, setRecptTypes] = useState([]);
  const [canPrint,   setCanPrint]   = useState(false);
  const [groupName,  setGroupName]  = useState('');
  const [fdLoading,  setFdLoading]  = useState(true);

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [repType,     setRepType]     = useState('LDGREP');
  const [fromDate,    setFromDate]    = useState(faYearStart());
  const [toDate,      setToDate]      = useState(todayStr());
  const [billTypes,   setBillTypes]   = useState(['GODRENT', 'HMLI']);
  const [billStatus,  setBillStatus]  = useState('ALL');
  const [filterGroup, setFilterGroup] = useState('');
  const [selParties,  setSelParties]  = useState([]);
  const [partySearch, setPartySearch] = useState('');
  const [selCompIDs,  setSelCompIDs]  = useState([]);
  const [recptType,   setRecptType]   = useState('');
  const [recptMode,   setRecptMode]   = useState('');
  const [filterOpen,  setFilterOpen]  = useState(true);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  // ── Detail state (RECPTENT / SUMREP) ─────────────────────────────────────────
  const [detailRow,   setDetailRow]   = useState(null);
  const [detailRows,  setDetailRows]  = useState([]);
  const [detailLoad,  setDetailLoad]  = useState(false);

  // ── Snackbar ─────────────────────────────────────────────────────────────────
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'info' });
  const showSnack = (msg, sev = 'info') => setSnack({ open: true, msg, sev });

  // ── Email dialog ─────────────────────────────────────────────────────────────
  const [emailDlg,  setEmailDlg]  = useState(false);
  const [emailLoad, setEmailLoad] = useState(false);

  // ── Load form-data ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/reports/receipt-report/form-data')
      .then(({ data }) => {
        setParties(data.parties   || []);
        setGroups(data.groups     || []);
        setCompanies(data.companies || []);
        setRecptModes(data.recptModes || []);
        setRecptTypes(data.recptTypes || []);
        setCanPrint(!!data.canPrint);
        setGroupName(data.groupName || '');
      })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setFdLoading(false));
  }, []);

  // ── Derived party list (filtered by group) ───────────────────────────────────
  const filteredParties = useMemo(() => {
    let list = parties;
    if (filterGroup) list = list.filter(p => p.pGroup === filterGroup);
    if (partySearch) {
      const q = partySearch.toLowerCase();
      list = list.filter(p => p.pName.toLowerCase().includes(q));
    }
    return list;
  }, [parties, filterGroup, partySearch]);

  const allPartiesSelected = selParties.length > 0 && selParties.length === filteredParties.length;
  const toggleAllParties   = () => {
    if (allPartiesSelected) setSelParties([]);
    else setSelParties(filteredParties.map(p => p.pkPartyID));
  };
  const toggleParty = pid => setSelParties(prev =>
    prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]
  );

  const toggleBillType = bt => setBillTypes(prev =>
    prev.includes(bt) ? prev.filter(x => x !== bt) : [...prev, bt]
  );

  const toggleCompany = cid => setSelCompIDs(prev =>
    prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
  );

  // ── View / run report ────────────────────────────────────────────────────────
  const handleView = useCallback(async () => {
    if (!selParties.length)  { showSnack('Select at least one party.', 'warning'); return; }
    if (!billTypes.length && repType !== 'RECPTENT') { showSnack('Select at least one bill type.', 'warning'); return; }

    setLoading(true);
    setError('');
    setRows([]);
    setDetailRow(null);
    setDetailRows([]);

    try {
      const body = { fromDate, toDate, billTypes, partyIDs: selParties, compIDs: selCompIDs };
      let endpoint = '';
      if (repType === 'LDGREP')   { endpoint = '/reports/receipt-report/ledger';         Object.assign(body, { billStatus }); }
      if (repType === 'LDGFMT')   { endpoint = '/reports/receipt-report/ledger-format';  }
      if (repType === 'RECPTENT') { endpoint = '/reports/receipt-report/receipt-entry';   Object.assign(body, { recptType, recptMode }); }
      if (repType === 'SUMREP')   { endpoint = '/reports/receipt-report/summary';         }

      const { data } = await api.post(endpoint, body);
      setRows(data.rows || []);
      if (!(data.rows || []).length) showSnack('No data found for the selected filters.', 'info');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [repType, fromDate, toDate, billTypes, billStatus, selParties, selCompIDs, recptType, recptMode]);

  // ── Detail load ──────────────────────────────────────────────────────────────
  const handleRowClick = useCallback(async (row) => {
    if (repType !== 'RECPTENT' && repType !== 'SUMREP') return;

    if (detailRow && detailRow._key === row._key) {
      setDetailRow(null); setDetailRows([]); return;
    }
    setDetailRow({ ...row });
    setDetailRows([]);
    setDetailLoad(true);

    try {
      if (repType === 'RECPTENT') {
        const { data } = await api.post('/reports/receipt-report/receipt-entry-detail', {
          pkRecptID: row.pkRecptID, compID: row.fkCompID,
        });
        setDetailRows(data.rows || []);
      } else {
        const { data } = await api.post('/reports/receipt-report/summary-detail', {
          fkPartyID: row.fkPartyID, compID: row.fkCompID,
          fromDate, toDate, billTypes,
        });
        setDetailRows(data.rows || []);
      }
    } catch (e) {
      showSnack(e.response?.data?.error || e.message, 'error');
    } finally {
      setDetailLoad(false);
    }
  }, [repType, detailRow, fromDate, toDate, billTypes]);

  // ── Export to Excel ───────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (!rows.length) return;
    const wb   = XLSX.utils.book_new();
    const toN  = n => parseFloat(n) || 0;
    const toNN = n => (n != null && n !== '') ? (parseFloat(n) || 0) : null; // nullable

    const sheetData = rows.map((r, i) => {
      if (repType === 'LDGREP') return {
        'Sr#': i + 1, 'Party': r.pName, 'Type': r.BillType, 'Bill Dt': fmtDt(r.BillDt),
        'Bill No': r.BillNum, 'Gross': toN(r.GrossAmt), 'Net Amt': toN(r.NetAmt),
        'Rcpt Dt': fmtDt(r.RecptDt), 'Rcpt Amt': toNN(r.RecptAmt),
        'TDS': toNN(r.TDSAmt), 'Disc': toNN(r.DiscAmt),
        'Balance': toN(r.BalAmt), 'Rcpt Mode': r.RecptMode, 'Rcpt Type': r.RecptType,
        'Cheque No': r.ChqNo, 'Cheque Dt': fmtDt(r.ChqDt), 'Bank': r.bName,
        'Remarks': r.rRemark, 'Comp': r.fkCompID,
      };
      if (repType === 'LDGFMT') return {
        'Sr#': i + 1, 'Party': r.pName, 'Entry Type': r.EntryType, 'Date': fmtDt(r.EntryDate),
        'Doc No': r.DocNo, 'Bill Type': r.BillType,
        'Bill Amt': toN(r.TotalBill), 'Rcpt Amt': toN(r.Receipt),
        'Total Rcpt': toN(r.TotalReceipt), 'Balance': toN(r.Balance), 'Comp': r.fkCompID,
      };
      if (repType === 'RECPTENT') return {
        'Sr#': i + 1, 'Party': r.pName, 'Rcpt Dt': fmtDt(r.RecptDt),
        'Rcpt Amt': toN(r.TotRecptAmt), 'Mode': r.RecptMode, 'Type': r.RecptType,
        'Cheque No': r.ChqNo, 'Cheque Dt': fmtDt(r.ChqDt), 'Bank': r.bName,
        'Comp': r.fkCompID,
      };
      if (repType === 'SUMREP') return {
        'Sr#': i + 1, 'Party': r.pName, 'Total Outstanding': toN(r.BalAmt),
        '≤30 Days': toN(r.BalAmt_30), '31-90 Days': toN(r.BalAmt_3190),
        '91-180 Days': toN(r.BalAmt_91180), '>180 Days': toN(r.BalAmt_180),
        'Comp': r.fkCompID,
      };
      return r;
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);

    // Stamp #,##0.00 format on every numeric amount cell
    const AMT_HDRS = {
      LDGREP:   ['Gross', 'Net Amt', 'Rcpt Amt', 'TDS', 'Disc', 'Balance'],
      LDGFMT:   ['Bill Amt', 'Rcpt Amt', 'Total Rcpt', 'Balance'],
      RECPTENT: ['Rcpt Amt'],
      SUMREP:   ['Total Outstanding', '≤30 Days', '31-90 Days', '91-180 Days', '>180 Days'],
    };
    const amtHdrs = AMT_HDRS[repType] || [];
    if (amtHdrs.length && ws['!ref']) {
      const range  = XLSX.utils.decode_range(ws['!ref']);
      const colMap = {};
      for (let C = range.s.c; C <= range.e.c; C++) {
        const a = XLSX.utils.encode_cell({ r: range.s.r, c: C });
        if (ws[a]) colMap[ws[a].v] = C;
      }
      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        for (const hdr of amtHdrs) {
          if (colMap[hdr] == null) continue;
          const a = XLSX.utils.encode_cell({ r: R, c: colMap[hdr] });
          if (ws[a] && ws[a].t === 'n') ws[a].z = '#,##0.00';
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `ReceiptReport_${repType}_${toDate}.xlsx`);
  }, [rows, repType, toDate]);

  // ── Email ─────────────────────────────────────────────────────────────────────
  const handleEmail = useCallback(async () => {
    if (!rows.length) { showSnack('Run report first.', 'warning'); return; }
    setEmailLoad(true);
    try {
      // Build compact party lookup: pkPartyID → {pGroup, pEmail}
      // Used by backend to combine parties with same pGroup into one email + attachment
      const partyMap = Object.fromEntries(
        parties.map(p => [p.pkPartyID, { pGroup: p.pGroup || '', pEmail: p.pEmail || '' }])
      );
      const { data } = await api.post('/reports/receipt-report/email', {
        rows, fromDate, toDate, repType, groupName, partyMap,
      }, { timeout: 300000 });
      const sentCount    = data.sent?.length  || 0;
      const errorCount   = data.errors?.length || 0;
      const noEmailCount = data.sent?.filter(s => s.noEmail).length || 0;
      let msg = `Sent: ${sentCount - noEmailCount}`;
      if (noEmailCount) msg += `, fallback (no email): ${noEmailCount}`;
      if (errorCount)   msg += `, failed: ${errorCount}`;
      showSnack(msg, errorCount ? 'warning' : 'success');
    } catch (e) {
      showSnack(e.response?.data?.error || e.message, 'error');
    } finally {
      setEmailLoad(false);
      setEmailDlg(false);
    }
  }, [rows, fromDate, toDate, repType, groupName, parties]);

  // ── Print / PDF ───────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!rows.length) { showSnack('Run report first.', 'warning'); return; }
    const logo = user?.groupID === 'BHW'  ? ADITYA_LOGO_B64
               : user?.groupID === 'VLCO' ? VLCO_LOGO_B64 : '';

    // ── LDGREP: "Outstanding Party wise Report" format (matches VB6 PDF layout) ──
    if (repType === 'LDGREP') {
      // Pass 1: collect opening balance and aggregate receipts per bill
      const byParty = new Map();
      for (const r of rows) {
        if (r.SortOrd === 2) continue; // skip excess/advance rows
        const pk = `${r.pName}||${r.fkCompID}`;
        if (!byParty.has(pk)) byParty.set(pk, { pName: r.pName, openingBal: 0, bills: new Map() });
        const entry = byParty.get(pk);

        if (r.SortOrd === 0) {
          // Opening balance: NetAmt holds the lump-sum outstanding before fromDate
          entry.openingBal = parseFloat(r.NetAmt) || 0;
          continue;
        }

        if (!r.BillNum) continue;
        const billKey = `${r.pkBillID || r.BillNum}||${r.BillType}`;
        if (!entry.bills.has(billKey)) {
          entry.bills.set(billKey, { BillDt: r.BillDt, BillNum: r.BillNum, NetAmt: parseFloat(r.NetAmt)||0,
            rcptAmt: 0, tdsAmt: 0, discAmt: 0, lastRcptDt: null });
        }
        const b = entry.bills.get(billKey);
        if (r.RecptAmt != null) b.rcptAmt += parseFloat(r.RecptAmt)||0;
        if (r.TDSAmt   != null) b.tdsAmt  += parseFloat(r.TDSAmt)  ||0;
        if (r.DiscAmt  != null) b.discAmt += parseFloat(r.DiscAmt) ||0;
        if (r.RecptDt) b.lastRcptDt = r.RecptDt;
      }

      const gn = groupName || 'Aditya Services';
      const css = `
        body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
        .pg-hdr{text-align:center;border:1px solid #bbb;padding:8px 12px;margin-bottom:14px}
        .pg-hdr img{height:55px;width:auto;margin-bottom:4px}
        .pg-hdr .ttl{font-size:13px;margin-top:4px}
        .pg-hdr .dts{font-size:12px}
        .pty{font-weight:bold;font-size:12px;margin:12px 0 3px}
        table{border-collapse:collapse;width:100%;margin-bottom:2px;page-break-inside:auto}
        tr{page-break-inside:avoid}
        th{border:1px solid #999;padding:4px 7px;background:#f0f0f0;font-weight:bold}
        td{border:1px solid #ccc;padding:3px 7px}
        .r{text-align:right}.c{text-align:center}
        .ob td{font-style:italic}
        .tot td{font-weight:bold;background:#f5f5f5}
        .no-print{margin-bottom:8px;}
        .no-print button{padding:5px 14px;cursor:pointer;font-size:11px;}
        @media print{body{margin:0}.no-print{display:none!important;}}`;

      let body = `<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
      <div class="pg-hdr">
        ${logo ? `<img src="${logo}" alt="">` : `<div style="font-size:18px;font-weight:bold;letter-spacing:3px">${gn}</div>`}
        <div class="ttl">Outstanding Party wise Report</div>
        <div class="dts">From : ${fmtDt(fromDate)}&nbsp;&nbsp;&nbsp;To : ${fmtDt(toDate)}</div>
      </div>`;

      for (const { pName, openingBal, bills } of byParty.values()) {
        let totalPending = 0;
        body += `<div class="pty">${pName}</div>
          <table><tr>
            <th>Bill Date</th><th>Bill No.</th><th class="r">Net Amount</th>
            <th>Received Date</th><th class="r">Received Amount</th>
            <th class="r">TDS Amount</th><th class="r">Pending Amount</th>
          </tr>`;

        // Opening balance row — only if non-zero
        if (openingBal) {
          totalPending += openingBal;
          body += `<tr class="ob">
            <td></td>
            <td>Opening Balance</td>
            <td></td><td></td><td></td><td></td>
            <td class="r">${fN(openingBal)}</td>
          </tr>`;
        }

        for (const b of bills.values()) {
          const pending = Math.max(0, b.NetAmt - b.rcptAmt - b.tdsAmt - b.discAmt);
          totalPending += pending;
          const hasRcpt = b.rcptAmt > 0 || b.tdsAmt > 0;
          body += `<tr>
            <td class="c">${fmtDt(b.BillDt)}</td>
            <td>${b.BillNum}</td>
            <td class="r">${fN(b.NetAmt)}</td>
            <td class="c">${hasRcpt ? fmtDt(b.lastRcptDt) : ''}</td>
            <td class="r">${hasRcpt ? fN(b.rcptAmt) : ''}</td>
            <td class="r">${hasRcpt && b.tdsAmt ? fN(b.tdsAmt) : ''}</td>
            <td class="r">${fN(pending)}</td>
          </tr>`;
        }
        body += `<tr class="tot">
          <td colspan="6">Total Bill Pending</td>
          <td class="r">${fN(totalPending)}</td>
        </tr></table>`;
      }

      const win = window.open('', '_blank');
      win.document.write(`<!DOCTYPE html><html><head><title>Outstanding Party wise Report</title>
        <style>${css}</style></head><body>${body}</body></html>`);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
      return;
    }

    // ── LDGFMT: Ledger Account format (matches VB6 party ledger) ─────────────
    if (repType === 'LDGFMT') {
      const billLabel = bt => ({ GODRENT: 'GODOWN RENT BILL', HMLI: 'HAMALI BILL',
        TRSP: 'TRANSPORT BILL', GEN: 'GENERAL BILL' }[bt] || bt || 'BILL');

      const byParty2 = new Map();
      const evtMap   = new Map();
      for (const r of rows) {
        const pk = `${r.pName}||${r.fkCompID}`;
        if (!byParty2.has(pk)) byParty2.set(pk, { pName: r.pName, events: [] });
        const party = byParty2.get(pk);
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

      const ldgCss = `
        body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
        @page{size:A4 portrait;margin:20mm}
        .pg-hdr{text-align:center;margin-bottom:14px}
        .pg-hdr img{height:55px;width:auto;margin-bottom:4px}
        .pg-hdr .pty{font-size:13px;font-weight:bold;margin-top:3px}
        .pg-hdr .ttl{font-size:12px;margin-top:2px}
        .pg-hdr .dts{font-size:11px}
        table{border-collapse:collapse;width:100%;margin-bottom:24px;page-break-inside:auto}
        th{border:1px solid #999;padding:4px 8px;background:#f0f0f0;font-weight:bold}
        td{border:1px solid #ccc;padding:3px 7px}
        .r{text-align:right}
        .mrow td{font-weight:bold}
        .sub td{font-size:10px;border-top:none;padding:1px 7px 1px 22px;color:#444;border-color:#e0e0e0}
        .etype{font-style:italic;text-align:right;font-weight:normal}
        .stot td{font-weight:bold;border-top:2px solid #888;background:#f8f8f8}
        .cbal td{font-weight:bold;background:#f0f0f0}
        .gtot td{font-weight:bold;border-top:2px solid #888;border-bottom:2px solid #888;background:#f8f8f8}
        .oprow td{background:#fff8e7}
        .no-print{margin-bottom:8px;}
        .no-print button{padding:5px 14px;cursor:pointer;font-size:11px;}
        @media print{body{margin:0}.no-print{display:none!important;}}`;

      let allHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Ledger Account</title><style>${ldgCss}</style></head><body>
        <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>`;

      for (const { pName, events } of byParty2.values()) {
        allHtml += `<div class="pg-hdr">
          ${logo ? `<img src="${logo}" alt="">` : `<div style="font-size:17px;font-weight:bold;letter-spacing:2px">${(groupName || '').toUpperCase()}</div>`}
          <div class="pty">${pName}</div>
          <div class="ttl">Ledger Account</div>
          <div class="dts">${fmtDt(fromDate)} to ${fmtDt(toDate)}</div>
        </div>
        <table><thead><tr>
          <th style="width:88px">Date</th>
          <th>Particulars</th>
          <th style="width:72px"></th>
          <th class="r" style="width:100px">Debit</th>
          <th class="r" style="width:100px">Credit</th>
        </tr></thead><tbody>`;

        let totalDr = 0, totalCr = 0;
        for (const evt of events) {
          if (evt.type === 'Opening') {
            totalDr += evt.balance;
            allHtml += `<tr class="mrow oprow">
              <td>${fmtDt(evt.date)}</td><td colspan="2">Opening Balance</td>
              <td class="r">${fN(evt.balance)}</td><td></td></tr>`;
          } else if (evt.type === 'Sales') {
            totalDr += evt.amount;
            allHtml += `<tr class="mrow">
              <td>${fmtDt(evt.date)}</td><td>${evt.label}</td>
              <td class="etype">Sales</td>
              <td class="r">${fN(evt.amount)}</td><td></td></tr>
              <tr class="sub"><td></td><td colspan="4">${evt.docNo}</td></tr>`;
          } else if (evt.type === 'Receipt') {
            totalCr += evt.total;
            allHtml += `<tr class="mrow">
              <td>${fmtDt(evt.date)}</td><td>${evt.bName || 'BANK'}</td>
              <td class="etype">Receipt</td>
              <td></td><td class="r">${fN(evt.total)}</td></tr>`;
            for (const s of evt.subs)
              allHtml += `<tr class="sub"><td></td>
                <td colspan="2">${s.docNo}&nbsp;&nbsp;&nbsp;${fN(s.amt)}</td>
                <td></td><td></td></tr>`;
          } else if (evt.type === 'TDS') {
            totalCr += evt.total;
            allHtml += `<tr class="mrow">
              <td>${fmtDt(evt.date)}</td><td></td>
              <td class="etype">TDS</td>
              <td></td><td class="r">${fN(evt.total)}</td></tr>`;
            for (const s of evt.subs)
              allHtml += `<tr class="sub"><td></td>
                <td colspan="2">${s.docNo}&nbsp;&nbsp;&nbsp;${fN(s.amt)}</td>
                <td></td><td></td></tr>`;
          }
        }
        const cb = totalDr - totalCr;
        allHtml += `<tr class="stot"><td colspan="3"></td>
          <td class="r">${fN(totalDr)}</td><td class="r">${fN(totalCr)}</td></tr>`;
        if (cb >= 0) {
          allHtml += `<tr class="cbal"><td colspan="3">Closing Balance</td>
            <td></td><td class="r">${fN(cb)}</td></tr>
            <tr class="gtot"><td colspan="3"></td>
            <td class="r">${fN(totalDr)}</td><td class="r">${fN(totalDr)}</td></tr>`;
        } else {
          allHtml += `<tr class="cbal"><td colspan="3">Closing Balance</td>
            <td class="r">${fN(Math.abs(cb))}</td><td></td></tr>
            <tr class="gtot"><td colspan="3"></td>
            <td class="r">${fN(totalCr)}</td><td class="r">${fN(totalCr)}</td></tr>`;
        }
        allHtml += `</tbody></table>`;
      }
      allHtml += `</body></html>`;
      const win2 = window.open('', '_blank');
      win2.document.write(allHtml);
      win2.document.close();
      win2.focus();
      setTimeout(() => win2.print(), 300);
      return;
    }

    // ── Other report types: generic table format ──────────────────────────────
    const repLabel = REPORT_TYPES.find(r => r.value === repType)?.label || repType;
    const title = `Receipt Report — ${repLabel} (${fmtDt(fromDate)} to ${fmtDt(toDate)})`;
    const css = `body{font-family:Arial,sans-serif;font-size:11px;margin:12px}
      h3{font-size:13px;margin:0 0 6px}
      table{border-collapse:collapse;width:100%;page-break-inside:auto}
      tr{page-break-inside:avoid}
      th{background:#ddd;font-weight:bold;text-align:center;border:1px solid #999;padding:3px 5px}
      td{border:1px solid #ccc;padding:2px 5px}
      .r{text-align:right}.c{text-align:center}
      .ph{background:#c8d8f8;font-weight:bold}
      .op{background:#fff8e1}.tot{background:#e8eaf6;font-weight:bold}
      .no-print{margin-bottom:8px;}
      .no-print button{padding:5px 14px;cursor:pointer;font-size:11px;}
      @media print{body{margin:0}.no-print{display:none!important;}}`;
    let tbody = '';

    if (repType === 'RECPTENT') {
      tbody += `<tr><th>#</th><th>Party</th><th>Rcpt Date</th><th class="r">Rcpt Amt</th>
        <th>Mode</th><th>Type</th><th>Cheque No</th><th>Chq Dt</th><th>Bank</th><th>Comp</th></tr>`;
      rows.forEach((r, i) => {
        tbody += `<tr>
          <td class="c">${i+1}</td><td>${r.pName}</td><td class="c">${fmtDt(r.RecptDt)}</td>
          <td class="r"><b>${fN(r.TotRecptAmt)}</b></td>
          <td class="c">${r.RecptMode||''}</td><td class="c">${r.RecptType||''}</td>
          <td class="c">${r.ChqNo||''}</td><td class="c">${fmtDt(r.ChqDt)}</td>
          <td>${r.bName||''}</td><td class="c">${r.compAlias||r.fkCompID}</td></tr>`;
      });
    } else if (repType === 'SUMREP') {
      tbody += `<tr><th>#</th><th>Party</th><th>Comp</th>
        <th class="r">Total Outstanding</th><th class="r">≤30 Days</th>
        <th class="r">31-90 Days</th><th class="r">91-180 Days</th><th class="r">&gt;180 Days</th></tr>`;
      let tot = {b:0,b30:0,b3190:0,b91180:0,b180:0};
      rows.forEach((r, i) => {
        tot.b+=r.BalAmt||0; tot.b30+=r.BalAmt_30||0; tot.b3190+=r.BalAmt_3190||0;
        tot.b91180+=r.BalAmt_91180||0; tot.b180+=r.BalAmt_180||0;
        tbody += `<tr>
          <td class="c">${i+1}</td><td>${r.pName}</td><td class="c">${r.compAlias||r.fkCompID}</td>
          <td class="r"><b>${fN(r.BalAmt)}</b></td><td class="r">${fN(r.BalAmt_30)}</td>
          <td class="r">${fN(r.BalAmt_3190)}</td><td class="r">${fN(r.BalAmt_91180)}</td>
          <td class="r">${fN(r.BalAmt_180)}</td></tr>`;
      });
      tbody += `<tr class="tot"><td colspan="3" class="r">TOTAL</td>
        <td class="r">${fN(tot.b)}</td><td class="r">${fN(tot.b30)}</td>
        <td class="r">${fN(tot.b3190)}</td><td class="r">${fN(tot.b91180)}</td>
        <td class="r">${fN(tot.b180)}</td></tr>`;
    }

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${css}</style></head>
      <body><div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div><h3>${title}</h3><table>${tbody}</table></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }, [rows, repType, fromDate, toDate, groupName]);

  // ── Cancel — reset all filters to defaults ────────────────────────────────────
  const handleCancel = useCallback(() => {
    setRepType('LDGREP');
    setFromDate(faYearStart());
    setToDate(todayStr());
    setBillTypes(['GODRENT', 'HMLI']);
    setBillStatus('ALL');
    setFilterGroup('');
    setSelParties([]);
    setPartySearch('');
    setSelCompIDs([]);
    setRecptType('');
    setRecptMode('');
    setRows([]);
    setDetailRow(null);
    setDetailRows([]);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (fdLoading) return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  );

  return (
    <Box sx={{ p: 2 }}>
      <Toolbar disableGutters sx={{ mb: 1, gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Receipt / Outstanding Report</Typography>
        <Tooltip title="Toggle Filters">
          <IconButton onClick={() => setFilterOpen(o => !o)} size="small">
            <FilterListIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Filter Panel ───────────────────────────────────────────────────── */}
      <Collapse in={filterOpen}>
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack spacing={2}>

            {/* Row 1: Report type + dates + View button */}
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-end">
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Report Type</InputLabel>
                <Select value={repType} label="Report Type" onChange={e => { setRepType(e.target.value); setRows([]); setDetailRow(null); }}>
                  {REPORT_TYPES.map(rt => <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>)}
                </Select>
              </FormControl>

              <TextField label="From Date" type="date" size="small" value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />

              <TextField label="To Date" type="date" size="small" value={toDate}
                onChange={e => setToDate(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />

              {can('RECEIPT_REP', 'CanExport') && (
              <Button variant="outlined" startIcon={<FileDownloadIcon />}
                onClick={handleExport} disabled={!rows.length}>
                Export
              </Button>
              )}

              <Button variant="outlined" startIcon={<PrintIcon />}
                onClick={handlePrint} disabled={!rows.length || !can('RECEIPT_REP', 'CanPrint')}>
                PDF
              </Button>

              {(repType === 'LDGREP' || repType === 'LDGFMT') && canPrint && (
                <Button variant="outlined" startIcon={emailLoad ? <CircularProgress size={16} /> : <EmailIcon />}
                  onClick={() => setEmailDlg(true)} disabled={!rows.length || emailLoad}>
                  Email
                </Button>
              )}

              <Button variant="outlined" color="error" onClick={handleCancel}>
                Cancel
              </Button>
            </Stack>

            {/* Row 2: Bill types */}
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>Bill Types:</Typography>
              {BILL_TYPES.map(bt => (
                <FormControlLabel key={bt.value} control={
                  <Checkbox size="small" checked={billTypes.includes(bt.value)} onChange={() => toggleBillType(bt.value)} />
                } label={bt.label} sx={{ mr: 0 }} />
              ))}
              <Button size="small" onClick={() => setBillTypes(BILL_TYPES.map(b => b.value))}>All</Button>
              <Button size="small" onClick={() => setBillTypes([])}>None</Button>
            </Stack>

            {/* Row 3: Bill status (LDGREP only) + Receipt filters (RECPTENT only) + Companies */}
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
              {(repType === 'LDGREP') && (
                <FormControl size="small">
                  <FormLabel sx={{ fontSize: '0.75rem' }}>Bill Status</FormLabel>
                  <RadioGroup row value={billStatus} onChange={e => setBillStatus(e.target.value)}>
                    <FormControlLabel value="ALL"     control={<Radio size="small" />} label="All" />
                    <FormControlLabel value="PENDING" control={<Radio size="small" />} label="Pending" />
                    <FormControlLabel value="RECEIPT" control={<Radio size="small" />} label="Received" />
                  </RadioGroup>
                </FormControl>
              )}

              {repType === 'RECPTENT' && (
                <>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Receipt Type</InputLabel>
                    <Select value={recptType} label="Receipt Type" onChange={e => setRecptType(e.target.value)}>
                      <MenuItem value="">All</MenuItem>
                      {recptTypes.map(rt => <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Receipt Mode</InputLabel>
                    <Select value={recptMode} label="Receipt Mode" onChange={e => setRecptMode(e.target.value)}>
                      <MenuItem value="">All</MenuItem>
                      {recptModes.map(rm => <MenuItem key={rm.value} value={rm.value}>{rm.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </>
              )}

              {companies.length > 1 && (
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>Companies:</Typography>
                  {companies.map(c => (
                    <FormControlLabel key={c.pkCompID} control={
                      <Checkbox size="small" checked={selCompIDs.length === 0 || selCompIDs.includes(c.pkCompID)}
                        onChange={() => toggleCompany(c.pkCompID)} />
                    } label={c.CompAlias || c.CompName} sx={{ mr: 0 }} />
                  ))}
                </Stack>
              )}
            </Stack>

            {/* Row 5: Party selection grid */}
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  Party Selection&nbsp;
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({selParties.length}/{filteredParties.length} selected)
                  </Typography>
                </Typography>
                <TextField size="small" placeholder="Search party…" value={partySearch}
                  onChange={e => setPartySearch(e.target.value)}
                  sx={{ width: 200 }}
                  InputProps={{ endAdornment: partySearch ? (
                    <IconButton size="small" onClick={() => setPartySearch('')}><CloseIcon fontSize="small" /></IconButton>
                  ) : null }} />
                {groups.length > 1 && (
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Group</InputLabel>
                    <Select value={filterGroup} label="Group" onChange={e => { setFilterGroup(e.target.value); setSelParties([]); }}>
                      <MenuItem value="">All Groups</MenuItem>
                      {groups.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}
              </Stack>

              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                {/* Header */}
                <Box sx={{
                  display: 'grid', gridTemplateColumns: '36px 1fr 90px',
                  bgcolor: 'primary.50', borderBottom: 1, borderColor: 'divider',
                  alignItems: 'center', pl: 0.5, pr: 1,
                }}>
                  <Checkbox size="small"
                    checked={allPartiesSelected}
                    indeterminate={selParties.length > 0 && !allPartiesSelected}
                    onChange={toggleAllParties}
                  />
                  <Typography variant="body2" fontWeight="bold">Party Name</Typography>
                  <Typography variant="body2" fontWeight="bold">Company</Typography>
                </Box>
                {/* Rows */}
                <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                  {filteredParties.map(p => (
                    <Box key={p.pkPartyID}
                      onClick={() => toggleParty(p.pkPartyID)}
                      sx={{
                        display: 'grid', gridTemplateColumns: '36px 1fr 90px',
                        borderBottom: 1, borderColor: 'divider',
                        alignItems: 'center', pl: 0.5, pr: 1,
                        cursor: 'pointer',
                        bgcolor: selParties.includes(p.pkPartyID) ? 'action.selected' : undefined,
                        '&:hover': { bgcolor: selParties.includes(p.pkPartyID) ? 'action.selected' : 'action.hover' },
                        '&:last-child': { borderBottom: 0 },
                      }}>
                      <Checkbox size="small" checked={selParties.includes(p.pkPartyID)}
                        onChange={() => toggleParty(p.pkPartyID)}
                        onClick={e => e.stopPropagation()} />
                      <Typography variant="body2" sx={{ py: 0.25 }}>{p.pName}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 0.25 }}>
                        {p.compAlias || p.fkCompID}
                      </Typography>
                    </Box>
                  ))}
                  {!filteredParties.length && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No parties found.</Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ mt: 1 }}>
                <Button variant="contained" startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handleView} disabled={loading}>
                  View
                </Button>
              </Box>
            </Box>

          </Stack>
        </Paper>
      </Collapse>

      {/* ── Selected party chips summary ──────────────────────────────────────── */}
      {selParties.length > 0 && !filterOpen && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1 }}>
          {selParties.slice(0, 5).map(pid => {
            const p = parties.find(x => x.pkPartyID === pid);
            return p ? <Chip key={pid} label={p.pName} size="small" onDelete={() => toggleParty(pid)} /> : null;
          })}
          {selParties.length > 5 && <Chip label={`+${selParties.length - 5} more`} size="small" />}
        </Stack>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────────── */}
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}><CircularProgress /></Box>}

      {/* ── Grid: LDGREP ─────────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && repType === 'LDGREP' && (
        <LedgerGrid rows={rows} />
      )}

      {/* ── Grid: LDGFMT ─────────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && repType === 'LDGFMT' && (
        <LedgerFormatGrid rows={rows} />
      )}

      {/* ── Grid: RECPTENT ───────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && repType === 'RECPTENT' && (
        <ReceiptEntryGrid rows={rows} selKey={detailRow?._key} onRowClick={handleRowClick} />
      )}

      {/* ── Grid: SUMREP ─────────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && repType === 'SUMREP' && (
        <SummaryGrid rows={rows} selKey={detailRow?._key} onRowClick={handleRowClick} />
      )}

      {/* ── Detail panel ─────────────────────────────────────────────────────── */}
      {detailRow && (
        <Paper variant="outlined" sx={{ mt: 2, p: 1 }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Detail: {detailRow.pName} {repType === 'RECPTENT' ? `— Receipt ${detailRow.pkRecptID}` : ''}
            </Typography>
            <IconButton size="small" onClick={() => { setDetailRow(null); setDetailRows([]); }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          {detailLoad ? <CircularProgress size={20} /> : (
            repType === 'RECPTENT' ? <ReceiptDetailTable rows={detailRows} /> : <SummaryDetailTable rows={detailRows} />
          )}
        </Paper>
      )}

      {/* ── Email confirm dialog ──────────────────────────────────────────────── */}
      <Dialog open={emailDlg} onClose={() => setEmailDlg(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Send Email Reminders</DialogTitle>
        <DialogContent>
          <Typography>
            Send outstanding bill statement emails to the selected parties?
            Parties sharing the same party group will receive a <strong>single combined report</strong> attached as an HTML file.
            Parties without an email address will fall back to the system default address.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailDlg(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleEmail} disabled={emailLoad}
            startIcon={emailLoad ? <CircularProgress size={16} /> : <EmailIcon />}>
            Send
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.sev} onClose={() => setSnack(s => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// ── LDGREP Grid ────────────────────────────────────────────────────────────────
function LedgerGrid({ rows }) {
  const byParty = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.pName}||${r.fkCompID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }, [rows]);

  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TH>#</TH><TH>Party</TH><TH>Remarks</TH><TH>Type</TH><TH>Bill Dt</TH><TH>Bill No</TH>
            <TH align="right">Gross</TH><TH align="right">Net Amt</TH>
            <TH>Rcpt Dt</TH><TH align="right">Rcpt Amt</TH><TH align="right">TDS</TH>
            <TH align="right">Disc</TH><TH align="right">Balance</TH>
            <TH>Mode</TH><TH>Type</TH><TH>Cheque No</TH><TH>Cheque Dt</TH><TH>Bank</TH>
            <TH>Ackldg Date</TH>
          </TableRow>
        </TableHead>
        <TableBody>
          {[...byParty.entries()].flatMap(([key, pRows], gi) => {
            const partyHeader = (
              <TableRow key={`ph-${key}`} sx={{ bgcolor: 'primary.50' }}>
                <TL colSpan={19} sx={{ fontWeight: 'bold', py: 0.5 }}>
                  {pRows[0].pName}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    [{pRows[0].fkCompID}]
                  </Typography>
                </TL>
              </TableRow>
            );
            const dataRows = pRows.map((r, i) => {
              const isOpening = r.SortOrd === 0;
              const isExcess  = r.SortOrd === 2;
              return (
                <TableRow key={`${key}-${i}`} hover
                  sx={{ bgcolor: isOpening ? 'warning.50' : isExcess ? 'info.50' : undefined }}>
                  <TC>{gi * 1000 + i + 1}</TC>
                  <TL sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.pName}</TL>
                  <TL sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isOpening ? 'Opening Balance' : isExcess ? r.rRemark : r.BillNum ? '' : r.rRemark}
                  </TL>
                  <TC>{r.BillType || ''}</TC>
                  <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.BillDt)}</TC>
                  <TC>{r.BillNum || ''}</TC>
                  <TR>{r.GrossAmt != null ? fN(r.GrossAmt) : ''}</TR>
                  <TR sx={{ fontWeight: isOpening ? 'bold' : 'normal' }}>{r.NetAmt != null ? fN(r.NetAmt) : ''}</TR>
                  <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.RecptDt)}</TC>
                  <TR>{r.RecptAmt != null ? fN(r.RecptAmt) : ''}</TR>
                  <TR>{r.TDSAmt  != null ? fN(r.TDSAmt)   : ''}</TR>
                  <TR>{r.DiscAmt != null ? fN(r.DiscAmt)  : ''}</TR>
                  <TR sx={{ fontWeight: 'bold', color: r.BalAmt < 0 ? 'error.main' : undefined }}>
                    {fN(r.BalAmt)}
                  </TR>
                  <TC>{r.RecptMode || ''}</TC>
                  <TC>{r.RecptType || ''}</TC>
                  <TC>{r.ChqNo || ''}</TC>
                  <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.ChqDt)}</TC>
                  <TL>{r.bName || ''}</TL>
                  <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.AcknldgDt)}</TC>
                </TableRow>
              );
            });
            const finalBal = pRows[pRows.length - 1]?.BalAmt || 0;
            const totalRow = (
              <TableRow key={`pt-${key}`} sx={{ bgcolor: 'action.selected' }}>
                <TL colSpan={12} sx={{ textAlign: 'right', fontWeight: 'bold', pr: 2 }}>
                  Closing Balance for {pRows[0].pName}:
                </TL>
                <TR sx={{ fontWeight: 'bold', color: finalBal < 0 ? 'error.main' : 'success.main' }}>
                  {fN(finalBal)}
                </TR>
                <TL colSpan={6} />
              </TableRow>
            );
            return [partyHeader, ...dataRows, totalRow];
          })}
        </TableBody>
      </Table>
    </Paper>
  );
}

// ── LDGFMT Grid ────────────────────────────────────────────────────────────────
function LedgerFormatGrid({ rows }) {
  const byParty = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.pName}||${r.fkCompID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }, [rows]);

  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TH>#</TH><TH>Party</TH><TH>Entry Type</TH><TH>Date</TH><TH>Doc No</TH>
            <TH>Bill Type</TH><TH align="right">Bill Amt</TH>
            <TH align="right">Rcpt Amt</TH><TH align="right">Total Rcpt</TH>
            <TH align="right">Balance</TH><TH>Ackldg Date</TH>
          </TableRow>
        </TableHead>
        <TableBody>
          {[...byParty.entries()].flatMap(([key, pRows], gi) => [
            <TableRow key={`ph-${key}`} sx={{ bgcolor: 'primary.50' }}>
              <TL colSpan={11} sx={{ fontWeight: 'bold' }}>
                {pRows[0].pName} <Typography component="span" variant="caption" color="text.secondary">[{pRows[0].fkCompID}]</Typography>
              </TL>
            </TableRow>,
            ...pRows.map((r, i) => (
              <TableRow key={`${key}-${i}`} hover
                sx={{ bgcolor: r.EntryType === 'Opening' ? 'warning.50' : undefined }}>
                <TC>{gi * 1000 + i + 1}</TC>
                <TL>{r.pName}</TL>
                <TC sx={{ fontWeight: r.EntryType === 'Opening' ? 'bold' : 'normal' }}>{r.EntryType}</TC>
                <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.EntryDate)}</TC>
                <TC>{r.DocNo || ''}</TC>
                <TC>{r.BillType || ''}</TC>
                <TR>{r.TotalBill   ? fN(r.TotalBill)   : ''}</TR>
                <TR>{r.Receipt     ? fN(r.Receipt)     : ''}</TR>
                <TR>{r.TotalReceipt ? fN(r.TotalReceipt) : ''}</TR>
                <TR sx={{ fontWeight: 'bold' }}>{r.Balance ? fN(r.Balance) : ''}</TR>
                <TC sx={{ whiteSpace: 'nowrap' }}>{r.EntryType === 'Sales' ? fmtDt(r.AcknldgDt) : ''}</TC>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
    </Paper>
  );
}

// ── RECPTENT Grid ──────────────────────────────────────────────────────────────
function ReceiptEntryGrid({ rows, selKey, onRowClick }) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TH>#</TH><TH>Party</TH><TH>Rcpt Date</TH><TH align="right">Rcpt Amt</TH>
            <TH>Mode</TH><TH>Type</TH><TH>Cheque No</TH><TH>Cheque Dt</TH><TH>Bank</TH><TH>Comp</TH>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => {
            const k = `${r.pkRecptID}||${r.fkCompID}`;
            return (
              <TableRow key={k} hover selected={selKey === k} onClick={() => onRowClick({ ...r, _key: k })}
                sx={{ cursor: 'pointer', bgcolor: selKey === k ? 'action.selected' : undefined }}>
                <TC>{i + 1}</TC>
                <TL>{r.pName}</TL>
                <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.RecptDt)}</TC>
                <TR sx={{ fontWeight: 'bold' }}>{fN(r.TotRecptAmt)}</TR>
                <TC>{r.RecptMode || ''}</TC>
                <TC>{r.RecptType || ''}</TC>
                <TC>{r.ChqNo || ''}</TC>
                <TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.ChqDt)}</TC>
                <TL>{r.bName || ''}</TL>
                <TC>{r.compAlias || r.fkCompID}</TC>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Paper>
  );
}

function ReceiptDetailTable({ rows }) {
  if (!rows.length) return <Typography variant="body2" color="text.secondary">No allocations found.</Typography>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TH>#</TH><TH>Bill Type</TH><TH>Bill Dt</TH><TH>Bill No</TH>
          <TH align="right">Bill Amt</TH><TH align="right">Rcpt Amt</TH>
          <TH align="right">TDS</TH><TH align="right">Disc</TH>
          <TH align="right">Tot Bill</TH><TH align="right">Balance</TH><TH>Remarks</TH>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i} hover>
            <TC>{i + 1}</TC><TC>{r.BillType}</TC><TC sx={{ whiteSpace: 'nowrap' }}>{fmtDt(r.BillDt)}</TC><TC>{r.BillNum}</TC>
            <TR>{fN(r.NetAmt)}</TR><TR>{fN(r.RecptAmt)}</TR>
            <TR>{fN(r.TDSAmt)}</TR><TR>{fN(r.DiscAmt)}</TR>
            <TR>{fN(r.TotBillAmt)}</TR><TR>{fN(r.BalAmt)}</TR>
            <TL>{r.rRemark || ''}</TL>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── SUMREP Grid ────────────────────────────────────────────────────────────────
function SummaryGrid({ rows, selKey, onRowClick }) {
  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc.BalAmt     += r.BalAmt      || 0;
    acc.BalAmt_30  += r.BalAmt_30   || 0;
    acc.BalAmt_3190+= r.BalAmt_3190 || 0;
    acc.BalAmt_91180+=r.BalAmt_91180|| 0;
    acc.BalAmt_180 += r.BalAmt_180  || 0;
    return acc;
  }, { BalAmt: 0, BalAmt_30: 0, BalAmt_3190: 0, BalAmt_91180: 0, BalAmt_180: 0 }), [rows]);

  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TH>#</TH><TH>Party</TH><TH>Comp</TH>
            <TH align="right">Total Outstanding</TH>
            <TH align="right">≤ 30 Days</TH>
            <TH align="right">31–90 Days</TH>
            <TH align="right">91–180 Days</TH>
            <TH align="right">&gt; 180 Days</TH>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => {
            const k = `${r.fkPartyID}||${r.fkCompID}`;
            return (
              <TableRow key={k} hover selected={selKey === k} onClick={() => onRowClick({ ...r, _key: k })}
                sx={{ cursor: 'pointer', bgcolor: selKey === k ? 'action.selected' : undefined }}>
                <TC>{i + 1}</TC>
                <TL>{r.pName}</TL>
                <TC>{r.compAlias || r.fkCompID}</TC>
                <TR sx={{ fontWeight: 'bold' }}>{fN(r.BalAmt)}</TR>
                <TR>{fN(r.BalAmt_30)}</TR>
                <TR>{fN(r.BalAmt_3190)}</TR>
                <TR>{fN(r.BalAmt_91180)}</TR>
                <TR>{fN(r.BalAmt_180)}</TR>
              </TableRow>
            );
          })}
          {/* Totals row */}
          <TableRow sx={{ bgcolor: 'action.selected' }}>
            <TC colSpan={3} sx={{ fontWeight: 'bold', textAlign: 'right' }}>TOTAL</TC>
            <TR sx={{ fontWeight: 'bold' }}>{fN(totals.BalAmt)}</TR>
            <TR sx={{ fontWeight: 'bold' }}>{fN(totals.BalAmt_30)}</TR>
            <TR sx={{ fontWeight: 'bold' }}>{fN(totals.BalAmt_3190)}</TR>
            <TR sx={{ fontWeight: 'bold' }}>{fN(totals.BalAmt_91180)}</TR>
            <TR sx={{ fontWeight: 'bold' }}>{fN(totals.BalAmt_180)}</TR>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  );
}

function SummaryDetailTable({ rows }) {
  if (!rows.length) return <Typography variant="body2" color="text.secondary">No outstanding bills found.</Typography>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TH>#</TH><TH>Bill Type</TH><TH>Bill Dt</TH><TH>Bill No</TH>
          <TH align="right">Gross Amt</TH><TH align="right">Net Amt</TH><TH align="right">Balance</TH>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i} hover>
            <TC>{i + 1}</TC><TC>{r.BillType}</TC><TC>{fmtDt(r.BillDt)}</TC><TC>{r.BillNum}</TC>
            <TR>{fN(r.GrossAmt)}</TR><TR>{fN(r.NetAmt)}</TR>
            <TR sx={{ fontWeight: 'bold' }}>{fN(r.BalanceAmt)}</TR>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
