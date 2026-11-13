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
  { label: 'Item Name', key: 'iName' },
  { label: 'Group',     key: 'iGroup' },
  { label: 'Type',      key: 'iType' },
  { label: 'Notes',     key: 'iNote' },
  { label: 'Status',    format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
];

export default function ItemListPage() {
  const navigate = useNavigate();
  const { can, user } = useAuth();

  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [page,      setPage]      = useState(0);
  const [deleteRow, setDeleteRow] = useState(null);

  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/items'); setRows(data); }
    catch { setError('Failed to load items'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    try { await api.delete(`/masters/items/${deleteRow.pkItemID}`); setDeleteRow(null); load(); }
    catch { setError('Delete failed'); }
  }

  const filtered = rows.filter((r) =>
    r.iName.toLowerCase().includes(search.toLowerCase()) ||
    r.iGroup.toLowerCase().includes(search.toLowerCase()) ||
    r.iType.toLowerCase().includes(search.toLowerCase())
  );

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Item Master</Typography>
        {can('ITEM_MASTER', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />} sx={{ mr: 1 }}
            onClick={() => exportCSV('items', EXPORT_COLS, filtered)}>
            Export
          </Button>
        )}
        {can('ITEM_MASTER', 'CanAdd') && user?.isPrimary && (
          <Button variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/items/new')}>
            Add Item
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by name, group or type…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        sx={{ mb: 2, width: 300 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Item Name</TableCell>
              <TableCell>Group</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ color: 'text.secondary' }}>No items found</TableCell></TableRow>
            ) : (
              paged.map((row, i) => (
                <TableRow key={row.pkItemID} hover>
                  <TableCell>{page * PAGE_SIZE + i + 1}</TableCell>
                  <TableCell><b>{row.iName}</b></TableCell>
                  <TableCell>{row.iGroup}</TableCell>
                  <TableCell><Chip label={row.iType} size="small" variant="outlined" /></TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.iNote || '—'}
                  </TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    {can('ITEM_MASTER', 'CanEdit') && user?.isPrimary && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => navigate(`/masters/items/${encodeId(row.pkItemID)}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {can('ITEM_MASTER', 'CanDelete') && user?.isPrimary && (
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
        <DialogTitle>Deactivate Item</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.iName}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
