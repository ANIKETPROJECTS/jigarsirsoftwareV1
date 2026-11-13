// HamaliCalPage.jsx — Hamali Calculation Entry
// VB6 origin: frmHamaliCalEntry.frm
//
// Workflow (mirrors VB6):
//   1. Enter date range + header params → click Go  (POST /go: loads header from DB, builds date list, counts working days)
//   2. Verify params → click View              (POST /view: computes all 26 columns per row)
//   3. Edit yellow cells (CVarai, DepoBrd, BrdDate) inline; recalculates downstream on blur
//   4. [Optional] Calculate Balance Varai      (Monthly Varai - Cash Varai) / Working Days equally
//   5. [Optional] Calculate Board Depo Amt     (totDepoBrd = cBrdLbr + depoBrd per row)
//   6. Click Save                              (POST /save: upsert H1 + delete/re-insert H2)
//   7. Export to Excel (xlsx) — mirrors VB6 cmdExport_Click

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, TextField, Alert, CircularProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Divider, Tooltip,
} from '@mui/material';
import SaveIcon          from '@mui/icons-material/Save';
import SearchIcon        from '@mui/icons-material/Search';
import VisibilityIcon    from '@mui/icons-material/Visibility';
import CalculateIcon     from '@mui/icons-material/Calculate';
import FileDownloadIcon  from '@mui/icons-material/FileDownload';
import AddIcon           from '@mui/icons-material/Add';
import * as XLSX         from 'xlsx';
import api               from '../../services/api';
import { useAuth }       from '../../contexts/AuthContext';

// ── Column definitions (matches VB6 column order, visible cols only) ─────────
const COLS = [
  { key: 'date',         label: 'Date',               editable: false, width: 70 },
  { key: 'rowState',     label: 'State',              editable: false, width: 60,  hidden: true },
  { key: 'boardAttd',    label: 'Brd\nAttd',          editable: false, width: 30 },
  { key: 'otherAttnd',   label: 'Oth\nAttd',          editable: false, width: 40 },
  { key: 'cDaily',       label: 'Cash\nDaily',        editable: false, width: 80 },
  { key: 'cVarai',       label: 'CVarai',             editable: true,  width: 80,  yellow: true },
  { key: 'cComm',        label: 'Cash\nComm',         editable: false, width: 80 },
  { key: 'cBrdLbr',      label: 'Cash\nBrd Lbr',     editable: false, width: 80 },
  { key: 'cOthrLbr',     label: 'Cash\nOth Lbr',     editable: false, width: 80 },
  { key: 'cPerBrdAmt',   label: 'C Per\nBrd',         editable: false, width: 80 },
  { key: 'cPerOthrAmt',  label: 'C Per\nOth',         editable: false, width: 80 },
  { key: 'oDaily',       label: 'O/S\nDaily',         editable: false, width: 80 },
  { key: 'oVarai',       label: 'O/S Varai',          editable: false, width: 80 },
  { key: 'oComm',        label: 'O/S\nComm',          editable: false, width: 80 },
  { key: 'oBrdLbr',      label: 'O/S\nBrd Lbr',      editable: false, width: 80 },
  { key: 'oOthrLbr',     label: 'O/S\nOth Lbr',      editable: false, width: 80 },
  { key: 'depoBrd',      label: 'DepoBrd',            editable: true,  width: 80,  yellow: true },
  { key: 'totDepoBrd',   label: 'Tot\nDepoBrd',       editable: false, width: 80 },
  { key: 'oPerBrdAmt',   label: 'O Per\nBrd',         editable: false, width: 80 },
  { key: 'oPerOtherAmt', label: 'O Per\nOth',         editable: false, width: 80 },
  { key: 'outsdLbrAmt',  label: 'Outsd\nLbr Amt',    editable: false, width: 80 },
  { key: 'brdDate',      label: 'Brd Date',           editable: true,  width: 110, yellow: true },
  { key: 'totHamali',    label: 'Tot\nHamali',        editable: false, width: 80 },
  { key: 'totComm',      label: 'Tot\nComm',          editable: false, width: 80 },
];

