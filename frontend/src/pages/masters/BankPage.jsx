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
  { label: 'Bank Name',   key: 'bName' },
  { label: 'Account No',  key: 'bAcNo' },
  { label: 'IFSC',        key: 'bIFSC' },
  { label: 'Branch',      key: 'bBranch' },
  { label: 'Primary',     format: (r) => r.bPrimeryFlg === 'Y' ? 'Yes' : 'No' },
  { label: 'Status',      format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

const EMPTY = { bName: '', bAcNo: '', bIFSC: '', bBranch: '', bPrimeryFlg: false, bNote: '', Active: 'Y' };

export default function BankPage() {
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
    try { const { data } = await api.get('/masters/banks'); setRows(data); }
    catch { setError('Failed to load banks'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditRow(null); setForm(EMPTY); setFormError(''); setDrawerOpen(true); }

  function openEdit(row) {
    setEditRow(row);
    setForm({
      bName:       row.bName,
      bAcNo:       row.bAcNo,
      bIFSC:       row.bIFSC || '',
      bBranch:     row.bBranch || '',
      bPrimeryFlg: row.bPrimeryFlg === 'Y',
      bNote:       row.bNote || '',
      Active:      row.Active,
    });
    setFormError(''); setDrawerOpen(true);
  }

  async function handleSave() {
    if (!form.bName || !form.bAcNo) { setFormError('Bank name and account number are required'); return; }
    setSaving(true); setFormError('');
    try {
      if (editRow) {
        await api.put(`/masters/banks/${editRow.pkBankID}`, form);
      } else {
        await api.post('/masters/banks', form);
      }
      setDrawerOpen(false); load();
    } catch (err) { setFormError(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try { await api.delete(`/masters/banks/${deleteRow.pkBankID}`); setDeleteRow(null); load(); }
    catch { setError('Delete failed'); }
  }

  const f      = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fUpper = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value.toUpperCase() }));

  const filtered = rows.filter((r) =>
    r.bName.toLowerCase().includes(search.toLowerCase()) ||
    r.bAcNo.includes(search) ||
    (r.bIFSC || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Bank Master</Typography>
        {can('MASTERS', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('banks', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('MASTERS', 'CanAdd') && (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>Add Bank</Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by name, A/C No or IFSC…"
        value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, width: 320 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Bank Name</TableCell>
              <TableCell>Account No</TableCell>
              <TableCell>IFSC</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell align="center">Primary</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>No banks found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.pkBankID} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><b>{row.bName}</b></TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{row.bAcNo}</TableCell>
                  <TableCell>{row.bIFSC || '—'}</TableCell>
                  <TableCell>{row.bBranch || '—'}</TableCell>
                  <TableCell align="center">
                    {row.bPrimeryFlg === 'Y' ? <Chip label="Primary" size="small" color="primary" /> : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
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
        title={editRow ? 'Edit Bank' : 'Add Bank'}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        <TextField label="Bank Name *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.bName} onChange={fUpper('bName')} slotProps={{ htmlInput: { maxLength: 50 } }} />
        <TextField label="Account Number *" size="small" fullWidth sx={{ mb: 2 }}
          value={form.bAcNo} onChange={f('bAcNo')} slotProps={{ htmlInput: { maxLength: 50 } }} />
        <TextField label="IFSC Code" size="small" fullWidth sx={{ mb: 2 }}
          value={form.bIFSC} onChange={f('bIFSC')} slotProps={{ htmlInput: { maxLength: 20 } }} />
        <TextField label="Branch" size="small" fullWidth sx={{ mb: 2 }}
          value={form.bBranch} onChange={f('bBranch')} slotProps={{ htmlInput: { maxLength: 30 } }} />
        <TextField label="Notes" size="small" fullWidth multiline rows={2} sx={{ mb: 2 }}
          value={form.bNote} onChange={f('bNote')} />
        <FormControlLabel
          control={<Switch checked={form.bPrimeryFlg} onChange={(e) => setForm((p) => ({ ...p, bPrimeryFlg: e.target.checked }))} />}
          label="Primary Bank"
        />
        {editRow && (
          <FormControlLabel
            control={<Switch checked={form.Active === 'Y'} onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
            label="Active"
          />
        )}
      </FormDrawer>

      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Deactivate Bank</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.bName}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
