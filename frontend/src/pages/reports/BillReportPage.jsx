// ─────────────────────────────────────────────────────────────────────────────
// BillReportPage.jsx  —  /reports/bill-report
// VB6 Source: frmBillReport.frm
//
// Layout mirrors the VB6 MDI child exactly:
//   Row 1 : Bill Type checkboxes (Godown Rent | Hamali) + report type radio
//   Row 2 : Company list (lstCompName checkbox group)
//   Row 3 : Party grid (vfgPartyBillRep) — select parties to query
//   Row 4 : Date pickers (Month+Year) + Search textbox + GO button
//   Row 5 : Bill grid (vfgSelBill) — colour-coded by BillStatus
//   Row 6 : Action footer — Export Excel | Send Email | View/PDF |
//            Bill Status buttons (Normal / Proforma / Delete) | Delete button
//
// VB6 row-colour scheme (BillStatus):
//   N (Normal)   — default background (white / theme)
//   P (Proforma) — light green  #C0FFC0  (VB6: &HC0FFC0)
//   D (Deleted)  — light blue   #C0C0FF  (VB6: &HC0C0FF)
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Alert, Box, Button, ButtonGroup, Checkbox, Chip,
  CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, FormGroup,
  Paper, Radio, RadioGroup, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import SearchIcon          from '@mui/icons-material/Search';
import FileDownloadIcon    from '@mui/icons-material/FileDownload';
import GridOnIcon          from '@mui/icons-material/GridOn';
import EmailIcon           from '@mui/icons-material/Email';
import PictureAsPdfIcon    from '@mui/icons-material/PictureAsPdf';
import SummarizeIcon       from '@mui/icons-material/Summarize';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────

// VB6 BillStatus values and their display labels / row colours
const STATUS_META = {
  N: { label: 'Normal',   color: 'success', rowBg: 'transparent' },
  P: { label: 'Proforma', color: 'warning', rowBg: '#fff3e0' },
  D: { label: 'Deleted',  color: 'error',   rowBg: '#fce4e4' },
};

// Bill type chip colours
const BILL_TYPE_META = {
  GR:   { label: 'G.Rent', color: 'primary' },
  HMLI: { label: 'Hamali', chipSx: { fontSize: 10, height: 18, bgcolor: '#795548', color: '#fff' } },
};

// VB6 report type optBillReport (cixBill=0, cixBillState=1, cixBillSum=2)
const REPORT_TYPES = [
  { value: 'main',      label: 'Main Bill'      },
  { value: 'statement', label: 'Bill Statement'  },
  { value: 'summary',   label: 'Bill Summary'    },
];

