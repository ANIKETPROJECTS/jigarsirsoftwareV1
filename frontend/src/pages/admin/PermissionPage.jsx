// ─────────────────────────────────────────────────────────────────────────────
// Permission Master Page
//
// This page defines WHAT each Role can do in each module of GMS.
//
// How it works:
//   1. User selects a Role from the dropdown at the top.
//   2. The page loads that role's current permissions from the API.
//   3. A MATRIX is displayed:
//        - Each ROW = one Module (MASTERS, ARRIVAL, DELIVERY, BILLING, REPORTS, ADMIN)
//        - Each COLUMN = one Action (View, Add, Edit, Delete, Print, Export)
//        - Each CELL = a checkbox (checked = allowed, unchecked = not allowed)
//   4. User checks/unchecks what they want.
//   5. User clicks SAVE — all rows are sent to the API in one call.
//
// After saving, users with that role will see the new permissions after their
// NEXT login (or after 5 minutes when the server's permission cache refreshes).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Checkbox, CircularProgress, FormControl,
  InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow,
  Toolbar, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import api      from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// The list of modules that exist in GMS — one row per module in the matrix.
// ModuleCode must match what is stored in mPermission.ModuleCode.
const MODULES = [
  { code: 'MASTERS',     label: 'Masters (State, Tax, Bank, Godown, Location, Holiday, Employee)' },
  { code: 'ITEM_MASTER', label: 'Item Master' },
  { code: 'PARTY',       label: 'Party Master' },
  { code: 'ARRIVAL',    label: 'Arrival / Stock In' },
  { code: 'DELIVERY',   label: 'Delivery / Stock Out' },
  { code: 'ATTENDANCE', label: 'Attendance Entry' },
  { code: 'HAMALI',     label: 'Hamali Calculation Entry' },
  { code: 'TRF_OPN_BAL', label: 'Transfer Opening Balance' },
  { code: 'TRF_DB',      label: 'Transfer Between DataBase' },
  { code: 'MOD_RATE',   label: 'Transaction Rate Entry' },
  { code: 'HAMALI_REP',    label: 'Hamali Calculation Report' },
  { code: 'BAL_REP',      label: 'Balance Report' },
  { code: 'AUDIT_REP',    label: 'Audit Report' },
  { code: 'BILL_GEN',     label: 'Bill Generation (Godown Rent, Tr/Hm/Gen)' },
  { code: 'BILL_REP',     label: 'Bill Report' },
  { code: 'RECEIPT_ENTRY', label: 'Receipt Entry (Payment against Bills)' },
  { code: 'RECEIPT_REP',  label: 'Receipt Report' },
  { code: 'BILL_LETTER',  label: 'Bill Letter & Acknowledgement' },
  { code: 'BILL_NUM_EDIT', label: 'Bill Number Editor (Edit & Delete Bill Numbers)' },
  { code: 'COMBO_DATA',     label: 'Combo Data (Dropdown lookup values: PackingType, HamaliType, etc.)' },
  { code: 'DOCUMENTS',      label: 'Document Files (Upload & manage company documents)' },
  { code: 'ADMIN',          label: 'Admin (Groups, Companies, Users, Roles)' },
  { code: 'UP_SERIAL_NUM', label: 'Update Serial Number (Bill No / Lot No override)' },
];

// The columns (actions) in the matrix
const ACTIONS = ['CanView', 'CanAdd', 'CanEdit', 'CanDelete', 'CanPrint', 'CanExport'];

// Friendly label for each action column header
const ACTION_LABELS = {
  CanView:   'View',
  CanAdd:    'Add',
  CanEdit:   'Edit',
  CanDelete: 'Delete',
  CanPrint:  'Print',
  CanExport: 'Export',
};

// Default row for a module that has no saved permissions yet (all denied)
function blankRow(code) {
  return { ModuleCode: code, CanView: false, CanAdd: false, CanEdit: false, CanDelete: false, CanPrint: false, CanExport: false };
}

