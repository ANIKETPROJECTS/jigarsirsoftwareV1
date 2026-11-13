import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, Stack, MenuItem,
  FormControlLabel, Switch, Alert, CircularProgress, Autocomplete,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon      from '@mui/icons-material/Save';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';

const ITEM_TYPES = [
  { code: 'ITM',  label: 'Item' },
  { code: 'SPC',  label: 'Space' },
];

const EMPTY = { iName: '', iGroup: '', iType: '', iNote: '', Active: 'Y' };

export default function ItemFormPage() {
  const navigate     = useNavigate();
  const { id: _rawId } = useParams();
  const id           = decodeId(_rawId);
  const isEdit       = !!id;
  const { user }     = useAuth();

  useEffect(() => {
    if (user && !user.isPrimary) navigate('/masters/items', { replace: true });
  }, [user, navigate]);

  const [form,    setForm]    = useState(EMPTY);
  const [groups,  setGroups]  = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error,   setError]   = useState('');

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await api.get('/masters/items');
      const unique = [...new Set(data.map((r) => r.iGroup).filter(Boolean))].sort();
      setGroups(unique);
    } catch {}
  }, []);

  const loadItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/items/${id}`);
      setForm({ iName: data.iName, iGroup: data.iGroup, iType: data.iType, iNote: data.iNote || '', Active: data.Active });
    } catch { setError('Failed to load item'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadGroups();
    loadItem();
  }, [loadGroups, loadItem]);

  async function handleSave() {
    if (!form.iName || !form.iGroup || !form.iType) {
      setError('Name, Group and Type are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/masters/items/${id}`, form);
      } else {
        await api.post('/masters/items', form);
      }
      navigate('/masters/items');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/items')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Item' : 'Add Item'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3, maxWidth: 600 }}>
        <Stack spacing={1.5}>
          <TextField label="Item Name *" size="small" fullWidth
            value={form.iName} onChange={f('iName')} slotProps={{ htmlInput: { maxLength: 30 } }} />
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Autocomplete freeSolo options={groups}
              sx={{ minWidth: 220, flexGrow: 1 }}
              value={form.iGroup}
              onChange={(_, v) => setForm((p) => ({ ...p, iGroup: v || '' }))}
              onInputChange={(_, v, reason) => {
                if (reason !== 'reset') setForm((p) => ({ ...p, iGroup: v || '' }));
              }}
              renderInput={(params) => (
                <TextField {...params} label="Group *" size="small"
                  helperText="Select existing or type a new group name"
                  inputProps={{ ...params.inputProps, maxLength: 15 }} />
              )}
            />
            <TextField label="Item Type *" select size="small"
              sx={{ minWidth: 220, flexGrow: 1 }}
              value={form.iType} onChange={f('iType')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {ITEM_TYPES.map((t) => (
                <MenuItem key={t.code} value={t.code}>{t.label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField label="Notes" size="small" fullWidth multiline rows={3}
            value={form.iNote} onChange={f('iNote')} />
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
          {saving ? 'Saving…' : 'Save Item'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/masters/items')} disabled={saving}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
