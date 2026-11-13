// Transaction Rate Entry  (migrated from VB6 frmModRate.frm / frmTransRate)
//
// VB6 form: frmTransRate, caption "Transection Entry"
// Permission module: MOD_RATE
//
// Editable columns:
//   LotNum   — ARV rows only (required)
//   RentRate — ARV / DESPRET / IN rows only (required)
//
// Column filter row: comma-separated OR logic ("ARV,DESP" in Type column).
// Both header and filter rows are sticky.
// First column: Edit icon — opens the transaction form in a new tab.
// Footer row: totals for HamaliRecd, HamaliAmt, HmlBillAmt.
//
// FaYear mode: when "Filter by Financial Year" is checked the date pickers
// are disabled; the query uses the year's own StartDt–EndDt from FaYearInfo.
//
// "Show Zero Rent Rate" checkbox: unchecked (default) = show all rows;
// checked = show only rows where RentRate is 0 or blank.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableFooter, Checkbox, Grid, TextField, MenuItem, FormControlLabel,
  Chip, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import SearchIcon       from '@mui/icons-material/Search';
import EditIcon         from '@mui/icons-material/Edit';
import SaveIcon         from '@mui/icons-material/Save';
import CancelIcon       from '@mui/icons-material/Cancel';
import RestartAltIcon   from '@mui/icons-material/RestartAlt';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PrintIcon        from '@mui/icons-material/Print';
import ListAltIcon      from '@mui/icons-material/ListAlt';
import DescriptionIcon  from '@mui/icons-material/Description';
import CloseIcon        from '@mui/icons-material/Close';
import api from '../../services/api';
import { encodeId } from '../../utils/idCodec';

const STATIC_BASE = (import.meta.env.VITE_API_BASE_URL || '/api')
  .replace(/\/api\/?$/, '');

// ─── Utilities ────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }

function fmtDate(val) {
  if (!val) return '';
  const [, m, d] = String(val).slice(0, 10).split('-');
  const y = String(val).slice(2, 4);
  return `${d}-${m}-${y}`;
}

function fmtNum(val, dec = 2) {
  if (val === null || val === undefined || val === '') return '';
  const n = parseFloat(val);
  return isNaN(n) ? '' : n.toFixed(dec);
}

// Comma-separated OR filter: "ARV,DESP" → cell must contain "arv" or "desp"
function matchesFilter(cellValue, filterText) {
  if (!filterText) return true;
  const terms = filterText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return true;
  const cell = String(cellValue ?? '').toLowerCase();
  return terms.some((t) => cell.includes(t));
}

function downloadCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const body = rows.map((r) =>
    columns.map((c) => {
      const val = c.csvVal ? c.csvVal(r) : (r[c.key] ?? '');
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `mod-rate-${today()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Transaction type meta ────────────────────────────────────────────────────
const TYPE_LABELS = { ARV: 'Arrival', DESP: 'Dispatch', DESPRET: 'Return', TRF: 'Transfer', IN: 'IN', OUT: 'OUT' };
const TYPE_COLORS = { ARV: 'success', DESP: 'error', DESPRET: 'warning', TRF: 'info', IN: 'primary', OUT: 'secondary' };

// Build the edit-form URL for a row (opens in new tab)
// DB stores FaYear as 4-char '2627'; upload folders use full '2026-2027'.
function toFaYearFull(raw) {
  if (!raw || raw.length !== 4) return raw || '';
  return `20${raw.slice(0, 2)}-20${raw.slice(2, 4)}`;
}

function getEditUrl(row) {
  const id = encodeId(row.pkTransID);
  switch (row.TransType) {
    case 'ARV': case 'IN': case 'DESPRET':  return `/transactions/arrivals/${id}/edit`;
    case 'DESP': case 'TRF': case 'OUT':    return `/transactions/dispatches/${id}/edit`;
    default:                                 return null;
  }
}

// ─── Column definitions ───────────────────────────────────────────────────────
// editable: false | 'arv_di' (ARV/DESPRET/IN) | 'arv'
// fmt(val, row) — display value; csvVal(row) — CSV value for computed columns
const COLUMNS = [
  { key: 'TransType',      label: 'Type',        editable: false,    width: 72  },
  { key: 'TransDt',        label: 'Date',        editable: false,    width: 82,  fmt: (v) => fmtDate(v) },
  { key: 'TransTm',        label: 'Time',        editable: false,    width: 50  },
  { key: 'LotNum',         label: 'Lot No',      editable: 'arv',    width: 80  },
  { key: 'pName',          label: 'Party',       editable: false,    width: 140 },
  {
    key: '_item',           label: 'Item',        editable: false,    width: 170,
    fmt: (_, row) => `${row?.iName || ''}${row?.ItemExtDesc ? ' ' + row.ItemExtDesc : ''}`,
    csvVal: (row) => `${row.iName || ''}${row.ItemExtDesc ? ' ' + row.ItemExtDesc : ''}`,
    filterKey: 'iName',
  },
  { key: 'TransQty',       label: 'Qty',         editable: false,    width: 55,  fmt: (v) => fmtNum(v, 0) },
  { key: 'Packing',        label: 'Packing',     editable: false,    width: 62 },
  { key: 'PackWght',       label: 'Pack Wt',     editable: false,    width: 68,  fmt: (v) => fmtNum(v, 3) },
  { key: 'GrossWght',      label: 'Gross Wt',    editable: false,    width: 68,  fmt: (v) => fmtNum(v, 3) },
  { key: 'GatePass',       label: 'Gate Pass',   editable: false,    width: 76  },
  { key: 'RentRate',       label: 'Rent Rate',   editable: 'arv_di', width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'gNum',           label: 'Godown',      editable: false,    width: 65  },
  { key: 'HamaliCode',     label: 'Hml Code',    editable: false,    width: 72  },
  { key: 'HamaliRecd',     label: 'Hml Recd',    editable: false,    width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'HamaliAmt',      label: 'Hml Amt',     editable: false,    width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'HmlBillAmt',     label: 'Hml Bill',    editable: false,    width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'OutsideLabr',    label: 'Out Labr',    editable: false,    width: 62  },
  { key: 'OtherHmlAmt',    label: 'Oth Hml',     editable: false,    width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'DoNum',          label: 'DO No.',      editable: false,    width: 76  },
  { key: 'VehiNum',        label: 'Vehicle No',  editable: false,    autoWidth: true, minWidth: 90  },
  { key: 'OwnTransFlg',    label: 'Own Trns',    editable: false,    width: 62  },
  { key: 'TransExtDetail', label: 'Trans Desc',  editable: false,    autoWidth: true, minWidth: 110 },
  { key: 'ItemRate',       label: 'Item Rate',   editable: false,    width: 76,  fmt: (v) => fmtNum(v, 2) },
  { key: 'DelivOpt',       label: 'Deliv Opt',   editable: false,    width: 72  },
  { key: 'PickupBy',       label: 'Pickup By',   editable: false,    width: 90  },
  { key: 'BatchNum',       label: 'Batch No',    editable: false,    width: 76  },
  { key: 'ActualWght',     label: 'Actual Wt',   editable: false,    width: 76,  fmt: (v) => fmtNum(v, 3) },
  { key: 'TransRemark',    label: 'Remark',      editable: false,    width: 120 },
  { key: 'UserID',         label: 'User',        editable: false,    width: 65  },
  { key: 'compAlias',      label: 'Co',          editable: false,    width: 45  },
];

// Columns that show totals in the footer
const TOTAL_COLS = new Set(['HamaliRecd', 'HamaliAmt', 'HmlBillAmt']);

// Whether a column is editable for a given row
function isColumnEditable(row, col) {
  if (col.editable === 'arv_di') return ['ARV', 'DESPRET', 'IN'].includes(row.TransType);
  if (col.editable === 'arv')    return row.TransType === 'ARV';
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ModRatePage() {
  const { can } = useAuth();
  // ── Filter panel ─────────────────────────────────────────────────────────────
  const [useFaYear,  setUseFaYear]  = useState(false);
  const [faYears,    setFaYears]    = useState([]);   // [{ faYear, startDt, endDt }]
  const [faYear,     setFaYear]     = useState('');
  const [startDate,  setStartDate]  = useState(today());
  const [endDate,    setEndDate]    = useState(today());
  const [transTypes, setTransTypes] = useState({ ARV: true, DESP: true, DESPRET: true, TRF: true, IN: true, OUT: true });
  const [showZeroRate, setShowZeroRate] = useState(false); // false = hide zero-rate rows

  // ── Grid ─────────────────────────────────────────────────────────────────────
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // ── Edit ─────────────────────────────────────────────────────────────────────
  const [editMode,     setEditMode]     = useState(false);
  const [editValues,   setEditValues]   = useState({});  // { pkTransID: { colKey: value } }
  const [modifiedKeys, setModifiedKeys] = useState(new Set());
  const [saving,       setSaving]       = useState(false);

  // ── Column filters ────────────────────────────────────────────────────────────
  const [colFilters, setColFilters] = useState({});

  // ── Doc viewer ───────────────────────────────────────────────────────────────
  const [docExists,   setDocExists]   = useState({});  // { pkTransID: boolean } — pre-loaded on view
  const [fetchedDocs, setFetchedDocs] = useState({});  // { pkTransID: doc[] }   — loaded on click
  const [docDialog,   setDocDialog]   = useState({ open: false, docs: [] });

  // ── Sticky header height measurement ─────────────────────────────────────────
  const headerRowRef = useRef(null);
  const [filterTop, setFilterTop] = useState(28);
  useEffect(() => {
    if (headerRowRef.current) {
      setFilterTop(headerRowRef.current.getBoundingClientRect().height);
    }
  });

  // ─── Load FaYears (returns [{ faYear, startDt, endDt }]) ──────────────────
  useEffect(() => {
    api.get('/transactions/mod-rate/fa-years')
      .then(({ data }) => {
        setFaYears(data);
        if (data.length) setFaYear(data[0].faYear);
      })
      .catch(() => {});
  }, []);

  // When FaYear selection changes, auto-fill the date range fields (display only)
  useEffect(() => {
    if (!useFaYear || !faYear) return;
    const yr = faYears.find((y) => y.faYear === faYear);
    if (yr) {
      setStartDate(yr.startDt || today());
      setEndDate(yr.endDt   || today());
    }
  }, [useFaYear, faYear, faYears]);

  // ─── Print helpers ─────────────────────────────────────────────────────────
  // Ref keeps the latest filteredRows accessible in openPrintReport without
  // placing it in the dep array (filteredRows is declared later in the file).
  const filteredRowsRef = useRef([]);

  const openPrintReport = useCallback(async (endpoint) => {
    setError(''); setSuccess('');
    const selectedTypes = Object.entries(transTypes).filter(([, v]) => v).map(([k]) => k);
    if (!selectedTypes.length) { setError('Select at least one transaction type.'); return; }
    setLoading(true);
    try {
      // Resolve colFilters: map column key → actual row field name.
      // For hamali-list, skip TransType — hamali records span all types and
      // a TransType column filter would exclude valid billing rows.
      const skipForHamali = new Set(['TransType']);
      const resolvedFilters = {};
      for (const [key, txt] of Object.entries(colFilters)) {
        if (!txt) continue;
        if (endpoint === 'hamali-list' && skipForHamali.has(key)) continue;
        const col = COLUMNS.find((c) => c.key === key);
        resolvedFilters[col?.filterKey || key] = txt;
      }

      const resp = await api.post(`/transactions/mod-rate/${endpoint}`, {
        startDate,
        endDate,
        faYear:     useFaYear ? faYear : undefined,
        useFaYear,
        transTypes: selectedTypes,
        // daily-report: send filtered rows so the print matches the grid exactly
        // hamali-list:  always re-queries DB (HmlBillAmt <> 0 filter), but receives colFilters
        ...(endpoint === 'daily-report'
          ? { rows: rows.length > 0 ? filteredRowsRef.current : undefined }
          : { colFilters: resolvedFilters }),
      }, { responseType: 'text' });
      const newWin = window.open('', '_blank');
      if (newWin) { newWin.document.write(resp.data); newWin.document.close(); }
    } catch (e) {
      let msg = 'Report generation failed.';
      try {
        const raw = e.response?.data;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        msg = parsed.error || msg;
      } catch (_) {}
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, faYear, useFaYear, transTypes, rows]);

  // ─── View ──────────────────────────────────────────────────────────────────
  const handleView = useCallback(async () => {
    setError(''); setSuccess('');
    const selectedTypes = Object.entries(transTypes).filter(([, v]) => v).map(([k]) => k);
    if (!selectedTypes.length) { setError('Select at least one transaction type.'); return; }

    // When FaYear mode is on, use the year's dates (already stored in startDate/endDate)
    setLoading(true);
    setRows([]);
    setEditMode(false); setEditValues({}); setModifiedKeys(new Set());
    try {
      const { data } = await api.post('/transactions/mod-rate/entries', {
        startDate,
        endDate,
        faYear:     useFaYear ? faYear    : undefined,
        useFaYear,
        transTypes: selectedTypes,
      });
      setRows(data);
      // Pre-load doc existence — mirrors Balance Report logic:
      // ARV → check TransDocuments by pkTransID (check-lots → hasDocs)
      // others → check TransDocuments + PickupPhotos by transID (check-dispatch-docs)
      if (data.length) {
        const arvRows    = data.filter((r) => r.TransType === 'ARV' && r.LotNum);
        const nonArvRows = data.filter((r) => r.TransType !== 'ARV' && r.pkTransID);
        const merged     = {};
        const pending    = [];

        if (arvRows.length) {
          const lots = arvRows.map((r) => ({ lotNum: r.LotNum, transID: r.pkTransID }));
          pending.push(
            api.post('/uploads/check-lots', { lots })
              .then(({ data: lotInfo }) => {
                for (const r of arvRows)
                  merged[r.pkTransID] = !!(lotInfo[r.LotNum]?.hasDocs);
              }).catch(() => {})
          );
        }
        if (nonArvRows.length) {
          const entries = nonArvRows.map((r) => ({ transID: r.pkTransID, faYear: r.FaYear }));
          pending.push(
            api.post('/uploads/check-dispatch-docs', { entries })
              .then(({ data: docMap }) => Object.assign(merged, docMap))
              .catch(() => {})
          );
        }
        Promise.all(pending).then(() => setDocExists({ ...merged }));
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [useFaYear, faYear, startDate, endDate, transTypes]);

  // ─── Enter Edit mode ───────────────────────────────────────────────────────
  const handleEdit = () => {
    if (!rows.length) return;
    const init = {};
    for (const row of rows) {
      init[row.pkTransID] = {};
      for (const col of COLUMNS) {
        if (isColumnEditable(row, col)) {
          init[row.pkTransID][col.key] = row[col.key] ?? '';
        }
      }
    }
    setEditValues(init);
    setModifiedKeys(new Set());
    setEditMode(true);
    setError(''); setSuccess('');
  };

  const handleCellChange = (pkTransID, colKey, value) => {
    setEditValues((prev) => ({ ...prev, [pkTransID]: { ...(prev[pkTransID] || {}), [colKey]: value } }));
    setModifiedKeys((prev) => new Set(prev).add(pkTransID));
  };

  const handleCancel = () => {
    setEditMode(false); setEditValues({}); setModifiedKeys(new Set()); setError('');
  };

  const handleReset = () => {
    setUseFaYear(false);
    setFaYear(faYears.length ? faYears[0].faYear : '');
    setStartDate(today());
    setEndDate(today());
    setTransTypes({ ARV: true, DESP: true, DESPRET: true, TRF: true, IN: true, OUT: true });
    setShowZeroRate(false);
    setColFilters({});
    setRows([]);
    setEditMode(false); setEditValues({}); setModifiedKeys(new Set());
    setDocExists({});
    setFetchedDocs({});
    setError(''); setSuccess('');
  };

  // ─── Doc click ────────────────────────────────────────────────────────────
  const handleDocClick = async (row) => {
    const id = row.pkTransID;
    let docs = fetchedDocs[id];
    if (docs === undefined) {
      try {
        if (row.TransType === 'ARV') {
          // Arrival docs in TransDocuments/ keyed by pkTransID
          const { data } = await api.get('/uploads/arrival', { params: { transID: id } });
          docs = data;
        } else {
          const transDocs = await api.get('/uploads/trans-docs', { params: { transID: id } })
            .then((r) => r.data).catch(() => []);
          if (['DESP', 'TRF', 'OUT'].includes(row.TransType)) {
            const compCode = id.split('!')[0];
            const pickupFiles = await api.get('/uploads/pickup-photo', {
              params: { compCode, gatePass: row.GatePass || '', faYear: toFaYearFull(row.FaYear) },
            }).then((r) => r.data.url ? [{ filename: 'Pickup Photo', url: r.data.url }] : [])
              .catch(() => []);
            docs = [...pickupFiles, ...transDocs];
          } else {
            docs = transDocs;
          }
        }
      } catch {
        docs = [];
      }
      setFetchedDocs((prev) => ({ ...prev, [id]: docs }));
      if (docs.length > 0) setDocExists((prev) => ({ ...prev, [id]: true }));
    }
    setDocDialog({ open: true, docs });
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!modifiedKeys.size) { setEditMode(false); return; }
    setError(''); setSuccess('');

    const payload = [];
    for (const pkTransID of modifiedKeys) {
      const orig   = rows.find((r) => r.pkTransID === pkTransID);
      const merged = { ...orig, ...(editValues[pkTransID] || {}) };

      if (['ARV', 'DESPRET', 'IN'].includes(orig.TransType) && !String(merged.RentRate ?? '').trim()) {
        setError(`Lot ${orig.LotNum}: Rent Rate cannot be blank.`); return;
      }
      if (orig.TransType === 'ARV' && !String(merged.LotNum ?? '').trim()) {
        setError(`Lot ${orig.LotNum}: Lot No cannot be blank.`); return;
      }
      payload.push(merged);
    }

    setSaving(true);
    try {
      const { data } = await api.put('/transactions/mod-rate/entries', { rows: payload });
      setRows((prev) =>
        prev.map((r) => modifiedKeys.has(r.pkTransID) ? { ...r, ...(editValues[r.pkTransID] || {}) } : r)
      );
      setEditMode(false); setEditValues({}); setModifiedKeys(new Set());
      setSuccess(`Saved ${data.updated} record(s).`);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Trans type helpers ───────────────────────────────────────────────────
  const allChecked  = Object.values(transTypes).every(Boolean);
  const someChecked = Object.values(transTypes).some(Boolean);

  // ─── Filtered rows ────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let r = rows;
    // Checked = show only zero-rent-rate rows; unchecked = show all
    if (showZeroRate) r = r.filter((row) => !parseFloat(row.RentRate));
    for (const [key, txt] of Object.entries(colFilters)) {
      if (!txt) continue;
      const col = COLUMNS.find((c) => c.key === key);
      const fk  = col?.filterKey || key;
      r = r.filter((row) => matchesFilter(row[fk], txt));
    }
    // Sort: Date desc → TransType asc → GatePass desc
    r = [...r].sort((a, b) => {
      if (b.TransDt !== a.TransDt) return b.TransDt.localeCompare(a.TransDt);
      const tCmp = (a.TransType || '').localeCompare(b.TransType || '');
      if (tCmp !== 0) return tCmp;
      return String(b.GatePass || '').localeCompare(String(a.GatePass || ''));
    });
    return r;
  }, [rows, showZeroRate, colFilters]);
  filteredRowsRef.current = filteredRows;

  // ─── Column totals (HamaliRecd, HamaliAmt, HmlBillAmt) ───────────────────
  const totals = useMemo(() => ({
    HamaliRecd: filteredRows.reduce((s, r) => s + (parseFloat(r.HamaliRecd) || 0), 0),
    HamaliAmt:  filteredRows.reduce((s, r) => s + (parseFloat(r.HamaliAmt)  || 0), 0),
    HmlBillAmt: filteredRows.reduce((s, r) => s + (parseFloat(r.HmlBillAmt) || 0), 0),
  }), [filteredRows]);

  // ─── Cell renderer ────────────────────────────────────────────────────────
  const renderCell = (row, col) => {
    const editable = editMode && isColumnEditable(row, col);
    if (editable) {
      const val     = editValues[row.pkTransID]?.[col.key] ?? '';
      const isDirty = modifiedKeys.has(row.pkTransID);
      return (
        <input
          value={val}
          onChange={(e) => handleCellChange(row.pkTransID, col.key, e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '1px 4px',
            border: `1px solid ${isDirty ? '#1976d2' : '#f9a825'}`,
            borderRadius: 2,
            background: isDirty ? '#e3f2fd' : '#fffde7',
          }}
        />
      );
    }
    if (col.key === 'TransType') {
      const raw = row.TransType;
      return <Chip label={TYPE_LABELS[raw] || raw || ''} color={TYPE_COLORS[raw] || 'default'} size="small" sx={{ fontSize: 10, height: 18 }} />;
    }
    const raw = row[col.key];
    return col.fmt ? col.fmt(raw, row) : (raw ?? '');
  };

  // ─── Sticky cell styles ───────────────────────────────────────────────────
  const sxTh = (col, extra = {}) => ({
    position: 'sticky', top: 0, zIndex: 3,
    ...(col.autoWidth ? { minWidth: col.minWidth } : { width: col.width, minWidth: col.width }),
    fontWeight: 700, fontSize: 11, p: '4px 5px',
    background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e0e0e0',
    borderRight: '1px solid', borderRightColor: 'divider',
    whiteSpace: 'nowrap',
    color: col.editable && col.editable !== false ? 'primary.main' : 'inherit',
    ...extra,
  });

  const sxFilter = (col) => ({
    position: 'sticky', top: `${filterTop}px`, zIndex: 2,
    ...(col.autoWidth ? { minWidth: col.minWidth } : { width: col.width, minWidth: col.width }),
    p: '2px 3px',
    background: (t) => t.palette.mode === 'dark' ? '#111' : '#f5f5f5',
    borderRight: '1px solid', borderRightColor: 'divider',
    verticalAlign: 'top',
  });

  const sxFooter = (col) => ({
    fontWeight: 700, fontSize: 12,
    p: '3px 5px',
    background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e8f5e9',
    borderRight: '1px solid', borderRightColor: 'divider',
    borderTop: '2px solid', borderTopColor: 'divider',
    whiteSpace: 'nowrap',
    ...(col.autoWidth ? { minWidth: col.minWidth } : { width: col.width, minWidth: col.width }),
    color: TOTAL_COLS.has(col.key) ? 'success.dark' : 'text.secondary',
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Transaction Rate Entry</Typography>

      {/* ── Filter Panel ── */}
      <Paper sx={{ p: 2, mb: 2, flexShrink: 0 }}>
        <Grid container spacing={2} alignItems="flex-end">

          {/* FaYear toggle + selector */}
          <Grid size={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Checkbox checked={useFaYear}
                    onChange={(e) => {
                      setUseFaYear(e.target.checked);
                      // Restore manual dates when switching off
                      if (!e.target.checked) { setStartDate(today()); setEndDate(today()); }
                    }}
                  />
                }
                label="Filter by Financial Year"
              />
              {useFaYear && (
                <TextField select size="small" label="Financial Year" sx={{ minWidth: 140 }}
                  value={faYear} onChange={(e) => setFaYear(e.target.value)}>
                  {faYears.map((y) => <MenuItem key={y.faYear} value={y.faYear}>{y.faYear}</MenuItem>)}
                </TextField>
              )}
            </Box>
          </Grid>

          {/* Date range — disabled when FaYear mode is on */}
          <Grid size={2}>
            <TextField fullWidth size="small" label="From Date" type="date"
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={useFaYear}
            />
          </Grid>
          <Grid size={2}>
            <TextField fullWidth size="small" label="To Date" type="date"
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={useFaYear}
            />
          </Grid>

          {/* Trans type checkboxes */}
          <Grid size={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ mr: 1 }}>Trans Types:</Typography>
              <FormControlLabel
                control={
                  <Checkbox checked={allChecked} indeterminate={!allChecked && someChecked}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setTransTypes({ ARV: v, DESP: v, DESPRET: v, TRF: v, IN: v, OUT: v });
                    }}
                  />
                }
                label="All"
              />
              {Object.keys(transTypes).map((t) => (
                <FormControlLabel key={t}
                  control={
                    <Checkbox size="small" checked={transTypes[t]}
                      onChange={(e) => setTransTypes((p) => ({ ...p, [t]: e.target.checked }))} />
                  }
                  label={TYPE_LABELS[t]}
                />
              ))}
            </Box>
          </Grid>

          {/* Show Zero Rent Rate checkbox */}
          <Grid size={12}>
            <FormControlLabel
              control={
                <Checkbox size="small" checked={showZeroRate}
                  onChange={(e) => setShowZeroRate(e.target.checked)} />
              }
              label="Show Zero Rent Rate"
            />
          </Grid>
        </Grid>

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="contained" startIcon={<SearchIcon />}
            onClick={handleView} disabled={loading || saving}>
            {loading && <CircularProgress size={14} sx={{ mr: 1 }} />}
            View
          </Button>

          {!editMode ? (
            <Button variant="outlined" startIcon={<EditIcon />}
              onClick={handleEdit} disabled={!rows.length || loading || !can('MOD_RATE', 'CanEdit')}>
              Edit
            </Button>
          ) : (
            <>
              <Button variant="contained" color="success" startIcon={<SaveIcon />}
                onClick={handleSave} disabled={saving}>
                {saving && <CircularProgress size={14} sx={{ mr: 1 }} />}
                Save
              </Button>
              <Button variant="outlined" color="error" startIcon={<CancelIcon />}
                onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            </>
          )}

          <Button variant="outlined" color="inherit" startIcon={<RestartAltIcon />}
            onClick={handleReset} disabled={loading || saving}>
            Cancel
          </Button>

          {can('MOD_RATE', 'CanExport') && (
            <Button variant="outlined" startIcon={<FileDownloadIcon />}
              onClick={() => downloadCsv(filteredRows, COLUMNS)} disabled={!filteredRows.length}>
              Export CSV
            </Button>
          )}

          {can('MOD_RATE', 'CanPrint') && (
            <Button variant="outlined" color="secondary" startIcon={<PrintIcon />}
              onClick={() => openPrintReport('daily-report')} disabled={loading || saving}>
              Daily Hamali List
            </Button>
          )}

          {can('MOD_RATE', 'CanPrint') && (
            <Button variant="outlined" color="secondary" startIcon={<ListAltIcon />}
              onClick={() => openPrintReport('hamali-list')} disabled={loading || saving}>
              Hamali List
            </Button>
          )}

          {editMode && modifiedKeys.size > 0 && (
            <Chip label={`${modifiedKeys.size} row(s) modified`} color="warning" size="small" />
          )}
        </Box>
      </Paper>

      {/* Alerts */}
      {error   && <Alert severity="error"   sx={{ mb: 1, whiteSpace: 'pre-wrap', flexShrink: 0 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 1, flexShrink: 0 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {rows.length > 0 && (
        <Typography variant="body2" sx={{ mb: 0.5, color: 'text.secondary', flexShrink: 0 }}>
          {filteredRows.length} of {rows.length} rows
          {editMode ? ' — yellow cells are editable for this row type' : ''}
        </Typography>
      )}

      {/* ── Main Grid ── */}
      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ tableLayout: 'auto', minWidth: COLUMNS.reduce((s, c) => s + (c.autoWidth ? (c.minWidth || 80) : c.width), 0) + 90 }}>

          <TableHead>
            {/* Column header row — sticky at top: 0 */}
            <TableRow ref={headerRowRef}>
              <TableCell sx={{
                position: 'sticky', top: 0, zIndex: 3,
                width: 44, minWidth: 44, fontWeight: 700, fontSize: 11, p: '4px 4px',
                background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e0e0e0',
                borderRight: '1px solid', borderRightColor: 'divider',
              }}>
                Edit
              </TableCell>
              <TableCell sx={{
                position: 'sticky', top: 0, zIndex: 3,
                width: 34, minWidth: 34, fontWeight: 700, fontSize: 11, p: '4px 4px',
                background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e0e0e0',
                borderRight: '1px solid', borderRightColor: 'divider',
              }}>
                Doc
              </TableCell>
              {COLUMNS.map((col) => (
                <TableCell key={col.key} sx={sxTh(col)}>
                  {col.label}
                </TableCell>
              ))}
            </TableRow>

            {/* Column filter row — sticky just below header row */}
            <TableRow>
              <TableCell sx={{
                position: 'sticky', top: `${filterTop}px`, zIndex: 2,
                width: 44, minWidth: 44, p: '2px 3px',
                background: (t) => t.palette.mode === 'dark' ? '#111' : '#f5f5f5',
                borderRight: '1px solid', borderRightColor: 'divider',
              }} />
              <TableCell sx={{
                position: 'sticky', top: `${filterTop}px`, zIndex: 2,
                width: 34, minWidth: 34, p: '2px 3px',
                background: (t) => t.palette.mode === 'dark' ? '#111' : '#f5f5f5',
                borderRight: '1px solid', borderRightColor: 'divider',
              }} />
              {COLUMNS.map((col) => {
                const filterVal = colFilters[col.key] || '';
                const terms = filterVal.split(',').map((t) => t.trim()).filter(Boolean);
                return (
                  <TableCell key={col.key} sx={sxFilter(col)}>
                    <input
                      placeholder="filter…"
                      value={filterVal}
                      onChange={(e) => setColFilters((prev) => ({ ...prev, [col.key]: e.target.value }))}
                      title="Comma-separated for OR (e.g. ARV,DESP)"
                      style={{
                        width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '1px 3px',
                        border: filterVal ? '1px solid #1976d2' : '1px solid #ccc', borderRadius: 2,
                      }}
                    />
                    {terms.length > 1 && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '1px', mt: '1px' }}>
                        {terms.map((t) => (
                          <Box key={t} component="span" sx={{ fontSize: 9, px: '3px', borderRadius: 1, background: '#1976d2', color: '#fff' }}>{t}</Box>
                        ))}
                      </Box>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>

          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 2} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            )}
            {!loading && !filteredRows.length && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 2} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                  No records. Set filters and click View.
                </TableCell>
              </TableRow>
            )}

            {filteredRows.map((row, idx) => {
              const isDirtyRow = editMode && modifiedKeys.has(row.pkTransID);
              const editUrl    = getEditUrl(row);
              return (
                <TableRow key={row.pkTransID} sx={{
                  background: isDirtyRow
                    ? (t) => t.palette.mode === 'dark' ? '#1a3a5c' : '#e3f2fd'
                    : idx % 2 === 0 ? 'transparent' : (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#fafafa',
                  '&:hover': { background: (t) => t.palette.mode === 'dark' ? '#2a2a2a' : '#f0f4ff' },
                }}>
                  {/* Edit icon — opens transaction form in new tab; blank for OUT/TRF */}
                  <TableCell sx={{ p: '1px 4px', width: 44, minWidth: 44, maxWidth: 44, borderRight: '1px solid', borderRightColor: 'divider', textAlign: 'center' }}>
                    {editUrl && (
                      <Tooltip title={`Edit ${TYPE_LABELS[row.TransType] || row.TransType}`} placement="right">
                        <IconButton size="small" onClick={() => window.open(editUrl, '_blank', 'noopener,noreferrer')} sx={{ p: '2px' }}>
                          <EditIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>

                  {/* Doc icon — orange when docs exist (pre-checked on load), gray otherwise */}
                  <TableCell sx={{ p: '1px 2px', width: 34, minWidth: 34, maxWidth: 34, borderRight: '1px solid', borderRightColor: 'divider', textAlign: 'center' }}>
                    <Tooltip title="View Documents" placement="right">
                      <IconButton size="small" onClick={() => handleDocClick(row)} sx={{ p: '2px' }}>
                        <DescriptionIcon sx={{
                          fontSize: 15,
                          color: docExists[row.pkTransID] ? '#e65100' : 'text.disabled',
                        }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>

                  {COLUMNS.map((col) => {
                    const cellEditable = editMode && isColumnEditable(row, col);
                    return (
                      <TableCell key={col.key} sx={{
                        p: '2px 5px', fontSize: 12,
                        borderRight: '1px solid', borderRightColor: 'divider',
                        ...(col.autoWidth
                          ? { minWidth: col.minWidth, whiteSpace: 'nowrap' }
                          : { width: col.width, minWidth: col.width, maxWidth: col.width, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                        ...(cellEditable ? { background: isDirtyRow ? '#dbeafe' : '#fffde7' } : {}),
                      }}>
                        {renderCell(row, col)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>

          {/* ── Totals footer ── sticky at bottom of scroll container */}
          {filteredRows.length > 0 && (
            <TableFooter sx={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
              <TableRow>
                {/* Edit column placeholder */}
                <TableCell sx={{
                  fontWeight: 700, fontSize: 12, p: '3px 5px',
                  background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e8f5e9',
                  borderRight: '1px solid', borderRightColor: 'divider',
                  borderTop: '2px solid', borderTopColor: 'divider',
                  width: 44, minWidth: 44,
                  color: 'text.secondary',
                }}>
                  Σ {filteredRows.length}
                </TableCell>
                {/* Doc column placeholder */}
                <TableCell sx={{
                  p: '3px 5px',
                  background: (t) => t.palette.mode === 'dark' ? '#1a1a1a' : '#e8f5e9',
                  borderRight: '1px solid', borderRightColor: 'divider',
                  borderTop: '2px solid', borderTopColor: 'divider',
                  width: 34, minWidth: 34,
                }} />
                {COLUMNS.map((col) => (
                  <TableCell key={col.key} sx={sxFooter(col)}>
                    {col.key === 'HamaliRecd' ? fmtNum(totals.HamaliRecd, 2)
                      : col.key === 'HamaliAmt'  ? fmtNum(totals.HamaliAmt,  2)
                      : col.key === 'HmlBillAmt' ? fmtNum(totals.HmlBillAmt, 2)
                      : col.key === 'pName'       ? 'Total'
                      : ''}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>

      {/* ── Document viewer dialog ── */}
      <Dialog open={docDialog.open} onClose={() => setDocDialog({ open: false, docs: [] })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          Documents
          <IconButton size="small" onClick={() => setDocDialog({ open: false, docs: [] })}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {docDialog.docs.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No documents saved for this entry.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {docDialog.docs.map((doc) => (
                <Chip
                  key={doc.filename}
                  label={doc.filename}
                  icon={<DescriptionIcon />}
                  component="a"
                  href={`${STATIC_BASE}${doc.url}`}
                  target="_blank"
                  rel="noreferrer"
                  clickable
                  size="small"
                />
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDocDialog({ open: false, docs: [] })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