const VISIBLE_COLS = COLS.filter(c => !c.hidden);

// ── Pure JS calculation helpers (mirror backend helpers) ──────────────────────
const r2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;

function calcCashHamali(row, commPerct) {
  const cp      = parseFloat(commPerct) || 0;
  const cComm   = r2((row.cDaily - row.cVarai) * cp / 100);
  const totLbr  = (row.boardAttd || 0) + (row.otherAttnd || 0);
  let cPerLbr   = 0;
  if (totLbr > 0) cPerLbr = (row.cDaily - row.cVarai - cComm) / totLbr;
  const cBrdLbr  = Math.round(cPerLbr * (row.boardAttd  || 0));
  const cOthrLbr = Math.round(cPerLbr * (row.otherAttnd || 0));
  return { cComm, cBrdLbr, cOthrLbr, cPerBrdAmt: cPerLbr, cPerOthrAmt: cPerLbr };
}

function calcOsHamali(row, commPerct) {
  const cp          = parseFloat(commPerct) || 0;
  const oComm       = r2((row.oDaily - row.oVarai - row.outsdLbrAmt) * cp / 100);
  const totLbr      = (row.boardAttd || 0) + (row.otherAttnd || 0);
  let oPerLbr       = 0;
  if (totLbr > 0)
    oPerLbr = (row.oDaily - row.oVarai - oComm - row.outsdLbrAmt) / totLbr;
  const oBrdLabAmt  = Math.round(oPerLbr * (row.boardAttd  || 0));
  const oBrdLbr     = oBrdLabAmt - (row.depoBrd || 0);
  const oPerBrdAmt  = (row.boardAttd || 0) > 0 ? oBrdLbr / row.boardAttd : 0;
  const oOthrLbr    = Math.round(oPerLbr * (row.otherAttnd || 0));
  const totHamali   = (row.cDaily || 0) + (row.oDaily || 0);
  const totComm     = (row.cComm  || 0) + oComm;
  return { oComm, oBrdLbr, oOthrLbr, oPerBrdAmt, oPerOtherAmt: oPerLbr, totHamali, totComm };
}

/** Re-derive all computed columns for a row after user edits a yellow cell */
function recompute(row, commPerct) {
  const cc = calcCashHamali(row, commPerct);
  const merged = { ...row, ...cc };
  const oc = calcOsHamali(merged, commPerct);
  return { ...merged, ...oc };
}

