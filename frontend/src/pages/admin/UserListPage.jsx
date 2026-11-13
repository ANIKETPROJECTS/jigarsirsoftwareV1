// ─────────────────────────────────────────────────────────────────────────────
// User List Page
//
// Shows all users in the current company group.
// Note: passwords are NEVER shown here (the API excludes them).
//
// Each row shows the user's code, full name, role, and active status.
// Clicking Edit navigates to UserFormPage.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Button, Chip, IconButton, Paper, Switch,
  Table, TableBody, TableCell, TableHead, TableRow,
  Toolbar, Typography,
} from '@mui/material';
import AddIcon  from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import api      from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function UserListPage() {
  const navigate = useNavigate();
  const { can, user: me } = useAuth();
  const [rows, setRows] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get('/admin/users');
      setRows(res.data);
    } catch { /* keep existing */ }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          User Master
        </Typography>
        {can('ADMIN', 'CanAdd') && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/admin/users/new')}
          >
            Add User
          </Button>
        )}
      </Toolbar>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F5F7FA' }}>
              {['User Code', 'Full Name', 'Group', 'Role', 'Active', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ color: '#003087', fontWeight: 700 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.pkUserId} hover>
                <TableCell>
                  {row.UserCode}
                  {/* Visual marker so you can spot your own account in the list */}
                  {row.pkUserId === me?.userId && (
                    <Chip label="You" size="small" color="primary" sx={{ ml: 1 }} />
                  )}
                </TableCell>
                <TableCell>{row.UserFullName}</TableCell>
                {/* Show which group this user belongs to — useful when viewing cross-group */}
                <TableCell>{row.fkGroupID}</TableCell>
                <TableCell>{row.fkRoleID}</TableCell>
                <TableCell>
                  <Switch checked={row.Active === 'Y'} size="small" disabled />
                </TableCell>
                <TableCell>
                  {can('ADMIN', 'CanEdit') && (
                    <IconButton
                      size="small"
                      onClick={() => navigate(`/admin/users/${encodeId(row.pkUserId)}`)}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
