// Transfer Opening Balance  (migrated from VB6 frmTrfOpnBal.frm)
//
// Transfers the closing stock balance of the PREVIOUS financial year as
// opening-balance entries (OpFlg = 'Y') in the CURRENT financial year.
// TransDt of opening entries = last day of the previous FaYear.
//
// Workflow:
//   1. Page loads: fetches parties + FaYear info from /init.
//   2. User selects parties (checkboxes) and clicks "Go".
//   3. Backend /execute runs the transfer for all selected parties.
//   4. Results table shows transferred lots; error table shows skipped lots.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, Grid, TextField, Chip, Divider,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import api from '../../services/api';

function fmtDate(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}

export default function TransferOpnBalPage() {
  const navigate = useNavigate();
  const { can } = useAuth();

  // Init data from server
  const [parties,       setParties]       = useState([]);
  const [sourceFaYear,  setSourceFaYear]  = useState(''); // previous FY (source of closing balance)
  const [targetFaYear,  setTargetFaYear]  = useState(''); // current FY (destination for opening entries)
  const [transDate,     setTransDate]     = useState(''); // last day of previous FY (TransDt)

  // Selection state
  const [selected, setSelected] = useState(new Set());

  // Operation state
  const [initLoading,  setInitLoading]  = useState(true);
  const [initError,    setInitError]    = useState('');
  const [executing,    setExecuting]    = useState(false);
  const [execError,    setExecError]    = useState('');
  const [result,       setResult]       = useState(null);

  // Load init data on mount
  useEffect(() => {
    api.get('/transactions/transfer-opn-bal/init')
      .then(({ data }) => {
        setParties(data.parties || []);
        setSourceFaYear(data.sourceFaYear || '');
        setTargetFaYear(data.targetFaYear || '');
        setTransDate(data.transDate || '');
      })
      .catch((err) => {
        setInitError(err.response?.data?.error || 'Failed to load data');
      })
      .finally(() => setInitLoading(false));
  }, []);

  const allSelected = parties.length > 0 && selected.size === parties.length;
  const someSelected = selected.size > 0 && selected.size < parties.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(parties.map((p) => p.pkPartyID)));
    }
  };

  const toggleParty = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGo = async () => {
    if (selected.size === 0) return;
    setExecuting(true);
    setExecError('');
    setResult(null);
    try {
      // Use a 10-minute timeout — transferring many lots can take a long time.
      const { data } = await api.post('/transactions/transfer-opn-bal/execute', {
        partyIDs:    [...selected],
        sourceFaYear,
        targetFaYear,
        transDate,
      }, { timeout: 600000 });
      setResult(data);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED') {
        setExecError('Transfer is taking too long. Please try with fewer parties at a time.');
      } else {
        setExecError(err.response?.data?.error || 'Transfer failed');
      }
    } finally {
      setExecuting(false);
    }
  };

  if (initLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <SwapHorizIcon color="primary" />
        <Typography variant="h5" fontWeight="bold">Transfer Opening Balance</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          onClick={handleGo}
          disabled={executing || selected.size === 0 || !sourceFaYear || !targetFaYear || !can('TRF_OPN_BAL', 'CanAdd')}
          startIcon={executing ? <CircularProgress size={18} color="inherit" /> : null}
        >
          {executing ? 'Processing…' : 'Go'}
        </Button>
        <Button variant="outlined" onClick={() => navigate(-1)}>Exit</Button>
      </Box>

      {initError && <Alert severity="error" sx={{ mb: 2 }}>{initError}</Alert>}
      {execError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setExecError('')}>{execError}</Alert>}

      {/* ── FaYear info bar ─────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4}>
            <TextField
              label="From FaYear"
              value={sourceFaYear || '—'}
              size="small"
              fullWidth
              helperText="Previous financial year"
              slotProps={{ input: { readOnly: true } }}
            />
          </Grid>
          <Grid item xs={6} sm={4}>
            <TextField
              label="To FaYear"
              value={targetFaYear || '—'}
              size="small"
              fullWidth
              helperText="Current financial year"
              slotProps={{ input: { readOnly: true } }}
            />
          </Grid>
          <Grid item xs={6} sm={4}>
            <TextField
              label="Transfer Date"
              value={fmtDate(transDate)}
              size="small"
              fullWidth
              helperText="Last day of previous FaYear"
              slotProps={{ input: { readOnly: true } }}
            />
          </Grid>
        </Grid>
      </Paper>

      {/* ── Party selection ─────────────────────────────────────────────── */}
      <Paper sx={{ mb: 2 }}>
        <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ mr: 1 }}>Select Parties:</Typography>
          <Button size="small" variant="outlined"
            onClick={() => setSelected(new Set(parties.map((p) => p.pkPartyID)))}>
            Select All
          </Button>
          <Button size="small" variant="outlined" color="inherit"
            onClick={() => setSelected(new Set())}>
            Deselect All
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {selected.size} / {parties.length} selected
          </Typography>
        </Box>
        <Divider />
        <TableContainer sx={{ maxHeight: 320 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ bgcolor: 'primary.main' }}>
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    sx={{ color: 'black', '&.Mui-checked': { color: 'black' }, '&.MuiCheckbox-indeterminate': { color: 'black' } }}
                  />
                </TableCell>
                {['Party Name', 'Code', 'Group'].map((h) => (
                  <TableCell key={h} sx={{ bgcolor: 'primary.main', fontWeight: 'bold', color: 'black' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {parties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    No parties found
                  </TableCell>
                </TableRow>
              ) : parties.map((p) => (
                <TableRow
                  key={p.pkPartyID}
                  hover
                  selected={selected.has(p.pkPartyID)}
                  onClick={() => toggleParty(p.pkPartyID)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(p.pkPartyID)}
                      onChange={() => toggleParty(p.pkPartyID)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell>{p.pName}</TableCell>
                  <TableCell>{p.pCode || '—'}</TableCell>
                  <TableCell>{p.pGroup || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* Summary */}
          <Alert
            severity={result.errors.length === 0 ? 'success' : 'warning'}
            sx={{ mb: 2 }}
          >
            Transfer complete — {result.processed.length} lot(s) transferred
            {result.errors.length > 0 && `, ${result.errors.length} lot(s) skipped with errors`}.
          </Alert>

          {/* Processed lots */}
          {result.processed.length > 0 && (
            <Paper sx={{ mb: 2 }}>
              <Box sx={{ p: 1.5 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Transferred Lots ({result.processed.length})
                </Typography>
              </Box>
              <Divider />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'success.light' }}>
                      {['#', 'Lot No.', 'Godowns', 'Status'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 'bold' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.processed.map((r, i) => (
                      <TableRow key={i} hover>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{r.LotNum}</TableCell>
                        <TableCell>{r.godowns}</TableCell>
                        <TableCell>
                          <Chip
                            label={r.status}
                            size="small"
                            color={r.status === 're-transferred' ? 'warning' : 'success'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Error lots */}
          {result.errors.length > 0 && (
            <Paper sx={{ mb: 2 }}>
              <Box sx={{ p: 1.5 }}>
                <Typography variant="subtitle1" fontWeight="bold" color="error">
                  Errors / Skipped Lots ({result.errors.length})
                </Typography>
              </Box>
              <Divider />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'error.light' }}>
                      {['Sr.No.', 'Lot No.', 'Description', 'pfkLotID'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 'bold' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i} hover>
                        <TableCell>{e.SrNo}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{e.LotNum || '—'}</TableCell>
                        <TableCell>{e.Description}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                          {e.pfkLotID}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
