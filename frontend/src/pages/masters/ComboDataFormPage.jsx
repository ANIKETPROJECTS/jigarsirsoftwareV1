import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, FormControlLabel,
  Switch, CircularProgress, Alert, Stack, Divider, Autocomplete,
} from '@mui/material';
import SaveIcon      from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';

const BLANK = { VCPurpose: '', VCCode: '', VCData: '', VCDesc: '', VCSrtOrd: 1, VCActive: 'Y' };

export default function ComboDataFormPage() {
  const navigate  = useNavigate();
  const { id }    = useParams();
  const isNew     = !id || id === 'new';
  const { user }  = useAuth();
  const isPrimary = user?.isPrimary;

  const [editPurpose, editCode] = isNew ? ['', ''] : decodeId(id).split('||');

  const [form,      setForm]      = useState(BLANK);
  const [loading,   setLoading]   = useState(!isNew);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [purposes,  setPurposes]  = useState([]);  // distinct existing purpose names
  const [codeError, setCodeError] = useState('');  // inline code uniqueness error

  // allRows ref — loaded once for suggestions; not state so it doesn't cause re-renders
  const allRowsRef = useRef([]);

  // Load all existing rows on mount (new form only) for autocomplete + validation
  useEffect(() => {
    if (!isNew) return;
    api.get('/masters/combo-data', { params: { active: 'all' } })
      .then(({ data }) => {
        allRowsRef.current = data;
        setPurposes([...new Set(data.map((r) => r.VCPurpose))].sort());
      })
      .catch(() => {});
  }, [isNew]);

  // When purpose changes: auto-fill Sort Order
  useEffect(() => {
    if (!isNew || !form.VCPurpose) return;
    const rows = allRowsRef.current.filter((r) => r.VCPurpose === form.VCPurpose);
    const nextSort = rows.length > 0
      ? Math.max(...rows.map((r) => r.VCSrtOrd ?? 0)) + 1
      : 1;
    setForm((prev) => ({ ...prev, VCSrtOrd: nextSort }));
    // Re-validate code if already typed
    if (form.VCCode) {
      const exists = rows.some((r) => r.VCCode === form.VCCode.trim().toUpperCase());
      setCodeError(exists ? 'Code already exists for this purpose' : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.VCPurpose]);

  // Load existing record for edit
  useEffect(() => {
    if (isNew) return;
    api.get(`/masters/combo-data/${encodeURIComponent(editPurpose)}/${encodeURIComponent(editCode)}`)
      .then(({ data }) => setForm({
        VCPurpose: data.VCPurpose,
        VCCode:    data.VCCode,
        VCData:    data.VCData,
        VCDesc:    data.VCDesc || '',
        VCSrtOrd:  data.VCSrtOrd ?? 0,
        VCActive:  data.VCActive || 'Y',
      }))
      .catch(() => setError('Failed to load record'))
      .finally(() => setLoading(false));
  }, [isNew, editPurpose, editCode]);

  function handleCodeChange(e) {
    const val = e.target.value.toUpperCase();
    setForm((prev) => ({ ...prev, VCCode: val }));
    if (form.VCPurpose) {
      const rows = allRowsRef.current.filter((r) => r.VCPurpose === form.VCPurpose);
      const exists = rows.some((r) => r.VCCode === val.trim());
      setCodeError(exists ? 'Code already exists for this purpose' : '');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (codeError) return;
    setError('');
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/masters/combo-data', {
          ...form,
          VCCode:   form.VCCode.trim().toUpperCase(),
          VCSrtOrd: parseInt(form.VCSrtOrd, 10) || 1,
        });
      } else {
        const { VCData, VCDesc, VCSrtOrd, VCActive } = form;
        await api.put(
          `/masters/combo-data/${encodeURIComponent(editPurpose)}/${encodeURIComponent(editCode)}`,
          { VCData, VCDesc, VCSrtOrd: parseInt(VCSrtOrd, 10) || 0, VCActive }
        );
      }
      navigate('/masters/combo-data');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 560 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/combo-data')} size="small">
          Back
        </Button>
        <Typography variant="h5" fontWeight={600}>
          {isNew ? 'New Combo Entry' : 'Edit Combo Entry'}
        </Typography>
      </Stack>

      {!isPrimary && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Only the Primary company can add or edit combo data. You are in view-only mode.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit}>
          <Stack>

            {/* Purpose — autocomplete with freeSolo for new, plain disabled for edit */}
            {isNew ? (
              <Autocomplete
                freeSolo
                options={purposes}
                inputValue={form.VCPurpose}
                onInputChange={(_, value) =>
                  setForm((prev) => ({ ...prev, VCPurpose: value || '' }))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Purpose"
                    required
                    size="small"
                    placeholder="Select existing or type new"
                    sx={{ mb: 3 }}
                  />
                )}
              />
            ) : (
              <TextField
                label="Purpose"
                value={form.VCPurpose}
                disabled
                fullWidth
                size="small"
                sx={{ mb: 3 }}
              />
            )}

            {/* Code — unique per purpose, validated live */}
            <TextField
              label="Code"
              value={form.VCCode}
              onChange={handleCodeChange}
              disabled={!isNew}
              required
              fullWidth
              size="small"
              error={!!codeError}
              helperText={codeError || ' '}
              inputProps={{ style: { textTransform: 'uppercase' } }}
              sx={{ mb: 2 }}
            />

            <TextField
              label="Display Name"
              value={form.VCData}
              onChange={(e) => setForm((prev) => ({ ...prev, VCData: e.target.value }))}
              required
              fullWidth
              size="small"
              placeholder="Label shown in dropdowns"
              sx={{ mb: 3 }}
            />

            <TextField
              label="Description"
              value={form.VCDesc}
              onChange={(e) => setForm((prev) => ({ ...prev, VCDesc: e.target.value }))}
              fullWidth
              size="small"
              multiline
              rows={2}
              sx={{ mb: 3 }}
            />

            {/* Sort Order — auto-suggested based on purpose */}
            <TextField
              label="Sort Order"
              type="number"
              value={form.VCSrtOrd}
              onChange={(e) => setForm((prev) => ({ ...prev, VCSrtOrd: e.target.value }))}
              fullWidth
              size="small"
              inputProps={{ min: 1, step: 1 }}
              sx={{ mb: 3 }}
            />

            <Divider sx={{ mb: 3 }} />

            <FormControlLabel
              control={
                <Switch
                  checked={form.VCActive === 'Y'}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, VCActive: e.target.checked ? 'Y' : 'N' }))
                  }
                />
              }
              label="Active"
              sx={{ mb: 3 }}
            />

            <Button
              type="submit"
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              disabled={saving || !!codeError || !isPrimary}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
