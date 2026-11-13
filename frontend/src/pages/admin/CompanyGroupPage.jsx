// ─────────────────────────────────────────────────────────────────────────────
// Company Group Master Page
//
// This page lets administrators manage the top-level "Company Groups".
// A Company Group (e.g. "BHW") is the parent that owns multiple companies
// (e.g. ADS, KPS, TEST). Group-level masters like State, Tax, Item, Godown
// are shared across all companies in a group.
//
// UI pattern: "Drawer" — the list of groups is on the left; clicking Add or
// clicking a row opens a slide-in panel (Drawer) on the right with the form.
// This is the same pattern used for State, Tax, Holiday, Bank masters.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import {
  Box, Button, Drawer, IconButton, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Toolbar, Typography,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import EditIcon   from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import api        from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// Width of the slide-in drawer panel
const DRAWER_WIDTH = 380;

export default function CompanyGroupPage() {
  const { can } = useAuth();

  // rows: the list of company groups loaded from the API
  const [rows,    setRows]    = useState([]);
  // open: whether the Add/Edit drawer is currently visible
  const [open,    setOpen]    = useState(false);
  // editing: the group object being edited, or null when adding new
  const [editing, setEditing] = useState(null);
  // form: the current values typed into the drawer form
  const [form,    setForm]    = useState({ pkGroupID: '', GroupName: '' });
  // error: validation error message shown inside the form
  const [error,   setError]   = useState('');

  // Load all company groups when the page first opens
  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get('/admin/company-groups');
      setRows(res.data);
    } catch { /* leave existing rows */ }
  }

  // Opens the drawer for adding a NEW group (blank form)
  function handleAdd() {
    setEditing(null);
    setForm({ pkGroupID: '', GroupName: '' });
    setError('');
    setOpen(true);
  }

  // Opens the drawer for EDITING an existing group (pre-fills the form)
  function handleEdit(row) {
    setEditing(row);
    setForm({ pkGroupID: row.pkGroupID, GroupName: row.GroupName });
    setError('');
    setOpen(true);
  }

  // Submits the form — calls POST (new) or PUT (existing)
  async function handleSave() {
    if (!form.pkGroupID.trim() || !form.GroupName.trim()) {
      setError('Both Group ID and Group Name are required');
      return;
    }
    try {
      if (editing) {
        // PUT — update existing group (pkGroupID cannot change)
        await api.put(`/admin/company-groups/${editing.pkGroupID}`, {
          GroupName: form.GroupName,
          Active:    'Y',
        });
      } else {
        // POST — create new group
        await api.post('/admin/company-groups', {
          pkGroupID: form.pkGroupID,
          GroupName: form.GroupName,
        });
      }
      setOpen(false);
      load();    // refresh the list
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  // Soft-deletes a group (sets Active = 'N' on the server)
  async function handleDelete(id) {
    if (!window.confirm('Deactivate this company group?')) return;
    try {
      await api.delete(`/admin/company-groups/${id}`);
      load();
    } catch { alert('Delete failed'); }
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Page header row */}
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Company Group Master
        </Typography>
        {can('ADMIN', 'CanAdd') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
            Add Group
          </Button>
        )}
      </Toolbar>

      {/* List of company groups */}
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              {['Group ID', 'Group Name', 'Active', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.pkGroupID} hover>
                <TableCell>{row.pkGroupID}</TableCell>
                <TableCell>{row.GroupName}</TableCell>
                <TableCell>
                  {/* Green = Active, Red = Inactive */}
                  <Switch checked={row.Active === 'Y'} size="small" disabled />
                </TableCell>
                <TableCell>
                  {can('ADMIN', 'CanEdit') && (
                    <IconButton size="small" onClick={() => handleEdit(row)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )}
                  {can('ADMIN', 'CanDelete') && (
                    <IconButton size="small" color="error" onClick={() => handleDelete(row.pkGroupID)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>
                  No company groups found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* Add / Edit Drawer — slides in from the right */}
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: DRAWER_WIDTH, p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {editing ? 'Edit Company Group' : 'Add Company Group'}
          </Typography>

          <Stack spacing={2}>
            {/* Group ID — only editable when creating new; locked when editing */}
            <TextField
              label="Group ID *"
              value={form.pkGroupID}
              onChange={(e) => setForm((f) => ({ ...f, pkGroupID: e.target.value.toUpperCase() }))}
              disabled={!!editing}   // once created, ID cannot change
              helperText={editing ? 'ID cannot be changed after creation' : 'Short code e.g. BHW'}
              slotProps={{ htmlInput: { maxLength: 10 } }}
              fullWidth
            />

            <TextField
              label="Group Name *"
              value={form.GroupName}
              onChange={(e) => setForm((f) => ({ ...f, GroupName: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: 50 } }}
              fullWidth
            />

            {/* Validation error */}
            {error && (
              <Typography color="error" variant="body2">{error}</Typography>
            )}

            {/* Save / Cancel buttons */}
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
