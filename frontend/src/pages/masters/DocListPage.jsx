// ─────────────────────────────────────────────────────────────────────────────
// DocListPage.jsx  —  /masters/docfiles
//
// Lists all uploaded documents for the company.
// Row background colour indicates document validity status:
//   Red    — expired (ToDt < today)
//   Yellow — about to expire (today ≤ ToDt < today + 30 days)
//   Green  — healthy (ToDt ≥ today + 31 days)
// Warning icon shown when a record is more than 180 days past its ToDt.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, Table, TableHead, TableRow,
  TableCell, TableBody, IconButton, Chip, TextField, MenuItem,
  Alert, CircularProgress, Tooltip,
} from '@mui/material';
import AddIcon           from '@mui/icons-material/Add';
import EditIcon          from '@mui/icons-material/Edit';
import DeleteIcon        from '@mui/icons-material/Delete';
import DownloadIcon      from '@mui/icons-material/Download';
import VisibilityIcon    from '@mui/icons-material/Visibility';
import FolderIcon        from '@mui/icons-material/Folder';
import WarningAmberIcon  from '@mui/icons-material/WarningAmber';
import api               from '../../services/api';
import { useAuth }       from '../../contexts/AuthContext';

// Full base URL of the Express server (strips /api suffix).
// Needed because /uploads is served by Express, not the React dev server.
const STATIC_BASE = (import.meta.env.VITE_API_BASE_URL || '/api')
  .replace(/\/api\/?$/, '');

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(val) {
  if (!val) return '—';
  return String(val).slice(0, 10).split('-').reverse().join('/'); // yyyy-mm-dd → dd/mm/yyyy
}

function daysDiff(toDtStr) {
  // Positive = days until expiry; negative = days since expiry
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dt = new Date(String(toDtStr).slice(0, 10));
  dt.setHours(0, 0, 0, 0);
  return Math.round((dt - today) / 86400000);
}

// ── Row status colour ─────────────────────────────────────────────────────────
function rowBg(toDtStr) {
  const diff = daysDiff(toDtStr);
  if (diff < 0)   return '#FFEBEE'; // red — expired
  if (diff < 30)  return '#FFFDE7'; // yellow — about to expire
  return '#E8F5E9';                 // green — healthy
}

function statusLabel(toDtStr) {
  const diff = daysDiff(toDtStr);
  if (diff < 0)  return { label: 'Expired',         color: 'error' };
  if (diff < 30) return { label: 'Expiring Soon',   color: 'warning' };
  return               { label: 'Valid',             color: 'success' };
}

