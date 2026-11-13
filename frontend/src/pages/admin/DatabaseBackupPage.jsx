// Admin — Database Backup
//
// Backs up one or more MySQL databases (each company + gms_admin) via
// server-side mysqldump → .sql.gz, then provides a download link.
//
// Why save-to-disk rather than stream:
//   Large databases can take minutes; direct HTTP streaming risks timeouts.
//   Saving to disk lets you download the file anytime, see backup history,
//   and retry downloads without re-running the dump.

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, FormControlLabel, Chip, IconButton, Tooltip, Divider,
  LinearProgress,
} from '@mui/material';
import BackupIcon        from '@mui/icons-material/Backup';
import DownloadIcon      from '@mui/icons-material/Download';
import DeleteIcon        from '@mui/icons-material/Delete';
import RefreshIcon       from '@mui/icons-material/Refresh';
import StorageIcon       from '@mui/icons-material/Storage';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function DatabaseBackupPage() {
  const { can } = useAuth();
  const [info,      setInfo]      = useState(null);   // { companies, adminDb, files, backupDir }
  const [loading,   setLoading]   = useState(true);
  const [running,   setRunning]   = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [selected,  setSelected]  = useState(new Set()); // DB names to back up
  const [deleting,  setDeleting]  = useState('');        // filename being deleted

  const loadInfo = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/admin/backup/info');
      setInfo(data);
      // Default: select all known databases
      if (!info) {
        const allDbs = new Set([
          data.adminDb.name,
          ...data.companies.map((c) => c.dbName),
        ]);
        setSelected(allDbs);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadInfo(); }, [loadInfo]);

  const toggleDb = (dbName) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) next.delete(dbName); else next.add(dbName);
      return next;
    });
  };

  const toggleAll = () => {
    if (!info) return;
    const all = [info.adminDb.name, ...info.companies.map((c) => c.dbName)];
    if (all.every((db) => selected.has(db))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(all));
    }
  };

  const handleRunBackup = async () => {
    if (!selected.size) { setError('Select at least one database.'); return; }
    setRunning(true); setError(''); setSuccess('');
    try {
      const { data } = await api.post('/admin/backup/run', { databases: [...selected] });
      const { results, errors } = data;
      if (results.length) {
        const summary = results.map((r) => `${r.db} → ${r.size}`).join('\n');
        const warns   = results.filter((r) => r.warnings).map((r) => `${r.db}: ${r.warnings}`).join('\n');
        setSuccess(`Backed up ${results.length} database(s):\n${summary}${warns ? '\n\nWarnings:\n' + warns : ''}`);
      }
      if (errors.length) {
        setError(errors.map((e) => `${e.db}: ${e.error}`).join('\n'));
      }
      await loadInfo();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = async (filename) => {
    try {
      const response = await api.get(`/admin/backup/download/${encodeURIComponent(filename)}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Download failed: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleDelete = async (filename) => {
    if (!window.confirm(`Delete backup file:\n${filename}\n\nThis cannot be undone.`)) return;
    setDeleting(filename); setError(''); setSuccess('');
    try {
      await api.delete(`/admin/backup/${encodeURIComponent(filename)}`);
      setSuccess(`Deleted: ${filename}`);
      await loadInfo();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setDeleting('');
    }
  };

  const allDbs   = info ? [info.adminDb.name, ...info.companies.map((c) => c.dbName)] : [];
  const allChk   = allDbs.length > 0 && allDbs.every((db) => selected.has(db));
  const someChk  = allDbs.some((db) => selected.has(db));

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography sx={{ mt: 2, color: 'text.secondary' }}>Loading database info…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 900 }}>
      <Typography variant="h6" gutterBottom>Database Backup</Typography>

      {error   && <Alert severity="error"   sx={{ mb: 2, whiteSpace: 'pre-wrap' }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* ── Database selection ── */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Select Databases to Back Up</Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={allChk}
                indeterminate={!allChk && someChk}
                onChange={toggleAll}
                size="small"
              />
            }
            label="Select All"
          />
        </Box>
        <Divider sx={{ mb: 1.5 }} />

        {/* Admin DB */}
        {info && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, p: 1, borderRadius: 1,
            bgcolor: selected.has(info.adminDb.name) ? 'action.selected' : 'transparent' }}>
            <Checkbox
              checked={selected.has(info.adminDb.name)}
              onChange={() => toggleDb(info.adminDb.name)}
              size="small"
            />
            <AdminPanelSettingsIcon fontSize="small" color="primary" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>{info.adminDb.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                Users · Roles · Permissions · Companies — the control plane
              </Typography>
            </Box>
            <Chip label="Admin" color="primary" size="small" variant="outlined" />
          </Box>
        )}

        {/* Company DBs */}
        {info?.companies.map((c) => (
          <Box key={c.pkCompID} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, p: 1, borderRadius: 1,
            bgcolor: selected.has(c.dbName) ? 'action.selected' : 'transparent' }}>
            <Checkbox
              checked={selected.has(c.dbName)}
              onChange={() => toggleDb(c.dbName)}
              size="small"
            />
            <StorageIcon fontSize="small" color="action" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={500}>{c.CompName}</Typography>
              <Typography variant="caption" color="text.secondary">{c.dbName} · {c.pkCompID}</Typography>
            </Box>
            <Chip label={c.CompAlias} size="small" variant="outlined" />
          </Box>
        ))}

        <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={running ? <CircularProgress size={16} color="inherit" /> : <BackupIcon />}
            onClick={handleRunBackup}
            disabled={running || !selected.size}
          >
            {running ? 'Backing Up…' : `Run Backup (${selected.size} DB${selected.size !== 1 ? 's' : ''})`}
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadInfo} disabled={loading || running}>
            Refresh
          </Button>
        </Box>

        {running && (
          <Alert severity="info" sx={{ mt: 1.5 }} icon={false}>
            Running mysqldump — this may take a minute for large databases. Please wait…
          </Alert>
        )}
      </Paper>

      {/* ── Backup files ── */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Backup History
            {info?.files.length ? <Chip label={info.files.length} size="small" sx={{ ml: 1 }} /> : null}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 350, textAlign: 'right' }}>
            {info?.backupDir}
          </Typography>
        </Box>
        <Divider sx={{ mb: 1 }} />

        {!info?.files.length ? (
          <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>
            No backups yet. Run a backup above to create one.
          </Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Filename</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 100 }} align="right">Size</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 170 }}>Created</TableCell>
                  <TableCell sx={{ width: 100 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {info.files.map((f) => (
                  <TableRow key={f.filename} hover>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{f.filename}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>{f.size}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{new Date(f.mtime).toLocaleString()}</TableCell>
                    <TableCell align="center">
                      {can('ADMIN', 'CanExport') && (
                      <Tooltip title="Download">
                        <IconButton size="small" onClick={() => handleDownload(f.filename)}>
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      )}
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(f.filename)}
                          disabled={deleting === f.filename}
                        >
                          {deleting === f.filename
                            ? <CircularProgress size={14} color="error" />
                            : <DeleteIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ── Notes ── */}
      <Paper sx={{ p: 2, mt: 2, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary" component="div">
          <strong>Restore:</strong> &nbsp;
          <code>gunzip &lt; backup-file.sql.gz | mysql -u username -p</code>
          <br />
          <strong>What's included:</strong> All tables, stored procedures, triggers, and a CREATE DATABASE statement —
          each file is self-contained and can be restored independently.
          <br />
          <strong>Backup method:</strong> mysqldump with <code>--single-transaction</code> (InnoDB hot backup, no table locks).
        </Typography>
      </Paper>
    </Box>
  );
}
