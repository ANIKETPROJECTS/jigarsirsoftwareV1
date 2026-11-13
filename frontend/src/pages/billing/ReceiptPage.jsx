import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Paper, Typography, Grid, Stack, TextField, MenuItem,
  FormGroup, FormControlLabel, Checkbox, Button,
  FormControl, InputLabel, Select,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, TableSortLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  InputAdornment, Alert, CircularProgress, Tabs, Tab,
} from '@mui/material';
import SearchIcon       from '@mui/icons-material/Search';
import AddCircleIcon    from '@mui/icons-material/AddCircle';
import SaveIcon         from '@mui/icons-material/Save';
import DeleteIcon       from '@mui/icons-material/Delete';
import CancelIcon       from '@mui/icons-material/Cancel';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useAuth }      from '../../contexts/AuthContext';
import api              from '../../services/api';

// ── Row state constants ───────────────────────────────────────────────────────
const RS_NONE   = 'None';
const RS_ADD    = 'Add';
const RS_VIEW   = 'View';
const RS_MODIFY = 'Modify';
const RS_DELETE = 'Delete';

// ── Bill grid column config ───────────────────────────────────────────────────
const COL = [
  { key: 'billType',  label: 'Bill Type',   align: 'left',   width: 90,  editable: false },
  { key: 'billDt',    label: 'Bill Date',   align: 'center', width: 100, editable: false },
  { key: 'billNum',   label: 'Bill No.',    align: 'left',   width: 100, editable: false },
  { key: 'grAmt',     label: 'Gross Amt',   align: 'center', width: 100, editable: false, fmt: true },
  { key: 'netAmt',    label: 'Net Amt',     align: 'center', width: 100, editable: false, fmt: true },
  { key: 'billBalAmt',label: 'Bal Amt',     align: 'center', width: 100, editable: false, fmt: true },
  { key: 'recdAmt',   label: 'Recd. Amt',  align: 'center', width: 110, editable: true,  bg: '#fff9c4' },
  { key: 'tdsPernt',  label: 'TDS %',      align: 'center', width: 70,  editable: true,  bg: '#fff9c4' },
  { key: 'tdsAmt',    label: 'TDS Amt',    align: 'center', width: 100, editable: true,  bg: '#fff9c4' },
  { key: 'discAmt',   label: 'Disc. Amt',  align: 'center', width: 100, editable: true,  bg: '#fff9c4' },
  { key: 'totAmt',    label: 'Tot. Amt',   align: 'center', width: 110, editable: false, bold: true },
  { key: 'balAmt',    label: 'Bal. Amt',   align: 'center', width: 100, editable: false },
  { key: 'remarks',   label: 'Remarks',    align: 'left',   width: 160, editable: true,  bg: '#fff9c4' },
];

const fmt  = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDt = s => { if (!s) return ''; const d = String(s).slice(0, 10); return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; };

// ── Browser-tab favicon ───────────────────────────────────────────────────────
// Shows ⏳ while any async operation is in flight; restores the app's default icon otherwise.
const FAVICON_BUSY = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<text y=".9em" font-size="85">⏳</text></svg>'
);
let _origFavicon = '';
function faviconBusy(on) {
  let lnk = document.querySelector("link[rel~='icon']");
  if (!lnk) { lnk = document.createElement('link'); lnk.rel = 'icon'; document.head.appendChild(lnk); }
  if (on) {
    if (!_origFavicon) _origFavicon = lnk.href;
    lnk.href = FAVICON_BUSY;
  } else if (_origFavicon) {
    lnk.href = _origFavicon;
    _origFavicon = '';
  }
}

