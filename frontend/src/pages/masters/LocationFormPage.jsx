// ─────────────────────────────────────────────────────────────────────────────
// LocationFormPage.jsx  —  Add / Edit a single mLocation record
//
// PURPOSE:
//   Form for creating or editing a Godown Location.
//   Flow: user selects a Godown → types a short Location Code → types a name.
//
// USED FOR:
//   /masters/locations/new          — create a new location
//   /masters/locations/:id/edit     — edit an existing location
//
// SHARED MASTER rules:
//   This page is only reachable by Primary company users (App.jsx wraps it in a
//   route that is only linked from LocationListPage when isPrimary = true).
//   The backend also enforces the same rule with HTTP 403 for non-primary writes.
//
// DATA FLOW:
//   1. Load godowns (GET /masters/godowns) to populate the Godown dropdown.
//   2. If editing: load existing location (GET /masters/locations/:id).
//   3. On save:
//       - POST /masters/locations   (new)
//       - PUT  /masters/locations/:id (edit)
//      Backend runs syncToGroup() after each write to keep sibling DBs in sync.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem,
  Stack, FormControlLabel, Switch, Alert, CircularProgress, Divider,
} from '@mui/material';
import ArrowBackIcon  from '@mui/icons-material/ArrowBack';
import SaveIcon       from '@mui/icons-material/Save';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import api            from '../../services/api';

// ── Default blank form state ─────────────────────────────────────────────────
const EMPTY = {
  fkGodownID:   '',   // UUID of the selected godown
  LocationCode: '',   // short code e.g. L1, FRONT, SHELF-3
  LocationName: '',   // full descriptive name
  lsqrft:       '',   // floor area in sq.ft (optional)
  lNote:        '',
  Active:       'Y',
};

export default function LocationFormPage() {
  const navigate = useNavigate();
  const { id: _rawId } = useParams();
  const id       = decodeId(_rawId);
  const isEdit   = !!id;   // true when URL contains /:id/edit

  const [form,    setForm]    = useState(EMPTY);
  const [godowns, setGodowns] = useState([]);   // list for the Godown dropdown
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error,   setError]   = useState('');

  // Generic field change handler
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // ── Load godown list for the dropdown ──────────────────────────────────────
  // We need gNum (short code like "G01") to show to the user.
  // The value stored in fkGodownID is the UUID (pkGodownID).
  const loadGodowns = useCallback(async () => {
    try {
      const { data } = await api.get('/masters/godowns');
      // Only show active godowns in the dropdown
      setGodowns(data.filter((g) => g.Active === 'Y'));
    } catch {
      setError('Failed to load godowns list');
    }
  }, []);

  // ── Load existing location when editing ────────────────────────────────────
  const loadLocation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/locations/${id}`);
      setForm({
        fkGodownID:   data.fkGodownID   || '',
        LocationCode: data.LocationCode || '',
        LocationName: data.LocationName || '',
        lsqrft:       data.lsqrft != null ? String(data.lsqrft) : '',
        lNote:        data.lNote        || '',
        Active:       data.Active       || 'Y',
      });
    } catch {
      setError('Failed to load location details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadGodowns();
    loadLocation();
  }, [loadGodowns, loadLocation]);

  // ── Save handler ───────────────────────────────────────────────────────────
  async function handleSave() {
    const { fkGodownID, LocationCode, LocationName } = form;

    // Client-side validation — mirrors the backend check
    if (!fkGodownID || !LocationCode || !LocationName) {
      setError('Godown, Location Code and Location Name are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/masters/locations/${id}`, form);
      } else {
        await api.post('/masters/locations', form);
      }
      // Navigate back to the list after a successful save
      navigate('/masters/locations');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/locations')} sx={{ mr: 2 }}>
          Back
        </Button>
        <LocationOnIcon color="primary" sx={{ mr: 1 }} />
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Location' : 'Add Location'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3, maxWidth: 600 }}>

        {/* ── Section: Godown selection ───────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Godown
        </Typography>
        <TextField
          label="Select Godown *" select size="small" fullWidth
          value={form.fkGodownID} onChange={f('fkGodownID')}
          helperText="Choose the godown that contains this location"
          SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
        >
          {godowns.length === 0 ? (
            <MenuItem disabled value="">No godowns available — add godowns first</MenuItem>
          ) : (
            godowns.map((g) => (
              <MenuItem key={g.pkGodownID} value={g.pkGodownID}>{g.gNum}</MenuItem>
            ))
          )}
        </TextField>

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Location details ───────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Location Details
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField
              label="Location Code *" size="small"
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.LocationCode}
              onChange={(e) => setForm((p) => ({ ...p, LocationCode: e.target.value.toUpperCase().slice(0, 10) }))}
              slotProps={{ htmlInput: { maxLength: 10 } }}
              helperText="Short code e.g. L1, FRONT, BAY-A"
            />
            <TextField
              label="Location Name *" size="small"
              sx={{ minWidth: 260, flexGrow: 2 }}
              value={form.LocationName}
              onChange={f('LocationName')}
              slotProps={{ htmlInput: { maxLength: 50 } }}
              helperText="Descriptive name e.g. Left Side Row 1"
            />
            <TextField
              label="Sq. Ft." size="small"
              sx={{ minWidth: 120, flexGrow: 0 }}
              type="number"
              value={form.lsqrft}
              onChange={(e) => setForm((p) => ({ ...p, lsqrft: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
              helperText="Area (optional)"
            />
          </Stack>
          <TextField
            label="Notes" size="small" fullWidth multiline rows={2}
            value={form.lNote} onChange={f('lNote')}
            placeholder="Any special notes about this location (optional)"
          />
          {isEdit && (
            <FormControlLabel
              control={<Switch checked={form.Active === 'Y'}
                onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
              label="Active"
            />
          )}
        </Stack>
      </Paper>

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button
          variant="contained" startIcon={<SaveIcon />}
          onClick={handleSave} disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Location'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => navigate('/masters/locations')}
          disabled={saving}
        >
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
