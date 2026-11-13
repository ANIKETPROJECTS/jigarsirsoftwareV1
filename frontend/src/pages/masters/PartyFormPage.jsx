import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Stack,
  FormControlLabel, Switch, Checkbox, Alert, CircularProgress, Divider,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon      from '@mui/icons-material/Save';
import api           from '../../services/api';
import { useAuth }  from '../../contexts/AuthContext';

// GSTIN: 2-digit state | 5-letter PAN | 4-digit PAN | 1-letter PAN | entity | Z | checksum
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/;
const GSTIN_PLACEHOLDER = '22AAAAA0000A1Z5';

const LOT_TYPES = [
  { code: 'ITM',  label: 'Item' },
  { code: 'SPC',  label: 'Space' },
  { code: 'BOTH', label: 'Both' },
];

const BILL_TYPES = [
  { code: 'MTH',  label: 'MONTHLY' },
  { code: 'WKL',  label: 'WEEKLY' },
  { code: 'LOT', label: 'LOT' },
];

const EMPTY = {
  pCode: '', pAlias: '', pName: '', pGroup: '', pRef: '',
  pBillType: '', pEmail: '', pBillAdd: '',
  pStartDate: new Date().toISOString().slice(0, 10),
  pLotReNumFlg: false, StFlagGodRent: true, StFlagTrans: true,
  pLotType: '', GSTNo: '', fkStateID: '', pNote: '', Active: 'Y',
};

