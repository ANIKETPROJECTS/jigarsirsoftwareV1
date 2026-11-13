import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, Stack, MenuItem,
  FormControlLabel, Switch, Alert, CircularProgress, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon      from '@mui/icons-material/Save';
import api           from '../../services/api';
import { useAuth }   from '../../contexts/AuthContext';

const EMPTY = {
  eName: '', eShortName: '', eAddress: '', eContect: '',
  eType: '', eDesignation: '', eBoardRegNum: '', eToliNum: '',
  eBoardName: '', eNote: '', Active: 'Y',
};

export default function EmployeeFormPage() {
  const navigate     = useNavigate();
  const { id: _rawId } = useParams();
  const id           = decodeId(_rawId);
  const isEdit       = !!id;
  const { user }     = useAuth();

  useEffect(() => {
    if (user && !user.isPrimary) navigate('/masters/employees', { replace: true });
  }, [user, navigate]);

  const [form,         setForm]         = useState(EMPTY);
  const [empTypes,     setEmpTypes]     = useState([]);
  const [designations, setDesignations] = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(isEdit);
  const [error,        setError]        = useState('');

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const loadCombos = useCallback(async () => {
    try {
      const [typesRes, desgRes] = await Promise.all([
        api.get('/combo?purpose=Type'),
        api.get('/combo?purpose=Designation'),
      ]);
      setEmpTypes(typesRes.data);
      setDesignations(desgRes.data);
    } catch {}
  }, []);

  const loadEmployee = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/employees/${id}`);
      setForm({
        eName:        data.eName,
        eShortName:   data.eShortName,
        eAddress:     data.eAddress || '',
        eContect:     data.eContect || '',
        eType:        data.eType,
        eDesignation: data.eDesignation,
        eBoardRegNum: data.eBoardRegNum || '',
        eToliNum:     data.eToliNum || '',
        eBoardName:   data.eBoardName || '',
        eNote:        data.eNote || '',
        Active:       data.Active,
      });
    } catch { setError('Failed to load employee'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadCombos();
    loadEmployee();
  }, [loadCombos, loadEmployee]);

  async function handleSave() {
    if (!form.eName || !form.eShortName || !form.eType || !form.eDesignation) {
      setError('Name, Short Name, Type and Designation are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/masters/employees/${id}`, form);
      } else {
        await api.post('/masters/employees', form);
      }
      navigate('/masters/employees');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/employees')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Employee' : 'Add Employee'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3 }}>
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Personal Details
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Full Name *" size="small"
              sx={{ minWidth: 220, flexGrow: 2 }}
              value={form.eName} onChange={f('eName')} slotProps={{ htmlInput: { maxLength: 50 } }} />
            <TextField label="Short Name *" size="small"
              sx={{ minWidth: 140, flexGrow: 1 }}
              value={form.eShortName} onChange={f('eShortName')} slotProps={{ htmlInput: { maxLength: 20 } }} />
            <TextField label="Contact No" size="small"
              sx={{ minWidth: 140, flexGrow: 1 }}
              value={form.eContect} onChange={f('eContect')} slotProps={{ htmlInput: { maxLength: 50 } }} />
          </Stack>
          <TextField label="Address" size="small" fullWidth multiline rows={2}
            value={form.eAddress} onChange={f('eAddress')} />
        </Stack>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Work Details
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Employee Type *" select size="small"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.eType} onChange={f('eType')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {empTypes.map((t) => (
                <MenuItem key={t.VCCode} value={t.VCCode}>{t.VCData}</MenuItem>
              ))}
            </TextField>
            <TextField label="Designation *" select size="small"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.eDesignation} onChange={f('eDesignation')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {designations.map((d) => (
                <MenuItem key={d.VCCode} value={d.VCCode}>{d.VCData}</MenuItem>
              ))}
            </TextField>
            <TextField label="Toli No" size="small"
              sx={{ minWidth: 140, flexGrow: 1 }}
              value={form.eToliNum} onChange={f('eToliNum')} slotProps={{ htmlInput: { maxLength: 10 } }}
              helperText="Labour gang number" />
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Board Name" size="small"
              sx={{ minWidth: 220, flexGrow: 1 }}
              value={form.eBoardName} onChange={f('eBoardName')} slotProps={{ htmlInput: { maxLength: 50 } }}
              helperText="Labour board name" />
            <TextField label="Board Reg No" size="small"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.eBoardRegNum} onChange={f('eBoardRegNum')} slotProps={{ htmlInput: { maxLength: 15 } }} />
          </Stack>
          <TextField label="Notes" size="small" fullWidth multiline rows={2}
            value={form.eNote} onChange={f('eNote')} />
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
          {saving ? 'Saving…' : 'Save Employee'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/masters/employees')} disabled={saving}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
