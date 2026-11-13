// ─────────────────────────────────────────────────────────────────────────────
// LocationListPage.jsx  —  /masters/locations
//
// PURPOSE:
//   Displays all mLocation records for the current user's group.
//   A Location is a named spot inside a Godown (e.g. Godown G01 → Location L1).
//
// SHARED MASTER rules visible in this page:
//   - All users (primary and secondary) can VIEW the list.
//   - Add / Edit / Delete buttons are hidden for secondary company users
//     because only the Primary company can write shared masters.
//   - isPrimary comes from the JWT payload via useAuth().
//
// DATA FLOW:
//   1. On mount: fetch godowns (for display name mapping) + fetch locations.
//   2. Godowns are indexed by pkGodownID so we can quickly look up gNum
//      when rendering the location rows (avoid N+1 queries).
//   3. Delete uses soft-delete (Active → 'N'); row disappears from list.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, Table, TableHead, TableRow,
  TableCell, TableBody, IconButton, Chip, TextField, MenuItem,
  Alert, CircularProgress, Tooltip,
} from '@mui/material';
import AddIcon      from '@mui/icons-material/Add';
import EditIcon     from '@mui/icons-material/Edit';
import DeleteIcon   from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';
import { exportCSV } from '../../utils/exportCSV';

export default function LocationListPage() {
  const navigate       = useNavigate();
  const { user, can }  = useAuth();

  // isPrimary: true means this user's company is the Primary company for the group.
  // Only Primary users see Add/Edit/Delete controls.
  const isPrimary = user?.isPrimary;

  const [locations,  setLocations]  = useState([]);
  const [godowns,    setGodowns]    = useState({});   // { pkGodownID: godownRow }
  const [filterGdwn, setFilterGdwn] = useState('');  // filter dropdown by godown
  const [godownList, setGodownList] = useState([]);   // for filter dropdown
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  // Load godowns first, then locations.
  // Godown map is needed to display gNum in the table (instead of raw UUID).
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch all godowns for the group to build a UUID→gNum lookup map
      const { data: gdwns } = await api.get('/masters/godowns');
      const gdwnMap = {};
      gdwns.forEach((g) => { gdwnMap[g.pkGodownID] = g; });
      setGodowns(gdwnMap);
      setGodownList(gdwns.filter((g) => g.Active === 'Y'));

      // Fetch locations — optionally filtered by a selected godown
      const params = filterGdwn ? `?godownID=${filterGdwn}` : '';
      const { data: locs } = await api.get(`/masters/locations${params}`);
      locs.sort((a, b) => {
        const gA = Number(gdwnMap[a.fkGodownID]?.gNum) || 0;
        const gB = Number(gdwnMap[b.fkGodownID]?.gNum) || 0;
        if (gA !== gB) return gA - gB;
        return a.LocationCode.localeCompare(b.LocationCode);
      });
      setLocations(locs);
    } catch {
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, [filterGdwn]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(row) {
    const label = `${godowns[row.fkGodownID]?.gNum || '?'} / ${row.LocationCode}`;
    if (!window.confirm(`Deactivate location "${label}"?`)) return;
    try {
      await api.delete(`/masters/locations/${row.pkLocationID}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  }

  return (
    <Box>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <LocationOnIcon color="primary" />
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
          Godown Locations
        </Typography>

        {/* Filter by godown — lets user see only one godown's locations */}
        <TextField
          select label="Filter by Godown" size="small" sx={{ width: 180 }}
          value={filterGdwn} onChange={(e) => setFilterGdwn(e.target.value)}
        >
          <MenuItem value="">All Godowns</MenuItem>
          {godownList.map((g) => (
            <MenuItem key={g.pkGodownID} value={g.pkGodownID}>
              {g.gNum}
            </MenuItem>
          ))}
        </TextField>

        {can('MASTERS', 'CanExport') && (
          <Button size="small" startIcon={<DownloadIcon />}
            onClick={() => exportCSV('locations', [
              { label: 'Godown',        format: (r) => godowns[r.fkGodownID]?.gNum || '' },
              { label: 'Location Code', key: 'LocationCode' },
              { label: 'Location Name', key: 'LocationName' },
              { label: 'Sq. Ft.',       key: 'lsqrft' },
              { label: 'Notes',         key: 'lNote' },
              { label: 'Status',        format: (r) => r.Active === 'Y' ? 'Active' : 'Inactive' },
            ], locations)}>
            Export
          </Button>
        )}

        {/* Add button — only shown to Primary company users with CanAdd permission */}
        {isPrimary && can('MASTERS', 'CanAdd') && (
          <Button
            variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/locations/new')}
          >
            Add Location
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Show info banner for secondary company users */}
      {!isPrimary && (
        <Alert severity="info" sx={{ mb: 2 }}>
          View only — contact the Primary company to add or edit locations.
        </Alert>
      )}

      <Paper elevation={1}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F5F7FA' }}>
                <TableCell sx={{ fontWeight: 600 }}>Godown</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Sq. Ft.</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                {isPrimary && <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {locations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isPrimary ? 7 : 6} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No locations found. {isPrimary ? 'Click "Add Location" to create one.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                locations.map((row) => (
                  <TableRow key={row.pkLocationID} hover>
                    {/* Godown display: show short code (gNum) resolved from UUID */}
                    <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>
                      {godowns[row.fkGodownID]?.gNum || '—'}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{row.LocationCode}</TableCell>
                    <TableCell>{row.LocationName}</TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                      {row.lsqrft != null ? Number(row.lsqrft).toFixed(2) : '—'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                      {row.lNote || '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={row.Active === 'Y' ? 'Active' : 'Inactive'}
                        color={row.Active === 'Y' ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    {isPrimary && (
                      <TableCell>
                        {can('MASTERS', 'CanEdit') && (
                          <Tooltip title="Edit">
                            <IconButton size="small"
                              onClick={() => navigate(`/masters/locations/${encodeId(row.pkLocationID)}/edit`)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {can('MASTERS', 'CanDelete') && row.Active === 'Y' && (
                          <Tooltip title="Deactivate">
                            <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}
