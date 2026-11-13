// ─────────────────────────────────────────────────────────────────────────────
// Role Master Page
//
// A Role is a named permission template (e.g. "Administrator", "Billing Clerk").
// Roles belong to a Company Group. Users in that group are then assigned one of
// its roles. The role controls what menus and buttons that user can see.
//
// KEY POINT: When ADDING a role, admin selects which Group it belongs to.
//            This allows a BHW admin to create roles for the XYZ group.
//            When EDITING, the group is locked (cannot move a role between groups
//            because existing users reference the pkRoleID).
//
// UI pattern: Drawer (same as CompanyGroupPage, StatePage, etc.)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import {
  Box, Button, Drawer, IconButton, MenuItem, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Toolbar, Typography,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import EditIcon   from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api        from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const DRAWER_WIDTH = 400;

export default function RolePage() {
  const { can } = useAuth();

  const [groups,  setGroups]  = useState([]);  // all company groups for the dropdown
  const [rows,    setRows]    = useState([]);
  const [open,    setOpen]    = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ fkGroupID: '', pkRoleID: '', RoleName: '' });
  const [error,   setError]   = useState('');

  // Load groups and roles together when page opens
  useEffect(() => { loadGroups(); load(); }, []);

  async function loadGroups() {
    try {
      const res = await api.get('/admin/company-groups');
      setGroups(res.data.filter((g) => g.Active === 'Y'));
    } catch { /* keep empty */ }
  }

  async function load() {
    try {
      const res = await api.get('/admin/roles');
      setRows(res.data);
    } catch { /* keep existing rows */ }
  }

  function handleAdd() {
    setEditing(null);
    setForm({ fkGroupID: '', pkRoleID: '', RoleName: '' });
    setError('');
    setOpen(true);
  }

  function handleEdit(row) {
    setEditing(row);
    setForm({ fkGroupID: row.fkGroupID, pkRoleID: row.pkRoleID, RoleName: row.RoleName });
    setError('');
    setOpen(true);
  }

  async function handleSave() {
    if (!form.fkGroupID || !form.pkRoleID.trim() || !form.RoleName.trim()) {
      setError('Group, Role ID and Role Name are all required');
      return;
    }
    try {
      if (editing) {
        // On edit: only RoleName and Active can change; pkRoleID and fkGroupID are locked
        await api.put(`/admin/roles/${editing.pkRoleID}`, { RoleName: form.RoleName, Active: 'Y' });
      } else {
        // On add: send fkGroupID from the dropdown — backend will use this, not req.user.groupID
        await api.post('/admin/roles', {
          fkGroupID: form.fkGroupID,
          pkRoleID:  form.pkRoleID,
          RoleName:  form.RoleName,
        });
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Deactivate this role?')) return;
    try {
      await api.delete(`/admin/roles/${id}`);
      load();
    } catch { alert('Delete failed'); }
  }

  // Find the group name for display in the table
  function groupName(gid) {
    return groups.find((g) => g.pkGroupID === gid)?.GroupName || gid;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Role Master
        </Typography>
        {can('ADMIN', 'CanAdd') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
            Add Role
          </Button>
        )}
      </Toolbar>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F5F7FA' }}>
              {['Group', 'Role ID', 'Role Name', 'Active', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ color: '#003087', fontWeight: 700 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.pkRoleID} hover>
                {/* Show both the group code and name for clarity */}
                <TableCell>{row.fkGroupID} — {groupName(row.fkGroupID)}</TableCell>
                <TableCell>{row.pkRoleID}</TableCell>
                <TableCell>{row.RoleName}</TableCell>
                <TableCell>
                  <Switch checked={row.Active === 'Y'} size="small" disabled />
                </TableCell>
                <TableCell>
                  {can('ADMIN', 'CanEdit') && (
                    <IconButton size="small" onClick={() => handleEdit(row)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )}
                  {can('ADMIN', 'CanDelete') && (
                    <IconButton size="small" color="error" onClick={() => handleDelete(row.pkRoleID)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary' }}>
                  No roles found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: DRAWER_WIDTH, p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {editing ? 'Edit Role' : 'Add Role'}
          </Typography>

          <Stack spacing={2}>
            {/* Group dropdown — selectable when adding, read-only when editing */}
            {!editing ? (
              <TextField
                label="Company Group *"
                select
                value={form.fkGroupID}
                onChange={(e) => setForm((f) => ({ ...f, fkGroupID: e.target.value }))}
                helperText="Which group will use this role?"
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
              <TextField
                label="Company Group"
                value={`${form.fkGroupID} — ${groupName(form.fkGroupID)}`}
                disabled
                helperText="Group cannot be changed after role is created"
                fullWidth
              />
            )}

            {/* Role ID — locked when editing */}
            <TextField
              label="Role ID *"
              value={form.pkRoleID}
              onChange={(e) => setForm((f) => ({ ...f, pkRoleID: e.target.value.toUpperCase() }))}
              disabled={!!editing}
              helperText={editing ? 'ID cannot be changed' : 'Short code e.g. ADMIN, BILLING (must be unique across all groups)'}
              slotProps={{ htmlInput: { maxLength: 20 } }}
              fullWidth
            />

            <TextField
              label="Role Name *"
              value={form.RoleName}
              onChange={(e) => setForm((f) => ({ ...f, RoleName: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: 50 } }}
              fullWidth
            />

            {error && <Typography color="error" variant="body2">{error}</Typography>}

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button variant="outlined" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="contained" onClick={handleSave}>Save</Button>
            </Stack>
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
