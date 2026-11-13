// BillNumberEditorPage — View, edit bill numbers, and delete bills.
// Godown Rent (tBill1), Hamali (tBillTrHmGen1/HMLI), General (tBillTrHmGen1/GEN).
// Paid bills (BalanceAmt ≤ 0) are read-only — cannot be updated or deleted.
//
// Permissions: BILL_NUM_EDIT / CanView (view), CanEdit (edit), CanDelete (delete)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Snackbar, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import SaveIcon        from '@mui/icons-material/Save';
import SearchIcon      from '@mui/icons-material/Search';
import RestartAltIcon  from '@mui/icons-material/RestartAlt';
import DeleteIcon      from '@mui/icons-material/Delete';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api             from '../../services/api';
import { useAuth }     from '../../contexts/AuthContext';

const TABS = [
  { label: 'Godown Rent', value: 'GODRENT' },
  { label: 'Hamali',      value: 'HMLI' },
  { label: 'General',     value: 'GEN' },
];

const today        = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => new Date().toISOString().slice(0, 8) + '01';
const fmt    = (n) => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDt  = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; };

const isPaid = (row) => row.BalanceAmt != null && parseFloat(row.BalanceAmt) <= 0.001;
const isOld  = (row) => {
  if (!row.BillDt) return false;
  return (Date.now() - new Date(row.BillDt).getTime()) / 86400000 > 70;
};

// ── Bill-number format rules ───────────────────────────────────────────────────
// Format: PREFIX/YYZZ/NNNN  e.g. GR/2627/0001
const BILL_FORMAT = {
  GODRENT: { prefix: 'GR', label: 'Godown Rent', example: 'GR/2627/0001' },
  HMLI:    { prefix: 'HM', label: 'Hamali',      example: 'HM/2627/0186' },
  GEN:     { prefix: 'GN', label: 'General',     example: 'GN/2627/0001' },
};
const BILL_REGEX = {
  GODRENT: /^GR\/\d{4}\/\d{4}$/,
  HMLI:    /^HM\/\d{4}\/\d{4}$/,
  GEN:     /^GN\/\d{4}\/\d{4}$/,
};

// Returns a Map of pkBillID → error string for all validation failures
function validateBillNums(changedRows, edits) {
  const errors = new Map();
  const seenNums = new Map(); // `${BillType}:${num}` → pkBillID (within-batch dup check)

  for (const row of changedRows) {
    const newNum = String(edits[row.pkBillID] ?? '').trim();
    const fmt    = BILL_FORMAT[row.BillType];
    const rx     = BILL_REGEX[row.BillType];

    if (!newNum) {
      errors.set(row.pkBillID, 'Bill number cannot be blank.');
      continue;
    }

    if (rx && !rx.test(newNum)) {
      errors.set(row.pkBillID,
        `Invalid format. Expected: ${fmt?.prefix ?? '??'}/YYZZ/NNNN (e.g. ${fmt?.example ?? 'XX/2627/0001'}).`
      );
      continue;
    }

    const key = `${row.BillType}:${newNum}`;
    if (seenNums.has(key)) {
      errors.set(row.pkBillID, `Duplicate bill number "${newNum}" used more than once in this save batch.`);
    } else {
      seenNums.set(key, row.pkBillID);
    }
  }
  return errors;
}

