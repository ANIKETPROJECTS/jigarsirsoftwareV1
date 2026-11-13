// ─────────────────────────────────────────────────────────────────────────────
// Company Form Page
//
// Used for both:
//   - Adding a new company (URL: /admin/companies/new)
//   - Editing an existing company (URL: /admin/companies/:compID)
//
// KEY POINT on Group selection:
//   When ADDING a new company, the admin can pick ANY group from the dropdown —
//   not just their own group. This lets a BHW admin create a company under XYZ group.
//   When EDITING, the group is shown read-only (you cannot move a company between groups
//   after creation because all its master data references the original group's fkGroupID).
//
// Fields:
//   fkGroupID — Which company group this company belongs to (selector on add; locked on edit)
//   pkCompID  — Short code (e.g. 'ADS'). Locked after creation.
//   CompName  — Full legal name (e.g. 'Aditya Distribution Services')
//   CompAlias — Short display name used in reports and bills
//   Active    — Y/N toggle (shown on edit only)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Button, FormControlLabel, MenuItem, Paper, Stack, Switch,
  TextField, Toolbar, Typography,
} from '@mui/material';
import SaveIcon      from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api           from '../../services/api';

export default function CompanyFormPage() {
  const { id: _rawId } = useParams();
  const id       = decodeId(_rawId);   // 'new' or a pkCompID like 'ADS'
  const navigate = useNavigate();

  const isNew = id === 'new';

  const [groups, setGroups] = useState([]);  // list of all company groups for the dropdown
  const [form, setForm] = useState({
    fkGroupID: '',   // which group this company belongs to
    pkCompID:  '',
    CompName:  '',
    CompAlias: '',
    Active:    'Y',
  });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  // Load all company groups for the Group dropdown (needed when adding a new company)
  useEffect(() => {
    api.get('/admin/company-groups').then((r) => {
      // Only show active groups in the dropdown
      setGroups(r.data.filter((g) => g.Active === 'Y'));
    }).catch(() => {});
  }, []);

  // When editing, load the existing company data into the form
  useEffect(() => {
    if (!isNew) {
      api.get('/admin/companies').then((res) => {
        const found = res.data.find((c) => c.pkCompID === id);
        if (found) {
          setForm({
            fkGroupID: found.fkGroupID,
            pkCompID:  found.pkCompID,
            CompName:  found.CompName,
            CompAlias: found.CompAlias,
            Active:    found.Active,
          });
        }
      }).catch(() => {});
    }
  }, [id, isNew]);

  function handleChange(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave() {
    const { fkGroupID, pkCompID, CompName, CompAlias } = form;
    if (!fkGroupID || !pkCompID.trim() || !CompName.trim() || !CompAlias.trim()) {
      setError('Group, Company ID, Name and Alias are all required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        // Send fkGroupID chosen by admin — the backend will use THIS, not the logged-in user's group
        await api.post('/admin/companies', { fkGroupID, pkCompID, CompName, CompAlias });
      } else {
        // Group cannot be changed on edit — only name, alias, active flag
        await api.put(`/admin/companies/${id}`, { CompName, CompAlias, Active: form.Active });
      }
      navigate('/admin/companies');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/companies')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          {isNew ? 'Add Company' : `Edit Company — ${id}`}
        </Typography>
      </Toolbar>

      <Paper sx={{ p: 3, maxWidth: 560 }}>
        <Stack spacing={2.5}>
          {/* Group selector — shown as dropdown when adding new, read-only text when editing */}
          {isNew ? (
            <TextField
              label="Company Group *"
              select
              value={form.fkGroupID}
              onChange={handleChange('fkGroupID')}
              helperText="Which group will own this company? You can choose any group."
              fullWidth
            >
              <MenuItem value=""><em>— Select Group —</em></MenuItem>
              {groups.map((g) => (
                <MenuItem key={g.pkGroupID} value={g.pkGroupID}>
                  {g.pkGroupID} — {g.GroupName}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            // On edit: group is shown read-only — cannot be changed after company is created
            // because all master data (State, Tax, Item, Godown, etc.) is already linked to
            // the original group via fkGroupID
            <TextField
              label="Company Group"
              value={form.fkGroupID}
              disabled
              helperText="Group cannot be changed after company is created"
              fullWidth
            />
          )}

          {/* Company ID — locked when editing */}
          <TextField
            label="Company ID *"
            value={form.pkCompID}
            onChange={(e) => setForm((f) => ({ ...f, pkCompID: e.target.value.toUpperCase() }))}
            disabled={!isNew}
            helperText={isNew ? 'Short code e.g. ADS, KPS (cannot change later)' : 'ID cannot be changed'}
            slotProps={{ htmlInput: { maxLength: 10 } }}
            fullWidth
          />

          <TextField
            label="Company Name *"
            value={form.CompName}
            onChange={handleChange('CompName')}
            slotProps={{ htmlInput: { maxLength: 50 } }}
            fullWidth
          />

          <TextField
            label="Company Alias *"
            value={form.CompAlias}
            onChange={handleChange('CompAlias')}
            helperText="Short name used in reports and bills"
            slotProps={{ htmlInput: { maxLength: 20 } }}
            fullWidth
          />

          {/* Active toggle — only shown when editing */}
          {!isNew && (
            <FormControlLabel
              label="Active"
              control={
                <Switch
                  checked={form.Active === 'Y'}
                  onChange={(e) => setForm((f) => ({ ...f, Active: e.target.checked ? 'Y' : 'N' }))}
                />
              }
            />
          )}

          {error && <Typography color="error" variant="body2">{error}</Typography>}

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={() => navigate('/admin/companies')}>Cancel</Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
