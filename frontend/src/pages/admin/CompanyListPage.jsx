// ─────────────────────────────────────────────────────────────────────────────
// Company List Page
//
// Shows all companies that belong to the current user's company group.
// Clicking "Add Company" or clicking a row navigates to CompanyFormPage.
//
// Example: if the logged-in user is in group "BHW", this page lists:
//   ADS — Aditya Distribution Services
//   KPS — Kashi Prasad Stores
//   TEST — Test Company
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Button, IconButton, Paper, Switch,
  Table, TableBody, TableCell, TableHead, TableRow,
  Toolbar, Typography,
} from '@mui/material';
import AddIcon  from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import api      from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function CompanyListPage() {
  const navigate = useNavigate();
  const { can }  = useAuth();
  const [rows, setRows] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.get('/admin/companies');
      setRows(res.data);
    } catch { /* keep existing */ }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Company Master
        </Typography>
        {can('ADMIN', 'CanAdd') && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/admin/companies/new')}
          >
            Add Company
          </Button>
        )}
      </Toolbar>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              {['Company ID', 'Company Name', 'Alias', 'Group', 'Active', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.pkCompID} hover>
                <TableCell>{row.pkCompID}</TableCell>
                <TableCell>{row.CompName}</TableCell>
                <TableCell>{row.CompAlias}</TableCell>
                {/* Show which group this company belongs to — important when viewing cross-group */}
                <TableCell>{row.fkGroupID}</TableCell>
                <TableCell>
                  <Switch checked={row.Active === 'Y'} size="small" disabled />
                </TableCell>
                <TableCell>
                  {can('ADMIN', 'CanEdit') && (
                    <IconButton
                      size="small"
                      onClick={() => navigate(`/admin/companies/${encodeId(row.pkCompID)}`)}
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
                  No companies found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