export default function PartyFormPage() {
  const navigate    = useNavigate();
  const { id: _rawId } = useParams();
  const id          = decodeId(_rawId);
  const isEdit      = !!id;
  const { user }    = useAuth();
  const isPrimary   = !!user?.isPrimary;

  const [form,          setForm]          = useState(EMPTY);
  const [states,        setStates]        = useState([]);
  const [contractRates, setContractRates] = useState([]);
  const [godownLinks,   setGodownLinks]   = useState([]);
  const [saving,        setSaving]        = useState(false);
  const [loading,       setLoading]       = useState(isEdit);
  const [error,         setError]         = useState('');
  const [gstError,      setGstError]      = useState('');

  const f      = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fUpper = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value.toUpperCase() }));

  function handleGSTChange(e) {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    setForm((p) => ({ ...p, GSTNo: val }));
    if (val.length === 15) {
      setGstError(GSTIN_REGEX.test(val) ? '' : 'Invalid GSTIN format');
    } else {
      setGstError('');
    }
  }
  const fBool = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.checked }));

  const loadStates = useCallback(async () => {
    try {
      const { data } = await api.get('/masters/states');
      setStates(data.filter((s) => s.Active === 'Y'));
    } catch {}
  }, []);

  const loadParty = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ data }, { data: rates }, { data: links }] = await Promise.all([
        api.get(`/masters/parties/${id}`),
        api.get(`/masters/parties/${id}/contract-rates`),
        api.get(`/masters/parties/${id}/godown-links`),
      ]);
      setForm({
        pCode:         data.pCode         || '',
        pAlias:        data.pAlias        || '',
        pName:         data.pName         || '',
        pGroup:        data.pGroup        || '',
        pRef:          data.pRef          || '',
        pBillType:     data.pBillType     || '',
        pEmail:        data.pEmail        || '',
        pBillAdd:      data.pBillAdd      || '',
        pStartDate:    data.pStartDate ? data.pStartDate.slice(0, 10) : '',
        pLotReNumFlg:  data.pLotReNumFlg  === 'Y',
        StFlagGodRent: data.StFlagGodRent === 'Y',
        StFlagTrans:   data.StFlagTrans   === 'Y',
        pLotType:      data.pLotType      || '',
        GSTNo:         data.GSTNo         || '',
        fkStateID:     data.fkStateID     ?? '',
        pNote:         data.pNote         || '',
        Active:        data.Active        || 'Y',
      });
      setContractRates(rates);
      setGodownLinks(links);
    } catch { setError('Failed to load party'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    loadStates();
    loadParty();
  }, [loadStates, loadParty]);

  async function handleSave() {
    const { pCode, pAlias, pGroup, pBillType, pStartDate, pLotType, GSTNo, fkStateID } = form;
    if (!pCode || !pAlias || !pGroup || !pBillType || !pStartDate || !pLotType || !fkStateID ||
        (isPrimary && !GSTNo)) {
      setError('Code, Alias, Group, Bill Type, Start Date, Lot Type and State are required' +
        (isPrimary ? ', GST No is also required' : ''));
      return;
    }
    if (GSTNo && !GSTIN_REGEX.test(GSTNo)) {
      setGstError('Invalid GSTIN — must be 15 chars: 22AAAAA0000A1Z5');
      setError('Please fix the GST Number format');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/masters/parties/${id}`, form);
      } else {
        await api.post('/masters/parties', form);
      }
      navigate('/masters/parties');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/parties')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Party' : 'Add Party'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3 }}>
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Basic Information
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Full Party Name" size="small"
              sx={{ minWidth: 220, flexGrow: 2 }}
              value={form.pName} onChange={fUpper('pName')} slotProps={{ htmlInput: { maxLength: 50 } }} />
            <TextField label="Party Code *" size="small"
              sx={{ minWidth: 130, flexGrow: 1 }}
              value={form.pCode} onChange={fUpper('pCode')} slotProps={{ htmlInput: { maxLength: 3 } }}
              helperText="Max 3 chars (e.g. ADS)" />
            <TextField label="Short Name (Alias) *" size="small"
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.pAlias} onChange={fUpper('pAlias')} slotProps={{ htmlInput: { maxLength: 20 } }} />
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Party Group *" size="small"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.pGroup} onChange={fUpper('pGroup')} slotProps={{ htmlInput: { maxLength: 30 } }}
              helperText="Used to group parties on reports" />
            <TextField label="Reference" size="small"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.pRef} onChange={f('pRef')} slotProps={{ htmlInput: { maxLength: 30 } }} />
            <TextField label="Email" size="small" type="email"
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.pEmail} onChange={f('pEmail')} slotProps={{ htmlInput: { maxLength: 200 } }} />
          </Stack>
          <TextField label="Billing Address" size="small" fullWidth multiline rows={3}
            value={form.pBillAdd} onChange={f('pBillAdd')}
            helperText="Printed on bill headers" />
        </Stack>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          Billing & GST
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Bill Type *" select size="small"
              sx={{ minWidth: 140, flexGrow: 1 }}
              value={form.pBillType} onChange={f('pBillType')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {BILL_TYPES.map((t) => (
                <MenuItem key={t.code} value={t.code}>{t.label}</MenuItem>
              ))}
            </TextField>
            <TextField label="Lot Type *" select size="small"
              sx={{ minWidth: 140, flexGrow: 1 }}
              value={form.pLotType} onChange={f('pLotType')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {LOT_TYPES.map((t) => (
                <MenuItem key={t.code} value={t.code}>{t.label}</MenuItem>
              ))}
            </TextField>
            <TextField label="Start Date *" type="date" size="small"
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.pStartDate} onChange={f('pStartDate')}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label={isPrimary ? 'GST Number *' : 'GST Number'} size="small"
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.GSTNo}
              onChange={handleGSTChange}
              error={!!gstError}
              helperText={gstError || `Format: ${GSTIN_PLACEHOLDER} (15 chars)`}
              slotProps={{ htmlInput: { maxLength: 15, style: { textTransform: 'uppercase', letterSpacing: '0.05em' } } }}
              placeholder={GSTIN_PLACEHOLDER} />
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
            <TextField label="State *" select size="small"
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.fkStateID} onChange={f('fkStateID')}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
              {states.map((s) => (
                <MenuItem key={s.pkStateID} value={s.pkStateID}>
                  {s.sName} ({s.sCode})
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', pt: 0.5 }}>
              <FormControlLabel
                control={<Checkbox checked={form.StFlagGodRent} onChange={fBool('StFlagGodRent')} />}
                label="Service Tax on Godown Rent" />
              <FormControlLabel
                control={<Checkbox checked={form.StFlagTrans} onChange={fBool('StFlagTrans')} />}
                label="Service Tax on Transport" />
              <FormControlLabel
                control={<Checkbox checked={form.pLotReNumFlg} onChange={fBool('pLotReNumFlg')} />}
                label="Re-number Lots per FA Year" />
            </Box>
          </Stack>
        </Stack>

        <Divider sx={{ my: 3 }} />
        <Stack spacing={1.5}>
          <TextField label="Notes" size="small" fullWidth multiline rows={3}
            value={form.pNote} onChange={f('pNote')} />
          {isEdit && (
            <FormControlLabel
              control={<Switch checked={form.Active === 'Y'}
                onChange={(e) => setForm((p) => ({ ...p, Active: e.target.checked ? 'Y' : 'N' }))} />}
              label="Active" />
          )}
        </Stack>
      </Paper>

      {/* ── Active Contract Rates (edit mode, view only) ─────────────────── */}
      {isEdit && (
        <Paper elevation={1} sx={{ mt: 3, p: 3 }}>
          <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
            Active Contract Rates (No End Date)
          </Typography>
          {contractRates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active contract rates found for this party.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#F5F7FA' }}>
                    {['Item', 'Rate Type', 'Trans Type', 'Packing', 'From Date',
                      'Unit From', 'Unit To', 'Charge Type', 'Hamali Code',
                      'Bill Rate', 'Labour Rate', 'Note'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: '#003087' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {contractRates.map((r) => (
                    <TableRow key={r.pkRateChartID} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.ItemName || '—'}</TableCell>
                      <TableCell>{r.RateType}</TableCell>
                      <TableCell>{r.TransType}</TableCell>
                      <TableCell>{r.PackingType}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {r.FromDt ? String(r.FromDt).slice(0, 10).split('-').reverse().join('/') : '—'}
                      </TableCell>
                      <TableCell sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {r.UnitFrom}
                      </TableCell>
                      <TableCell sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {r.UnitTo}
                      </TableCell>
                      <TableCell>{r.ChargeType}</TableCell>
                      <TableCell>{r.HamaliCode}</TableCell>
                      <TableCell sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {Number(r.BillRate).toFixed(2)}
                      </TableCell>
                      <TableCell sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {Number(r.LabourRate).toFixed(2)}
                      </TableCell>
                      <TableCell>{r.Note || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}

      {/* ── Active Godown Links (edit mode, view only) ───────────────────── */}
      {isEdit && (
        <Paper elevation={1} sx={{ mt: 3, p: 3 }}>
          <Typography variant="subtitle2" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
            Active Godown Links (No End Date)
          </Typography>
          {godownLinks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active godown links found for this party.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#F5F7FA' }}>
                    {['Link Type', 'Godown No', 'From Date', 'Note'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: '#003087' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {godownLinks.map((r) => (
                    <TableRow key={r.pkLinkID} hover>
                      <TableCell>{r.LinkTypeName}</TableCell>
                      <TableCell>{r.GodownNum || '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {r.FromDt ? String(r.FromDt).slice(0, 10).split('-').reverse().join('/') : '—'}
                      </TableCell>
                      <TableCell>{r.Note || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Party'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/masters/parties')} disabled={saving}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