// ── File URL builder ──────────────────────────────────────────────────────────
// Must use full server origin so the request goes to Express, not the React
// dev server. STATIC_BASE resolves to e.g. http://localhost:3001
function fileUrl(fileName) {
  return `${STATIC_BASE}/uploads/Documents/DocFiles/${encodeURIComponent(fileName)}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DocListPage() {
  const navigate      = useNavigate();
  const { can }       = useAuth();

  const [docs,       setDocs]       = useState([]);
  const [filterType, setFilterType] = useState('');
  const [filterAct,  setFilterAct]  = useState('Y');
  const [docTypes,   setDocTypes]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('docType', filterType);
      if (filterAct)  params.set('active',  filterAct);
      const { data } = await api.get(`/masters/docfiles?${params}`);
      setDocs(data);

      // Refresh doc types for filter dropdown
      const { data: types } = await api.get('/masters/docfiles/doctypes');
      setDocTypes(types);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterAct]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(row) {
    const label = `${row.DocType} — ${fmtDate(row.ToDt)}`;
    if (!window.confirm(`Permanently delete document "${label}"?\n\nThis will also delete the file from disk and cannot be undone.`)) return;
    try {
      await api.delete(`/masters/docfiles/${row.pkDocID}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  }

  return (
    <Box>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <FolderIcon color="primary" />
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
          Document Files
        </Typography>

        {/* Filters */}
        <TextField
          select label="Doc Type" size="small" sx={{ width: 160 }}
          value={filterType} onChange={(e) => setFilterType(e.target.value)}
        >
          <MenuItem value="">All Types</MenuItem>
          {docTypes.map((t) => (
            <MenuItem key={t} value={t}>{t}</MenuItem>
          ))}
        </TextField>

        <TextField
          select label="Status" size="small" sx={{ width: 120 }}
          value={filterAct} onChange={(e) => setFilterAct(e.target.value)}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="Y">Active</MenuItem>
          <MenuItem value="N">Inactive</MenuItem>
        </TextField>

        {can('DOCUMENTS', 'CanAdd') && (
          <Button
            variant="contained" size="small" startIcon={<AddIcon />}
            onClick={() => navigate('/masters/docfiles/new')}
          >
            Add Document
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        {[
          { bg: '#E8F5E9', label: 'Healthy (> 30 days)' },
          { bg: '#FFFDE7', label: 'Expiring within 30 days' },
          { bg: '#FFEBEE', label: 'Expired' },
        ].map(({ bg, label }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 16, height: 16, bgcolor: bg, border: '1px solid #ccc', borderRadius: 0.5 }} />
            <Typography variant="caption" color="text.secondary">{label}</Typography>
          </Box>
        ))}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.dark' }} />
          <Typography variant="caption" color="text.secondary">Overdue for deletion (180+ days past expiry)</Typography>
        </Box>
      </Box>

      <Paper elevation={1}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F5F7FA' }}>
                <TableCell sx={{ fontWeight: 600 }}>Doc Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Party</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Godown</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>From Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>To Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Active</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No documents found. {can('DOCUMENTS', 'CanAdd') ? 'Click "Add Document" to upload one.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                docs.map((row) => {
                  const { label: sLabel, color: sColor } = statusLabel(row.ToDt);
                  const stale = daysDiff(row.ToDt) < -180;
                  return (
                    <TableRow
                      key={row.pkDocID}
                      sx={{ bgcolor: rowBg(row.ToDt), '&:hover': { filter: 'brightness(0.96)' } }}
                    >
                      <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>
                        {row.DocType}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Tooltip title={row.DocDiscrption} placement="top-start">
                          <span>{row.DocDiscrption}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{row.PartyName || '—'}</TableCell>
                      <TableCell>{row.GodownNum || '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(row.FromDt)}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(row.ToDt)}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Chip label={sLabel} color={sColor} size="small" />
                          {stale && (
                            <Tooltip title="Document expired 180+ days ago — consider deleting this record">
                              <WarningAmberIcon sx={{ fontSize: 18, color: 'warning.dark' }} />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.Active === 'Y' ? 'Active' : 'Inactive'}
                          color={row.Active === 'Y' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {/* View — open file in new tab via a real anchor (works for PDF + images) */}
                        <Tooltip title="View File">
                          <IconButton size="small" color="primary"
                            component="a"
                            href={fileUrl(row.FileName)}
                            target="_blank"
                            rel="noopener noreferrer">
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        {/* Download */}
                        {can('DOCUMENTS', 'CanExport') && (
                        <Tooltip title="Download File">
                          <IconButton size="small"
                            onClick={async () => {
                              try {
                                const response = await fetch(fileUrl(row.FileName));
                                if (!response.ok) throw new Error('Network error');
                                const blob = await response.blob();
                                const url  = URL.createObjectURL(blob);
                                const a    = document.createElement('a');
                                a.href     = url;
                                a.download = row.FileName;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                // Revoke after a delay so the browser finishes reading the blob
                                setTimeout(() => URL.revokeObjectURL(url), 5000);
                              } catch {
                                setError('Download failed');
                              }
                            }}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        )}

                        {/* Edit */}
                        {can('DOCUMENTS', 'CanEdit') && (
                          <Tooltip title="Edit">
                            <IconButton size="small" color="info"
                              onClick={() => navigate(`/masters/docfiles/${encodeId(row.pkDocID)}/edit`)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}

                        {/* Delete */}
                        {can('DOCUMENTS', 'CanDelete') && (
                          <Tooltip title="Delete (permanent)">
                            <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}
