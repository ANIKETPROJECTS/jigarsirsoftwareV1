// ─────────────────────────────────────────────────────────────────────────────
// DocFormPage.jsx  —  Add / Edit a single DocumentsFile record
//
// ROUTES:
//   /masters/docfiles/new          — create a new document
//   /masters/docfiles/:id/edit     — edit an existing document
//
// Sends multipart/form-data so the file is included alongside the text fields.
// In edit mode, if no new file is selected, the existing file is kept.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem,
  Stack, Divider, Alert, CircularProgress, Autocomplete,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon      from '@mui/icons-material/Save';
import FolderIcon    from '@mui/icons-material/Folder';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import api from '../../services/api';

const EMPTY = {
  DocType:       '',
  DocDiscrption: '',
  fkPartyID:     '',
  fkGodownID:    '',
  FromDt:        '',
  ToDt:          '',
  Note:          '',
  Active:        'Y',
};

export default function DocFormPage() {
  const navigate = useNavigate();
  const { id: _rawId } = useParams();
  const id     = decodeId(_rawId);
  const isEdit = !!id;

  const [form,        setForm]        = useState(EMPTY);
  const [docTypes,    setDocTypes]    = useState([]);   // existing DocType values for autocomplete
  const [parties,     setParties]     = useState([]);   // active parties
  const [godowns,     setGodowns]     = useState([]);   // active non-expired godowns
  const [selParty,    setSelParty]    = useState(null); // Autocomplete selection object
  const [selGodown,   setSelGodown]   = useState(null); // Autocomplete selection object
  const [selDocType,  setSelDocType]  = useState('');   // freeSolo Autocomplete value

  const [file,        setFile]        = useState(null); // new File selected by user
  const [existingFileName, setExistingFileName] = useState(''); // current file in edit mode

  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error,   setError]   = useState('');

  const fileInputRef = useRef(null);

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // ── Load combos ───────────────────────────────────────────────────────────
  const loadCombos = useCallback(async () => {
    try {
      const [{ data: types }, { data: pts }, { data: gdwns }] = await Promise.all([
        api.get('/masters/docfiles/doctypes'),
        api.get('/masters/parties'),
        api.get('/masters/godowns'),
      ]);
      setDocTypes(types);
      setParties(pts.filter((p) => p.Active === 'Y'));
      // Active godowns where gEndDt is null (still in use)
      setGodowns(gdwns.filter((g) => g.Active === 'Y' && !g.gEndDt));
    } catch {
      setError('Failed to load combo data');
    }
  }, []);

  // ── Load existing record (edit mode) ──────────────────────────────────────
  const loadRecord = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/docfiles/${id}`);
      setSelDocType(data.DocType || '');
      setForm({
        DocType:       data.DocType       || '',
        DocDiscrption: data.DocDiscrption || '',
        fkPartyID:     data.fkPartyID     || '',
        fkGodownID:    data.fkGodownID    || '',
        FromDt:        data.FromDt ? String(data.FromDt).slice(0, 10) : '',
        ToDt:          data.ToDt   ? String(data.ToDt).slice(0, 10)   : '',
        Note:          data.Note          || '',
        Active:        data.Active        || 'Y',
      });
      setExistingFileName(data.FileName || '');
      // selParty / selGodown are resolved by the useEffect below once combos are loaded
    } catch {
      setError('Failed to load document details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadCombos(); }, [loadCombos]);
  useEffect(() => { loadRecord(); }, [loadRecord]);

  // Resolve Autocomplete selection objects once combos and form are both loaded
  useEffect(() => {
    if (form.fkPartyID  && parties.length)  setSelParty(parties.find((p) => p.pkPartyID === form.fkPartyID) || null);
    if (form.fkGodownID && godowns.length)  setSelGodown(godowns.find((g) => g.pkGodownID === form.fkGodownID) || null);
  }, [form.fkPartyID, form.fkGodownID, parties, godowns]);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    const docType = (typeof selDocType === 'object' ? selDocType?.label : selDocType) || '';
    if (!docType.trim())          { setError('Doc Type is required'); return; }
    if (!form.DocDiscrption.trim()) { setError('Description is required'); return; }
    if (!form.FromDt)              { setError('From Date is required'); return; }
    if (!form.ToDt)                { setError('To Date is required'); return; }
    if (form.FromDt > form.ToDt)   { setError('From Date cannot be after To Date'); return; }
    if (!isEdit && !file)          { setError('Please select a file to upload'); return; }

    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('DocType',       docType.trim());
      fd.append('DocDiscrption', form.DocDiscrption.trim());
      fd.append('fkPartyID',     form.fkPartyID  || '');
      fd.append('fkGodownID',    form.fkGodownID || '');
      fd.append('FromDt',        form.FromDt);
      fd.append('ToDt',          form.ToDt);
      fd.append('Note',          form.Note || '');
      fd.append('Active',        form.Active);
      if (file) fd.append('docFile', file);

      if (isEdit) {
        await api.put(`/masters/docfiles/${id}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.post('/masters/docfiles', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      navigate('/masters/docfiles');
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
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/masters/docfiles')} sx={{ mr: 2 }}>
          Back
        </Button>
        <FolderIcon color="primary" sx={{ mr: 1 }} />
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Document' : 'Add Document'}
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3, maxWidth: 720 }}>

        {/* ── Doc Type ────────────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          Document Type
        </Typography>
        <Autocomplete
          freeSolo
          size="small"
          options={docTypes}
          value={selDocType}
          onInputChange={(_, v) => { setSelDocType(v); setForm((p) => ({ ...p, DocType: v })); }}
          onChange={(_, v)      => { setSelDocType(v || ''); setForm((p) => ({ ...p, DocType: v || '' })); }}
          renderInput={(params) => (
            <TextField {...params} label="Doc Type *" fullWidth
              helperText="Type a new category or select an existing one" />
          )}
        />

        <Divider sx={{ my: 2.5 }} />

        {/* ── Description ─────────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          Description
        </Typography>
        <TextField
          label="Description *" size="small" fullWidth multiline rows={3}
          value={form.DocDiscrption}
          onChange={f('DocDiscrption')}
          slotProps={{ htmlInput: { maxLength: 400 } }}
          helperText={`${form.DocDiscrption.length}/400`}
        />

        <Divider sx={{ my: 2.5 }} />

        {/* ── Party & Godown ───────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          Linked To (Party or Godown)
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Autocomplete
            size="small" sx={{ minWidth: 260, flexGrow: 1 }}
            options={parties}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.pName || '')}
            value={selParty}
            onChange={(_, v) => {
              setSelParty(v);
              setSelGodown(null);
              setForm((p) => ({ ...p, fkPartyID: v?.pkPartyID || '', fkGodownID: '' }));
            }}
            renderInput={(params) => (
              <TextField {...params} label="Party Name" helperText="Select if document belongs to a party" />
            )}
          />
          <Autocomplete
            size="small" sx={{ minWidth: 200, flexGrow: 1 }}
            options={godowns}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.gNum || '')}
            value={selGodown}
            onChange={(_, v) => {
              setSelGodown(v);
              setSelParty(null);
              setForm((p) => ({ ...p, fkGodownID: v?.pkGodownID || '', fkPartyID: '' }));
            }}
            renderInput={(params) => (
              <TextField {...params} label="Godown No" helperText="Select if document belongs to a godown" />
            )}
          />
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        {/* ── Dates ────────────────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          Validity Period
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <TextField
            label="From Date *" type="date" size="small" sx={{ minWidth: 180 }}
            value={form.FromDt} onChange={f('FromDt')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To Date *" type="date" size="small" sx={{ minWidth: 180 }}
            value={form.ToDt} onChange={f('ToDt')}
            slotProps={{ inputLabel: { shrink: true } }}
            error={!!(form.FromDt && form.ToDt && form.ToDt < form.FromDt)}
            helperText={form.FromDt && form.ToDt && form.ToDt < form.FromDt ? 'To Date must be ≥ From Date' : ''}
          />
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        {/* ── File Upload ──────────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          File
        </Typography>
        <Stack direction="row" alignItems="center" spacing={2}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          <Button
            variant="outlined" size="small" startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? 'Change File' : isEdit ? 'Replace File' : 'Choose File *'}
          </Button>
          <Typography variant="body2" color={file ? 'text.primary' : 'text.secondary'}>
            {file
              ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)`
              : existingFileName
                ? `Current: ${existingFileName}`
                : 'No file selected'}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Images and PDFs accepted. Images larger than 300 KB are automatically compressed. PDFs are stored in their original format to preserve document quality.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        {/* ── Note & Active ─────────────────────────────────────────────────── */}
        <Typography variant="subtitle2" color="primary" sx={{ mb: 1.5, fontWeight: 600 }}>
          Additional Info
        </Typography>
        <Stack spacing={1.5}>
          <TextField
            label="Note" size="small" fullWidth multiline rows={2}
            value={form.Note} onChange={f('Note')}
          />
          {isEdit && (
            <TextField
              label="Active" select size="small" sx={{ width: 160 }}
              value={form.Active} onChange={f('Active')}
            >
              <MenuItem value="Y">Active</MenuItem>
              <MenuItem value="N">Inactive</MenuItem>
            </TextField>
          )}
        </Stack>

        <Divider sx={{ my: 3 }} />

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained" startIcon={<SaveIcon />}
            onClick={handleSave} disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outlined" onClick={() => navigate('/masters/docfiles')}>
            Cancel
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
