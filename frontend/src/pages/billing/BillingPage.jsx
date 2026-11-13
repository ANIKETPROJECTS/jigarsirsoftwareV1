// ─────────────────────────────────────────────────────────────────────────────
// BillingPage — Bill Generation for Transport, Hamali & General
// VB6 Source: frmBillTrHmGen.frm
//
// Tab 0 (Party & Bills): selectors + existing-bills grid
// Tab 1 (Bill Entry):    editable line-items grid + generate/delete
// ─────────────────────────────────────────────────────────────────────────────
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
  Paper, Select, Stack, Switch, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography,
} from '@mui/material';
import AddIcon                from '@mui/icons-material/Add';
import DeleteIcon             from '@mui/icons-material/Delete';
import SaveIcon               from '@mui/icons-material/Save';
import FileDownloadIcon       from '@mui/icons-material/FileDownload';
import RestartAltIcon         from '@mui/icons-material/RestartAlt';
import DeleteOutlinedIcon      from '@mui/icons-material/DeleteOutlined';
import EditIcon               from '@mui/icons-material/Edit';
import ReceiptLongIcon        from '@mui/icons-material/ReceiptLong';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const today = () => new Date().toISOString().slice(0, 10);

// ── Small inline helpers ─────────────────────────────────────────────────────

const fmt = (n) => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BILL_TYPE_LABELS = { HMLI: 'Hamali', TRSP: 'Transport', GEN: 'General' };
const HAMALI_OPTIONS   = ['Loading', 'Unloading'];

// Determines default hamali direction from VB6 logic in vfgTransEnt_AfterEdit:
//   ARV / DESPRET / IN → Unloading; everything else → Loading
const autoHamali = (transType) =>
  ['ARV', 'DESPRET', 'IN'].includes(transType) ? 'Unloading' : 'Loading';

const txnTypeChipSx = (type) => {
  const t = (type || '').toUpperCase();
  const base = { fontSize: 10, height: 18 };
  if (t === 'ARV')  return { ...base, bgcolor: '#388e3c', color: '#fff' }; // green
  if (t === 'DESP') return { ...base, bgcolor: '#d32f2f', color: '#fff' }; // red
  if (t === 'IN')   return { ...base, bgcolor: '#f57c00', color: '#fff' }; // orange
  if (t === 'OUT')  return { ...base, bgcolor: '#5d4037', color: '#fff' }; // brown
  return { ...base };
};

// VB6 vfgTransEnt_AfterEdit rate/amount linkage.
// Uses actual line property names (transQty, billRate) so updateLine mapping works.
//   TRAN/GEN: base = Qty (KG mode) or Tons (Ton mode)
//   ITEM:     base always = Qty; Tons = (Qty Ã— PackWght) / 1000 (auto); Rate read-only
function recalcLine(line, changed, kgTonFlg) {
  const l = { ...line };

  // ITEM rows: auto-compute tons from qty Ã— weight
  if (l.recdType === 'ITEM') {
    l.tons = parseFloat(((+l.transQty * +l.packWght) / 1000).toFixed(3));
  }

  // ITEM rows always base on Qty; others use Qty or Tons per mode
  const base = (l.recdType === 'ITEM' || kgTonFlg === 'K') ? +l.transQty : +l.tons;

  if (changed === 'amount') {
    l.billRate = base > 0 ? parseFloat((+l.amount / base).toFixed(4)) : 0;
  } else if (changed === 'billRate') {
    l.amount = parseFloat((+l.billRate * base).toFixed(2));
  } else if (changed === 'transQty' || changed === 'tons' || changed === 'packWght') {
    l.amount = parseFloat((+l.billRate * base).toFixed(2));
  }

  return l;
}

// ── Compact editable table cell ──────────────────────────────────────────────
function EC({ value, onChange, type = 'text', disabled, width = 70, align = 'right', select, options }) {
  if (select) {
    return (
      <Select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        size="small"
        variant="standard"
        disableUnderline={disabled}
        sx={{ fontSize: 11, minWidth: width }}
      >
        {options.map((o) => <MenuItem key={o} value={o} sx={{ fontSize: 11 }}>{o}</MenuItem>)}
      </Select>
    );
  }
  return (
    <TextField
      value={value ?? ''}
      onChange={(e) => onChange(type === 'number' ? e.target.value : e.target.value)}
      onBlur={type === 'number' ? (e) => onChange(parseFloat(e.target.value) || 0) : undefined}
      disabled={disabled}
      type={type === 'number' ? 'text' : type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      size="small"
      variant="standard"
      sx={{ width }}
      slotProps={{
        input: {
          disableUnderline: disabled,
          style: { fontSize: 11, textAlign: align, padding: '1px 0' },
        },
      }}
    />
  );
}

// ── Type chip ────────────────────────────────────────────────────────────────
const TYPE_COLOR = { TRAN: 'primary', ITEM: 'success', GEN: 'warning' };
const TypeChip = ({ type }) => (
  <Chip label={type} color={TYPE_COLOR[type] || 'default'} size="small"
    sx={{ fontSize: 9, height: 18, px: 0.25 }} />
);

// ── Save-result summary dialog ───────────────────────────────────────────────
function SaveResultDialog({ open, result, onClose }) {
  if (!result) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: 'success.main', color: 'white', py: 1 }}>
        Bill Generated
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={1}>
          <Typography variant="body2"><b>Bill No:</b> {result.billNum}</Typography>
          <Divider />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">Gross Amount</Typography>
            <Typography variant="body2">₹ {fmt(result.grossAmt)}</Typography>
          </Stack>
          {result.tax1?.amt > 0 && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2">{result.tax1.desc} ({result.tax1.rate}%)</Typography>
              <Typography variant="body2">₹ {fmt(result.tax1.amt)}</Typography>
            </Stack>
          )}
          {result.tax2?.amt > 0 && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2">{result.tax2.desc} ({result.tax2.rate}%)</Typography>
              <Typography variant="body2">₹ {fmt(result.tax2.amt)}</Typography>
            </Stack>
          )}
          {result.tax3?.amt > 0 && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2">{result.tax3.desc} ({result.tax3.rate}%)</Typography>
              <Typography variant="body2">₹ {fmt(result.tax3.amt)}</Typography>
            </Stack>
          )}
          <Divider />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body1" fontWeight={700}>Net Amount</Typography>
            <Typography variant="body1" fontWeight={700} color="primary">₹ {fmt(result.netAmt)}</Typography>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" size="small">OK</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Module-level memoized row — stable reference prevents remount on re-render.
