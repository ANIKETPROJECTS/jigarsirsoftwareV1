import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination,
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
  { label: 'Code',      key: 'pCode' },
  { label: 'Alias',     key: 'pAlias' },
  { label: 'Party Name', key: 'pName' },
  { label: 'Group',     key: 'pGroup' },
  { label: 'GST No',    key: 'GSTNo' },
  { label: 'Bill Type', key: 'pBillType' },
  { label: 'Status',    format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

export default function PartyListPage() {
  const navigate = useNavigate();
  const { can }  = useAuth();

  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [page,      setPage]      = useState(0);
  const [deleteRow, setDeleteRow] = useState(null);

  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/parties'); setRows(data); }
    catch { setError('Failed to load parties'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    try {
      await api.delete(`/masters/parties/${deleteRow.pkPartyID}`);
      setDeleteRow(null);
      load();
    } catch { setError('Delete failed'); }
  }

  const filtered = rows.filter((r) =>
    r.pAlias.toLowerCase().includes(search.toLowerCase()) ||
    (r.pName || '').toLowerCase().includes(search.toLowerCase()) ||
    r.pCode.toLowerCase().includes(search.toLowerCase()) ||
    r.pGroup.toLowerCase().includes(search.toLowerCase())
  );

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Party Master</Typography>
        {can('PARTY', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('parties', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('PARTY', 'CanAdd') && (
          <Button variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/parties/new')}>
            Add Party
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by name, alias, code or group…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        sx={{ mb: 2, width: 360 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Alias</TableCell>
              <TableCell>Party Name</TableCell>
              <TableCell>Group</TableCell>
              <TableCell>GST No</TableCell>
              <TableCell>Bill Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} align="center" sx={{ color: 'text.secondary' }}>No parties found</TableCell></TableRow>
            ) : (
              paged.map((row, i) => (
                <TableRow key={row.pkPartyID} hover>
                  <TableCell>{page * PAGE_SIZE + i + 1}</TableCell>
                  <TableCell><b>{row.pCode}</b></TableCell>
                  <TableCell>{row.pAlias}</TableCell>
                  <TableCell>{row.pName || '—'}</TableCell>
                  <TableCell>{row.pGroup}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.GSTNo}</TableCell>
                  <TableCell>{row.pBillType}</TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    {can('PARTY', 'CanEdit') && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => navigate(`/masters/parties/${encodeId(row.pkPartyID)}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {can('PARTY', 'CanDelete') && (
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

      <TablePagination
        component="div"
        count={filtered.length}
        page={page}
        rowsPerPage={PAGE_SIZE}
        rowsPerPageOptions={[PAGE_SIZE]}
        onPageChange={(_, newPage) => setPage(newPage)}
        sx={{ borderTop: 1, borderColor: 'divider' }}
      />

      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)}>
        <DialogTitle>Deactivate Party</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.pAlias}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
