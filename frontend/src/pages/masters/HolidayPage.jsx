import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Paper, Typography, Button, TextField, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip,
  FormControlLabel, Checkbox, Switch,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import AddIcon      from '@mui/icons-material/Add';
import EditIcon     from '@mui/icons-material/Edit';
import DeleteIcon   from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import api           from '../../services/api';
import FormDrawer    from '../../components/FormDrawer';
import { useAuth }   from '../../contexts/AuthContext';
import { exportCSV } from '../../utils/exportCSV';

const EXPORT_COLS = [
  { label: 'Date',        format: (r) => r.hDate ? r.hDate.slice(0, 10) : '' },
  { label: 'FY Year',     key: 'hFaYear' },
  { label: 'Holiday Name', key: 'hName' },
  { label: 'Board',       format: (r) => r.hBoard === 'Y' ? 'Yes' : 'No' },
  { label: 'Office',      format: (r) => r.hOffice === 'Y' ? 'Yes' : 'No' },
  { label: 'Status',      format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

const makeEmpty = () => ({
  hDate: new Date().toISOString().slice(0, 10),
  hName: '', hBoard: false, hOffice: false, hNote: '', Active: 'Y',
});

// Returns current Indian FY in the GMS "YYYY" format, e.g. "2627" for Apr 2026–Mar 2027
function getCurrentFY() {
  const now   = new Date();
  const m     = now.getMonth() + 1;
  const y     = now.getFullYear();
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HolidayPage() {
  const { can, user } = useAuth();
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [search,     setSearch]     = useState('');
  const [fyFilter,   setFyFilter]   = useState(getCurrentFY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editRow,    setEditRow]    = useState(null);
  const [form,       setForm]       = useState(makeEmpty);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [deleteRow,  setDeleteRow]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/holidays'); setRows(data); }
    catch { setError('Failed to load holidays'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditRow(null); setForm(makeEmpty()); setFormError(''); setDrawerOpen(true); }

  function openEdit(row) {
    setEditRow(row);
    setForm({
      hDate:   row.hDate ? row.hDate.slice(0, 10) : '',
      hName:   row.hName,
      hBoard:  row.hBoard === 'Y',
      hOffice: row.hOffice === 'Y',
      hNote:   row.hNote || '',
      Active:  row.Active,
    });
    setFormError(''); setDrawerOpen(true);
  }

  async function handleSave() {
    if (!form.hDate || !form.hName) { setFormError('Date and Name are required'); return; }
    setSaving(true); setFormError('');
    try {
      if (editRow) {
        await api.put(`/masters/holidays/${editRow.pkHldID}`, form);
      } else {
        await api.post('/masters/holidays', form);
      }
      setDrawerOpen(false); load();
    } catch (err) { setFormError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try { await api.delete(`/masters/holidays/${deleteRow.pkHldID}`); setDeleteRow(null); load(); }
    catch { setError('Delete failed'); }
  }

  const f      = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fUpper = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value.toUpperCase() }));
  const fChk   = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.checked }));

  // Distinct FY years from loaded data, newest first
  const fyOptions = useMemo(() => {
    const yrs = [...new Set(rows.map((r) => r.hFaYear).filter(Boolean))];
    return yrs.sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Search searches ALL rows (ignores FY filter).
  // When search is empty, FY combo filters the list.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (q) {
      return rows.filter((r) =>
        r.hName.toLowerCase().includes(q) ||
        (r.hFaYear || '').toLowerCase().includes(q)
      );
    }
    return fyFilter === 'ALL'
      ? rows
      : rows.filter((r) => r.hFaYear === fyFilter);
  }, [rows, search, fyFilter]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Holiday Master</Typography>
        {can('MASTERS', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('holidays', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('MASTERS', 'CanAdd') && user?.isPrimary && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>Add Holiday</Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>FY Year</InputLabel>
          <Select
            label="FY Year"
            value={fyOptions.includes(fyFilter) || fyFilter === 'ALL' ? fyFilter : 'ALL'}
            onChange={(e) => setFyFilter(e.target.value)}
          >
            <MenuItem value="ALL">All Years</MenuItem>
            {fyOptions.map((fy) => (
              <MenuItem key={fy} value={fy}>{fy}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          size="small"
          placeholder="Search name or FY (searches all years)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 320 }}
        />
      </Box>

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>FY Year</TableCell>
              <TableCell>Holiday Name</TableCell>
              <TableCell align="center">Board</TableCell>
              <TableCell align="center">Office</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>No holidays found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.pkHldID} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{fmtDate(row.hDate)}</TableCell>
                  <TableCell>{row.hFaYear}</TableCell>
                  <TableCell><b>{row.hName}</b></TableCell>
                  <TableCell align="center">
                    {row.hBoard === 'Y' ? <Chip label="Yes" size="small" color="primary" variant="outlined" /> : '—'}
                  </TableCell>
                  <TableCell align="center">
                    {row.hOffice === 'Y' ? <Chip label="Yes" size="small" color="secondary" variant="outlined" /> : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    {can('MASTERS', 'CanEdit') && user?.isPrimary && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('MASTERS', 'CanDelete') && user?.isPrimary && (
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleteRow(row)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <FormDrawer
        open={drawerOpen}
        title={editRow ? 'Edit Holiday' : 'Add Holiday'}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        <TextField label="Date *" type="date" size="small" fullWidth sx={{ mb: 2 }}
          value={form.hDate} onChange={f('hDate')} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="Holiday Name *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.hName} onChange={fUpper('hName')} slotProps={{ htmlInput: { maxLength: 30 } }} />
        <Box sx={{ mb: 2 }}>
          <FormControlLabel
            control={<Checkbox checked={form.hBoard} onChange={fChk('hBoard')} />}
            label="Board Holiday"
          />
          <FormControlLabel
            control={<Checkbox checked={form.hOffice} onChange={fChk('hOffice')} />}
            label="Office Holiday"
          />
        </Box>
        <TextField label="Notes" size="small" fullWidth multiline rows={3} sx={{ mb: 2 }}
          value={form.hNote} onChange={f('hNote')} />
        {editRow && (
          <FormControlLabel
            control={<Switch checked={form.Active === 'Y'} onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
            label="Active"
          />
        )}
      </FormDrawer>

      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Deactivate Holiday</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.hName}</b> ({fmtDate(deleteRow?.hDate)}) as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
