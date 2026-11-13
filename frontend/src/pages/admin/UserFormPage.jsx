// ─────────────────────────────────────────────────────────────────────────────
// User Form Page
//
// Add or Edit a system user.
//
// KEY POINT on Group + Role:
//   A user belongs to a Company GROUP (not a specific company). When they log in
//   they choose which company (within their group) to work in.
//
//   Admin picks a group → roles dropdown updates to show only that group's roles.
//   Both Group and UserCode are editable in add and edit mode.
//   Changing Group clears the selected role so admin must pick a new one.
//
// Other rules:
//   - UserCode must be unique within the group (checked on backend).
//   - Password is required when creating a new user.
//   - When editing: leave Password blank to keep the current password unchanged.
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

export default function UserFormPage() {
  const { id: _rawId } = useParams();
  const id       = decodeId(_rawId);  // 'new' or a user ID
  const navigate = useNavigate();
  const isNew    = id === 'new';

  const [groups, setGroups] = useState([]);  // all company groups for the Group dropdown
  const [roles,  setRoles]  = useState([]);  // roles for the SELECTED group

  const [form, setForm] = useState({
    fkGroupID:    '',   // which group this user belongs to
    UserCode:     '',
    UserFullName: '',
    password:     '',
    fkRoleID:     '',
    Active:       'Y',
  });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  // Load all groups for the Group dropdown
  useEffect(() => {
    api.get('/admin/company-groups').then((r) => {
      setGroups(r.data.filter((g) => g.Active === 'Y'));
    }).catch(() => {});
  }, []);

  // When editing, load the existing user's data then load that group's roles
  useEffect(() => {
    if (!isNew) {
      api.get(`/admin/users/${id}`).then((r) => {
        const u = r.data;
        setForm({
          fkGroupID:    u.fkGroupID,
          UserCode:     u.UserCode,
          UserFullName: u.UserFullName,
          password:     '',            // never pre-fill password
          fkRoleID:     u.fkRoleID,
          Active:       u.Active,
        });
        // Load roles for the user's group so the Role dropdown is populated
        loadRolesForGroup(u.fkGroupID);
      }).catch(() => {});
    }
  }, [id, isNew]);

  // Loads roles filtered to a specific group — called when group is selected or on edit load
  async function loadRolesForGroup(groupID) {
    if (!groupID) { setRoles([]); return; }
    try {
      const res = await api.get('/admin/roles');
      // Filter roles to the chosen group, show only active roles
      setRoles(res.data.filter((r) => r.fkGroupID === groupID && r.Active === 'Y'));
    } catch { setRoles([]); }
  }

  // When admin changes the Group dropdown: update form, clear role, reload roles
  function handleGroupChange(e) {
    const groupID = e.target.value;
    setForm((f) => ({ ...f, fkGroupID: groupID, fkRoleID: '' }));  // clear old role selection
    loadRolesForGroup(groupID);
  }

  function handleChange(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave() {
    const { fkGroupID, UserCode, UserFullName, password, fkRoleID } = form;
    if (!fkGroupID || !UserCode.trim() || !UserFullName.trim() || !fkRoleID) {
      setError('Group, User Code, Full Name and Role are required');
      return;
    }
    if (isNew && !password.trim()) {
      setError('Password is required for new users');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        // fkGroupID goes to backend — user will be created in the chosen group
        await api.post('/admin/users', {
          fkGroupID,
          UserCode,
          UserFullName,
          password,
          fkRoleID,
        });
      } else {
        await api.put(`/admin/users/${id}`, {
          fkGroupID,
          UserCode,
          UserFullName,
          password: password || undefined,   // omit if blank so server keeps existing hash
          fkRoleID,
          Active: form.Active,
        });
      }
      navigate('/admin/users');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin/users')} sx={{ mr: 2 }}>
          Back
        </Button>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          {isNew ? 'Add User' : `Edit User — ${form.UserCode}`}
        </Typography>
      </Toolbar>

      <Paper sx={{ p: 3, maxWidth: 560 }}>
        <Stack spacing={2.5}>

          {/* Group — editable dropdown in both add and edit mode */}
          <TextField
            label="Company Group *"
            select
            value={form.fkGroupID}
            onChange={handleGroupChange}
            helperText="Changing the group will clear the selected role — pick a new role after."
            fullWidth
          >
            <MenuItem value=""><em>— Select Group —</em></MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.pkGroupID} value={g.pkGroupID}>
                {g.pkGroupID} — {g.GroupName}
              </MenuItem>
            ))}
          </TextField>

          {/* User Code — editable in both add and edit mode */}
          <TextField
            label="User Code *"
            value={form.UserCode}
            onChange={(e) => setForm((f) => ({ ...f, UserCode: e.target.value.toUpperCase() }))}
            helperText="Short login name e.g. RAJ — must be unique within the group"
            slotProps={{ htmlInput: { maxLength: 20 } }}
            fullWidth
          />

          <TextField
            label="Full Name *"
            value={form.UserFullName}
            onChange={handleChange('UserFullName')}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            fullWidth
          />

          {/* Password — required when adding, optional when editing */}
          <TextField
            label={isNew ? 'Password *' : 'New Password (leave blank to keep current)'}
            type="password"
            value={form.password}
            onChange={handleChange('password')}
            helperText={isNew ? '' : 'Only fill this if you want to reset the password'}
            fullWidth
          />

          {/* Role — filtered to the selected group's roles.
              If no group is selected yet, shows a hint to pick a group first. */}
          <TextField
            label="Role *"
            select
            value={form.fkRoleID}
            onChange={handleChange('fkRoleID')}
            helperText={
              !form.fkGroupID
                ? 'Select a Group first to see available roles'
                : roles.length === 0
                ? 'No active roles found for this group — create roles in Role Master first'
                : 'The role controls all permissions for this user'
            }
            disabled={!form.fkGroupID}   // can't pick a role until group is chosen
            fullWidth
          >
            <MenuItem value=""><em>— Select Role —</em></MenuItem>
            {roles.map((r) => (
              <MenuItem key={r.pkRoleID} value={r.pkRoleID}>
                {r.pkRoleID} — {r.RoleName}
              </MenuItem>
            ))}
          </TextField>

          {/* Active toggle — only on edit */}
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
            <Button variant="outlined" onClick={() => navigate('/admin/users')}>Cancel</Button>
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