export default function BillNumberEditorPage() {
  const { can } = useAuth();
  const canEdit   = can('BILL_NUM_EDIT', 'CanEdit');
  const canDelete = can('BILL_NUM_EDIT', 'CanDelete');

  const [tabIdx,       setTabIdx]       = useState(0);
  const [fromDate,     setFromDate]     = useState(firstOfMonth());
  const [toDate,       setToDate]       = useState(today());
  const [partySearch,  setPartySearch]  = useState('');

  const [rows,        setRows]        = useState([]);
  const [edits,       setEdits]       = useState({});   // pkBillID → new bill number string
  const [validErrors, setValidErrors] = useState(new Map()); // pkBillID → error string
  const [sort,        setSort]        = useState({ col: 'BillDt', dir: 'desc' });
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [fetchErr,    setFetchErr]    = useState('');

  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState(null);  // { pkBillID, billType, compID, BillNum, pName }
  const [deleting,     setDeleting]     = useState(false);

  const [toast, setToast] = useState({ open: false, msg: '', severity: 'success' });
  const showToast = (msg, severity = 'success') => setToast({ open: true, msg, severity });

  const billType = TABS[tabIdx].value;

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchBills = useCallback(async () => {
    setLoading(true);
    setFetchErr('');
    setEdits({});
    try {
      const { data } = await api.get('/billing/bill-numbers', { params: { billType, fromDate, toDate } });
      setRows(data.rows || []);
    } catch (err) {
      setFetchErr(err.response?.data?.error || err.message || 'Failed to load bills.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [billType, fromDate, toDate]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const toggleSort = (col) =>
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }));

  // ── Party search filter + sort ────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    const filtered = q ? rows.filter(r => (r.pName || '').toLowerCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => {
      const aVal = sort.col === 'BillDt' ? a.BillDt : (a.BillNum || '');
      const bVal = sort.col === 'BillDt' ? b.BillDt : (b.BillNum || '');
      const cmp  = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sort.dir === 'desc' ? -cmp : cmp;
    });
  }, [rows, partySearch, sort]);

  // ── Edit tracking ─────────────────────────────────────────────────────────────
  const handleEdit = (pkBillID, value) => {
    setEdits(prev => ({ ...prev, [pkBillID]: value }));
    if (validErrors.has(pkBillID)) {
      setValidErrors(prev => { const m = new Map(prev); m.delete(pkBillID); return m; });
    }
  };

  // Only unpaid + within-70-day changed rows are saveable
  const changedRows = useMemo(() =>
    rows.filter(r => !isPaid(r) && !isOld(r) && Object.prototype.hasOwnProperty.call(edits, r.pkBillID)),
    [rows, edits]
  );

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!changedRows.length) { showToast('No changes to save.', 'info'); return; }

    // Client-side validation: blank, format, within-batch duplicates
    const errors = validateBillNums(changedRows, edits);
    setValidErrors(errors);
    if (errors.size) {
      showToast(`${errors.size} validation error(s) — fix highlighted rows before saving.`, 'error');
      return;
    }

    const updates = changedRows.map(r => ({
      pkBillID:   r.pkBillID,
      billType:   r.BillType,
      newBillNum: String(edits[r.pkBillID]).trim(),
      compID:     r.compID,
    }));
    setSaving(true);
    try {
      const { data } = await api.put('/billing/bill-numbers', { updates });
      setValidErrors(new Map());
      showToast(data.message || `${updates.length} bill number(s) saved.`);
      await fetchBills();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Save failed.';
      // Surface per-record errors from 207 partial-failure response
      if (err.response?.status === 207 && Array.isArray(err.response.data?.results)) {
        const serverErrors = new Map();
        err.response.data.results
          .filter(r => r.status === 'error')
          .forEach(r => serverErrors.set(r.pkBillID, r.error));
        setValidErrors(serverErrors);
      }
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDeleteClick = (row) => setDeleteTarget(row);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data } = await api.delete('/billing/bill-numbers', {
        data: { deletes: [{ pkBillID: deleteTarget.pkBillID, billType: deleteTarget.BillType, compID: deleteTarget.compID }] },
      });
      showToast(data.message || 'Bill deleted.');
      setDeleteTarget(null);
      await fetchBills();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Delete failed.';
      showToast(msg, 'error');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Tab change ────────────────────────────────────────────────────────────────
  const handleTabChange = (_, newIdx) => {
    setTabIdx(newIdx);
    setEdits({});
    setValidErrors(new Map());
    setPartySearch('');
  };

  const handleReset = () => {
    setEdits({});
    setValidErrors(new Map());
    setPartySearch('');
    setFromDate(firstOfMonth());
    setToDate(today());
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Bill Number Editor
      </Typography>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: 2, mb: 2 }}>
        <Tabs value={tabIdx} onChange={handleTabChange}
          sx={{ borderBottom: '1px solid #e0e0e0', px: 1 }}>
          {TABS.map(t => (
            <Tab key={t.value} label={t.label} sx={{ fontSize: 13, fontWeight: 600 }} />
          ))}
        </Tabs>

        {/* ── Filters ─────────────────────────────────────────────────────────── */}
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
            <TextField label="From Date" type="date" size="small" value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
            <TextField label="To Date" type="date" size="small" value={toDate}
              onChange={e => setToDate(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
            <TextField label="Search Party" size="small" value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
              sx={{ width: 200 }} placeholder="Type to filter..." />
            <Button variant="contained" size="small" startIcon={<SearchIcon />}
              onClick={fetchBills} disabled={loading}>
              Load
            </Button>
            <Button variant="outlined" size="small" startIcon={<RestartAltIcon />}
              onClick={handleReset} disabled={loading || saving}>
              Reset
            </Button>
            {canEdit && (
              <Button variant="contained" size="small" color="success"
                startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || !changedRows.length}>
                Save Changes{changedRows.length > 0 ? ` (${changedRows.length})` : ''}
              </Button>
            )}
          </Stack>

          {validErrors.size > 0 && (
            <Alert severity="error" sx={{ mt: 1 }}>
              <strong>{validErrors.size} validation error(s)</strong> — fix highlighted rows before saving:
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {[...validErrors.entries()].map(([id, msg]) => {
                  const row = rows.find(r => r.pkBillID === id);
                  return (
                    <li key={id} style={{ fontSize: 12 }}>
                      <strong>{row?.BillNum || id}</strong> ({row?.pName || ''}): {msg}
                    </li>
                  );
                })}
              </ul>
            </Alert>
          )}
        </Box>
      </Paper>

      {/* ── Status line ──────────────────────────────────────────────────────────── */}
      {!loading && !fetchErr && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {visibleRows.length} record(s) shown
          {rows.length !== visibleRows.length ? ` (${rows.length} total)` : ''}
          {changedRows.length > 0 ? ` · ${changedRows.length} unsaved change(s)` : ''}
        </Typography>
      )}

      {fetchErr && <Alert severity="error" sx={{ mb: 2 }}>{fetchErr}</Alert>}

      {/* ── Table ──────────────────────────────────────────────────────────────── */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0}
          sx={{ border: '1px solid #e0e0e0', borderRadius: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: '#E3F2FD' }}>
                <TableCell
                  onClick={() => toggleSort('BillDt')}
                  sx={{ fontWeight: 700, fontSize: 12, cursor: 'pointer', userSelect: 'none',
                        '&:hover': { bgcolor: '#BBDEFB' } }}>
                  Bill Date {sort.col === 'BillDt' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Party</TableCell>
                <TableCell
                  onClick={() => toggleSort('BillNum')}
                  sx={{ fontWeight: 700, fontSize: 12, cursor: 'pointer', userSelect: 'none',
                        '&:hover': { bgcolor: '#BBDEFB' } }}>
                  Current Bill No. {sort.col === 'BillNum' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 200 }}>
                  New Bill No.
                  {!canEdit && (
                    <Typography component="span" variant="caption" color="text.secondary"> (view only)</Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: 12 }}>Amount</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Status</TableCell>
                {canDelete && (
                  <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 56 }} />
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canDelete ? 7 : 6} align="center"
                    sx={{ py: 4, color: 'text.secondary' }}>
                    No bills found for the selected period. Bills may not have been generated yet for this month.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
                  const paid     = isPaid(row);
                  const old      = isOld(row);
                  const locked   = paid || old;
                  const isDirty  = !locked && Object.prototype.hasOwnProperty.call(edits, row.pkBillID);
                  const editVal  = isDirty ? edits[row.pkBillID] : row.BillNum;
                  const rowError = validErrors.get(row.pkBillID);
                  const lockTip  = paid ? 'Paid bills cannot be edited'
                                 : old  ? 'Bills older than 70 days cannot be edited'
                                 : '';

                  return (
                    <TableRow
                      key={`${row.compID}-${row.BillType}-${row.pkBillID}`}
                      sx={{
                        bgcolor: rowError ? '#FFEBEE'
                               : locked   ? '#f9f9f9'
                               : isDirty  ? '#FFF8E1'
                               : undefined,
                        '&:hover': {
                          bgcolor: rowError ? '#FFCDD2'
                                 : locked   ? '#f3f3f3'
                                 : isDirty  ? '#FFF3CD'
                                 : '#F5F7FA',
                        },
                        opacity: locked ? 0.75 : 1,
                      }}
                    >
                      <TableCell sx={{ fontSize: 12 }}>{fmtDt(row.BillDt)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{row.pName}</TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{row.BillNum}</TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Tooltip title={lockTip} placement="top">
                          <span>
                            <TextField
                              size="small"
                              value={editVal ?? ''}
                              onChange={e => handleEdit(row.pkBillID, e.target.value)}
                              disabled={!canEdit || locked}
                              error={!!rowError}
                              helperText={rowError || undefined}
                              inputProps={{ style: { fontSize: 12, fontFamily: 'monospace', padding: '4px 8px' } }}
                              sx={{ width: 220 }}
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(row.NetAmt)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={paid ? 'Paid' : 'Unpaid'}
                          size="small"
                          sx={{
                            fontSize: 10, height: 18,
                            bgcolor: paid ? '#e8f5e9' : '#fff3e0',
                            color:   paid ? '#2e7d32' : '#e65100',
                          }}
                        />
                      </TableCell>
                      {canDelete && (
                        <TableCell sx={{ py: 0.5, px: 0.5 }}>
                          <Tooltip title={
                            paid ? 'Cannot delete a paid bill'
                          : old  ? 'Cannot delete a bill older than 70 days'
                          : 'Delete bill'
                          }>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                disabled={locked}
                                onClick={() => handleDeleteClick(row)}
                                sx={{ opacity: locked ? 0.4 : 1 }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Delete confirmation dialog ─────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}
        maxWidth="xs" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <WarningAmberIcon color="error" />
            <span>Delete Bill</span>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Typography>
            Permanently delete bill <strong>{deleteTarget?.BillNum}</strong> for{' '}
            <strong>{deleteTarget?.pName}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            This removes the header and all detail lines from the database and cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteConfirm}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Toast ──────────────────────────────────────────────────────────────── */}
      <Snackbar open={toast.open} autoHideDuration={4000}
        onClose={() => setToast(t => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast.severity}
          onClose={() => setToast(t => ({ ...t, open: false }))}
          sx={{ width: '100%' }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
