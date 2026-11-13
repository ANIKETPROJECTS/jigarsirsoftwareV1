import { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Button, TextField, IconButton, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import EditIcon   from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api        from '../../services/api';
import FormDrawer from '../../components/FormDrawer';
import { useAuth } from '../../contexts/AuthContext';

const TAX_TYPES = ['P', 'R']; // Percentage, Rate
const TAX_LABELS = { P: 'Percentage', R: 'Rate' };

const EMPTY = { TaxCode: '', TaxFromDt: '', TaxToDt: '', TaxType: 'I', TaxRate: '', TaxDesc: '' };

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function TaxPage() {
  const { can } = useAuth();
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [search,     setSearch]     = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editRow,    setEditRow]    = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [deleteRow,  setDeleteRow]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/taxes'); setRows(data); }
    catch { setError('Failed to load taxes'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditRow(null); setForm(EMPTY); setFormError(''); setDrawerOpen(true); }

  function openEdit(row) {
    setEditRow(row);
    setForm({
      TaxCode:   row.TaxCode,
      TaxFromDt: row.TaxFromDt ? row.TaxFromDt.slice(0, 10) : '',
      TaxToDt:   row.TaxToDt   ? row.TaxToDt.slice(0, 10)   : '',
      TaxType:   row.TaxType,
      TaxRate:   String(row.TaxRate),
      TaxDesc:   row.TaxDesc || '',
    });
    setFormError(''); setDrawerOpen(true);
  }

  async function handleSave() {
    if (!form.TaxCode || !form.TaxFromDt || !form.TaxType || form.TaxRate === '')
      { setFormError('Tax Code, From Date, Type and Rate are required'); return; }
    setSaving(true); setFormError('');
    try {
      if (editRow) {
        await api.put(`/masters/taxes/${editRow.TaxCode}/${editRow.TaxFromDt.slice(0, 10)}`, form);
      } else {
        await api.post('/masters/taxes', form);
      }
      setDrawerOpen(false); load();
    } catch (err) { setFormError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try {
      await api.delete(`/masters/taxes/${deleteRow.TaxCode}/${deleteRow.TaxFromDt.slice(0, 10)}`);
      setDeleteRow(null); load();
    } catch { setError('Delete failed'); }
  }

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const filtered = rows.filter((r) =>
    r.TaxCode.toLowerCase().includes(search.toLowerCase()) ||
    (r.TaxDesc || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Tax Master</Typography>
        {can('MASTERS', 'CanAdd') && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>Add Tax</Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by tax code or description…"
        value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, width: 320 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Tax Code</TableCell>
              <TableCell>From Date</TableCell>
              <TableCell>To Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Rate %</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>No taxes found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={`${row.TaxCode}_${row.TaxFromDt}`} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><b>{row.TaxCode}</b></TableCell>
                  <TableCell>{fmtDate(row.TaxFromDt)}</TableCell>
                  <TableCell>{fmtDate(row.TaxToDt)}</TableCell>
                  <TableCell>{TAX_LABELS[row.TaxType] || row.TaxType}</TableCell>
                  <TableCell align="right">{parseFloat(row.TaxRate).toFixed(2)}%</TableCell>
                  <TableCell>{row.TaxDesc || '—'}</TableCell>
                  <TableCell align="center">
                    {can('MASTERS', 'CanEdit') && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('MASTERS', 'CanDelete') && (
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
        title={editRow ? 'Edit Tax Entry' : 'Add Tax Entry'}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        <TextField label="Tax Code *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxCode} onChange={f('TaxCode')} slotProps={{ htmlInput: { maxLength: 30 } }}
          disabled={!!editRow} helperText={editRow ? 'Tax Code cannot be changed' : ''} />
        <TextField label="From Date *" type="date" size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxFromDt} onChange={f('TaxFromDt')}
          slotProps={{ inputLabel: { shrink: true } }} disabled={!!editRow}
          helperText={editRow ? 'From Date cannot be changed' : ''} />
        <TextField label="To Date (leave blank if ongoing)" type="date" size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxToDt} onChange={f('TaxToDt')} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="Tax Type *" select size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxType} onChange={f('TaxType')}>
          {TAX_TYPES.map((t) => <MenuItem key={t} value={t}>{TAX_LABELS[t]}</MenuItem>)}
        </TextField>
        <TextField label="Tax Rate % *" type="number" size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxRate} onChange={f('TaxRate')} slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01 } }} />
        <TextField label="Description" size="small" fullWidth sx={{ mb: 2 }}
          value={form.TaxDesc} onChange={f('TaxDesc')} slotProps={{ htmlInput: { maxLength: 100 } }} />
      </FormDrawer>

      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Delete Tax Entry</DialogTitle>
        <DialogContent>
          <Typography>Permanently delete <b>{deleteRow?.TaxCode}</b> ({fmtDate(deleteRow?.TaxFromDt)})?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