function getDefaultDates() {
  const today = new Date();
  const y  = today.getFullYear();
  const mo = today.getMonth() + 1;
  const mm = String(mo).padStart(2, '0');
  const lastDay = String(new Date(y, mo, 0).getDate()).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${lastDay}` };
}

const fmt2   = n => (parseFloat(n) || 0).toFixed(2);
const fmtI   = n => Math.round(parseFloat(n) || 0);
const fmtDate = s => s ? `${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}` : '';

// ─────────────────────────────────────────────────────────────────────────────
export default function HamaliCalPage() {
  const { can } = useAuth();
  const canAdd  = can('HAMALI', 'CanAdd');

  const { from: defFrom, to: defTo } = useMemo(getDefaultDates, []);

  const [fromDate,       setFromDate]       = useState(defFrom);
  const [toDate,         setToDate]         = useState(defTo);
  const [commPerct,      setCommPerct]      = useState('');
  const [totVaraiAmt,    setTotVaraiAmt]    = useState('');
  const [boardTonRate,   setBoardTonRate]   = useState('');
  const [boardLeavyPerct,setBoardLeavyPerct]= useState('');
  const [workingDays,    setWorkingDays]    = useState('');
  const [calVarai,       setCalVarai]       = useState('');   // Monthly Varai / Working days display

  const [dates,          setDates]          = useState([]);   // [{ date, isHoliday }]
  const [rows,           setRows]           = useState([]);   // grid rows (one per date)

  const [goLoading,      setGoLoading]      = useState(false);
  const [viewLoading,    setViewLoading]    = useState(false);
  const [saveLoading,    setSaveLoading]    = useState(false);
  const [alert,          setAlert]          = useState(null); // { type, msg }

  const [goRan,          setGoRan]          = useState(false);
  const [viewRan,        setViewRan]        = useState(false);

  const headerRowRef = useRef(null);
  const [headerRowH, setHeaderRowH] = useState(42);
  useEffect(() => {
    if (headerRowRef.current) setHeaderRowH(headerRowRef.current.offsetHeight);
  }, [rows.length]);

  // ── Reset form (called after save, or from New button) ────────────────────
  const resetForm = useCallback(() => {
    const { from, to } = getDefaultDates();
    setFromDate(from);
    setToDate(to);
    setCommPerct('');
    setTotVaraiAmt('');
    setBoardTonRate('');
    setBoardLeavyPerct('');
    setWorkingDays('');
    setCalVarai('');
    setDates([]);
    setRows([]);
    setGoRan(false);
    setViewRan(false);
  }, []);

  // ── Step 1: Go ─────────────────────────────────────────────────────────────
  // Loads header params + date list. If existing data found, fills header fields
  // so user can review before clicking View to load the grid.
  const handleGo = useCallback(async () => {
    if (!fromDate || !toDate) return setAlert({ type: 'warning', msg: 'Please select From and To dates.' });
    setGoLoading(true); setAlert(null); setRows([]); setViewRan(false);
    try {
      const { data } = await api.post('/transactions/hamali/go', { fromDate, toDate });
      setDates(data.dates);
      setWorkingDays(String(data.workingDays));
      if (data.header) {
        setCommPerct(String(data.header.tCommPerct));
        setTotVaraiAmt(String(data.header.tTotVaraiAmt));
        setBoardTonRate(String(data.header.tBoardTonRate));
        setBoardLeavyPerct(String(data.header.tBoardLeavyPerct));
        setAlert({ type: 'info', msg: 'Existing record found. Click View to load grid in Modify mode.' });
      }
      setGoRan(true);
    } catch (e) {
      setAlert({ type: 'error', msg: e.response?.data?.error || 'Failed to load header data' });
    } finally {
      setGoLoading(false);
    }
  }, [fromDate, toDate]);

  // ── Step 2: View ───────────────────────────────────────────────────────────
  const handleView = useCallback(async () => {
    if (!commPerct || !totVaraiAmt || !boardTonRate || !boardLeavyPerct)
      return setAlert({ type: 'warning', msg: 'Please fill in all header fields (Commission %, Varai, Ton Rate, Levy %).' });
    if (!goRan || dates.length === 0)
      return setAlert({ type: 'warning', msg: 'Please click Go first to load dates.' });

    setViewLoading(true); setAlert(null);
    try {
      const { data } = await api.post('/transactions/hamali/view', {
        fromDate, toDate, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct, dates,
      });
      setRows(data.rows);
      setViewRan(true);
      setCalVarai(''); // will be filled when user clicks Calc Balance Varai
    } catch (e) {
      setAlert({ type: 'error', msg: e.response?.data?.error || 'Failed to load grid data' });
    } finally {
      setViewLoading(false);
    }
  }, [fromDate, toDate, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct, dates, goRan, workingDays]);

  // ── Inline cell edit handlers ───────────────────────────────────────────────
  // VB6 AfterEdit: CVarai and DepoBrd trigger recalculation
  const handleCellChange = useCallback((rowIdx, key, val) => {
    setRows(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [key]: val };
      return next;
    });
  }, []);

  const handleCellBlur = useCallback((rowIdx, key, val) => {
    setRows(prev => {
      const next = [...prev];
      const row  = { ...next[rowIdx], [key]: parseFloat(val) || 0 };

      // VB6 validation: cVarai cannot exceed cDaily
      if (key === 'cVarai' && row.cVarai > row.cDaily) row.cVarai = 0;
      // VB6 validation: depoBrd cannot exceed oBrdLbr (checked before recalc)
      if (key === 'depoBrd' && row.depoBrd > row.oBrdLbr) row.depoBrd = 0;

      if (key === 'cVarai' || key === 'depoBrd') {
        next[rowIdx] = recompute(row, commPerct);
      } else {
        next[rowIdx] = row; // brdDate — no recalc needed
      }
      return next;
    });
  }, [commPerct]);

  // ── Tab key navigation across editable cells ──────────────────────────────
  // Tab   → next non-holiday row, same col; at last row → first row of next col
  // Shift+Tab → previous non-holiday row; at first row → last row of prev col
  const EDIT_KEYS = useMemo(() => VISIBLE_COLS.filter(c => c.editable).map(c => c.key), []);

  const handleCellKeyDown = useCallback((e, ri, colKey) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const dir      = e.shiftKey ? -1 : 1;
    const colIdx   = EDIT_KEYS.indexOf(colKey);

    // Walk rows in direction, skipping holidays
    let nextRi = ri + dir;
    while (nextRi >= 0 && nextRi < rows.length && rows[nextRi].isHoliday) nextRi += dir;

    let targetRi  = nextRi;
    let targetCol = colKey;

    if (nextRi < 0 || nextRi >= rows.length) {
      // Move to next/prev editable column
      const nextColIdx = colIdx + dir;
      if (nextColIdx < 0 || nextColIdx >= EDIT_KEYS.length) return;
      targetCol = EDIT_KEYS[nextColIdx];
      // Find first (or last) non-holiday row in new column
      if (dir === 1) {
        targetRi = rows.findIndex(r => !r.isHoliday);
      } else {
        targetRi = rows.length - 1;
        while (targetRi >= 0 && rows[targetRi].isHoliday) targetRi--;
      }
    }

    if (targetRi < 0 || targetRi >= rows.length) return;
    document.getElementById(`cell-${targetRi}-${targetCol}`)?.focus();
  }, [rows, EDIT_KEYS]);

  // ── Calculate Balance Varai ────────────────────────────────────────────────
  // Balance Varai = Monthly Varai - Cash Varai received (sum of all cVarai)
  // Then distribute equally: Balance Varai / Working Days per non-holiday row
  const handleCalBalVarai = useCallback(() => {
    const wdInt = parseInt(workingDays) || 1;
    const tv    = parseFloat(totVaraiAmt) || 0;

    const totalCashVarai = rows.reduce((s, r) => s + (parseFloat(r.cVarai) || 0), 0);
    const balVarai = r2(tv - totalCashVarai);

    if (balVarai < 0)
      return setAlert({ type: 'warning', msg: 'Balance Varai is negative. Check Cash Varai values.' });

    const oVaraiPerDay = r2(balVarai / wdInt);
    const cp = parseFloat(commPerct) || 0;

    setCalVarai(balVarai.toFixed(2));

    setRows(prev => prev.map(r => {
      if (r.isHoliday) return r;
      return recompute({ ...r, oVarai: oVaraiPerDay }, cp);
    }));

    setAlert({
      type: 'success',
      msg: `Balance Varai ₹${balVarai.toFixed(2)} ÷ ${wdInt} days = ₹${oVaraiPerDay.toFixed(2)}/day`,
    });
  }, [rows, workingDays, totVaraiAmt, commPerct]);

  // ── Calculate Board Depo Amt (VB6: cmdCalBrdAmt_Click) ────────────────────
  // totDepoBrd = cBrdLbr + depoBrd for each row
  const handleCalBrdAmt = useCallback(() => {
    setRows(prev => prev.map(r => ({
      ...r,
      totDepoBrd: (r.cBrdLbr || 0) + (r.depoBrd || 0),
    })));
    setAlert({ type: 'success', msg: 'Board Depo amounts recalculated.' });
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!viewRan || rows.length === 0) return;
    setSaveLoading(true); setAlert(null);
    try {
      const { data } = await api.post('/transactions/hamali/save', {
        fromDate, rows, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct,
      });
      const hasErrors = data.errors?.length > 0;
      // Reset form to blank state, then show result message
      resetForm();
      setAlert({
        type: hasErrors ? 'warning' : 'success',
        msg: `Saved ${data.saved} row(s) successfully.${hasErrors ? ' Errors: ' + data.errors.join('; ') : ''}`,
      });
    } catch (e) {
      setAlert({ type: 'error', msg: e.response?.data?.error || 'Save failed' });
    } finally {
      setSaveLoading(false);
    }
  }, [viewRan, rows, fromDate, commPerct, totVaraiAmt, boardTonRate, boardLeavyPerct, resetForm]);

  // ── Export to Excel (VB6: cmdExport_Click) ─────────────────────────────────
  const handleExport = useCallback(() => {
    if (rows.length === 0) return;
    const header = VISIBLE_COLS.map(c => c.label.replace('\n', ' '));
    const dataRows = rows.map(r =>
      VISIBLE_COLS.map(c => {
        if (c.key === 'date' || c.key === 'brdDate') return r[c.key] || '';
        if (c.key === 'rowState') return r[c.key] || '';
        if (c.key === 'boardAttd' || c.key === 'otherAttnd') return fmtI(r[c.key]);
        return fmt2(r[c.key]);
      })
    );
    // Totals row
    const totals = VISIBLE_COLS.map(c => {
      if (c.key === 'date') return 'TOTAL';
      if (['boardAttd', 'otherAttnd'].includes(c.key))
        return rows.reduce((s, r) => s + (parseInt(r[c.key]) || 0), 0);
      if (!['rowState', 'brdDate'].includes(c.key))
        return rows.reduce((s, r) => s + (parseFloat(r[c.key]) || 0), 0).toFixed(2);
      return '';
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows, totals]);
    // Color holiday rows green (xlsx doesn't support cell colours in free lib, skip)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hamali Calculation');
    XLSX.writeFile(wb, `HamaliCalEntry_${fromDate}_${toDate}.xlsx`);
  }, [rows, fromDate, toDate]);

  // ── Totals (mirrors VB6 fixed row) ─────────────────────────────────────────
  const totals = useMemo(() => {
    const t = {};
    for (const c of VISIBLE_COLS) {
      if (['date', 'rowState', 'brdDate'].includes(c.key)) continue;
      t[c.key] = rows.reduce((s, r) => s + (parseFloat(r[c.key]) || 0), 0);
    }
    return t;
  }, [rows]);

  // ─────────────────────────────────────────────────────────────────────────
  const inputSx = { '& input': { py: '4px', px: '6px', fontSize: '0.82rem' } };
  const labelSx = { fontSize: '0.78rem' };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom fontWeight={600}>
        Hamali Calculation Entry
      </Typography>

      {alert && (
        <Alert severity={alert.type} onClose={() => setAlert(null)} sx={{ mb: 1 }}>
          {alert.msg}
        </Alert>
      )}

      {/* ── Header Inputs ───────────────────────────────────────────────────── */}
      <Paper sx={{ p: 1.5, mb: 1.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end' }}>
          {/* Row 1: dates + Go */}
          <TextField
            label="From Date" type="date" size="small"
            value={fromDate} onChange={e => setFromDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ ...inputSx, width: 150 }}
          />
          <TextField
            label="To Date" type="date" size="small"
            value={toDate} onChange={e => setToDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ ...inputSx, width: 150 }}
          />
          <Button
            variant="contained" size="small" startIcon={goLoading ? <CircularProgress size={14} color="inherit" /> : <SearchIcon />}
            onClick={handleGo} disabled={goLoading}
          >
            Go
          </Button>
        </Box>

        <Divider sx={{ my: 1 }} />

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end' }}>
          <TextField
            label="Commission %" size="small" type="number"
            value={commPerct} onChange={e => setCommPerct(e.target.value)}
            sx={{ ...inputSx, width: 120 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <TextField
            label="Monthly Varai Amount" size="small" type="number"
            value={totVaraiAmt} onChange={e => setTotVaraiAmt(e.target.value)}
            sx={{ ...inputSx, width: 160 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <TextField
            label="Board Ton Rate" size="small" type="number"
            value={boardTonRate} onChange={e => setBoardTonRate(e.target.value)}
            sx={{ ...inputSx, width: 130 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <TextField
            label="Board Levy %" size="small" type="number"
            value={boardLeavyPerct} onChange={e => setBoardLeavyPerct(e.target.value)}
            sx={{ ...inputSx, width: 120 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <TextField
            label="Working Days" size="small" type="number"
            value={workingDays} disabled
            sx={{ ...inputSx, width: 110 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <TextField
            label="Balance Varai" size="small"
            value={calVarai} disabled
            sx={{ ...inputSx, width: 130 }} slotProps={{ inputLabel: { sx: labelSx } }}
          />
          <Button
            variant="contained" size="small" color="secondary"
            startIcon={viewLoading ? <CircularProgress size={14} color="inherit" /> : <VisibilityIcon />}
            onClick={handleView} disabled={viewLoading || !goRan}
          >
            View
          </Button>
        </Box>
      </Paper>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <TableContainer
        component={Paper}
        sx={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto', mb: 1.5 }}
      >
        <Table size="small" stickyHeader sx={{ minWidth: 2000, tableLayout: 'auto' }}>
          <TableHead>
            {/* Row 1 — column headers */}
            <TableRow ref={headerRowRef}>
              {VISIBLE_COLS.map(c => (
                <TableCell
                  key={c.key}
                  sx={{
                    ...(c.width ? { width: c.width, minWidth: c.width } : { whiteSpace: 'nowrap' }),
                    fontSize: '0.7rem', fontWeight: 700,
                    whiteSpace: 'pre-line', lineHeight: 1.2,
                    p: '4px 4px', textAlign: 'center',
                    backgroundColor: c.yellow ? '#fff59d' : '#fafafa',
                    position: 'sticky', top: 0, zIndex: 2,
                    ...(c.key === 'date' ? {
                      left: 0, zIndex: 4,
                      backgroundColor: '#e3f2fd',
                      borderRight: '2px solid #90caf9',
                    } : {}),
                  }}
                >
                  {c.label}
                </TableCell>
              ))}
            </TableRow>

            {/* Row 2 — totals (fixed below header) */}
            {rows.length > 0 && (
              <TableRow sx={{ backgroundColor: '#e3f2fd' }}>
                {VISIBLE_COLS.map(c => {
                  const isInt = ['boardAttd','otherAttnd','cBrdLbr','cOthrLbr','oBrdLbr','oOthrLbr'].includes(c.key);
                  const val   = totals[c.key] || 0;
                  const tdSx  = {
                    p: '2px 4px', fontSize: '0.72rem', fontWeight: 700,
                    position: 'sticky', top: headerRowH, zIndex: 2,
                    backgroundColor: '#e3f2fd',
                    borderBottom: '2px solid #90caf9',
                  };
                  if (c.key === 'date')    return <TableCell key="date"    sx={{ ...tdSx, whiteSpace: 'nowrap', left: 0, zIndex: 4, borderRight: '2px solid #90caf9' }}>TOTAL</TableCell>;
                  if (c.key === 'brdDate') return <TableCell key="brdDate" sx={tdSx} />;
                  return (
                    <TableCell key={c.key} sx={{ ...tdSx, textAlign: 'right' }}>
                      {isInt ? Math.round(val) : val.toFixed(2)}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableHead>

          <TableBody>
            {rows.length === 0 && !viewLoading && (
              <TableRow>
                <TableCell colSpan={VISIBLE_COLS.length} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {goRan ? 'Click View to load the grid.' : 'Click Go to begin.'}
                </TableCell>
              </TableRow>
            )}
            {viewLoading && (
              <TableRow>
                <TableCell colSpan={VISIBLE_COLS.length} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}

            {rows.map((row, ri) => (
              <TableRow
                key={row.date}
                sx={{
                  backgroundColor: row.isHoliday ? '#c8e6c9' : (ri % 2 === 0 ? 'background.paper' : 'action.hover'),
                  '&:hover': { backgroundColor: row.isHoliday ? '#a5d6a7' : 'action.selected' },
                }}
              >
                {VISIBLE_COLS.map(c => {
                  const rawVal = row[c.key];
                  const isInt  = ['boardAttd', 'otherAttnd', 'cBrdLbr', 'cOthrLbr', 'oBrdLbr', 'oOthrLbr'].includes(c.key);
                  const isDate = c.key === 'date';
                  const isBrdDate = c.key === 'brdDate';

                  let display;
                  if (isDate) display = fmtDate(rawVal);
                  else if (isInt) display = fmtI(rawVal);
                  else if (typeof rawVal === 'number' || (rawVal && !isNaN(rawVal))) display = fmt2(rawVal);
                  else display = rawVal ?? '';

                  if (!c.editable) {
                    return (
                      <TableCell
                        key={c.key}
                        sx={{
                          p: '2px 4px', fontSize: '0.72rem',
                          textAlign: isDate ? 'left' : 'right',
                          fontWeight: row.rowState === 'MODIFY' && c.key === 'totHamali' ? 600 : 400,
                          ...(isDate ? {
                            position: 'sticky', left: 0, zIndex: 1,
                            backgroundColor: row.isHoliday ? '#c8e6c9' : (ri % 2 === 0 ? '#fff' : '#f5f5f5'),
                            borderRight: '2px solid #90caf9',
                            whiteSpace: 'nowrap',
                          } : {}),
                        }}
                      >
                        {display}
                      </TableCell>
                    );
                  }

                  // Editable yellow cell
                  return (
                    <TableCell
                      key={c.key}
                      sx={{ p: '1px 2px', backgroundColor: row.isHoliday ? undefined : '#fff9c4' }}
                    >
                      <input
                        id={`cell-${ri}-${c.key}`}
                        type={isBrdDate ? 'date' : 'number'}
                        value={isBrdDate ? (rawVal || '') : (rawVal ?? '')}
                        onChange={e => handleCellChange(ri, c.key, e.target.value)}
                        onBlur={e => handleCellBlur(ri, c.key, e.target.value)}
                        onKeyDown={e => handleCellKeyDown(e, ri, c.key)}
                        disabled={row.isHoliday}
                        style={{
                          width: '100%', border: 'none', outline: 'none',
                          background: 'transparent',
                          fontSize: '0.72rem', textAlign: isBrdDate ? 'left' : 'right',
                          padding: '1px 2px',
                        }}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}

          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Action Buttons ───────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {canAdd && (
          <Button
            variant="contained" size="small" startIcon={saveLoading ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
            onClick={handleSave} disabled={saveLoading || !viewRan || rows.length === 0}
          >
            Save
          </Button>
        )}
        <Button
          variant="outlined" size="small" color="inherit" startIcon={<AddIcon />}
          onClick={() => { resetForm(); setAlert(null); }}
        >
          New
        </Button>
        <Button
          variant="outlined" size="small" startIcon={<CalculateIcon />}
          onClick={handleCalBalVarai} disabled={!viewRan || rows.length === 0}
        >
          Calc Balance Varai
        </Button>
        <Button
          variant="outlined" size="small" startIcon={<CalculateIcon />}
          onClick={handleCalBrdAmt} disabled={!viewRan || rows.length === 0}
        >
          Calc Board Depo Amt
        </Button>
        {can('HAMALI', 'CanExport') && (
        <Button
          variant="outlined" size="small" startIcon={<FileDownloadIcon />}
          onClick={handleExport} disabled={rows.length === 0}
        >
          Export Excel
        </Button>
        )}

        {/* Board note (mirrors VB6 lblCalBrdNote) */}
        {rows.length > 0 && (
          <Typography variant="caption" color="error" sx={{ ml: 2, maxWidth: 280 }}>
            Note: Calculate Board Depo before Save. TotDepoBrd = CashBrdLbr + DepoBrd.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
