// ─────────────────────────────────────────────────────────────────────────────
// Rate Chart Page — Editable Grid
//
// IMPORTANT: CellSelect / CellNum / CellDate are defined at MODULE LEVEL
// (outside the component function). This is required — if they were defined
// inside RateChartPage, React would treat them as a NEW component type on
// every render (because the function reference changes), unmount the old
// element, mount a new one, and the focused input would lose focus after
// every keystroke. Module-level = stable reference = no remount.
//
// Keyboard shortcut: Press [Insert] to add a new row (when a party is selected).
// ─────────────────────────────────────────────────────────────────────────────
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, CircularProgress, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import AddIcon          from '@mui/icons-material/Add';
import CheckCircleIcon  from '@mui/icons-material/CheckCircle';
import DeleteIcon       from '@mui/icons-material/Delete';
import SaveIcon         from '@mui/icons-material/Save';
import api        from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Static option lists (from VB6 source) ────────────────────────────────────

const RATE_TYPES = [
  { code: 'GR', label: 'Godown Rent' },
  { code: 'HM', label: 'Hamali' },
];

const TRANS_TYPES = [
  { code: 'ARV',     label: 'Arrival' },
  { code: 'DESP',    label: 'Despatch' },
  { code: 'DESPRET', label: 'Return' },
  { code: 'TRF',     label: 'Transfer' },
  { code: 'IN',      label: 'In' },
  { code: 'OUT',     label: 'Out' },
];


// ── Blank row template ────────────────────────────────────────────────────────
const BLANK_ROW = () => ({
  _isNew:        true,
  _dirty:        false,
  _saving:       false,
  pkRateChartID: null,
  RateType:      'HM',
  PackingType:   '',
  UnitFrom:      '1',
  UnitTo:        '99999',
  BillRate:      '0',
  LabourRate:    '0',
  ChargeType:    '',
  FromDt:        '',
  ToDt:          '',
  TransType:     '',
  HamaliCode:    '',
  fkItemID:      '',
  Active:        'Y',
  Note:          '',
});

// Sort saved rows: RateType → Packing → active (ToDt null) first, expired last.
// Unsaved new rows always stay at the bottom.
function sortRates(rows) {
  const saved = rows.filter((r) => !r._isNew);
  const unsaved = rows.filter((r) => r._isNew);
  saved.sort((a, b) => {
    if (a.RateType !== b.RateType) return a.RateType.localeCompare(b.RateType);
    if (a.PackingType !== b.PackingType) return a.PackingType.localeCompare(b.PackingType);
    // null ToDt = still active → comes first; non-null = expired → goes down
    const aExpired = Boolean(a.ToDt), bExpired = Boolean(b.ToDt);
    return aExpired === bExpired ? 0 : aExpired ? 1 : -1;
  });
  return [...saved, ...unsaved];
}

// Compact cell padding
const CS = { p: '3px 4px' };
const INPUT_SX = { fontSize: 12, padding: '3px 6px' };

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

// ── MODULE-LEVEL cell components ─────────────────────────────────────────────
// These MUST be outside RateChartPage so their function reference is stable.
// A stable reference means React reuses the existing DOM element and does NOT
// unmount it on re-render → input keeps focus after every keystroke.

function CellSelect({ value, onChange, options, disabled, emptyLabel = '—' }) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      displayEmpty
      sx={{ minWidth: 95, fontSize: 12 }}
      slotProps={{ htmlInput: { style: INPUT_SX } }}
    >
      <MenuItem value="" sx={{ fontSize: 12 }}><em>{emptyLabel}</em></MenuItem>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>{o.label}</MenuItem>
      ))}
    </Select>
  );
}

function CellNum({ value, onChange, disabled, width = 70 }) {
  return (
    <TextField
      size="small"
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      sx={{ width }}
      slotProps={{ htmlInput: { style: INPUT_SX, step: '0.01' } }}
    />
  );
}

