import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, Stack,
  FormControlLabel, Switch, Alert, CircularProgress, Autocomplete,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon      from '@mui/icons-material/Save';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';

const EMPTY = {
  gNum: '', gRate: '', gSqrft: '', gAmt: '',
  gOwner: '', gAdd: '', gStartDt: '', gEndDt: '', gNote: '', Active: 'Y',
};

function calcAmt(rate, sqrft) {
  const r = parseFloat(rate);
  const s = parseFloat(sqrft);
  if (!isNaN(r) && !isNaN(s) && r > 0 && s > 0) return String(r * s);
  return '';
}

export default function GodownFormPage() {
  const navigate     = useNavigate();
  const { id: _rawId } = useParams();
  const id           = decodeId(_rawId);
  const { user }     = useAuth();

  useEffect(() => {
    if (user && !user.isPrimary) navigate('/masters/godowns', { replace: true });
  }, [user, navigate]);
  const isEdit   = !!id;

  const [form,    setForm]    = useState(EMPTY);
  const [owners,  setOwners]  = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error,   setError]   = useState('');

  const loadOwners = useCallback(async () => {
    try {
      const { data } = await api.get('/masters/godowns');
      const unique = [...new Set(data.map((r) => r.gOwner).filter(Boolean))].sort();
      setOwners(unique);
    } catch {}
  }, []);

  const loadGodown = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/godowns/${id}`);
      setForm({
        gNum:     data.gNum,
        gRate:    data.gRate  != null ? String(data.gRate)  : '',
        gSqrft:   data.gSqrft != null ? String(data.gSqrft) : '',
        gAmt:     data.gAmt   != null ? String(data.gAmt)   : '',
        gOwner:   data.gOwner || '',
        gAdd:     data.gAdd   || '',
        gStartDt: data.gStartDt ? data.gStartDt.slice(0, 10) : '',
        gEndDt:   data.gEndDt   ? data.gEndDt.slice(0, 10)   : '',
        gNote:    data.gNote  || '',
        Active:   data.Active,
      });
    } catch { setError('Failed to load godown'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadOwners();
    loadGodown();
  }, [loadOwners, loadGodown]);

  function handleRateChange(e) {
    const gRate = e.target.value;
    setForm((p) => ({ ...p, gRate, gAmt: calcAmt(gRate, p.gSqrft) }));
  }

  function handleSqrftChange(e) {
    const gSqrft = e.target.value;
    setForm((p) => ({ ...p, gSqrft, gAmt: calcAmt(p.gRate, gSqrft) }));
  }

  async function handleSave() {
    if (!form.gNum) { setError('Godown number is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        gRate:  form.gRate  !== '' ? parseFloat(form.gRate)  : null,
        gSqrft: form.gSqrft !== '' ? parseFloat(form.gSqrft) : null,
        gAmt:   form.gAmt   !== '' ? parseFloat(form.gAmt)   : null,
      };
      if (isEdit) {
        await api.put(`/masters/godowns/${id}`, payload);
      } else {
        await api.post('/masters/godowns', payload);
      }
      navigate('/masters/godowns');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/godowns')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Godown' : 'Add Godown'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3, maxWidth: 700 }}>
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Godown Details
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Godown No *" size="small"
              sx={{ minWidth: 130, flexGrow: 1 }}
              value={form.gNum} onChange={(e) => setForm((p) => ({ ...p, gNum: e.target.value.toUpperCase() }))}
              slotProps={{ htmlInput: { maxLength: 5 } }} helperText="e.g. G01, G02" />
            <TextField label="Rate (per sqft)" type="number" size="small"
              sx={{ minWidth: 130, flexGrow: 1 }}
              value={form.gRate} onChange={handleRateChange}
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }} />
            <TextField label="Area (sqft)" type="number" size="small"
              sx={{ minWidth: 130, flexGrow: 1 }}
              value={form.gSqrft} onChange={handleSqrftChange}
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }} />
            <TextField label="Monthly Amount" type="number" size="small"
              sx={{ minWidth: 130, flexGrow: 1,
                ...(form.gRate && form.gSqrft ? { '& .MuiInputBase-input': { bgcolor: '#F5F5F5', color: 'text.secondary' } } : {}) }}
              value={form.gAmt}
              onChange={(e) => setForm((p) => ({ ...p, gAmt: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, step: 0.01 }, input: { readOnly: !!(form.gRate && form.gSqrft) } }}
              helperText={form.gRate && form.gSqrft ? `${form.gRate} × ${form.gSqrft}` : 'Auto-calculated'} />
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Autocomplete freeSolo options={owners}
              sx={{ minWidth: 220, flexGrow: 1 }}
              value={form.gOwner}
              onChange={(_, v) => setForm((p) => ({ ...p, gOwner: v || '' }))}
              onInputChange={(_, v) => setForm((p) => ({ ...p, gOwner: v || '' }))}
              renderInput={(params) => (
                <TextField {...params} label="Owner" size="small"
                  helperText="Select existing or type a new owner name"
                  slotProps={{ htmlInput: { ...(params.inputProps || {}), maxLength: 30 } }} />
              )}
            />
            <TextField label="Start Date" type="date" size="small"
              sx={{ minWidth: 150, flexGrow: 1 }}
              value={form.gStartDt} onChange={(e) => setForm((p) => ({ ...p, gStartDt: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="End Date" type="date" size="small"
              sx={{ minWidth: 150, flexGrow: 1 }}
              value={form.gEndDt} onChange={(e) => setForm((p) => ({ ...p, gEndDt: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <TextField label="Address" size="small" fullWidth multiline rows={2}
            value={form.gAdd} onChange={(e) => setForm((p) => ({ ...p, gAdd: e.target.value }))} />
          <TextField label="Notes" size="small" fullWidth multiline rows={2}
            value={form.gNote} onChange={(e) => setForm((p) => ({ ...p, gNote: e.target.value }))} />
          {isEdit && (
            <FormControlLabel
              control={<Switch checked={form.Active === 'Y'}
                onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
              label="Active" />
          )}
        </Stack>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Godown'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/masters/godowns')} disabled={saving}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