const fmt = n =>
  (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = s =>
  s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// ── Component ─────────────────────────────────────────────────────────────────
export default function BillReportPage() {
  const { user, can } = useAuth();

  // ── Filter state ───────────────────────────────────────────────────────────
  const [fromYM,        setFromYM]        = useState('');   // 'YYYY-MM'
  const [toYM,          setToYM]          = useState('');
  const [billTypes,     setBillTypes]     = useState({ GR: true, HM: true });
  const [reportType,    setReportType]    = useState('main');
  const [searchText,    setSearchText]    = useState('');
  const [withLtrHead,   setWithLtrHead]   = useState(false);
  const [sendEmail,     setSendEmail]     = useState(false);  // VB6: chkExportEmail

  // ── Data state ─────────────────────────────────────────────────────────────
  const [companies,     setCompanies]     = useState([]);    // lstCompName
  const [selCompIDs,    setSelCompIDs]    = useState(new Set());
  const [parties,       setParties]       = useState([]);    // vfgPartyBillRep
  const [selPartyIDs,   setSelPartyIDs]   = useState(new Set());
  const [partySearch,   setPartySearch]   = useState('');
  const [bills,         setBills]         = useState([]);    // vfgSelBill
  const [selBillIDs,    setSelBillIDs]    = useState(new Set());
  const [canEdit,       setCanEdit]       = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [loadingForm,   setLoadingForm]   = useState(false);
  const [loadingBills,  setLoadingBills]  = useState(false);
  const [working,       setWorking]       = useState(false);  // for status/delete/email
  const [error,         setError]         = useState('');
  const [successMsg,    setSuccessMsg]    = useState('');

  // Confirmation dialogs
  const [statusDialog,  setStatusDialog]  = useState({ open: false, targetStatus: '' });
  const [emailDialog,   setEmailDialog]   = useState(false);
  const [emailSending,  setEmailSending]  = useState(false);
  const [emailResults,  setEmailResults]  = useState([]);   // [{ partyName, status, note?, error? }]
  const [pdfLoading,    setPdfLoading]    = useState(false);

  // ── Load form-data on mount ────────────────────────────────────────────────
  const loadFormData = useCallback(async () => {
    setLoadingForm(true);
    setError('');
    try {
      const { data } = await api.get('/reports/bill-report/form-data');

      setCompanies(data.companies || []);
      setParties(data.parties || []);
      setCanEdit(data.canEdit);

      // Select all companies and all parties by default (mirrors VB6 udfInitialiseControls)
      setSelCompIDs(new Set((data.companies || []).map(c => c.pkCompID)));
      setSelPartyIDs(new Set((data.parties  || []).map(p => p.pkPartyID)));

      // Apply default month logic (VB6: udfInitialiseControls)
      if (data.defaults) {
        setFromYM(data.defaults.fromYM);
        setToYM(data.defaults.toYM);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingForm(false);
    }
  }, []);

  useEffect(() => { loadFormData(); }, []); // eslint-disable-line

  // ── Derived: parties visible for the currently selected companies ─────────
  // Mirrors VB6 udfFillSelPartyGrid which re-queried the party grid filtered by
  // mFv.sCompName (the IN-list of selected company IDs) every time lstCompName_Click fired.
  // Here we do the same filter in-memory — no extra API call needed because all
  // active parties were already fetched in /form-data.
  const visibleParties = useMemo(
    () => parties.filter(p => selCompIDs.has(p.fkCompID)),
    [parties, selCompIDs]
  );

  const filteredParties = useMemo(
    () => partySearch.trim()
      ? visibleParties.filter(p => p.pName.toLowerCase().includes(partySearch.toLowerCase()))
      : visibleParties,
    [visibleParties, partySearch]
  );

  // Sync party selection to visible (filtered) rows: hidden rows deselect, visible rows auto-select
  useEffect(() => {
    setSelPartyIDs(new Set(filteredParties.map(p => p.pkPartyID)));
  }, [filteredParties]);

  // ── Company checkbox toggle ────────────────────────────────────────────────
  // VB6 lstCompName_Click: after rebuilding the party grid it auto-checked every
  // row (vbChecked). We replicate that: whenever the company set changes, the
  // party selection is reset to "all parties of the now-visible companies".
  const toggleComp = (pkCompID) => {
    setSelCompIDs(prev => {
      // Must not deselect the last company — validation message mirrors VB6
      if (prev.has(pkCompID) && prev.size === 1) return prev;   // guard: at least one
      const next = new Set(prev);
      if (next.has(pkCompID)) next.delete(pkCompID); else next.add(pkCompID);
      return next;
    });
  };

  // ── Party grid selection ───────────────────────────────────────────────────
  const toggleParty = (pkPartyID) =>
    setSelPartyIDs(prev => {
      const next = new Set(prev);
      if (next.has(pkPartyID)) next.delete(pkPartyID); else next.add(pkPartyID);
      return next;
    });

  // Select-all / deselect-all operates on the VISIBLE (company-filtered) list only
  const toggleAllParties = () => {
    const visibleIDs = visibleParties.map(p => p.pkPartyID);
    const allVisible = visibleIDs.every(id => selPartyIDs.has(id));
    if (allVisible) {
      // Deselect only the visible ones; keep any hidden-company selections intact
      setSelPartyIDs(prev => {
        const next = new Set(prev);
        visibleIDs.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelPartyIDs(prev => new Set([...prev, ...visibleIDs]));
    }
  };

  // ── GO button — fetch bill list (VB6: cmdGo_Click) ────────────────────────
  const handleGo = async () => {
    setError('');
    setSuccessMsg('');

    if (!billTypes.GR && !billTypes.HM) {
      setError('Select at least one bill type (Godown Rent / Hamali).');
      return;
    }
    // Company validation — VB6: lstCompName_Click MsgBox "Please select atleast one company."
    if (selCompIDs.size === 0) {
      setError('Please select at least one company.');
      return;
    }
    if (selPartyIDs.size === 0) {
      setError('Please select at least one party.');
      return;
    }

    setLoadingBills(true);
    setBills([]);
    setSelBillIDs(new Set());
    try {
      const { data } = await api.post('/reports/bill-report', {
        fromYM,
        toYM,
        billTypes: [
          ...(billTypes.GR ? ['GR'] : []),
          ...(billTypes.HM ? ['HM'] : []),
        ],
        partyIDs: [...selPartyIDs],
        compIDs:  [...selCompIDs],
        search:   searchText.trim(),
      }, { timeout: 120000 });
      const rows = data.bills || [];
      setBills(rows);
      // Auto-select all returned bills (mirrors VB6 vbChecked on all rows)
      setSelBillIDs(new Set(rows.map(b => b.pkBillID)));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingBills(false);
    }
  };

  // ── Search button (VB6: cmdSrch_Click) ────────────────────────────────────
  // Same as GO but passes the search text as a bill-number filter
  const handleSearch = () => handleGo();

  // ── Bill grid selection ────────────────────────────────────────────────────
  const toggleBill = (pkBillID) =>
    setSelBillIDs(prev => {
      const next = new Set(prev);
      if (next.has(pkBillID)) next.delete(pkBillID); else next.add(pkBillID);
      return next;
    });

  const toggleAllBills = () => {
    if (selBillIDs.size === bills.length) setSelBillIDs(new Set());
    else setSelBillIDs(new Set(bills.map(b => b.pkBillID)));
  };

  // ── Validation helper for status/delete/view actions ───────────────────────
  // VB6: udfValSelBill — if both GR+HM are checked and the grid has mixed types,
  // returns false. Here we enforce: only one bill type when doing status/delete/PDF.
  const activeBillTypes = [
    ...(billTypes.GR ? ['GR'] : []),
    ...(billTypes.HM ? ['HM'] : []),
  ];
  const singleBillType = activeBillTypes.length === 1 ? activeBillTypes[0] : null;

  const validateSingleType = (action) => {
    if (!singleBillType) {
      setError(`Select only one Bill Type for ${action}.`);
      return false;
    }
    return true;
  };

  const validateSelectionNotEmpty = () => {
    if (selBillIDs.size === 0) {
      setError('Please select at least one bill.');
      return false;
    }
    return true;
  };

  // ── Bill Status update (VB6: cmdBillStatus_Click) ─────────────────────────
  const openStatusDialog = (targetStatus) => {
    setError('');
    if (!validateSingleType('updating Bill Status')) return;
    if (!validateSelectionNotEmpty()) return;
    setStatusDialog({ open: true, targetStatus });
  };

  const doUpdateStatus = async () => {
    setStatusDialog(s => ({ ...s, open: false }));
    setWorking(true);
    try {
      await api.put('/reports/bill-report/status', {
        billIDs:  [...selBillIDs],
        billType: singleBillType,
        status:   statusDialog.targetStatus,
      });
      setSuccessMsg('Selected Bill Status updated.');
      await handleGo();  // refresh grid (VB6: Call cmdGo_Click after update)
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setWorking(false);
    }
  };


  // ── Export to Excel (VB6: cmdExport_Click / vfgExpBill grid) ─────────────
  // VB6 exported 12 columns to a hidden grid (vfgExpBill) then saved as .xls.
  // Here we convert the bill array directly to an XLSX workbook.
  const exportExcel = () => {
    if (!bills.length) { setError('No data to export.'); return; }

    const statusLabel = { N: 'NORMAL', P: 'PROFORMA', D: 'DELETED' };
    const n = v => parseFloat(v) || 0;   // ensure numeric — MySQL returns strings
    const rows = bills.map(b => ({
      'Party Name':  b.pName,
      'Bill Date':   fmtDate(b.BillDt),
      'Bill No':     b.BillNum,
      'Gross Amt':   n(b.GrossAmt),
      'Tax 1':       n(b.Tax1Amt),
      'Tax 2':       n(b.Tax2Amt),
      'Tax 3':       n(b.Tax3Amt),
      'Round Off':   n(b.RoundOff),
      'Net Amt':     n(b.NetAmt),
      'GST No':      b.GSTNo,
      'Company':     b.fkCompID,
      'Bill Status': statusLabel[b.BillStatus] || b.BillStatus,
      'Bill Type':   b.BillType,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-fit column widths: measure header + every cell value, cap at 50
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(h => ({
      wch: Math.min(
        Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length)) + 2,
        50
      ),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BillDetail');
    XLSX.writeFile(wb, `BillDetail_${toYM}.xlsx`);
  };

  // ── View / Print (VB6: cmdView_Click → udfShowReportProcess) ────────────
  // Backend returns browser-printable HTML; we open it in a new tab.
  // The HTML contains window.print() so the print dialog fires automatically.
  const handleViewPDF = async () => {
    setError('');
    if (!validateSingleType('print or email')) return;
    if (!validateSelectionNotEmpty()) return;
    if (sendEmail) {
      setEmailDialog(true);
      return;
    }
    setPdfLoading(true);
    try {
      const selectedBills = bills.filter(b => selBillIDs.has(b.pkBillID));
      const resp = await api.post('/reports/bill-report/print', {
        bills:          selectedBills,
        billType:       singleBillType,
        withLetterhead: withLtrHead,
        reportType,
      }, { responseType: 'text', timeout: 120000 });

      // Open the HTML in a new tab; the page's script triggers window.print()
      const blob = new Blob([resp.data], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      let msg = 'Print generation failed.';
      try { msg = JSON.parse(e.response?.data)?.error || msg; } catch { /* raw text */ }
      setError(e.response?.data || e.message || msg);
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Send Email (VB6: chkExportEmail + cmdView_Click email branch) ─────────
  const doSendEmail = async () => {
    setEmailResults([]);
    setEmailSending(true);
    setWorking(true);
    try {
      const selectedBills = bills.filter(b => selBillIDs.has(b.pkBillID));
      const { data } = await api.post('/reports/bill-report/email', {
        bills:    selectedBills,
        billType: singleBillType,
      }, { timeout: 300000 });
      // Normalise backend { sent[], errors[] } into the same results shape as Balance Report
      const results = [
        ...(data.sent || []).map(s => ({
          partyName: s.pName,
          status:    s.noEmail ? 'skipped' : 'sent',
          note:      s.noEmail ? 'No email address — sent to fallback' : '',
        })),
        ...(data.errors || []).map(e => ({
          partyName: e.pName,
          status:    'failed',
          error:     e.error,
        })),
      ];
      setEmailResults(results);
    } catch (e) {
      setEmailResults([{ partyName: '—', status: 'failed', error: e.response?.data?.error || e.message }]);
    } finally {
      setEmailSending(false);
      setWorking(false);
    }
  };

  // ── Totals for selected bills ──────────────────────────────────────────────
  const totals = useMemo(() => {
    let gross = 0, net = 0;
    bills.forEach(b => {
      if (selBillIDs.has(b.pkBillID)) {
        gross += parseFloat(b.GrossAmt) || 0;
        net   += parseFloat(b.NetAmt)   || 0;
      }
    });
    return { gross, net, count: selBillIDs.size };
  }, [bills, selBillIDs]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>

      {/* Page title */}
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <SummarizeIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>Bill Report</Typography>
      </Stack>

      {error      && <Alert severity="error"   sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Paper variant="outlined" sx={{ p: 2 }}>

        {/* ── Row 1: Bill Type + Report Type ─────────────────────────────── */}
        <Stack direction="row" spacing={4} alignItems="center" mb={1.5} flexWrap="wrap">
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">Bill Type</Typography>
            <FormGroup row>
              <FormControlLabel
                label="Godown Rent"
                control={
                  <Checkbox size="small" checked={billTypes.GR}
                    onChange={e => setBillTypes(p => ({ ...p, GR: e.target.checked }))} />
                }
              />
              <FormControlLabel
                label="Hamali"
                control={
                  <Checkbox size="small" checked={billTypes.HM}
                    onChange={e => setBillTypes(p => ({ ...p, HM: e.target.checked }))} />
                }
              />
            </FormGroup>
          </Box>

          {/* VB6: optBillReport — report type for View/PDF */}
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">Report Type</Typography>
            <RadioGroup row value={reportType} onChange={e => setReportType(e.target.value)}>
              {REPORT_TYPES.map(rt => (
                <FormControlLabel key={rt.value} value={rt.value} label={rt.label}
                  control={<Radio size="small" />} />
              ))}
            </RadioGroup>
          </Box>

          {/* Letter Head toggle (VB6: chkLtrHead) */}
          <FormControlLabel
            label="Letter Head"
            control={<Checkbox size="small" checked={withLtrHead}
              onChange={e => setWithLtrHead(e.target.checked)} />}
          />
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* ── Row 2: Company list (lstCompName) ──────────────────────────── */}
        {loadingForm ? (
          <Box textAlign="center" py={2}><CircularProgress size={24} /></Box>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary">Companies</Typography>
            <FormGroup row sx={{ mb: 1.5 }}>
              {companies.map(c => (
                <FormControlLabel
                  key={c.pkCompID}
                  label={c.CompAlias || c.CompName}
                  control={
                    <Checkbox size="small" checked={selCompIDs.has(c.pkCompID)}
                      onChange={() => toggleComp(c.pkCompID)} />
                  }
                />
              ))}
            </FormGroup>

            <Divider sx={{ my: 1 }} />

            {/* ── Row 3: Party grid (vfgPartyBillRep) ──────────────────── */}
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap">
              <Typography variant="caption" color="text.secondary">
                Party Selection&nbsp;
                ({visibleParties.filter(p => selPartyIDs.has(p.pkPartyID)).length}/{visibleParties.length} selected)
                {selCompIDs.size === 0 && (
                  <Typography component="span" variant="caption" color="error" ml={1}>
                    — select at least one company
                  </Typography>
                )}
              </Typography>
              <TextField
                size="small"
                placeholder="Search party…"
                value={partySearch}
                onChange={e => setPartySearch(e.target.value)}
                sx={{ width: 200, '& .MuiInputBase-input': { py: '3px', fontSize: 12 } }}
              />
            </Stack>
            <TableContainer
              sx={{ maxHeight: 200, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        // Checked only when every visible party is selected
                        checked={
                          visibleParties.length > 0 &&
                          visibleParties.every(p => selPartyIDs.has(p.pkPartyID))
                        }
                        indeterminate={
                          visibleParties.some(p =>  selPartyIDs.has(p.pkPartyID)) &&
                          visibleParties.some(p => !selPartyIDs.has(p.pkPartyID))
                        }
                        onChange={toggleAllParties}
                      />
                    </TableCell>
                    <TableCell>Party Name</TableCell>
                    <TableCell>Company</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredParties.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} align="center"
                        sx={{ py: 3, color: 'text.secondary', fontStyle: 'italic' }}>
                        {selCompIDs.size === 0
                          ? 'Select a company to see its parties.'
                          : partySearch.trim()
                            ? `No parties match "${partySearch}".`
                            : 'No active parties found for the selected company(s).'}
                      </TableCell>
                    </TableRow>
                  ) : filteredParties.map(p => (
                    <TableRow key={p.pkPartyID} hover
                      onClick={() => toggleParty(p.pkPartyID)} sx={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selPartyIDs.has(p.pkPartyID)}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleParty(p.pkPartyID)} />
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{p.pName}</TableCell>
                      <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{p.fkCompID}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Divider sx={{ my: 1 }} />

            {/* ── Row 4: Date pickers + Search + GO ─────────────────────── */}
            <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap" mb={1.5}>
              {/* Month+Year pickers — VB6 dtpBillRepDt with CustomFormat="MMMM yyyy" */}
              <TextField
                label="From Month" type="month" size="small"
                value={fromYM} onChange={e => setFromYM(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ width: 185 }}
              />
              <TextField
                label="To Month" type="month" size="small"
                value={toYM} onChange={e => setToYM(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ width: 185 }}
              />

              {/* Search by bill number (VB6: txtSrch + cmdSrch_Click) */}
              <TextField
                label="Bill Number" size="small" value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Full bill number…" sx={{ width: 200 }}
              />
              <Button variant="outlined" startIcon={<SearchIcon />}
                onClick={handleSearch} disabled={loadingBills}>
                Search
              </Button>

              {/* GO button (VB6: cmdGo_Click — uses party selection, not search text) */}
              <Button variant="contained" onClick={handleGo}
                disabled={loadingBills || selCompIDs.size === 0 || selPartyIDs.size === 0}
                endIcon={loadingBills ? <CircularProgress size={16} color="inherit" /> : undefined}>
                GO
              </Button>
            </Stack>
          </>
        )}

        <Divider sx={{ my: 1 }} />

        {/* ── Row 5: Bill grid (vfgSelBill) ─────────────────────────────── */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="caption" color="text.secondary">
            Bills ({bills.length} loaded, {selBillIDs.size} selected)
          </Typography>
          {bills.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              Selected — Gross: ₹{fmt(totals.gross)} | Net: ₹{fmt(totals.net)}
            </Typography>
          )}
        </Stack>

        <TableContainer
          sx={{ maxHeight: 320, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1.5 }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={bills.length > 0 && selBillIDs.size === bills.length}
                    indeterminate={selBillIDs.size > 0 && selBillIDs.size < bills.length}
                    onChange={toggleAllBills}
                  />
                </TableCell>
                <TableCell>Bill No</TableCell>
                <TableCell>Bill Date</TableCell>
                <TableCell>Party</TableCell>
                <TableCell align="right">Gross Amt</TableCell>
                <TableCell align="right">Net Amt</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Company</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loadingBills ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center"
                    sx={{ py: 4, color: 'text.secondary', fontStyle: 'italic' }}>
                    Press GO to load bills.
                  </TableCell>
                </TableRow>
              ) : bills.map(b => {
                const checked = selBillIDs.has(b.pkBillID);
                const st      = STATUS_META[b.BillStatus] || STATUS_META.N;
                return (
                  <TableRow key={b.pkBillID} hover
                    onClick={() => toggleBill(b.pkBillID)}
                    sx={{
                      cursor: 'pointer',
                      // VB6 row colour: N=white, P=light green, D=light blue
                      bgcolor: st.rowBg,
                      '&:hover': { filter: 'brightness(0.96)' },
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={checked}
                        onClick={e => e.stopPropagation()}
                        onChange={() => toggleBill(b.pkBillID)} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{b.BillNum}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{fmtDate(b.BillDt)}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{b.pName}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 11 }}>₹{fmt(b.GrossAmt)}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 600 }}>₹{fmt(b.NetAmt)}</TableCell>
                    <TableCell>
                      {(() => {
                        const t = BILL_TYPE_META[b.BillType] || { label: b.BillType, color: 'default' };
                        return t.chipSx
                          ? <Chip label={t.label} size="small" sx={t.chipSx} />
                          : <Chip label={t.label} size="small" color={t.color} sx={{ fontSize: 10, height: 18 }} />;
                      })()}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{b.fkCompID}</TableCell>
                    <TableCell>
                      <Chip label={st.label} size="small" color={st.color}
                        sx={{ fontSize: 10, height: 18 }} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider sx={{ my: 1 }} />

        {/* ── Row 6: Bill Status + Action Footer ────────────────────────── */}
        {/* Bill Status section — VB6: lblBillStatus + cmdBillStatus (index 0/1/2) */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mb={1}>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
            Bill Status:
          </Typography>

          {/* Normal (index 0) */}
          <Tooltip title="Mark selected bills as Normal (N)">
            <span>
              <Button size="small" variant="outlined" color="success"
                disabled={!canEdit || working || selBillIDs.size === 0}
                onClick={() => openStatusDialog('N')}>
                Normal
              </Button>
            </span>
          </Tooltip>

          {/* Proforma (index 1) */}
          <Tooltip title="Mark selected bills as Proforma (P)">
            <span>
              <Button size="small" variant="outlined" color="warning"
                disabled={!canEdit || working || selBillIDs.size === 0}
                onClick={() => openStatusDialog('P')}>
                Proforma
              </Button>
            </span>
          </Tooltip>

          {/* Deleted status (index 2) — marks as deleted, does NOT remove from DB */}
          <Tooltip title="Mark selected bills as Deleted (D). Does NOT remove from DB.">
            <span>
              <Button size="small" variant="outlined" color="error"
                disabled={!canEdit || working || selBillIDs.size === 0}
                onClick={() => openStatusDialog('D')}>
                Mark Deleted
              </Button>
            </span>
          </Tooltip>

          {!canEdit && (
            <Typography variant="caption" color="warning.main">
              (No Edit permission)
            </Typography>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          Bill Status will affect the current logged-in company only.
        </Typography>

        {/* Action footer — Export | Email toggle | View/PDF | Hard Delete */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">

          {/* Export to Excel (VB6: cmdExport_Click) */}
          {can('BILL_REP', 'CanExport') && (
          <Tooltip title="Export bill list to Excel (.xlsx)">
            <span>
              <Button size="small" variant="outlined" startIcon={<GridOnIcon />}
                disabled={bills.length === 0} onClick={exportExcel}>
                Export Excel
              </Button>
            </span>
          </Tooltip>
          )}

          {/* Send Email checkbox (VB6: chkExportEmail) */}
          <FormControlLabel
            label="Send Email"
            control={
              <Checkbox size="small" checked={sendEmail}
                onChange={e => setSendEmail(e.target.checked)} />
            }
          />

          {/* View / PDF (VB6: cmdView_Click) */}
          <Tooltip title={sendEmail ? 'Send email with PDF attachment' : 'Open PDF preview'}>
            <span>
              <Button size="small" variant="contained"
                startIcon={pdfLoading
                  ? <CircularProgress size={16} color="inherit" />
                  : sendEmail ? <EmailIcon /> : <PictureAsPdfIcon />}
                disabled={pdfLoading || working || selBillIDs.size === 0}
                onClick={handleViewPDF}>
                {sendEmail ? 'Send Email' : 'View / PDF'}
              </Button>
            </span>
          </Tooltip>

          {working && <CircularProgress size={20} />}
        </Stack>
      </Paper>

      {/* ── Bill Status confirmation dialog ────────────────────────────────── */}
      <Dialog open={statusDialog.open} onClose={() => setStatusDialog(s => ({ ...s, open: false }))}
        maxWidth="xs" fullWidth>
        <DialogTitle>Update Bill Status</DialogTitle>
        <DialogContent>
          <Typography>
            Set status of <strong>{selBillIDs.size}</strong> selected bill(s) to{' '}
            <strong>{STATUS_META[statusDialog.targetStatus]?.label}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" mt={1} display="block">
            This will only affect bills in the current company.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialog(s => ({ ...s, open: false }))}>Cancel</Button>
          <Button variant="contained" onClick={doUpdateStatus}>Update</Button>
        </DialogActions>
      </Dialog>

      {/* ── Email progress dialog (matches Balance Report style) ───────────── */}
      <Dialog
        open={emailDialog}
        onClose={() => { if (!emailSending) { setEmailDialog(false); setEmailResults([]); } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ pb: 0.5 }}>
          <Typography fontWeight={600}>Send Email</Typography>
          {emailResults.length > 0 && (
            <Typography fontSize={11} color="text.secondary">
              Sent:&nbsp;{emailResults.filter(r => r.status === 'sent').length}
              &nbsp;|&nbsp;
              Failed/Skipped:&nbsp;{emailResults.filter(r => r.status !== 'sent').length}
            </Typography>
          )}
        </DialogTitle>

        <DialogContent dividers sx={{ minHeight: 100 }}>
          {/* Confirmation (before sending) */}
          {!emailSending && emailResults.length === 0 && (
            <Typography>
              Send email with PDF attachment to&nbsp;
              <strong>{selBillIDs.size}</strong> selected party(s)?
            </Typography>
          )}

          {/* Sending in progress */}
          {emailSending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={20} />
              <Typography>Sending emails, please wait…</Typography>
            </Box>
          )}

          {/* Results — same layout as Balance Report EmailSendDialog */}
          {emailResults.length > 0 && (
            <Box>
              <Alert
                severity={emailResults.every(r => r.status === 'sent') ? 'success' : 'warning'}
                sx={{ mb: 1.5 }}
              >
                Sent:&nbsp;{emailResults.filter(r => r.status === 'sent').length}
                &nbsp;|&nbsp;
                Failed/Skipped:&nbsp;{emailResults.filter(r => r.status !== 'sent').length}
              </Alert>
              {emailResults.map((r, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                  <Typography
                    fontSize={11}
                    sx={{
                      color: r.status === 'sent' ? 'success.main' : 'error.main',
                      minWidth: 44,
                      flexShrink: 0,
                    }}
                  >
                    {r.status === 'sent' ? 'âœ“ Sent' : r.status === 'skipped' ? '– Skip' : 'âœ— Fail'}
                  </Typography>
                  <Box>
                    <Typography fontSize={11}>{r.partyName}</Typography>
                    {r.note  && <Typography fontSize={10} color="warning.main">{r.note}</Typography>}
                    {r.error && <Typography fontSize={10} color="error.main">{r.error}</Typography>}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => { setEmailDialog(false); setEmailResults([]); }}
            disabled={emailSending}
          >
            {emailResults.length > 0 ? 'Close' : 'Cancel'}
          </Button>
          {emailResults.length === 0 && (
            <Button
              variant="contained"
              startIcon={emailSending ? <CircularProgress size={14} color="inherit" /> : <EmailIcon />}
              onClick={doSendEmail}
              disabled={emailSending}
            >
              {emailSending ? 'Sending…' : 'Send'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

    </Box>
  );
}