function emptyRow() {
  return {
    rowState: RS_NONE, newRowFlg: 'Y', cpkSrNo: -1,
    fkBillID: '', billType: '', billDt: '', billNum: '',
    grAmt: 0, netAmt: 0, billBalAmt: 0,
    recdAmt: 0, tdsPernt: 0, tdsAmt: 0, discAmt: 0,
    totAmt: 0, balAmt: 0, remarks: '',
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ReceiptPage() {
  const { user, can } = useAuth();

  // ── Form data (dropdowns) ─────────────────────────────────────────────────
  const [parties,    setParties]    = useState([]);
  const [recptModes, setRecptModes] = useState([]);
  const [recptTypes, setRecptTypes] = useState([]);
  const [banks,      setBanks]      = useState([]);
  const [canAdd,     setCanAdd]     = useState(false);
  const [canEdit,    setCanEdit]    = useState(false);
  const [canDelete,  setCanDelete]  = useState(false);
  const [loadingFD,  setLoadingFD]  = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(0);

  // ── Tab 0 — List state ────────────────────────────────────────────────────
  const [listFromDt,     setListFromDt]     = useState(today.slice(0, 7) + '-01');
  const [listToDt,       setListToDt]       = useState(today);
  const [listSearch,     setListSearch]     = useState('');
  const [listRows,       setListRows]       = useState([]);
  const [listLoading,    setListLoading]    = useState(false);
  const [listSelectedID, setListSelectedID] = useState('');
  const [sortField,      setSortField]      = useState('RecptDt');
  const [sortDir,        setSortDir]        = useState('desc');

  // ── Tab 1 — Form state ────────────────────────────────────────────────────
  const [editMode,  setEditMode]  = useState('new');
  const [pkRecptID, setPkRecptID] = useState('');
  const [recptDt,   setRecptDt]   = useState(today);
  const [fkPartyID, setFkPartyID] = useState('');
  const [recptMode, setRecptMode] = useState('');
  const [recptType, setRecptType] = useState('');
  const [chqDt,     setChqDt]     = useState(today);
  const [chqNo,     setChqNo]     = useState('');
  const [bankName,  setBankName]  = useState('');
  const [fkBankID,  setFkBankID]  = useState('');
  const [recptAmt,  setRecptAmt]  = useState('');
  const [rNote,     setRNote]     = useState('');

  // ── Bill type checkboxes ──────────────────────────────────────────────────
  const [btGodrent, setBtGodrent] = useState(true);
  const [btHamali,  setBtHamali]  = useState(true);
  const [btTrsp,    setBtTrsp]    = useState(false);
  const [btGen,     setBtGen]     = useState(false);

  // ── Grids ─────────────────────────────────────────────────────────────────
  const [rows,         setRows]         = useState([]);
  const [pendingAdvs,  setPendingAdvs]  = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);

  // ── Dialog / status ───────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [errorMsg,   setErrorMsg]   = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── Load form data ────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/billing/receipts/form-data').then(r => {
      setParties(r.data.parties || []);
      setRecptModes(r.data.recptModes || []);
      setRecptTypes(r.data.recptTypes || []);
      setBanks(r.data.banks || []);
      setCanAdd(r.data.canAdd);
      setCanEdit(r.data.canEdit);
      setCanDelete(r.data.canDelete);
    }).catch(e => setErrorMsg(e.response?.data?.error || e.message))
      .finally(() => setLoadingFD(false));
  }, []);

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    grAmt:      acc.grAmt      + r.grAmt,
    netAmt:     acc.netAmt     + r.netAmt,
    billBalAmt: acc.billBalAmt + r.billBalAmt,
    recdAmt:    acc.recdAmt    + r.recdAmt,
    tdsAmt:     acc.tdsAmt     + r.tdsAmt,
    discAmt:    acc.discAmt    + r.discAmt,
    totAmt:     acc.totAmt     + r.totAmt,
    balAmt:     acc.balAmt     + r.balAmt,
    count:      acc.count      + 1,
  }), { grAmt:0, netAmt:0, billBalAmt:0, recdAmt:0, tdsAmt:0, discAmt:0, totAmt:0, balAmt:0, count:0 }),
  [rows]);

  const recptBalAmt = (parseFloat(recptAmt) || 0) - totals.totAmt;
  const chequeMode  = recptMode === 'Q';
  const cashMode    = recptMode === 'C';

  // ── Favicon + cursor: hourglass while processing ─────────────────────────
  const isProcessing = saving || listLoading || loadingBills;
  useEffect(() => () => { faviconBusy(false); document.body.style.cursor = ''; }, []);
  useEffect(() => {
    faviconBusy(isProcessing);
    document.body.style.cursor = isProcessing ? 'wait' : '';
  }, [isProcessing]);

  // ── Type code → label map (for Tab 0 grid) ────────────────────────────────
  const recptTypeMap = useMemo(() =>
    Object.fromEntries(recptTypes.map(t => [t.value, t.label])),
    [recptTypes]
  );

  // ── Load receipt list ─────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await api.get('/billing/receipts/search', {
        params: { fromDate: listFromDt, toDate: listToDt },
      });
      setListRows(r.data || []);
    } catch (e) {
      setErrorMsg(e.response?.data?.error || e.message);
    } finally {
      setListLoading(false);
    }
  }, [listFromDt, listToDt]);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Tab 0: client-side search + sort on top of server date-range results ──
  const filteredList = useMemo(() => {
    let data = listRows;
    const q = listSearch.trim().toLowerCase();
    if (q) {
      data = data.filter(r =>
        (r.partyName || '').toLowerCase().includes(q) ||
        (r.RecptDt   || '').slice(0, 10).includes(q)  ||
        String(r.RecptAmt || '').includes(q)
      );
    }
    return [...data].sort((a, b) => {
      const va = String(a[sortField] ?? '');
      const vb = String(b[sortField] ?? '');
      const cmp = va.localeCompare(vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [listRows, listSearch, sortField, sortDir]);

  // ── Reset Tab 1 form ──────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditMode('new');
    setPkRecptID('');
    setRecptDt(today);
    setFkPartyID('');
    setRecptMode('');
    setRecptType('');
    setChqDt(today);
    setChqNo('');
    setBankName('');
    setFkBankID('');
    setRecptAmt('');
    setRNote('');
    setBtGodrent(true);
    setBtHamali(true);
    setBtTrsp(false);
    setBtGen(false);
    setRows([]);
    setPendingAdvs([]);
    setErrorMsg('');
    setSuccessMsg('');
  }, [today]);

  // ── Auto-set bill type checkboxes on party dropdown change (new mode only) ─
  // Kept as a plain function (not a useEffect) so it only fires on user action,
  // never when loadReceiptForEdit sets fkPartyID programmatically.
  const handlePartyChange = (newPartyID) => {
    setFkPartyID(newPartyID);
    setRows([]);  // clear bills from previous party
    const p = parties.find(x => x.pkPartyID === newPartyID);
    if (!p) return;
    setBtGodrent(true);   // GodownRent on by default
    setBtHamali(true);    // Hamali on by default
    setBtTrsp(false);
    setBtGen(false);
  };

  // ── Load pending advances when party changes ──────────────────────────────
  useEffect(() => {
    if (!fkPartyID) { setPendingAdvs([]); return; }
    api.get('/billing/receipts/pending-advances', { params: { partyId: fkPartyID } })
      .then(r => setPendingAdvs(r.data || []))
      .catch(() => setPendingAdvs([]));
  }, [fkPartyID]);

  // ── Select Bill ───────────────────────────────────────────────────────────
  const handleSelectBill = async () => {
    setErrorMsg('');
    if (!fkPartyID) return setErrorMsg('Please select Party Name.');
    if (!recptAmt || parseFloat(recptAmt) <= 0) return setErrorMsg('Please enter Receipt Amount.');
    if (!recptMode) return setErrorMsg('Please select Receipt Mode.');
    if (!recptType) return setErrorMsg('Please select Receipt Type.');

    const billTypes = [
      btGodrent && 'GODRENT', btHamali && 'HMLI', btTrsp && 'TRSP', btGen && 'GEN',
    ].filter(Boolean);
    if (!billTypes.length) return setErrorMsg('Select at least one Bill Type.');

    setLoadingBills(true);
    try {
      const r = await api.get('/billing/receipts/bills', {
        params: { partyId: fkPartyID, billTypes: billTypes.join(','), receiptDate: recptDt },
      });
      const toBillRow = b => ({
        ...emptyRow(),
        fkBillID:   b.pkBillID,
        billType:   b.BillType,
        billDt:     b.BillDt ? b.BillDt.slice(0, 10) : '',
        billNum:    b.BillNum,
        grAmt:      parseFloat(b.GrossAmt)   || 0,
        netAmt:     parseFloat(b.NetAmt)     || 0,
        billBalAmt: parseFloat(b.BalanceAmt) || 0,
      });
      if (editMode === 'edit') {
        // In modify mode: keep existing rows, append only bills not already in the grid
        setRows(prev => {
          const existingKeys = new Set(prev.map(row => `${row.fkBillID}|${row.billType}`));
          const added = (r.data || [])
            .filter(b => !existingKeys.has(`${b.pkBillID}|${b.BillType}`))
            .map(toBillRow);
          return [...prev, ...added];
        });
      } else {
        setRows((r.data || []).map(toBillRow));
      }
    } catch (e) {
      setErrorMsg(e.response?.data?.error || e.message);
    } finally {
      setLoadingBills(false);
    }
  };

  // ── Grid cell edit ────────────────────────────────────────────────────────
  const handleCellChange = (idx, field, rawVal) => {
    setRows(prev => {
      const next = [...prev];
      const row  = { ...next[idx] };
      const val  = parseFloat(rawVal) || 0;

      if (field === 'recdAmt') {
        row.recdAmt  = val > row.billBalAmt ? 0 : val;
        row.tdsPernt = 0;
        row.tdsAmt   = 0;
        if (row.newRowFlg === 'Y') row.rowState = row.recdAmt > 0 ? RS_ADD    : RS_NONE;
        else                       row.rowState = row.recdAmt > 0 ? RS_MODIFY : RS_DELETE;
      } else if (field === 'tdsPernt') {
        row.tdsPernt = val;
        row.tdsAmt   = parseFloat((row.grAmt * val / 100).toFixed(2));
      } else if (field === 'tdsAmt') {
        row.tdsAmt   = val;
        row.tdsPernt = row.grAmt ? Math.round((val / row.grAmt) * 100) : 0;
        if (row.newRowFlg === 'N' && row.rowState === RS_VIEW) row.rowState = RS_MODIFY;
      } else if (field === 'discAmt') {
        row.discAmt = val;
        if (row.newRowFlg === 'N' && row.rowState === RS_VIEW) row.rowState = RS_MODIFY;
      } else if (field === 'remarks') {
        row.remarks = rawVal;
        if (row.newRowFlg === 'N' && row.rowState === RS_VIEW) row.rowState = RS_MODIFY;
      }

      row.totAmt = row.recdAmt - row.tdsAmt - row.discAmt;
      row.balAmt = row.billBalAmt - row.recdAmt;

      next[idx] = row;
      return next;
    });
  };

  // ── Load a receipt into Tab 1 form ────────────────────────────────────────
  // Called from Tab 0 View button and from pending advances double-click.
  const loadReceiptForEdit = async (recptID) => {
    setErrorMsg('');
    try {
      const r = await api.get(`/billing/receipts/${recptID}`);
      const d = r.data;
      const lines = d.lines || [];
      // Derive bill type checkboxes from the actual lines in the receipt
      const types = new Set(lines.map(l => l.billType));
      setBtGodrent(types.has('GODRENT') || (!types.size));  // default on if no lines
      setBtHamali(types.has('HMLI')    || (!types.size));
      setBtTrsp(types.has('TRSP'));
      setBtGen(types.has('GEN'));
      setPkRecptID(d.pkRecptID);
      setEditMode('edit');
      setRecptDt(d.recptDt);
      setFkPartyID(d.fkPartyID);
      setRecptAmt(String(d.recptAmt));
      setRecptMode(d.recptMode);
      setRecptType(d.recptType);
      setFkBankID(d.fkBankID);
      setBankName(d.bankName);
      setChqNo(d.chqNo);
      setChqDt(d.chqDt || today);
      setRNote(d.rNote);
      setRows(lines);
    } catch (e) {
      setErrorMsg(e.response?.data?.error || e.message);
    }
  };

  // ── Tab 0: View button ────────────────────────────────────────────────────
  const handleView = async () => {
    if (!listSelectedID) return;
    await loadReceiptForEdit(listSelectedID);
    setActiveTab(1);
  };

  // ── Tab 0: Delete button ──────────────────────────────────────────────────
  const handleDeleteFromList = async () => {
    setDeleteOpen(false);
    setErrorMsg('');
    try {
      await api.delete(`/billing/receipts/${listSelectedID}`);
      setListSelectedID('');
      setSuccessMsg('Receipt Deleted.');
      loadList();
    } catch (e) {
      setErrorMsg(e.response?.data?.error || e.message);
    }
  };

  // ── Tab 0: Column sort ────────────────────────────────────────────────────
  const handleSort = field => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  // ── Tab 0: Excel (CSV) export — UTF-8 BOM so Excel reads Indian names ─────
  const exportExcel = () => {
    if (!filteredList.length) return;
    const hdrs = ['Receipt Date', 'Party Name', 'Receipt Amount', 'Receipt Type'];
    const body = filteredList.map(r => [
      r.RecptDt?.slice(0, 10) || '',
      r.partyName || '',
      r.RecptAmt  || 0,
      recptTypeMap[r.RecptType] || r.RecptType || '',
    ]);
    const csv = [hdrs, ...body]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['ï»¿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `receipts_${listFromDt}_to_${listToDt}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Validate (Tab 1) ──────────────────────────────────────────────────────
  const validate = () => {
    if (!fkPartyID) return 'Please select Party Name.';
    if (!recptMode) return 'Please select Receipt Mode.';
    if (!recptType) return 'Please select Receipt Type.';
    if (!recptAmt || parseFloat(recptAmt) <= 0) return 'Please enter Receipt Amount.';
    if (editMode === 'new' && ![btGodrent, btHamali, btTrsp, btGen].some(Boolean)) return 'Select at least one Bill Type.';
    for (const r of rows) {
      if (r.balAmt < 0) return `Negative Balance Amount for Bill No. ${r.billNum}`;
    }
    const gridTotal = totals.totAmt;
    const hdrAmt    = parseFloat(recptAmt) || 0;
    if (recptType === 'N' && Math.abs(hdrAmt - gridTotal) > 0.01)
      return 'Mismatch Receipt Amount — for Normal type, receipt amount must equal total allocated amount.';
    if (recptType === 'O' && (hdrAmt < gridTotal - 0.01 || gridTotal <= 0))
      return 'Mismatch Receipt Amount — for On Account type, receipt amount must be ≥ allocated total.';
    if (recptType === 'A' && editMode === 'new' && hdrAmt !== 0 && gridTotal > 0)
      return 'Mismatch Receipt Amount — for Advance type, no bill allocation is allowed.';
    return '';
  };

  // ── Save (Tab 1) — on success go to Tab 0 ────────────────────────────────
  const handleSave = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const err = validate();
    if (err) return setErrorMsg(err);

    setSaving(true);
    try {
      const payload = {
        recptDt, fkPartyID, recptAmt: parseFloat(recptAmt),
        recptType, recptMode, fkBankID: fkBankID || null,
        bankName: chequeMode ? bankName : '',
        chqNo:    chqNo ?? '',
        chqDt:    chqDt || today,
        rNote:    rNote ?? '',
        lines:    rows,
      };
      if (editMode === 'edit') {
        await api.put(`/billing/receipts/${pkRecptID}`, payload);
      } else {
        await api.post('/billing/receipts', payload);
      }
      setSuccessMsg('Receipt Entry Saved.');
      resetForm();
      loadList();
      setActiveTab(0);
    } catch (e) {
      setErrorMsg(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Cancel (Tab 1) — clear form and go to Tab 0 ──────────────────────────
  const handleCancel = () => {
    resetForm();
    setActiveTab(0);
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loadingFD) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} mb={1}>Receipt Entry</Typography>

      {errorMsg   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setErrorMsg('')}>{errorMsg}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab label="Receipt List" />
        <Tab label={editMode === 'edit' ? `Modify Receipt` : 'New Receipt'} />
      </Tabs>

      {/* ══ TAB 0: RECEIPT LIST ══════════════════════════════════════════════ */}
      {activeTab === 0 && (
        <Box>

          {/* Filter bar */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
              <TextField label="From Date" type="date" size="small" sx={{ width: 160 }}
                slotProps={{ inputLabel: { shrink: true } }}
                value={listFromDt} onChange={e => setListFromDt(e.target.value)} />
              <TextField label="To Date" type="date" size="small" sx={{ width: 160 }}
                slotProps={{ inputLabel: { shrink: true } }}
                value={listToDt} onChange={e => setListToDt(e.target.value)} />
              <TextField label="Search" size="small" sx={{ minWidth: 220, flexGrow: 1 }}
                value={listSearch} onChange={e => setListSearch(e.target.value)}
                placeholder="Party name or amount…"
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
              <Button variant="outlined" size="small" onClick={loadList} disabled={listLoading}>
                {listLoading ? <CircularProgress size={16} /> : 'Search'}
              </Button>
              {canAdd && (
                <Button variant="contained" size="small" startIcon={<AddCircleIcon />}
                  onClick={() => { resetForm(); setActiveTab(1); }}>
                  New Receipt
                </Button>
              )}
            </Stack>
          </Paper>

          {/* Receipt grid */}
          <Paper>
            <TableContainer sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, width: 130 }}>
                      <TableSortLabel
                        active={sortField === 'RecptDt'}
                        direction={sortField === 'RecptDt' ? sortDir : 'asc'}
                        onClick={() => handleSort('RecptDt')}>
                        Receipt Date
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>
                      <TableSortLabel
                        active={sortField === 'partyName'}
                        direction={sortField === 'partyName' ? sortDir : 'asc'}
                        onClick={() => handleSort('partyName')}>
                        Party Name
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, textAlign: 'center', width: 150 }}>
                      Receipt Amount
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>Receipt Type</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {listLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </TableCell>
                    </TableRow>
                  ) : filteredList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 4 }}>
                        No receipts found for this period
                      </TableCell>
                    </TableRow>
                  ) : filteredList.map(r => (
                    <TableRow key={r.pkRecptID}
                      hover
                      selected={r.pkRecptID === listSelectedID}
                      onClick={() => setListSelectedID(r.pkRecptID === listSelectedID ? '' : r.pkRecptID)}
                      onDoubleClick={async () => {
                        setListSelectedID(r.pkRecptID);
                        await loadReceiptForEdit(r.pkRecptID);
                        setActiveTab(1);
                      }}
                      sx={{ cursor: 'pointer' }}>
                      <TableCell sx={{ fontSize: 12 }}>{fmtDt(r.RecptDt)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{r.partyName}</TableCell>
                      <TableCell sx={{ fontSize: 12, textAlign: 'center' }}>{fmt(r.RecptAmt)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{recptTypeMap[r.RecptType] || r.RecptType}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ px: 2, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">
                {filteredList.length} record{filteredList.length !== 1 ? 's' : ''}
                {listSearch ? ' (filtered)' : ''}
              </Typography>
            </Box>
          </Paper>

          {/* Action buttons */}
          <Paper sx={{ p: 1.5, mt: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="outlined" size="small"
                disabled={!listSelectedID} onClick={handleView}>
                View
              </Button>
              {canDelete && (
                <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />}
                  disabled={!listSelectedID} onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
              )}
              <Button variant="outlined" size="small"
                disabled={!listSelectedID} onClick={() => setListSelectedID('')}>
                Cancel
              </Button>
              <Box sx={{ flex: 1 }} />
              {can('RECEIPT_ENTRY', 'CanExport') && (
              <Button variant="outlined" size="small" startIcon={<FileDownloadIcon />}
                disabled={!filteredList.length} onClick={exportExcel}>
                Excel Export
              </Button>
              )}
            </Box>
          </Paper>
        </Box>
      )}

      {/* ══ TAB 1: RECEIPT ENTRY FORM ════════════════════════════════════════ */}
      {activeTab === 1 && (
        <Box>
          <Typography variant="subtitle2" color="text.secondary" mb={2}>
            {editMode === 'edit' ? `Modify Receipt` : 'New Receipt'}
          </Typography>

          {/* Header + Pending Advances */}
          <Grid container spacing={2}>
            {/* Left — Receipt Header */}
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 2 }}>
                <Stack spacing={1.5}>

                  {/* Row 1 — Date | Company | Party */}
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <TextField label="Receipt Date" type="date" size="small"
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: 160 }}
                      value={recptDt} onChange={e => setRecptDt(e.target.value)} />
                    <TextField label="Company" size="small" disabled value={user?.compID || ''}
                      sx={{ width: 140 }} />
                    <FormControl size="small" sx={{ minWidth: 220, flexGrow: 1 }}>
                      <InputLabel>Party Name *</InputLabel>
                      <Select value={fkPartyID} label="Party Name *"
                        onChange={e => handlePartyChange(e.target.value)}
                        MenuProps={{ PaperProps: { sx: { minWidth: 'fit-content' } } }}>
                        <MenuItem value=""><em>— Select Party —</em></MenuItem>
                        {parties.map(p => (
                          <MenuItem key={`${p.fkCompID}|${p.pkPartyID}`} value={p.pkPartyID}>
                            <span style={{ fontWeight: 500 }}>{p.pName}</span>
                            {p.pCode && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: '#555' }}>
                                ({p.pCode})
                              </span>
                            )}
                            {p.fkCompID && (
                              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#1565C0' }}>
                                [{p.fkCompID}]
                              </span>
                            )}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>

                  {/* Row 2 — Receipt Mode | Receipt Type | Bank */}
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <TextField label="Receipt Mode *" size="small" select
                      sx={{ minWidth: 140, flexGrow: 1 }}
                      value={recptMode} onChange={e => setRecptMode(e.target.value)}>
                      {recptModes.map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                    </TextField>
                    <TextField label="Receipt Type *" size="small" select
                      sx={{ minWidth: 140, flexGrow: 1 }}
                      value={recptType} onChange={e => setRecptType(e.target.value)}>
                      {recptTypes.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </TextField>
                    <TextField label="Bank" size="small" select disabled={cashMode || !recptMode}
                      sx={{ minWidth: 160, flexGrow: 1 }}
                      value={fkBankID} onChange={e => setFkBankID(e.target.value)}>
                      {banks.map(b => <MenuItem key={b.value} value={b.value}>{b.label}</MenuItem>)}
                    </TextField>
                  </Stack>

                  {/* Row 4 — Cheque fields */}
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <TextField label="Cheque Date" type="date" size="small" disabled={!chequeMode}
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: 160 }}
                      value={chqDt} onChange={e => setChqDt(e.target.value)} />
                    <TextField label="Cheque No." size="small" disabled={!chequeMode}
                      inputProps={{ maxLength: 30 }}
                      sx={{ minWidth: 140, flexGrow: 1 }}
                      value={chqNo} onChange={e => setChqNo(e.target.value)} />
                    <TextField label="Bank Name (manual)" size="small" disabled={!chequeMode}
                      inputProps={{ maxLength: 100 }}
                      sx={{ minWidth: 200, flexGrow: 2 }}
                      value={bankName} onChange={e => setBankName(e.target.value)} />
                  </Stack>

                  {/* Row 5 — Note */}
                  <TextField label="Note" size="small" fullWidth multiline rows={2}
                    value={rNote} onChange={e => setRNote(e.target.value)} />

                  {/* Row 6 — Amounts */}
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <TextField label="Receipt Amount *" size="small" type="number"
                      sx={{ minWidth: 160, flexGrow: 1, '& .MuiInputBase-root': { bgcolor: '#e8f5e9' } }}
                      value={recptAmt} onChange={e => setRecptAmt(e.target.value)}
                      inputProps={{ min: 0, step: 0.01 }} />
                    <TextField label="TDS Amount (grid total)" size="small" disabled
                      sx={{ minWidth: 160, flexGrow: 1 }}
                      value={fmt(totals.tdsAmt)} />
                    <TextField label="Receipt Balance" size="small" disabled
                      sx={{ minWidth: 160, flexGrow: 1, '& .MuiInputBase-root': { bgcolor: recptBalAmt < 0 ? '#ffebee' : undefined } }}
                      value={fmt(recptBalAmt)} />
                  </Stack>

                </Stack>
              </Paper>
            </Grid>

            {/* Right — Pending Advances */}
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 1.5, height: '100%' }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  ON ACCOUNT / ADVANCE PENDING RECEIPT DETAIL
                </Typography>
                <TableContainer sx={{ maxHeight: 240, mt: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {['Date', 'Type', 'Rec. Amt', 'Pend. Amt'].map(h => (
                          <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, py: 0.5 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pendingAdvs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center' }}>
                            None
                          </TableCell>
                        </TableRow>
                      ) : pendingAdvs.map(r => (
                        <TableRow key={r.pkRecptID} hover sx={{ cursor: 'pointer' }}
                          onDoubleClick={() => loadReceiptForEdit(r.pkRecptID)}>
                          <TableCell sx={{ fontSize: 11 }}>{fmtDt(r.RecptDt)}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{r.RecptType}</TableCell>
                          <TableCell sx={{ fontSize: 11, textAlign: 'center' }}>{fmt(r.RecptAmt)}</TableCell>
                          <TableCell sx={{ fontSize: 11, textAlign: 'center' }}>{fmt(r.PendAmt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Double-click a row to load for editing
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Bill Type + Select Bill */}
          <Paper sx={{ p: 2, mt: 2 }}>
            <Grid container alignItems="center" spacing={2}>
              <Grid item>
                <Typography variant="body2" fontWeight={600} sx={{ mr: 1 }}>Bill Types:</Typography>
              </Grid>
              <Grid item>
                <FormGroup row>
                  <FormControlLabel control={<Checkbox size="small" checked={btGodrent} onChange={e => setBtGodrent(e.target.checked)} />} label="Godown Rent" />
                  <FormControlLabel control={<Checkbox size="small" checked={btHamali}  onChange={e => setBtHamali(e.target.checked)}  />} label="Hamali" />
                  <FormControlLabel control={<Checkbox size="small" checked={btTrsp}    onChange={e => setBtTrsp(e.target.checked)}    />} label="Transportation" />
                  <FormControlLabel control={<Checkbox size="small" checked={btGen}     onChange={e => setBtGen(e.target.checked)}     />} label="General" />
                </FormGroup>
              </Grid>
              <Grid item sx={{ ml: 'auto' }}>
                <Button variant="contained" size="small" startIcon={<AddCircleIcon />}
                  onClick={handleSelectBill} disabled={loadingBills}>
                  {loadingBills ? 'Loading…' : 'Select Bill'}
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {/* Bill Allocation Grid */}
          <Paper sx={{ mt: 2, overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 320, overflowX: 'auto' }}>
              <Table size="small" stickyHeader sx={{ minWidth: 1200 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#1565C0' }}>
                    {COL.map(c => (
                      <TableCell key={c.key}
                        sx={{ fontWeight: 700, fontSize: 11, color: '#fff', bgcolor: '#1565C0',
                              textAlign: c.align, width: c.width, whiteSpace: 'nowrap', py: 0.5 }}>
                        {c.label}
                        {c.editable && <span style={{ color: '#ffee58', fontSize: 9, marginLeft: 2 }}>●</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                  {rows.length > 0 && (() => {
                    const totKeys = ['grAmt','netAmt','billBalAmt','recdAmt','tdsAmt','discAmt','totAmt','balAmt'];
                    return (
                      <TableRow>
                        {COL.map(c => (
                          <TableCell key={c.key}
                            sx={{ fontWeight: 700, fontSize: 11, textAlign: c.align,
                                  py: 0.5, bgcolor: '#2e7d32', whiteSpace: 'nowrap',
                                  color: c.key === 'totAmt' ? '#ffee58' : '#fff',
                                  position: 'sticky', top: '33px', zIndex: 2 }}>
                            {c.key === 'billNum' ? `${totals.count} bills` : (totKeys.includes(c.key) ? fmt(totals[c.key]) : '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })()}
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={COL.length} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                        Click "Select Bill" to load pending bills
                      </TableCell>
                    </TableRow>
                  ) : rows.map((row, idx) => {
                    const deleted = row.rowState === RS_DELETE;
                    const balNeg  = row.balAmt < 0;
                    return (
                      <TableRow key={idx}
                        sx={{
                          opacity: deleted ? 0.4 : 1,
                          bgcolor: idx % 2 === 0 ? '#fafafa' : '#fff',
                        }}>
                        {COL.map(c => {
                          const v = row[c.key];
                          if (!c.editable) {
                            return (
                              <TableCell key={c.key}
                                sx={{
                                  fontSize: 12, textAlign: c.align, py: 0.4, px: 1,
                                  fontWeight: c.bold ? 700 : 400,
                                  bgcolor: c.key === 'balAmt' && balNeg ? '#ffebee' : undefined,
                                  color:   c.key === 'totAmt' ? '#1565C0' : undefined,
                                  whiteSpace: 'nowrap',
                                }}>
                                {c.fmt ? fmt(v) : c.key === 'billDt' ? fmtDt(v) : (c.key === 'balAmt' ? fmt(v) : (c.key === 'totAmt' ? fmt(v) : v))}
                              </TableCell>
                            );
                          }
                          // recdAmt stays editable even when row is soft-deleted so the
                          // user can re-enter an amount without having to reload the form.
                          const cellDisabled = deleted && c.key !== 'recdAmt';
                          return (
                            <TableCell key={c.key} sx={{ py: 0.3, px: 0.5, bgcolor: cellDisabled ? undefined : c.bg }}>
                              {c.key === 'remarks' ? (
                                <TextField size="small" fullWidth variant="standard"
                                  value={v} disabled={cellDisabled}
                                  onChange={e => handleCellChange(idx, c.key, e.target.value)}
                                  inputProps={{ style: { fontSize: 11 } }}
                                  sx={{ '& .MuiInput-underline:before': { border: 'none' } }}
                                />
                              ) : (
                                <TextField size="small" variant="standard" type="number"
                                  value={v || ''} disabled={cellDisabled}
                                  onChange={e => handleCellChange(idx, c.key, e.target.value)}
                                  inputProps={{ style: { fontSize: 12, textAlign: 'center', width: c.width - 16 } }}
                                  sx={{ '& .MuiInput-underline:before': { border: 'none' } }}
                                />
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>

              </Table>
            </TableContainer>
          </Paper>

          {/* Action Buttons — no View/Select, no Delete */}
          <Paper sx={{ p: 1.5, mt: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1 }} />
              <Button variant="outlined" size="small" startIcon={<CancelIcon />} onClick={handleCancel}>
                Cancel
              </Button>
              {(editMode === 'new' ? canAdd : canEdit) && (
                <Button variant="contained" size="small" startIcon={<SaveIcon />}
                  onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              )}
            </Box>
          </Paper>
        </Box>
      )}

      {/* ── Delete Confirm Dialog ─────────────────────────────────────────── */}
      {(() => {
        const delRow = listRows.find(r => r.pkRecptID === listSelectedID);
        return (
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WarningAmberIcon color="warning" /> Confirm Delete
            </DialogTitle>
            <DialogContent>
              <Typography>Delete the following receipt?</Typography>
              {delRow && (
                <Box sx={{ mt: 1, pl: 1, borderLeft: '3px solid', borderColor: 'warning.main' }}>
                  <Typography variant="body2"><strong>Party :</strong> {delRow.partyName}</Typography>
                  <Typography variant="body2"><strong>Date &nbsp;:</strong> {fmtDt(delRow.RecptDt)}</Typography>
                  <Typography variant="body2"><strong>Amount:</strong> {fmt(delRow.RecptAmt)}</Typography>
                </Box>
              )}
              <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
                This will remove the header and all bill allocations. This action cannot be undone.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button onClick={handleDeleteFromList} color="error" variant="contained">Delete</Button>
            </DialogActions>
          </Dialog>
        );
      })()}
    </Box>
  );
}