export default function PermissionPage() {
  const { can, refreshPermissions } = useAuth();

  const [roles,     setRoles]     = useState([]);  // dropdown options
  const [roleID,    setRoleID]    = useState('');  // currently selected role
  const [matrix,   setMatrix]    = useState([]);  // rows of permission data
  const [loading,  setLoading]   = useState(false);
  const [saving,   setSaving]    = useState(false);
  const [saved,    setSaved]     = useState(false);

  // Load role list for the dropdown when page opens
  useEffect(() => {
    api.get('/admin/roles').then((r) => setRoles(r.data)).catch(() => {});
  }, []);

  // When a role is selected, load its permissions from the API
  const loadPermissions = useCallback(async (rid) => {
    setLoading(true);
    setSaved(false);
    try {
      const res = await api.get(`/admin/permissions/${rid}`);
      // res.data is an array of rows from mPermission for this role
      // For each module, either use the loaded row or a blank default
      const map = {};
      res.data.forEach((r) => {
        // Convert 'Y'/'N' strings from DB into true/false for checkboxes
        map[r.ModuleCode] = {
          ModuleCode: r.ModuleCode,
          CanView:    r.CanView   === 'Y',
          CanAdd:     r.CanAdd    === 'Y',
          CanEdit:    r.CanEdit   === 'Y',
          CanDelete:  r.CanDelete === 'Y',
          CanPrint:   r.CanPrint  === 'Y',
          CanExport:  r.CanExport === 'Y',
        };
      });
      // Build the full matrix — one row per MODULES entry, even if no saved data
      setMatrix(MODULES.map((m) => map[m.code] || blankRow(m.code)));
    } finally { setLoading(false); }
  }, []);

  function handleRoleChange(e) {
    const rid = e.target.value;
    setRoleID(rid);
    if (rid) loadPermissions(rid);
    else setMatrix([]);
  }

  // Toggle one checkbox — updates only the matching row/column in the matrix
  function handleToggle(moduleCode, action) {
    setMatrix((prev) =>
      prev.map((row) =>
        row.ModuleCode === moduleCode
          ? { ...row, [action]: !row[action] }
          : row
      )
    );
    setSaved(false);
  }

  // Send the full matrix to the API in one call
  async function handleSave() {
    if (!roleID) return;
    setSaving(true);
    try {
      await api.put(`/admin/permissions/${roleID}`, { permissions: matrix });
      setSaved(true);
      await refreshPermissions();
    } catch { alert('Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Permission Master
        </Typography>
        {can('ADMIN', 'CanEdit') && roleID && (
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving}
          >
            {saved ? 'Saved!' : 'Save Permissions'}
          </Button>
        )}
      </Toolbar>

      {/* Role selector — choose which role's permissions to edit */}
      <FormControl sx={{ minWidth: 280, mb: 3 }}>
        <InputLabel>Select Role</InputLabel>
        <Select value={roleID} label="Select Role" onChange={handleRoleChange}>
          <MenuItem value=""><em>— Choose a Role —</em></MenuItem>
          {roles.map((r) => (
            <MenuItem key={r.pkRoleID} value={r.pkRoleID}>
              {r.pkRoleID} — {r.RoleName}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Permission matrix — shown only after a role is selected */}
      {loading && <CircularProgress />}
      {!loading && matrix.length > 0 && (
        <Paper>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                <TableCell sx={{ color: '#00008B', fontWeight: 700, minWidth: 240 }}>Module</TableCell>
                {ACTIONS.map((a) => (
                  <TableCell key={a} align="center" sx={{ color: '#00008B', fontWeight: 700 }}>
                    {ACTION_LABELS[a]}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {matrix.map((row) => (
                <TableRow key={row.ModuleCode} hover>
                  {/* Module name */}
                  <TableCell>
                    {MODULES.find((m) => m.code === row.ModuleCode)?.label || row.ModuleCode}
                  </TableCell>

                  {/* One checkbox per action */}
                  {ACTIONS.map((action) => (
                    <TableCell key={action} align="center">
                      <Checkbox
                        checked={row[action]}
                        onChange={() => handleToggle(row.ModuleCode, action)}
                        disabled={!can('ADMIN', 'CanEdit')}
                        size="small"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {!loading && !roleID && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Select a role above to view and edit its permissions.
        </Typography>
      )}
    </Box>
  );
}
