import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip,
} from '@mui/material';
import AddIcon      from '@mui/icons-material/Add';
import EditIcon     from '@mui/icons-material/Edit';
import DeleteIcon   from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';
import { exportCSV } from '../../utils/exportCSV';

const EXPORT_COLS = [
  { label: 'Godown No',   key: 'gNum' },
  { label: 'Owner',       key: 'gOwner' },
  { label: 'Area (sqft)', key: 'gSqrft' },
  { label: 'Rate',        key: 'gRate' },
  { label: 'Monthly Amt', key: 'gAmt' },
  { label: 'Status',      format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

function fmtDecimal(v) { return v != null ? parseFloat(v).toLocaleString('en-IN') : '—'; }

export default function GodownListPage() {
  const navigate = useNavigate();
  const { can, user } = useAuth();

  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [deleteRow, setDeleteRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/godowns'); setRows(data); }
    catch { setError('Failed to load godowns'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    try { await api.delete(`/masters/godowns/${deleteRow.pkGodownID}`); setDeleteRow(null); load(); }
    catch { setError('Delete failed'); }
  }

  const filtered = rows.filter((r) =>
    r.gNum.toLowerCase().includes(search.toLowerCase()) ||
    (r.gOwner || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Godown Master</Typography>
        {can('MASTERS', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('godowns', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('MASTERS', 'CanAdd') && user?.isPrimary && (
          <Button variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/godowns/new')}>
            Add Godown
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by godown no or owner…"
        value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, width: 280 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Godown No</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell align="right">Area (sqft)</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell align="right">Monthly Amt</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>No godowns found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.pkGodownID} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><b>{row.gNum}</b></TableCell>
                  <TableCell>{row.gOwner || '—'}</TableCell>
                  <TableCell align="right">{fmtDecimal(row.gSqrft)}</TableCell>
                  <TableCell align="right">{row.gRate != null ? parseFloat(row.gRate).toFixed(2) : '—'}</TableCell>
                  <TableCell align="right">{row.gAmt != null ? parseFloat(row.gAmt).toFixed(2) : '—'}</TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    {can('MASTERS', 'CanEdit') && user?.isPrimary && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => navigate(`/masters/godowns/${encodeId(row.pkGodownID)}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {can('MASTERS', 'CanDelete') && user?.isPrimary && (
                      <Tooltip title="Deactivate">
                        <IconButton size="small" color="error" onClick={() => setDeleteRow(row)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Deactivate Godown</DialogTitle>
        <DialogContent>
          <Typography>Mark Godown <b>{deleteRow?.gNum}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