function CellDate({ value, onChange, disabled }) {
  return (
    <TextField
      size="small"
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      slotProps={{ inputLabel: { shrink: true } }}
      sx={{ width: 130 }}
      slotProps={{ htmlInput: { style: INPUT_SX } }}
    />
  );
}

function CellText({ value, onChange, disabled, width = 120 }) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      sx={{ width }}
      slotProps={{ htmlInput: { style: INPUT_SX } }}
    />
  );
}

// Stable option arrays for dropdowns that never change at runtime
const RATE_TYPES_OPTS  = RATE_TYPES.map((t)  => ({ value: t.code, label: t.label }));
const TRANS_TYPES_OPTS = TRANS_TYPES.map((t) => ({ value: t.code, label: t.label }));

// ── Row component (module-level = stable reference = no unmount on parent re-render)
// Wrapped in memo so only the row whose data changed re-renders on each keystroke.
// Custom comparator: skip comparing callbacks (they're stable via useCallback) and
// only check the row object reference + the option arrays that could change on load.
// Display-only cell: shows text, clicking activates the row for editing
function DisplayCell({ children, onActivate, sx }) {
  return (
    <TableCell sx={{ ...CS, cursor: 'pointer', fontSize: 12, ...sx }} onClick={onActivate}>
      {children || <span style={{ color: '#bbb' }}>—</span>}
    </TableCell>
  );
}