// memo comparator: re-render only when this row's data, selection, or mode changes.
// kgTonFlg is included so the `up` closure inside always has the latest value.
function BillRowInner({ line: l, idx, kgTonFlg, packingList, isSelected, onUpdate, onSelect }) {
  const up = (field, val) => onUpdate(l._key, field, val, kgTonFlg);

  if (l._placeholder) {
    return (
      <TableRow
        onClick={() => onSelect(isSelected ? null : l._key)}
        sx={{
          cursor: 'pointer',
          bgcolor: isSelected ? 'primary.50' : 'transparent',
          outline: isSelected ? '2px solid' : 'none',
          outlineColor: 'primary.main',
        }}>
        <TableCell colSpan={15} sx={{ py: 0.75, textAlign: 'center', color: 'text.disabled', fontSize: 11, fontStyle: 'italic' }}>
          Select this row, then click Add Item or Add General to insert above it
        </TableCell>
      </TableRow>
    );
  }

  const isTran = l.recdType === 'TRAN';
  const isItem = l.recdType === 'ITEM';
  const isGen  = l.recdType === 'GEN';

  return (
    <TableRow
      onClick={() => onSelect(isSelected ? null : l._key)}
      sx={{
        cursor: 'pointer',
        bgcolor: isSelected ? 'primary.50' : (idx % 2 === 0 ? 'transparent' : 'grey.50'),
        outline: isSelected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
      }}>
      <TableCell sx={{ fontSize: 11, p: '2px 5px', textAlign: 'center' }}>{idx + 1}</TableCell>
      <TableCell sx={{ p: '2px 4px' }}><TypeChip type={l.recdType} /></TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.recdDt || ''} onChange={(v) => up('recdDt', v)} type="date" disabled={isTran || isGen} width={95} align="left" />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.lotNum} onChange={(v) => up('lotNum', v)} disabled={true} width={58} align="left" />
      </TableCell>
      <TableCell sx={{ p: '2px 4px', minWidth: 110 }}>
        <EC value={l.iName} onChange={(v) => up('iName', v)} disabled={isTran || isGen} width="100%" align="left" />
      </TableCell>
      <TableCell sx={{ p: '2px 4px', minWidth: 120 }}>
        <EC value={l.billDesc2} onChange={(v) => up('billDesc2', v)} disabled={!isGen} width="100%" align="left" />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.transQty} onChange={(v) => up('qty', v)} type="number" disabled={isGen} width={58} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        {isItem ? (
          <EC value={l.packing} onChange={(v) => up('packing', v)} select options={packingList} width={90} align="left" />
        ) : (
          <EC value={l.packing} onChange={() => {}} disabled={true} width={58} align="left" />
        )}
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.packWght} onChange={(v) => up('packWght', v)} type="number" disabled={!isItem} width={52} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.tons} onChange={(v) => up('tons', v)} type="number" disabled={isGen || isItem} width={62} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.amount} onChange={(v) => up('amount', v)} type="number" width={78} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.billRate} onChange={(v) => up('rate', v)} type="number" disabled={isGen || isItem} width={70} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px' }}>
        <EC value={l.hamaliFlg} onChange={(v) => up('hamaliFlg', v)} disabled={isGen} select options={HAMALI_OPTIONS} width={88} />
      </TableCell>
      <TableCell sx={{ p: '2px 4px', minWidth: 80 }}>
        <EC value={l.fromDest} onChange={(v) => up('fromDest', v)} disabled={isGen} width="100%" align="left" />
      </TableCell>
      <TableCell sx={{ p: '2px 4px', minWidth: 80 }}>
        <EC value={l.toDest} onChange={(v) => up('toDest', v)} disabled={isGen} width="100%" align="left" />
      </TableCell>
    </TableRow>
  );
}
const BillRow = memo(BillRowInner, (prev, next) =>
  prev.line        === next.line        &&
  prev.idx         === next.idx         &&
  prev.kgTonFlg    === next.kgTonFlg    &&
  prev.isSelected  === next.isSelected  &&
  prev.packingList === next.packingList
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const { user, can } = useAuth();
  const keyRef = useRef(1);
  const nextKey = () => String(keyRef.current++);

  // ── Master data (loaded once on mount) ────────────────────────────────────
  const [formData, setFormData]   = useState({ billTypes: [], parties: [], companies: [], faYears: [], packingList: [] });
  const [masterLoading, setML]    = useState(true);

  // ── Party selection (Tab 0) ──────────────────────────────────────────────
  const [billType,    setBillType]    = useState('HMLI');
  const [fkCompID,    setFkCompID]    = useState('');
  const [fkPartyID,   setFkPartyID]   = useState('');
  const [faYear,      setFaYear]      = useState('');
  const [billFrom,    setBillFrom]    = useState(today());
  const [billTo,      setBillTo]      = useState(today());
  const [kgTonFlg,    setKgTonFlg]    = useState('K');
  const [billDesc1,   setBillDesc1]   = useState('');
  const [billNote,    setBillNote]    = useState('');
  const [gstNo,       setGstNo]       = useState('');
  const [fkStateID,   setFkStateID]   = useState('');
  const [stFlagTrans, setStFlagTrans] = useState('N');

  // ── Bills list (Tab 0 grid) ───────────────────────────────────────────────
  const [bills,         setBills]       = useState([]);
  const [billsLoading,  setBillsLoading] = useState(false);

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const [editMode,    setEditMode]   = useState('add');  // 'add' | 'modify'
  const [editBillID,  setEditBillID] = useState(null);
  const [editBillNum, setEditBillNum] = useState('');    // human-readable bill number for display
  const [editCompID,  setEditCompID] = useState('');     // company of bill being modified

  // ── Line items (Tab 1 grid) ───────────────────────────────────────────────
  const [lines,           setLines]          = useState([]);
  const [selectedLineKey, setSelectedLineKey] = useState(null);

  // ── Transaction selection dialog ─────────────────────────────────────────
  const [txnOpen,     setTxnOpen]    = useState(false);
  const [txnRows,     setTxnRows]    = useState([]);
  const [txnSelected, setTxnSelected] = useState(new Set());
  const [txnLoading,  setTxnLoading]  = useState(false);
  const [txnSearch,   setTxnSearch]   = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab,        setTab]        = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [saveResult, setSaveResult] = useState(null);
  const [showResult, setShowResult] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const visibleLines  = useMemo(() => lines.filter((l) => !l._deleted), [lines]);
  // Placeholder rows (blank anchor at grid bottom) are excluded from amounts and validation
  const billableLines = useMemo(() => visibleLines.filter((l) => !l._placeholder), [visibleLines]);
  const grossAmt      = useMemo(() => billableLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0), [billableLines]);
  const nextSrNo      = (arr) => arr.filter((l) => !l._deleted && !l._placeholder).length + 1;
  const selectedParty = useMemo(
    () => formData.parties.find((p) => p.pkPartyID === fkPartyID),
    [formData.parties, fkPartyID]
  );

  const compAliasMap = useMemo(
    () => Object.fromEntries(formData.companies.map(c => [c.pkCompID, c.CompAlias || c.pkCompID])),
    [formData.companies]
  );

  // ── Load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    setML(true);
    api.get('/billing/bills/form-data')
      .then(({ data }) => {
        setFormData(data);
        if (data.faYears.length)   setFaYear(data.faYears[0].FaYear);
        if (data.companies.length) setFkCompID(data.companies[0].pkCompID);
        // VB6: gudfGetBillToDay + udfDatePeriod — set default period from mCompBillDate
        if (data.defaultDates) {
          setBillFrom(data.defaultDates.fromDate);
          setBillTo(data.defaultDates.toDate);
        }
      })
      .catch((e) => setError(e.response?.data?.error || 'Failed to load form data'))
      .finally(() => setML(false));
  }, []);

  // Pre-fill GST info when party is selected (VB6: udfFillPartyDetails)
  useEffect(() => {
    if (selectedParty) {
      setGstNo(selectedParty.GSTNo?.trim() || '');
      setFkStateID(selectedParty.fkStateID || '');
      setStFlagTrans(selectedParty.StFlagTrans || 'N');
      // Company dropdown stays independent — party selection does NOT change it.
    }
  }, [selectedParty]);

  // ── Load bills list ───────────────────────────────────────────────────────
  const loadBills = useCallback(() => {
    setBillsLoading(true);
    setError('');
    const params = {};
    if (faYear)    params.faYear  = faYear;
    if (fkCompID)  params.compID  = fkCompID;
    if (fkPartyID) params.partyID = fkPartyID;
    api.get('/billing/bills', { params })
      .then(({ data }) => setBills(data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load bills'))
      .finally(() => setBillsLoading(false));
  }, [faYear, fkPartyID]);

  // ── Load a bill for Modify ────────────────────────────────────────────────
  const loadBillForModify = useCallback(async (bill) => {
    setError('');
    try {
      const { data } = await api.get(`/billing/bills/${bill.pkBillID}`);
      const { header, lines: dbLines } = data;

      setBillType(header.BillType    || 'HMLI');
      setFkCompID(header.fkCompID    || '');
      setFkPartyID(header.fkPartyID  || '');
      setBillFrom(header.BillFrom?.slice(0, 10) || today());
      setBillTo(header.BillDt?.slice(0, 10)     || today());
      setKgTonFlg(header.KgTonFlg   || 'K');
      setBillDesc1(header.BillDesc1  || '');
      setBillNote(header.BillNote    || '');
      setGstNo(header.GSTNo          || '');
      setFkStateID(header.fkStateID  || '');
      setStFlagTrans(header.StFlagTrans || 'N');

      setLines([
        ...dbLines.map((l) => ({
          _key:         nextKey(),
          _new:         false,
          _deleted:     false,
          _placeholder: false,
          cpkSrNo:      l.cpkSrNo,
          recdType:     l.RecdType,
          recdSrNo:     l.RecdSrNo,
          recdDt:       l.RecdDt?.slice(0, 10) || null,
          pfkLotID:     l.pfkLotID  || '',
          lotNum:       l.LotNum    || '',
          iName:        l.iName     || '',
          transQty:     l.TransQty  || 0,
          packing:      l.Packing   || '',
          packWght:     l.PackWght  || 0,
          tons:         l.Tons      || 0,
          billDesc2:    l.BillDesc2 || '',
          fromDest:     l.FromDest  || '',
          toDest:       l.ToDest    || '',
          hamaliFlg:    l.HamaliFlg || '',
          billRate:     l.BillRate  || 0,
          amount:       l.Amount    || 0,
        })),
        // Blank anchor row at bottom for insertion reference
        {
          _key: nextKey(), _new: true, _deleted: false, _placeholder: true,
          recdType: 'GEN', recdSrNo: 0,
          recdDt: null, pfkLotID: '', lotNum: '', iName: '',
          transQty: 0, packing: '', packWght: 0, tons: 0,
          billDesc2: '', fromDest: '', toDest: '',
          hamaliFlg: '', billRate: 0, amount: 0,
        },
      ]);

      setEditMode('modify');
      setEditBillID(bill.pkBillID);
      setEditBillNum(header.BillNum || bill.BillNum || '');
      setEditCompID(bill.fkCompID);
      setTab(1);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load bill');
    }
  }, []); // eslint-disable-line

  // ── Reset to Add mode ─────────────────────────────────────────────────────
  const handleNew = () => {
    if (!fkPartyID || !fkCompID) {
      setError('Select a company and party before creating a new bill.');
      return;
    }
    // Start with one blank placeholder row at the bottom so the user can always
    // select it and click Add Item / Add General to insert a row above it (= at end).
    setLines([{
      _key: nextKey(), _new: true, _deleted: false, _placeholder: true,
      recdType: 'GEN', recdSrNo: 0,
      recdDt: null, pfkLotID: '', lotNum: '', iName: '',
      transQty: 0, packing: '', packWght: 0, tons: 0,
      billDesc2: '', fromDest: '', toDest: '',
      hamaliFlg: '', billRate: 0, amount: 0,
    }]);
    setSelectedLineKey(null);
    setEditMode('add');
    setEditBillID(null);
    setEditCompID('');
    setBillDesc1('');
    setBillNote('');
    setError('');
    setSuccess('');
    setTab(1);
  };

  const handleCancel = () => {
    setLines([]);
    setSelectedLineKey(null);
    setEditMode('add');
    setEditBillID(null);
    setEditBillNum('');
    setEditCompID('');
    setError('');
    setSuccess('');
    setTab(0);
  };

  // ── Line item mutations ───────────────────────────────────────────────────
  const updateLine = useCallback((key, field, rawValue, kgTon) => {
    // Map grid alias names to actual line property names
    const fieldMap   = { qty: 'transQty', rate: 'billRate' };
    const actualField = fieldMap[field] || field;
    const recalcFields = ['amount', 'transQty', 'billRate', 'tons', 'packWght'];

    setLines((prev) =>
      prev.map((l) => {
        if (l._key !== key) return l;
        const updated = { ...l, [actualField]: rawValue };
        return recalcFields.includes(actualField)
          ? recalcLine(updated, actualField, kgTon)
          : updated;
      })
    );
  }, []);

  const removeSelectedLine = () => {
    if (!selectedLineKey) return;
    const target = lines.find(l => l._key === selectedLineKey);
    if (!target || target._placeholder) return; // placeholder is permanent
    setLines((prev) =>
      prev.map((l) => {
        if (l._key !== selectedLineKey) return l;
        if (l._new) return null; // will be filtered
        return { ...l, _deleted: true };
      }).filter(Boolean)
    );
    setSelectedLineKey(null);
  };

  // Insert a new row: above the selected row if one is chosen, otherwise just before
  // the placeholder anchor (= at the logical end of real rows).
  const insertNewRow = (newRow) => {
    setLines((prev) => {
      if (selectedLineKey) {
        const idx = prev.findIndex(l => l._key === selectedLineKey && !l._deleted);
        if (idx >= 0) {
          const r = [...prev];
          r.splice(idx, 0, newRow);
          return r;
        }
      }
      const phIdx = prev.findIndex(l => l._placeholder && !l._deleted);
      if (phIdx >= 0) {
        const r = [...prev];
        r.splice(phIdx, 0, newRow);
        return r;
      }
      return [...prev, newRow];
    });
  };

  const addItemRow = () => {
    insertNewRow({
      _key: nextKey(), _new: true, _deleted: false, _placeholder: false,
      recdType: 'ITEM', recdSrNo: nextSrNo(lines),
      recdDt: billTo, pfkLotID: '', lotNum: '', iName: '',
      transQty: 0, packing: '', packWght: 0, tons: 0,
      billDesc2: '', fromDest: '', toDest: '',
      hamaliFlg: 'Loading', billRate: 0, amount: 0,
    });
  };

  const addGenRow = () => {
    insertNewRow({
      _key: nextKey(), _new: true, _deleted: false, _placeholder: false,
      recdType: 'GEN', recdSrNo: nextSrNo(lines),
      recdDt: null, pfkLotID: '', lotNum: '', iName: '',
      transQty: 0, packing: '', packWght: 0, tons: 0,
      billDesc2: '', fromDest: '', toDest: '',
      hamaliFlg: '', billRate: 0, amount: 0,
    });
  };

  // ── Open "Add Transaction" dialog ─────────────────────────────────────────
  const openTxnDialog = async () => {
    if (!fkPartyID || !fkCompID) {
      setError('Select a company and party first.');
      return;
    }
    setTxnOpen(true);
    setTxnSearch('');
    setTxnSelected(new Set());
    setTxnLoading(true);
    try {
      const { data } = await api.get('/billing/bills/transactions', {
        params: {
          partyID:  fkPartyID,
          compID:   selectedParty?.fkCompID || fkCompID,
          branchID: user.branchID,
          fromDate: billFrom,
          toDate:   billTo,
        },
      });
      setTxnRows(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load transactions');
      setTxnOpen(false);
    } finally {
      setTxnLoading(false);
    }
  };

  const txnFilteredRows = useMemo(() => {
    const s = txnSearch.toLowerCase();
    return txnRows.filter(
      (r) => !s || r.ItemName?.toLowerCase().includes(s) || String(r.LotNum || '').toLowerCase().includes(s)
    );
  }, [txnRows, txnSearch]);

  const addSelectedTxns = () => {
    const toAdd = txnFilteredRows.filter((r) => txnSelected.has(r.pkTransID));
    setLines((prev) => {
      const baseSrNo = nextSrNo(prev); // nextSrNo already excludes placeholder rows
      const newLines = toAdd.map((r, idx) => {
        const qty    = parseFloat(r.TransQty)  || 0;
        const wgt    = parseFloat(r.PackWght)  || 0;
        const tons   = parseFloat(((qty * wgt) / 1000).toFixed(3));
        // VB6 udfAddTransRow: Amount col gets ccolAddHmlBillAmt directly; Rate is derived
        const amount   = parseFloat(r.HmlBillAmt) || 0;
        const base     = kgTonFlg === 'K' ? qty : tons;
        const billRate = base > 0 ? parseFloat((amount / base).toFixed(4)) : 0;
        return {
          _key: nextKey(), _new: true, _deleted: false, _placeholder: false,
          recdType: 'TRAN', recdSrNo: baseSrNo + idx,
          recdDt:   r.TransDt,
          pfkLotID: r.pfkLotID || '',
          lotNum:   String(r.LotNum || ''),
          iName:    r.ItemName || '',
          transQty: qty,
          packing:  r.Packing  || '',
          packWght: wgt,
          tons,
          billDesc2: '',
          fromDest:  '',
          toDest:    '',
          hamaliFlg: autoHamali(r.TransType),
          billRate,
          amount,
        };
      });
      // Always insert before the placeholder anchor so the blank row stays at bottom
      const phIdx = prev.findIndex(l => l._placeholder && !l._deleted);
      if (phIdx >= 0) {
        const updated = [...prev];
        updated.splice(phIdx, 0, ...newLines);
        return updated;
      }
      return [...prev, ...newLines];
    });
    setTxnOpen(false);
  };

  // ── Save / Generate Bill ──────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!fkPartyID || !fkCompID || !billTo) {
      setError('Party, Company and Bill Date are required.');
      return;
    }
    if (billableLines.length === 0) {
      setError('Add at least one line item before generating the bill.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    // Build payload lines — exclude the placeholder anchor row, include deleted lines for modify.
    // Renumber recdSrNo sequentially by visual order; deleted rows keep their stored value.
    let srCounter = 1;
    const payloadLines = lines.filter(l => !l._placeholder).map((l) => ({
      cpkSrNo:   l.cpkSrNo || 0,
      rowAction: l._deleted ? 'delete' : (l._new ? 'add' : 'modify'),
      recdType:  l.recdType,
      recdSrNo:  l._deleted ? (l.recdSrNo || 0) : srCounter++,
      recdDt:    l.recdDt   || null,
      pfkLotID:  l.pfkLotID || '',
      lotNum:    l.lotNum   || '',
      iName:     l.iName    || '',
      transQty:  parseFloat(l.transQty)  || 0,
      packing:   l.packing   || '',
      packWght:  parseFloat(l.packWght)  || 0,
      tons:      parseFloat(l.tons)      || 0,
      billDesc2: l.billDesc2 || '',
      fromDest:  l.fromDest  || '',
      toDest:    l.toDest    || '',
      hamaliFlg: l.hamaliFlg || '',
      billRate:  parseFloat(l.billRate)  || 0,
      amount:    parseFloat(l.amount)    || 0,
    }));

    const body = {
      billType, fkPartyID, fkCompID, billFrom, billTo,
      kgTonFlg, billDesc1, billNote, stFlagTrans, gstNo, fkStateID,
      grossAmt, lines: payloadLines,
    };

    try {
      let result;
      if (editMode === 'modify') {
        const { data } = await api.put(`/billing/bills/${editBillID}`, body);
        result = data;
        setSuccess(`Bill ${editBillNum || editBillID} updated successfully.`);
      } else {
        const { data } = await api.post('/billing/bills', body);
        result = data;
        setSuccess(`Bill #${data.billNum} generated.`);
      }
      setSaveResult(result);
      setShowResult(true);
      loadBills();
      handleCancel();
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete Bill ───────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!editBillID) return;
    if (!window.confirm(`Delete bill ${editBillID}? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await api.delete(`/billing/bills/${editBillID}`, {
        data: { fkCompID: editCompID || fkCompID },
      });
      setSuccess('Bill deleted.');
      loadBills();
      handleCancel();
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const header = ['Sr', 'Type', 'Date', 'Lot', 'Item', 'Description', 'Qty', 'Packing', 'Wt(kg)', 'Tons', 'Amount', 'Rate', 'Hamali', 'From', 'To'];
    const rows = billableLines.map((l, i) => [
      i + 1, l.recdType,
      l.recdDt || '', l.lotNum || '', l.iName || '', l.billDesc2 || '',
      l.transQty, l.packing, l.packWght, l.tons,
      l.amount, l.billRate, l.hamaliFlg, l.fromDest, l.toDest,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bill_${editBillID || 'new'}_${billTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  if (masterLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>

      {/* Page title */}
      <Toolbar disableGutters sx={{ mb: 1, minHeight: 40 }}>
        <ReceiptLongIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
          Bill Generation — Transport / Hamali / General
        </Typography>
      </Toolbar>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 1 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 1 }}>{success}</Alert>}

      {/* ── Tabs ── */}
      <Paper sx={{ mb: 1 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
          <Tab label="Party & Bills" />
          <Tab label="Bill Entry" disabled={!fkPartyID || !fkCompID} />
        </Tabs>
      </Paper>

      {/* ════════════════════════════════════════════════════════════════════
          TAB 0 — Party Selection + Bill List (fraPartyView + fraBillView)
          VB6: udfFillGridCombo, udfFillBillView
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 0 && (
        <Box>
          {/* ── Selectors ── */}
          <Paper sx={{ p: 2, mb: 1 }}>
            <Stack spacing={2}>
              {/* Row 1: Bill type / Company / Party */}
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Bill Type</InputLabel>
                  <Select value={billType} label="Bill Type" onChange={(e) => setBillType(e.target.value)}>
                    {formData.billTypes.map((bt) => (
                      <MenuItem key={bt.code} value={bt.code}>{bt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Company</InputLabel>
                  <Select value={fkCompID} label="Company" onChange={(e) => setFkCompID(e.target.value)}>
                    {formData.companies.map((c) => (
                      <MenuItem key={c.pkCompID} value={c.pkCompID}>{c.CompName}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 220, flexGrow: 1 }}>
                  <InputLabel>Party</InputLabel>
                  <Select value={fkPartyID} label="Party" onChange={(e) => setFkPartyID(e.target.value)}>
                    <MenuItem value=""><em>— All Parties —</em></MenuItem>
                    {formData.parties.map((p) => (
                      <MenuItem key={p.pkPartyID} value={p.pkPartyID}>
                        <span>{p.pName}</span>
                        <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.6 }}>
                          [{compAliasMap[p.fkCompID] || p.fkCompID}]
                        </span>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              {/* Row 2: Date range / KG-Ton */}
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <TextField size="small" label="From Date" type="date" value={billFrom}
                  onChange={(e) => setBillFrom(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 150 }} />
                <TextField size="small" label="To Date" type="date" value={billTo}
                  onChange={(e) => setBillTo(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 150 }} />

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
                    Qty Mode
                  </Typography>
                  <ToggleButtonGroup size="small" exclusive value={kgTonFlg}
                    onChange={(_, v) => { if (v) setKgTonFlg(v); }}>
                    <ToggleButton value="K" sx={{ px: 2, fontSize: 12 }}>KG</ToggleButton>
                    <ToggleButton value="T" sx={{ px: 2, fontSize: 12 }}>Ton</ToggleButton>
                  </ToggleButtonGroup>
                </Box>

                {billType === 'TRSP' && (
                  <FormControlLabel
                    control={
                      <Switch size="small" checked={stFlagTrans === 'Y'}
                        onChange={(e) => setStFlagTrans(e.target.checked ? 'Y' : 'N')} />
                    }
                    label={<Typography variant="body2">Interstate</Typography>}
                  />
                )}
              </Stack>

              {/* Row 3: Description / Note / GST */}
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <TextField size="small" label="Description" value={billDesc1}
                  onChange={(e) => setBillDesc1(e.target.value)} sx={{ flexGrow: 1, minWidth: 180 }} />
                <TextField size="small" label="Note" value={billNote}
                  onChange={(e) => setBillNote(e.target.value)} sx={{ flexGrow: 1, minWidth: 180 }} />
                <TextField size="small" label="GST No" value={gstNo}
                  onChange={(e) => setGstNo(e.target.value)} sx={{ width: 160 }} />
              </Stack>
            </Stack>
          </Paper>

          {/* ── Bills View Panel (fraBillView / vfgBillView) ── */}
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel>FA Year</InputLabel>
                <Select value={faYear} label="FA Year" onChange={(e) => setFaYear(e.target.value)}>
                  {formData.faYears.map((fy) => (
                    <MenuItem key={fy.FaYear} value={fy.FaYear}>{fy.FaYear}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="outlined" size="small" onClick={loadBills} disabled={billsLoading}>
                {billsLoading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                Load Bills
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              {can('BILL_GEN', 'CanAdd') && (
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew}
                  disabled={!fkPartyID || !fkCompID}>
                  New Bill
                </Button>
              )}
            </Stack>

            <TableContainer sx={{ maxHeight: 400, overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['Bill Date', 'Bill No', 'Type', 'Party', 'Company', 'Gross', 'Net', 'Status'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, bgcolor: 'grey.100', whiteSpace: 'nowrap' }}>
                        {h}
                      </TableCell>
                    ))}
                    <TableCell sx={{ fontWeight: 700, fontSize: 11, bgcolor: 'grey.100' }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 3, color: 'text.secondary', fontSize: 12 }}>
                        {billsLoading ? 'Loading…' : 'No bills found. Click "Load Bills" to search.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {bills.map((b) => (
                    <TableRow key={b.pkBillID} hover
                      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                      onClick={() => loadBillForModify(b)}>
                      <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{b.BillDt?.slice(0, 10)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{b.BillNum}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Chip label={BILL_TYPE_LABELS[b.BillType] || b.BillType}
                          size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{b.pName}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{b.compAlias || b.fkCompID}</TableCell>
                      <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{fmt(b.GrossAmt)}</TableCell>
                      <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{fmt(b.NetAmt)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Chip label={b.BillStatus === 'Y' ? 'Paid' : 'Open'}
                          color={b.BillStatus === 'Y' ? 'success' : 'default'}
                          size="small" sx={{ fontSize: 10, height: 20 }} />
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); loadBillForModify(b); }}>
                            <EditIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB 1 — Bill Entry (fraEntryView + vfgTransEnt)
          VB6: udfGenBill, udfAddBill2Detail, vfgTransEnt_AfterEdit
          ════════════════════════════════════════════════════════════════════ */}
      {tab === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', overflow: 'hidden' }}>
          {/* Header summary */}
          <Paper sx={{ p: 1.5, mb: 1, flexShrink: 0 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap" alignItems="center">
              <Typography variant="body2">
                <b>Party:</b> {selectedParty?.pName || fkPartyID}
              </Typography>
              <Typography variant="body2">
                <b>Type:</b> {BILL_TYPE_LABELS[billType]}
              </Typography>
              <Typography variant="body2">
                <b>Period:</b> {billFrom} → {billTo}
              </Typography>
              <Typography variant="body2">
                <b>Mode:</b> {kgTonFlg === 'K' ? 'Kilogram' : 'Ton'}
              </Typography>
              {editMode === 'modify' && (
                <Chip label={`Modify: ${editBillNum || editBillID}`} color="warning" size="small" />
              )}
            </Stack>
          </Paper>

          {/* Action bar */}
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexShrink: 0 }} flexWrap="wrap">
            <Button variant="outlined" size="small" startIcon={<AddIcon />}
              onClick={openTxnDialog} disabled={saving}>
              Add Transaction
            </Button>
            <Button variant="outlined" size="small" startIcon={<AddIcon />}
              onClick={addItemRow} disabled={saving}>
              Add Item
            </Button>
            <Button variant="outlined" size="small" startIcon={<AddIcon />}
              onClick={addGenRow} disabled={saving}>
              Add General
            </Button>
            <Button variant="outlined" size="small" color="error"
              startIcon={<DeleteOutlinedIcon />}
              onClick={removeSelectedLine}
              disabled={!selectedLineKey || saving}>
              Remove Row
            </Button>
          </Stack>

          {/* Line items grid (vfgTransEnt) — flex: 1 fills remaining height; stickyHeader keeps columns visible */}
          <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto', minHeight: 0, mb: 1 }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'auto', minWidth: 1100 }}>
              <TableHead>
                <TableRow>
                  {[
                    { h: 'Sr',   w: 32 },
                    { h: 'Type', w: 46 },
                    { h: 'Date', w: 96 },
                    { h: 'Lot',  w: 60 },
                    { h: 'Item', w: 110, auto: true },
                    { h: 'Description', w: 120, auto: true },
                    { h: 'Qty',  w: 60 },
                    { h: 'Pack', w: 95 },
                    { h: 'Wt(g)', w: 55 },
                    { h: 'Tons',  w: 65 },
                    { h: 'Amount', w: 80 },
                    { h: 'Rate',   w: 72 },
                    { h: 'Hamali', w: 92 },
                    { h: 'From',   w: 80, auto: true },
                    { h: 'To',     w: 80, auto: true },
                  ].map(({ h, w, auto }) => (
                    <TableCell key={h} sx={{
                      fontWeight: 700, fontSize: 11, p: '4px 5px',
                      bgcolor: 'grey.200', whiteSpace: 'nowrap',
                      ...(auto ? { minWidth: w } : { width: w, minWidth: w }),
                    }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {billableLines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={15} align="center"
                      sx={{ py: 4, color: 'text.secondary', fontSize: 12 }}>
                      No line items. Use the buttons above to add transactions, items, or general charges.
                    </TableCell>
                  </TableRow>
                )}
                {visibleLines.map((l, idx) => (
                  <BillRow
                    key={l._key}
                    line={l}
                    idx={idx}
                    kgTonFlg={kgTonFlg}
                    packingList={formData.packingList}
                    isSelected={l._key === selectedLineKey}
                    onUpdate={updateLine}
                    onSelect={setSelectedLineKey}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Totals row */}
          <Paper sx={{ p: 1.5, mb: 1, flexShrink: 0 }}>
            <Stack direction="row" spacing={4} alignItems="center">
              <Typography variant="body1">
                <b>Gross Amount: </b>
                <Typography component="span" variant="body1" color="primary.main" fontWeight={700}>
                  ₹ {fmt(grossAmt)}
                </Typography>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Tax amounts are calculated by the server when the bill is generated.
              </Typography>
            </Stack>
          </Paper>

          {/* Bottom action bar */}
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ flexShrink: 0 }}>
            {can('BILL_GEN', 'CanAdd') && (
              <Button variant="contained" color="primary" startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                onClick={handleGenerate} disabled={saving || deleting}>
                {editMode === 'modify' ? 'Update Bill' : 'Generate Bill'}
              </Button>
            )}
            {can('BILL_GEN', 'CanDelete') && editMode === 'modify' && (
              <Button variant="outlined" color="error" startIcon={deleting ? <CircularProgress size={14} /> : <DeleteIcon />}
                onClick={handleDelete} disabled={saving || deleting}>
                Delete Bill
              </Button>
            )}
            {can('BILL_GEN', 'CanExport') && billableLines.length > 0 && (
              <Button variant="outlined" startIcon={<FileDownloadIcon />}
                onClick={handleExport} disabled={saving}>
                Export CSV
              </Button>
            )}
            <Button variant="outlined" color="inherit" startIcon={<RestartAltIcon />}
              onClick={handleCancel} disabled={saving || deleting}>
              Cancel
            </Button>
          </Stack>
        </Box>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Transaction Selection Dialog (VB6: udfOpRecSet / udfPopRecd)
          Popup to pick billable stock entries for "Add Transaction"
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={txnOpen} onClose={() => setTxnOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          Select Transactions to Bill
          <Typography variant="caption" display="block" color="text.secondary">
            Showing unbilled entries (HmlBillAmt ≠ 0, OpFlg = N) for {selectedParty?.pName || '—'}, {billFrom} → {billTo}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ px: 2, pt: 1, pb: 1 }}>
            <TextField size="small" placeholder="Search by item or lot…" value={txnSearch}
              onChange={(e) => setTxnSearch(e.target.value)} fullWidth />
          </Box>
          {txnLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: 'grey.100' }}>
                      <Checkbox size="small"
                        checked={txnFilteredRows.length > 0 && txnFilteredRows.every((r) => txnSelected.has(r.pkTransID))}
                        indeterminate={txnFilteredRows.some((r) => txnSelected.has(r.pkTransID)) &&
                                      !txnFilteredRows.every((r) => txnSelected.has(r.pkTransID))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTxnSelected(new Set(txnFilteredRows.map((r) => r.pkTransID)));
                          } else {
                            setTxnSelected(new Set());
                          }
                        }} />
                    </TableCell>
                    {['Type', 'Date', 'Lot #', 'D.O. No', 'Item', 'Qty', 'Packing', 'Wt(g)', 'Hamali Recd', 'Hamali Amt', 'Bill Amt'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, bgcolor: 'grey.100', whiteSpace: 'nowrap' }}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {txnFilteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} align="center" sx={{ py: 3, color: 'text.secondary', fontSize: 12 }}>
                        No billable transactions found for the selected party and date range.
                      </TableCell>
                    </TableRow>
                  )}
                  {txnFilteredRows.map((r) => {
                    const checked = txnSelected.has(r.pkTransID);
                    return (
                      <TableRow key={r.pkTransID}
                        hover
                        selected={checked}
                        onClick={() => setTxnSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.pkTransID)) next.delete(r.pkTransID); else next.add(r.pkTransID);
                          return next;
                        })}
                        sx={{ cursor: 'pointer' }}>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={checked} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Chip label={r.TransType} size="small" sx={txnTypeChipSx(r.TransType)} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.TransDt ? r.TransDt.split('-').reverse().join('-') : ''}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.LotNum}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.DoNum}</TableCell>
                        <TableCell sx={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ItemName}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{r.TransQty}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.Packing}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{r.PackWght}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{fmt(r.HamaliRecd)}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'right' }}>{fmt(r.HamaliAmt)}</TableCell>
                        <TableCell sx={{ fontSize: 12, textAlign: 'right', fontWeight: 600, color: 'primary.main' }}>{fmt(r.HmlBillAmt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
            {txnSelected.size} selected
          </Typography>
          <Button onClick={() => setTxnOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addSelectedTxns} disabled={txnSelected.size === 0}>
            Add Selected ({txnSelected.size})
          </Button>
        </DialogActions>
      </Dialog>

      {/* Save Result Dialog */}
      <SaveResultDialog open={showResult} result={saveResult}
        onClose={() => { setShowResult(false); setSaveResult(null); }} />
    </Box>
  );
}
