import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, Table, TableHead, TableRow,
  TableCell, TableBody, IconButton, Chip, TextField, MenuItem,
  Alert, CircularProgress, Tooltip, Stack,
} from '@mui/material';
import AddIcon      from '@mui/icons-material/Add';
import EditIcon     from '@mui/icons-material/Edit';
import DeleteIcon   from '@mui/icons-material/Delete';
import ListAltIcon  from '@mui/icons-material/ListAlt';
import api          from '../../services/api';
import { useAuth }  from '../../contexts/AuthContext';

export default function ComboDataListPage() {
  const navigate       = useNavigate();
  const { can, user }  = useAuth();
  const isPrimary = user?.isPrimary;

  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [filterPurp,  setFilterPurp]  = useState('');
  const [filterText,  setFilterText]  = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/masters/combo-data', {
        params: { active: showInactive ? 'all' : undefined },
      });
      setRows(data);
    } catch {
      setError('Failed to load combo data');
    } finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  // Distinct VCPurpose values from loaded rows — for filter dropdown
  const purposes = useMemo(() => {
    const set = new Set(rows.map((r) => r.VCPurpose));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filterPurp) list = list.filter((r) => r.VCPurpose === filterPurp);
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter((r) =>
        r.VCCode.toLowerCase().includes(q) ||
        r.VCData.toLowerCase().includes(q) ||
        (r.VCDesc || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, filterPurp, filterText]);

  async function handleDelete(row) {
    if (!window.confirm(`Delete "${row.VCPurpose} / ${row.VCCode}"?`)) return;
    try {
      await api.delete(`/masters/combo-data/${encodeURIComponent(row.VCPurpose)}/${encodeURIComponent(row.VCCode)}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  }

  function editPath(row) {
    const id = encodeId(`${row.VCPurpose}||${row.VCCode}`);
    return `/masters/combo-data/${id}/edit`;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <ListAltIcon sx={{ color: '#1565C0', mr: 1 }} />
        <Typography variant="h5" fontWeight={600}>Combo Data</Typography>
        {isPrimary && can('COMBO_DATA', 'CanAdd') && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/masters/combo-data/new')}
            sx={{ ml: 'auto' }}
          >
            Add New
          </Button>
        )}
      </Stack>

      {/* Filters */}
      <Stack direction="row" gap={2} sx={{ mb: 2 }} flexWrap="wrap">
        <TextField
          select label="Purpose" size="small" sx={{ minWidth: 180 }}
          value={filterPurp} onChange={(e) => setFilterPurp(e.target.value)}
        >
          <MenuItem value=""><em>All Purposes</em></MenuItem>
          {purposes.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
        </TextField>
        <TextField
          label="Search code / name" size="small" sx={{ minWidth: 220 }}
          value={filterText} onChange={(e) => setFilterText(e.target.value)}
        />
        <Button
          variant={showInactive ? 'contained' : 'outlined'}
          size="small"
          color="secondary"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? 'Showing All' : 'Show Inactive'}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <CircularProgress />
      ) : (
        <Paper>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#E3F2FD' }}>
                <TableCell sx={{ fontWeight: 700 }}>Purpose</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Display Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Sort</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                    No records found
                  </TableCell>
                </TableRow>
              ) : filtered.map((row) => (
                <TableRow key={`${row.VCPurpose}||${row.VCCode}`} hover>
                  <TableCell>{row.VCPurpose}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.VCCode}</TableCell>
                  <TableCell>{row.VCData}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>{row.VCDesc || '—'}</TableCell>
                  <TableCell align="center">{row.VCSrtOrd}</TableCell>
                  <TableCell align="center">
                    <Chip
                      label={row.VCActive === 'Y' ? 'Active' : 'Inactive'}
                      color={row.VCActive === 'Y' ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="center">
                    {isPrimary && can('COMBO_DATA', 'CanEdit') && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => navigate(editPath(row))}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {isPrimary && can('COMBO_DATA', 'CanDelete') && row.VCActive === 'Y' && (
                      <Tooltip title="Deactivate">
                        <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
        {filtered.length} record{filtered.length !== 1 ? 's' : ''}
      </Typography>
    </Box>
  );
}
