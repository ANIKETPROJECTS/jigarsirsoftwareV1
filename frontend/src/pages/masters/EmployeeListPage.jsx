import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import EditIcon   from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api        from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function EmployeeListPage() {
  const navigate = useNavigate();
  const { can, user } = useAuth();

  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [deleteRow, setDeleteRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/employees'); setRows(data); }
    catch { setError('Failed to load employees'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    try { await api.delete(`/masters/employees/${deleteRow.pkEmpID}`); setDeleteRow(null); load(); }
    catch { setError('Delete failed'); }
  }

  const filtered = rows.filter((r) =>
    r.eName.toLowerCase().includes(search.toLowerCase()) ||
    r.eShortName.toLowerCase().includes(search.toLowerCase()) ||
    r.eType.toLowerCase().includes(search.toLowerCase()) ||
    r.eToliNum.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>Employee Master</Typography>
        {can('MASTERS', 'CanAdd') && user?.isPrimary && (
          <Button variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/employees/new')}>
            Add Employee
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TextField size="small" placeholder="Search by name, type or toli no…"
        value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2, width: 300 }} />

      <TableContainer component={Paper} elevation={1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Short Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Designation</TableCell>
              <TableCell>Toli No</TableCell>
              <TableCell>Board Reg No</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} align="center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} align="center" sx={{ color: 'text.secondary' }}>No employees found</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.pkEmpID} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><b>{row.eName}</b></TableCell>
                  <TableCell>{row.eShortName}</TableCell>
                  <TableCell>{row.eType}</TableCell>
                  <TableCell>{row.eDesignation}</TableCell>
                  <TableCell>{row.eToliNum || '—'}</TableCell>
                  <TableCell>{row.eBoardRegNum || '—'}</TableCell>
                  <TableCell>
                    <Chip label={row.Active === 'Y' ? 'Active' : 'Inactive'} size="small"
                      color={row.Active === 'Y' ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    {can('MASTERS', 'CanEdit') && user?.isPrimary && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => navigate(`/masters/employees/${encodeId(row.pkEmpID)}/edit`)}>
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
        <DialogTitle>Deactivate Employee</DialogTitle>
        <DialogContent>
          <Typography>Mark <b>{deleteRow?.eName}</b> as inactive?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Deactivate</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