function RateRowInner({ row, index, isEditing, onUpdate, onSave, onDelete, onStartEdit, canAdd, canEditExisting, canDelete, packingOpts, chargeOpts, hamaliOpts, itemOpts }) {
  const canEdit = row._isNew ? canAdd : canEditExisting;
  const isGR    = row.RateType === 'GR';

  const labelOf = (opts, val) => opts.find((o) => o.value === val)?.label || val || '—';

  if (!isEditing) {
    // ── Display mode: lightweight text cells, no MUI inputs rendered ──────────
    return (
      <TableRow
        sx={{ bgcolor: row._dirty ? '#FFF8E1' : row._isNew ? '#F1F8FF' : 'inherit', cursor: canEdit ? 'pointer' : 'default' }}
        onClick={canEdit ? () => onStartEdit(index) : undefined}
      >
        <DisplayCell>{labelOf(RATE_TYPES_OPTS,  row.RateType)}</DisplayCell>
        <DisplayCell>{row.PackingType || '—'}</DisplayCell>
        <DisplayCell sx={{ textAlign: 'right' }}>{row.UnitFrom}</DisplayCell>
        <DisplayCell sx={{ textAlign: 'right' }}>{row.UnitTo}</DisplayCell>
        <DisplayCell sx={{ textAlign: 'right' }}>{row.BillRate}</DisplayCell>
        <DisplayCell sx={{ textAlign: 'right' }}>{isGR ? '' : row.LabourRate}</DisplayCell>
        <DisplayCell>{isGR ? '' : labelOf(chargeOpts,   row.ChargeType)}</DisplayCell>
        <DisplayCell>{fmtDate(row.FromDt)}</DisplayCell>
        <DisplayCell>{fmtDate(row.ToDt)}</DisplayCell>
        <DisplayCell>{isGR ? '' : labelOf(TRANS_TYPES_OPTS, row.TransType)}</DisplayCell>
        <DisplayCell>{isGR ? '' : labelOf(hamaliOpts,  row.HamaliCode)}</DisplayCell>
        <DisplayCell>{isGR ? '' : labelOf(itemOpts,    row.fkItemID)}</DisplayCell>
        <DisplayCell sx={{ textAlign: 'center' }}>{row.Active === 'Y' ? '✓' : ''}</DisplayCell>
        <DisplayCell>{row.Note}</DisplayCell>
        <TableCell sx={{ ...CS, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          {row._saving ? (
            <IconButton size="small" disabled><CircularProgress size={14} /></IconButton>
          ) : !row._isNew && !row._dirty ? (
            <Tooltip title="Saved">
              <IconButton size="small" disabled sx={{ color: 'success.main !important' }}>
                <CheckCircleIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : canEdit ? (
            <Tooltip title={row._isNew ? 'Save new row' : 'Save changes'}>
              <IconButton size="small" onClick={() => onSave(index)} sx={{ color: row._isNew ? 'primary.main' : 'warning.main' }}>
                <SaveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {canDelete && (
            <Tooltip title={row._isNew ? 'Remove' : 'Deactivate'}>
              <IconButton size="small" color="error" onClick={() => onDelete(index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
    );
  }

  // ── Edit mode: full MUI inputs, shown only for the active row ─────────────
  return (
    <TableRow sx={{ bgcolor: row._isNew ? '#F1F8FF' : '#E3F2FD' }}>
      <TableCell sx={CS}>
        <CellSelect value={row.RateType} onChange={(v) => onUpdate(index, 'RateType', v)} options={RATE_TYPES_OPTS} disabled={!canEdit} />
      </TableCell>
      <TableCell sx={CS}>
        <CellSelect value={row.PackingType} onChange={(v) => onUpdate(index, 'PackingType', v)} options={packingOpts} disabled={!canEdit} />
      </TableCell>
      <TableCell sx={CS}>
        <CellNum value={row.UnitFrom} onChange={(v) => onUpdate(index, 'UnitFrom', v)} disabled={!canEdit} width={80} />
      </TableCell>
      <TableCell sx={CS}>
        <CellNum value={row.UnitTo} onChange={(v) => onUpdate(index, 'UnitTo', v)} disabled={!canEdit} width={80} />
      </TableCell>
      <TableCell sx={CS}>
        <CellNum value={row.BillRate} onChange={(v) => onUpdate(index, 'BillRate', v)} disabled={!canEdit} width={76} />
      </TableCell>
      <TableCell sx={CS}>
        <CellNum value={row.LabourRate} onChange={(v) => onUpdate(index, 'LabourRate', v)} disabled={!canEdit || isGR} width={66} />
      </TableCell>
      <TableCell sx={CS}>
        <CellSelect value={row.ChargeType} onChange={(v) => onUpdate(index, 'ChargeType', v)} options={chargeOpts} disabled={!canEdit || isGR} />
      </TableCell>
      <TableCell sx={CS}>
        <CellDate value={row.FromDt} onChange={(v) => onUpdate(index, 'FromDt', v)} disabled={!canEdit} />
      </TableCell>
      <TableCell sx={CS}>
        <CellDate value={row.ToDt} onChange={(v) => onUpdate(index, 'ToDt', v)} disabled={!canEdit} />
      </TableCell>
      <TableCell sx={CS}>
        <CellSelect value={row.TransType} onChange={(v) => onUpdate(index, 'TransType', v)} options={TRANS_TYPES_OPTS} disabled={!canEdit || isGR} />
      </TableCell>
      <TableCell sx={CS}>
        <CellSelect value={row.HamaliCode} onChange={(v) => onUpdate(index, 'HamaliCode', v)} options={hamaliOpts} disabled={!canEdit || isGR} />
      </TableCell>
      <TableCell sx={CS}>
        <CellSelect value={row.fkItemID} onChange={(v) => onUpdate(index, 'fkItemID', v)} options={itemOpts} disabled={!canEdit || isGR} emptyLabel="0" />
      </TableCell>
      <TableCell sx={{ ...CS, textAlign: 'center' }}>
        <Checkbox checked={row.Active === 'Y'} onChange={(e) => onUpdate(index, 'Active', e.target.checked ? 'Y' : 'N')} disabled={!canEdit} size="small" />
      </TableCell>
      <TableCell sx={CS}>
        <CellText value={row.Note} onChange={(v) => onUpdate(index, 'Note', v)} disabled={!canEdit} />
      </TableCell>
      <TableCell sx={{ ...CS, whiteSpace: 'nowrap' }}>
        {row._saving ? (
          <IconButton size="small" disabled><CircularProgress size={14} /></IconButton>
        ) : !row._isNew && !row._dirty ? (
          <Tooltip title="Saved">
            <IconButton size="small" disabled sx={{ color: 'success.main !important' }}>
              <CheckCircleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : canEdit ? (
          <Tooltip title={row._isNew ? 'Save new row' : 'Save changes'}>
            <IconButton size="small" onClick={() => onSave(index)} sx={{ color: row._isNew ? 'primary.main' : 'warning.main' }}>
              <SaveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {canDelete && (
          <Tooltip title={row._isNew ? 'Remove' : 'Deactivate'}>
            <IconButton size="small" color="error" onClick={() => onDelete(index)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}
const RateRow = memo(RateRowInner, (prev, next) =>
  prev.row         === next.row         &&
  prev.index       === next.index       &&
  prev.isEditing   === next.isEditing   &&
  prev.packingOpts === next.packingOpts &&
  prev.chargeOpts  === next.chargeOpts  &&
  prev.hamaliOpts  === next.hamaliOpts  &&
  prev.itemOpts    === next.itemOpts
);

// ── Main component ────────────────────────────────────────────────────────────
export default function RateChartPage() {
  const { can } = useAuth();

  const [parties,      setParties]      = useState([]);
  const [items,        setItems]        = useState([]);
  const [chargeTypes,  setChargeTypes]  = useState([]);
  const [hamaliTypes,  setHamaliTypes]  = useState([]);
  const [packingTypes, setPackingTypes] = useState([]);
  const [partyID,           setPartyID]           = useState('0');
  const [rows,              setRows]              = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [extraPackingTypes, setExtraPackingTypes]  = useState([]);
  const [editingIndex,      setEditingIndex]       = useState(null);

  // Refs so callbacks always read the latest values without being in their deps
  const partyIDRef  = useRef(partyID);
  const rowsRef     = useRef(rows);
  const gridRef     = useRef(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  useEffect(() => { partyIDRef.current = partyID; }, [partyID]);
  rowsRef.current = rows;

  // After saving a new row we add a blank row and trigger this effect to
  // focus the first field of that new row automatically.
  useEffect(() => {
    if (focusTrigger === 0 || !gridRef.current) return;
    const id = setTimeout(() => {
      const trs = gridRef.current?.querySelectorAll('tr');
      const last = trs?.[trs.length - 1];
      last?.querySelector('.MuiSelect-select, input')?.focus();
    }, 30);
    return () => clearTimeout(id);
  }, [focusTrigger]);

  const startEditing = useCallback((index) => setEditingIndex(index), []);

  const loadRates = useCallback(async (pid) => {
    setEditingIndex(null);
    setLoading(true);
    try {
      const res = await api.get(`/masters/ratechart?partyID=${pid}`);
      setExtraPackingTypes([...new Set(res.data.map((d) => d.PackingType).filter(Boolean))]);
      setRows(sortRates(res.data.map((d) => ({
        _isNew:        false,
        _dirty:        false,
        _saving:       false,
        pkRateChartID: d.pkRateChartID,
        RateType:      d.RateType      || 'HM',
        PackingType:   d.PackingType   || '',
        UnitFrom:      String(d.UnitFrom   ?? 1),
        UnitTo:        String(d.UnitTo     ?? 99999),
        BillRate:      String(d.BillRate   ?? 0),
        LabourRate:    String(d.LabourRate ?? 0),
        ChargeType:    d.ChargeType    || '',
        FromDt:        d.FromDt ? d.FromDt.substring(0, 10) : '',
        ToDt:          d.ToDt   ? d.ToDt.substring(0, 10)   : '',
        TransType:     d.TransType     || '',
        HamaliCode:    d.HamaliCode    || '',
        fkItemID:      d.fkItemID      || '',
        Active:        d.Active        || 'Y',
        Note:          d.Note          || '',
      }))));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    api.get('/masters/parties?slim=1').then((r) => setParties(r.data.filter((p) => p.Active === 'Y'))).catch(() => {});
    api.get('/masters/items?slim=1').then((r)   => setItems(r.data)).catch(() => {});
    api.get('/combo?purpose=ChargeType').then((r)     => setChargeTypes(r.data)).catch(() => {});
    api.get('/combo?purpose=HamaliType').then((r)     => setHamaliTypes(r.data)).catch(() => {});
    api.get('/combo?purpose=PackingType').then((r)    => setPackingTypes(r.data)).catch(() => {});

    // Load general (all-party) rates on mount — partyID='0' returns rows with fkPartyID=0
    loadRates('0');

    // [Insert] key → add row (register once; uses ref to avoid stale closure)
    function handleKey(e) {
      if (e.key === 'Insert') {
        e.preventDefault();
        setRows((prev) => [...prev, BLANK_ROW()]);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [loadRates]);

  function handlePartyChange(e) {
    const pid = e.target.value;
    setPartyID(pid);
    loadRates(pid);
  }

  const updateCell = useCallback((index, field, value) => {
    setRows((prev) => prev.map((row, i) =>
      i === index ? { ...row, [field]: value, _dirty: !row._isNew } : row
    ));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => {
      setEditingIndex(prev.length);
      return [...prev, BLANK_ROW()];
    });
  }, []);

  const saveRow = useCallback(async (index) => {
    const row = rowsRef.current[index];
    const isGR = row.RateType === 'GR';
    if (!row.RateType || !row.PackingType || !row.FromDt) {
      alert('Rate Type, Packing and From Date are required'); return;
    }
    if (isGR && !row.BillRate) {
      alert('Bill Rate is required for Godown Rent'); return;
    }
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, _saving: true } : r));
    const payload = {
      fkPartyID:   partyIDRef.current,
      fkItemID:    isGR ? '' : (row.fkItemID || ''),
      RateType:    row.RateType,
      TransType:   isGR ? '' : (row.TransType || ''),
      PackingType: row.PackingType,
      FromDt:      row.FromDt,
      ToDt:        row.ToDt || null,
      UnitFrom:    parseFloat(row.UnitFrom)   || 0,
      UnitTo:      parseFloat(row.UnitTo)     || 99999,
      ChargeType:  isGR ? '' : (row.ChargeType || ''),
      HamaliCode:  isGR ? '' : (row.HamaliCode || ''),
      BillRate:    parseFloat(row.BillRate)   || 0,
      LabourRate:  isGR ? 0  : (parseFloat(row.LabourRate) || 0),
      Note:        row.Note || '',
      Active:      row.Active,
    };
    try {
      if (row._isNew) {
        const res = await api.post('/masters/ratechart', payload);
        setRows((prev) => {
          const updated = prev.map((r, i) =>
            i === index ? { ...r, pkRateChartID: res.data.pkRateChartID, _isNew: false, _dirty: false, _saving: false } : r
          );
          const next = [...sortRates(updated), BLANK_ROW()];
          setEditingIndex(next.length - 1);
          return next;
        });
        setFocusTrigger((t) => t + 1);
      } else {
        await api.put(`/masters/ratechart/${row.pkRateChartID}`, payload);
        setRows((prev) => sortRates(prev.map((r, i) => i === index ? { ...r, _dirty: false, _saving: false } : r)));
        setEditingIndex(null);
      }
    } catch (err) {
      setRows((prev) => prev.map((r, i) => i === index ? { ...r, _saving: false } : r));
      alert(err.response?.data?.error || 'Save failed');
    }
  }, []);

  const deleteRow = useCallback(async (index) => {
    const row = rowsRef.current[index];
    if (row._isNew) { setRows((prev) => prev.filter((_, i) => i !== index)); return; }
    if (!window.confirm('Deactivate this rate entry?')) return;
    try {
      await api.delete(`/masters/ratechart/${row.pkRateChartID}`);
      setRows((prev) => prev.map((r, i) => i === index ? { ...r, Active: 'N' } : r));
    } catch { alert('Delete failed'); }
  }, []);

  // Build packing options from combo data, then augment with any DB values
  // already on loaded rows that aren't covered — prevents blank cells when
  // the combo API fails or VCCode doesn't perfectly match the stored value.
  const packingOpts = useMemo(() => {
    const valid = packingTypes.filter((t) => t.VCCode);
    const base = valid.length > 0
      ? valid.map((t) => ({ value: t.VCCode, label: t.VCData }))
      : [
          { value: 'Bag',       label: 'Bag'       },
          { value: 'Drum',      label: 'Drum'      },
          { value: 'Loose',     label: 'Loose'     },
          { value: 'Tarpaulin', label: 'Tarpaulin' },
        ];
    const covered = new Set(base.map((o) => o.value));
    for (const pt of extraPackingTypes) {
      if (!covered.has(pt)) {
        base.push({ value: pt, label: pt });
        covered.add(pt);
      }
    }
    return base;
  }, [packingTypes, extraPackingTypes]);

  const chargeOpts = useMemo(() => {
    const valid = chargeTypes.filter((t) => t.VCCode);
    return valid.length > 0
      ? valid.map((t) => ({ value: t.VCCode, label: t.VCData }))
      : [{ value: 'Per Package', label: 'Per Package' }, { value: 'Per Ton', label: 'Per Ton' }];
  }, [chargeTypes]);

  const hamaliOpts = useMemo(() => {
    const valid = hamaliTypes.filter((t) => t.VCCode);
    return valid.length > 0
      ? valid.map((t) => ({ value: t.VCCode, label: t.VCData }))
      : [{ value: 'On A/C', label: 'On A/C' }, { value: 'Cash', label: 'Cash' }];
  }, [hamaliTypes]);

  const itemOpts = useMemo(() => items.map((i) => ({ value: i.pkItemID, label: i.iName })), [items]);

  const canAdd          = can('MASTERS', 'CanAdd');
  const canEditExisting = can('MASTERS', 'CanEdit');
  const canDelete       = can('MASTERS', 'CanDelete');

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Contract Rate Chart
        </Typography>
      </Toolbar>

      {/* Party selector */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 320 }}>
            <InputLabel>Party Name</InputLabel>
            <Select value={partyID} label="Party Name" onChange={handlePartyChange}>
              <MenuItem value="0">0 — All Parties</MenuItem>
              {parties.map((p) => (
                <MenuItem key={p.pkPartyID} value={p.pkPartyID}>{p.pName}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {canAdd && (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={addRow}>
              Add Row
            </Button>
          )}
          <Typography variant="caption" color="text.secondary">
            Shortcut: <strong>Insert</strong> key to add row
          </Typography>
        </Stack>
      </Paper>

      {loading && <CircularProgress sx={{ mt: 2 }} />}

      {!loading && (
        <Paper sx={{ overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <Table size="small" stickyHeader sx={{ minWidth: 1400 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: '#dbeafe' }}>
                {[
                  ['Rate Type *', 110], ['Packing *',   120], ['From',      85],
                  ['To',           85], ['Bill Rate *',  82], ['Labour',     72],
                  ['Charge Type', 120], ['From Date *', 135], ['To Date',   135],
                  ['Trans Type',  110], ['Hamali Code', 110], ['Item',      130],
                  ['Active',       55], ['Note',        140], ['',           72],
                ].map(([label, width]) => (
                  <TableCell key={label}
                    sx={{ color: '#0d47a1', fontWeight: 700, fontSize: 12, p: '6px 8px', minWidth: width }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody ref={gridRef}>
              {rows.map((row, index) => (
                <RateRow
                  key={row.pkRateChartID || `new-${index}`}
                  row={row}
                  index={index}
                  isEditing={editingIndex === index}
                  onUpdate={updateCell}
                  onSave={saveRow}
                  onDelete={deleteRow}
                  onStartEdit={startEditing}
                  canAdd={canAdd}
                  canEditExisting={canEditExisting}
                  canDelete={canDelete}
                  packingOpts={packingOpts}
                  chargeOpts={chargeOpts}
                  hamaliOpts={hamaliOpts}
                  itemOpts={itemOpts}
                />
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={15} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                    {partyID ? 'No rate chart entries for this party.' : 'No general rates found (applies to all parties).'} Click "Add Row" or press [Insert] to create one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}

    </Box>
  );
}
