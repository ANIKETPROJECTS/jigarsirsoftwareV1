import { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Button, TextField, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip,
  FormControlLabel, Switch,
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
  { label: 'Code',     key: 'sInitial' },
  { label: 'State Name', key: 'sName' },
  { label: 'GST Code', key: 'sCode' },
  { label: 'Notes',    key: 'sNote' },
  { label: 'Status',   format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

const EMPTY = { sInitial: '', sName: '', sCode: '', sNote: '', Active: 'Y' };

export default function StatePage() {
  const { can, user } = useAuth();
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [search,      setSearch]      = useState('');
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editRow,     setEditRow]     = useState(null);
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [formError,   setFormError]   = useState('');
  const [deleteRow,   setDeleteRow]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/masters/states');
      setRows(data);
    } catch { setError('Failed to load states'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditRow(null);
    setForm(EMPTY);
    setFormError('');
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditRow(row);
    setForm({ sInitial: row.sInitial, sName: row.sName, sCode: row.sCode, sNote: row.sNote || '', Active: row.Active });
    setFormError('');
    setDrawerOpen(true);
  }

  async function handleSave() {
    if (!form.sInitial || !form.sName || !form.sCode) { setFormError('Code, Name and GST Code are required'); return; }
    setSaving(true); setFormError('');
    try {
      if (editRow) {
        await api.put(`/masters/states/${editRow.pkStateID}`, form);
      } else {
        await api.post('/masters/states', form);
      }
      setDrawerOpen(false);
      load();
    } catch (err) { setFormError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try {
      await api.delete(`/masters/states/${deleteRow.pkStateID}`);
      setDeleteRow(null);
      load();
    } catch { setError('Delete failed'); }
  }

  const f      = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fUpper = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value.toUpperCase() }));
  const filtered = rows.filter((r) =>
    r.sName.toLowerCase().includes(search.toLowerCase()) ||
    r.sInitial.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>State Master</Typography>
        {can('MASTERS', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('states', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('MASTERS', 'CanAdd') && user?.isPrimary && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>Add State</Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Search */}
      <TextField
        size="small" placeholder="Search by name or code…" value={search}
        onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, width: 300 }}
      />

      {/* Table */}
      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>State Name</TableCell>
              <TableCell>GST Code</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ color: 'text.secondary' }}>No states found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.pkStateID} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><b>{row.sInitial}</b></TableCell>
                  <TableCell>{row.sName}</TableCell>
                  <TableCell>{row.sCode}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.sNote || '—'}
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

      {/* Add / Edit Drawer */}
      <FormDrawer
        open={drawerOpen}
        title={editRow ? 'Edit State' : 'Add State'}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        <TextField label="State Code *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.sInitial} onChange={fUpper('sInitial')} slotProps={{ htmlInput: { maxLength: 4 } }}
          helperText="Short code (max 4 chars, e.g. MH)" />
        <TextField label="State Name *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.sName} onChange={fUpper('sName')} slotProps={{ htmlInput: { maxLength: 30 } }} />
        <TextField label="GST State Code *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.sCode} onChange={fUpper('sCode')} slotProps={{ htmlInput: { maxLength: 4 } }}
          helperText="Numeric code used in GST (e.g. 27)" />
        <TextField label="Notes" size="small" fullWidth multiline rows={3} sx={{ mb: 2 }}
          value={form.sNote} onChange={f('sNote')} />
        {editRow && (
          <FormControlLabel
            control={<Switch checked={form.Active === 'Y'} onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
            label="Active"
          />
        )}
      </FormDrawer>

      {/* Delete confirmation */}
      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Deactivate State</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.sName}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
