// ─────────────────────────────────────────────────────────────────────────────
// BillGenPage — Godown Rent Bill Generation
// VB6 Source: frmBillGen.frm
//
// 3-step wizard:
//   Step 0 (Party Selection)  : Bill Month (M/Y only), Billable toggle, party grid
//   Step 1 (Lot Selection)    : Lot grid with billing periods, balances, CSV export
//   Step 2 (Bill Generation)  : Confirm and generate, show results
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Paper, Radio, RadioGroup,
  Stack, Step, StepLabel, Stepper,
  Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CheckCircleIcon   from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon  from '@mui/icons-material/ArrowForward';
import ArrowBackIcon     from '@mui/icons-material/ArrowBack';
import FileDownloadIcon  from '@mui/icons-material/FileDownload';
import ReceiptLongIcon   from '@mui/icons-material/ReceiptLong';
import RefreshIcon       from '@mui/icons-material/Refresh';
import WarningAmberIcon  from '@mui/icons-material/WarningAmber';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const fmt     = n => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const STEPS = ['Party Selection', 'Lot Selection', 'Generate Bills'];

export default function BillGenPage() {
  const { user, can } = useAuth();
  const compID = user?.compID || '';

  // ── Form state ─────────────────────────────────────────────────────────────
  const [step,      setStep]      = useState(0);
  const [billMonth, setBillMonth] = useState('');  // YYYY-MM for the picker input
  const [billDate,  setBillDate]  = useState('');  // YYYY-MM-DD actual bill-to date (from mCompBillDate)
  const [billFrom,  setBillFrom]  = useState('');
  const [billTo,    setBillTo]    = useState('');
  const [billable,  setBillable]  = useState('Y'); // 'Y' Billable / 'N' Non-Billable

  // ── Data state ─────────────────────────────────────────────────────────────
  const [parties,         setParties]         = useState([]);
  const [selectedParties, setSelectedParties] = useState(new Set());
  const [lots,            setLots]            = useState([]);
  const [selectedLots,    setSelectedLots]    = useState(new Set()); // index-based
  const [generated,          setGenerated]          = useState([]);
  const [duplicates,         setDuplicates]         = useState([]);
  const [shuffledPartyOrder, setShuffledPartyOrder] = useState([]); // randomized party order for bill gen
  const [confirmOpen,        setConfirmOpen]        = useState(false); // duplicate-warning dialog
  const [zeroRateOpen,       setZeroRateOpen]       = useState(false); // zero-rate warning dialog

  // ── Loading / error ────────────────────────────────────────────────────────
  const [loadingForm, setLoadingForm] = useState(false);
  const [loadingLots, setLoadingLots] = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState('');

  // ── Load form-data: parties + bill period from mCompBillDate ─────────────
  // bYearMonth: 'YYYY-MM' — we append '-01' so the backend resolves the real
  // BillDay from mCompBillDate and returns the true billTo date.
  const loadFormData = useCallback(async (bYearMonth) => {
    setLoadingForm(true);
    setError('');
    try {
      const params = {};
      if (bYearMonth) params.billDate = bYearMonth + '-01';
      const { data } = await api.get('/billing/godrent/form-data', { params });
      setParties(data.parties || []);
      if (data.period) {
        const { billTo: bt, billFrom: bf } = data.period;
        setBillTo(bt || '');
        setBillFrom(bf || '');
        setBillDate(bt || '');
        // Keep picker in sync with the resolved bill-to month
        if (bt) setBillMonth(bt.slice(0, 7));
      }
      setSelectedParties(new Set());
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingForm(false);
    }
  }, []);

  // Initial load — no month argument, backend defaults to current date
  useEffect(() => { loadFormData(''); }, []); // eslint-disable-line

  // Month picker change: user picks YYYY-MM, we resolve the period
  const handleBillMonthChange = (e) => {
    const ym = e.target.value; // 'YYYY-MM'
    setBillMonth(ym);
    if (ym) loadFormData(ym);
  };

  // ── Step 0: Party selection ────────────────────────────────────────────────
  const [partySearch, setPartySearch] = useState('');

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    return q ? parties.filter(p => p.pName.toLowerCase().includes(q)) : parties;
  }, [parties, partySearch]);

  const toggleParty = (pkPartyID) => {
    setSelectedParties(prev => {
      const next = new Set(prev);
      if (next.has(pkPartyID)) next.delete(pkPartyID); else next.add(pkPartyID);
      return next;
    });
  };
  const allFilteredSelected = filteredParties.length > 0 &&
    filteredParties.every(p => selectedParties.has(p.pkPartyID));
  const someFilteredSelected = filteredParties.some(p => selectedParties.has(p.pkPartyID));
  const toggleAllParties = () => {
    setSelectedParties(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredParties.forEach(p => next.delete(p.pkPartyID));
      else filteredParties.forEach(p => next.add(p.pkPartyID));
      return next;
    });
  };

  // Validate duplicates first; if any found open the warning dialog and wait for user confirmation.
  const goToLots = async () => {
    if (selectedParties.size === 0) { setError('Select at least one party.'); return; }
    if (!billDate) { setError('Bill month is required.'); return; }
    setError('');

    let dups = [];
    try {
      const { data: val } = await api.post('/billing/godrent/validate', {
        billDate, partyIDs: [...selectedParties],
      });
      dups = val.duplicates || [];
    } catch { dups = []; }

    setDuplicates(dups);

    if (dups.length > 0) {
      // Stop here and open the confirmation dialog — user must explicitly proceed
      setConfirmOpen(true);
      return;
    }

    await fetchLots();
  };

  // Actually load lots and advance to Step 1. Called either directly (no duplicates)
  // or after the user clicks "Proceed Anyway" in the confirmation dialog.
  const fetchLots = async () => {
    setConfirmOpen(false);
    setLoadingLots(true);
    try {
      const { data } = await api.post('/billing/godrent/lots', {
        billDate, partyIDs: [...selectedParties], billable,
      });
      setLots(data.lots || []);
      if (data.billFrom) setBillFrom(data.billFrom);
      if (data.billTo)   setBillTo(data.billTo);
      setSelectedLots(new Set(data.lots.map((_, i) => i)));
      setStep(1);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingLots(false);
    }
  };

  // ── Step 1: Lot selection ──────────────────────────────────────────────────
  const toggleLot = (i) => {
    setSelectedLots(prev => {
      const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next;
    });
  };
  const toggleAllLots = () => {
    if (selectedLots.size === lots.length) setSelectedLots(new Set());
    else setSelectedLots(new Set(lots.map((_, i) => i)));
  };

  const lotSummary = useMemo(() => {
    let gross = 0;
    [...selectedLots].forEach(i => { gross += lots[i]?.amount || 0; });
    return { count: selectedLots.size, gross };
  }, [selectedLots, lots]);

  // CSV export: all loaded lots (both selected and unselected), with a Selected column
  const exportLotsCSV = () => {
    const headers = [
      'Party', 'Lot #', 'Item', 'Arrival Date', 'Arv Qty', 'Packing',
      'From Date', 'To Date', 'Balance', 'Rate', 'Amount', 'Selected',
    ];
    const rows = lots.map((lot, i) => [
      lot.pName,
      lot.lotNum,
      lot.iName,
      fmtDate(lot.oriTransDt),
      lot.oriTransQty,
      lot.packing,
      fmtDate(lot.fromDt),
      fmtDate(lot.toDt),
      lot.balQty,
      lot.rentRate,
      (lot.amount || 0).toFixed(2),
      selectedLots.has(i) ? 'Yes' : 'No',
    ]);
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
    const blob = new Blob(['ï»¿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `GodRentLots_${billDate || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const goToGenerate = () => {
    if (selectedLots.size === 0) { setError('Select at least one lot.'); return; }
    setError('');

    // Build unique party order from selected lots, then Fisher-Yates shuffle
    const partyOrder = [...new Map([...selectedLots].map(i => [lots[i].partyID, true])).keys()];
    for (let i = partyOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [partyOrder[i], partyOrder[j]] = [partyOrder[j], partyOrder[i]];
    }
    setShuffledPartyOrder(partyOrder);

    const hasZeroRate = [...selectedLots].some(i => !(lots[i]?.rentRate));
    if (hasZeroRate) { setZeroRateOpen(true); return; }
    setStep(2);
  };

  // ── Step 2: Generate bills ─────────────────────────────────────────────────
  const doGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      // Group selected lots by party
      const byParty = {};
      [...selectedLots].forEach(i => {
        const lot = lots[i];
        if (!byParty[lot.partyID]) byParty[lot.partyID] = [];
        byParty[lot.partyID].push(lot);
      });
      // Submit in the pre-shuffled party order so bill numbers are assigned randomly
      const selectedLotList = shuffledPartyOrder.flatMap(id => byParty[id] || []);

      // Build map of partyID → { pkBillID, billNum } for parties being modified.
      // duplicates[] was populated when the user clicked "Proceed Anyway".
      const existingBillsMap = {};
      duplicates.forEach(d => {
        existingBillsMap[d.fkPartyID] = { pkBillID: d.pkBillID, billNum: d.BillNum };
      });

      const { data } = await api.post('/billing/godrent/generate', {
        billDate, billFrom, billTo, lots: selectedLotList,
        existingBills: existingBillsMap,
      });
      setGenerated(data.generated || []);
      setStep(3);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    setStep(0);
    setLots([]);
    setSelectedLots(new Set());
    setSelectedParties(new Set());
    setGenerated([]);
    setDuplicates([]);
    setShuffledPartyOrder([]);
    setError('');
  };

  // ── Grouped lot display (by party) ────────────────────────────────────────
  const groupedLots = useMemo(() => {
    const groups = {};
    lots.forEach((lot, i) => {
      if (!groups[lot.partyID]) groups[lot.partyID] = { pName: lot.pName, rows: [] };
      groups[lot.partyID].rows.push({ lot, i });
    });
    return Object.values(groups);
  }, [lots]);

  const isDone = step === 3;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <ReceiptLongIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>Godown Rent Bill Generation</Typography>
      </Stack>

      {/* Stepper */}
      <Stepper activeStep={isDone ? 3 : step} sx={{ mb: 3 }}>
        {STEPS.map(label => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── STEP 0: Party Selection ─────────────────────────────────────── */}
      {step === 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {/* Controls row */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-end" mb={2}>
            {/* Month+Year picker — day is resolved from mCompBillDate by the backend */}
            <TextField
              label="Bill Month" type="month" size="small"
              value={billMonth}
              onChange={handleBillMonthChange}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 170 }}
            />

            {/* Resolved billing period (from / to dates with actual BillDay) */}
            {billFrom && billTo && (
              <Box>
                <Typography variant="caption" color="text.secondary">Bill Period</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {fmtDate(billFrom)} — {fmtDate(billTo)}
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="caption" color="text.secondary" display="block">Lot Filter</Typography>
              <RadioGroup row value={billable} onChange={e => setBillable(e.target.value)}>
                <FormControlLabel value="Y" control={<Radio size="small" />} label="Billable" />
                <FormControlLabel value="N" control={<Radio size="small" />} label="Non-Billable" />
              </RadioGroup>
            </Box>

            {/* Party name search */}
            <TextField
              label="Search Party" size="small" placeholder="Type to filter…"
              value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
              sx={{ width: 220 }}
              inputProps={{ autoComplete: 'off' }}
            />
          </Stack>

          {/* Party grid */}
          {loadingForm ? (
            <Box textAlign="center" py={4}><CircularProgress /></Box>
          ) : (
            <TableContainer sx={{ maxHeight: 500, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={allFilteredSelected}
                        indeterminate={!allFilteredSelected && someFilteredSelected}
                        onChange={toggleAllParties}
                      />
                    </TableCell>
                    <TableCell>Party Name</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell>Bill Type</TableCell>
                    <TableCell>Group</TableCell>
                    <TableCell>ST Flag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredParties.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        {parties.length === 0
                          ? 'No active parties configured for Godown Rent in this company.'
                          : 'No parties match your search.'}
                      </TableCell>
                    </TableRow>
                  ) : filteredParties.map(p => {
                    const checked = selectedParties.has(p.pkPartyID);
                    return (
                      <TableRow key={p.pkPartyID} hover selected={checked}
                        onClick={() => toggleParty(p.pkPartyID)} sx={{ cursor: 'pointer' }}>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={checked}
                            onClick={e => e.stopPropagation()} onChange={() => toggleParty(p.pkPartyID)} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 13 }}>{p.pName}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{p.pCode}</TableCell>
                        <TableCell>
                          <Chip label={p.pBillType || '-'} size="small" sx={{ fontSize: 10, height: 18 }} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{p.pGroup}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{p.StFlagGodRent}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
            <Typography variant="body2" color="text.secondary">
              {selectedParties.size} / {parties.length} parties selected
              {partySearch && filteredParties.length !== parties.length &&
                ` (${filteredParties.length} shown)`}
            </Typography>
            <Button
              variant="contained"
              endIcon={loadingLots ? <CircularProgress size={16} color="inherit" /> : <ArrowForwardIcon />}
              disabled={selectedParties.size === 0 || loadingLots || loadingForm}
              onClick={goToLots}
            >
              Load Lots
            </Button>
          </Stack>

        </Paper>
      )}

      {/* ── STEP 1: Lot Selection ───────────────────────────────────────── */}
      {step === 1 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {/* Summary bar */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle2">
              Bill Period: <strong>{fmtDate(billFrom)}</strong> — <strong>{fmtDate(billTo)}</strong>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              Lots: <strong>{lots.length}</strong>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              Selected: <strong>{selectedLots.size}</strong>
              {billable === 'Y' && (
                <>&nbsp;&nbsp;|&nbsp;&nbsp;Gross: <strong>₹{fmt(lotSummary.gross)}</strong></>
              )}
            </Typography>
            <Stack direction="row" spacing={1}>
              {can('BILL_GEN', 'CanExport') && (
              <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />}
                disabled={lots.length === 0} onClick={exportLotsCSV}>
                Export Excel
              </Button>
              )}
              <Button size="small" startIcon={<ArrowBackIcon />}
                onClick={() => { setStep(0); setLots([]); }}>
                Back
              </Button>
            </Stack>
          </Stack>

          {lots.length === 0 ? (
            <Alert severity="info">No lots found for the selected parties and billing period.</Alert>
          ) : (
            <TableContainer sx={{ maxHeight: 540, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={lots.length > 0 && selectedLots.size === lots.length}
                        indeterminate={selectedLots.size > 0 && selectedLots.size < lots.length}
                        onChange={toggleAllLots}
                      />
                    </TableCell>
                    <TableCell>Party</TableCell>
                    <TableCell>Lot #</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell>Arrival Dt</TableCell>
                    <TableCell align="right">Arv Qty</TableCell>
                    <TableCell>From Dt</TableCell>
                    <TableCell>To Dt</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    {billable === 'Y' && <TableCell align="right">Amount</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupedLots.map(group =>
                    group.rows.map(({ lot, i }, ri) => {
                      const checked = selectedLots.has(i);
                      const zeroRate = !lot.rentRate;
                      return (
                        <TableRow key={i} hover selected={checked}
                          onClick={() => toggleLot(i)}
                          sx={{
                            cursor: 'pointer',
                            ...(zeroRate && {
                              bgcolor: '#ffebee',
                              '&:hover':             { bgcolor: '#ffcdd2' },
                              '&.Mui-selected':      { bgcolor: '#ffcdd2' },
                              '&.Mui-selected:hover':{ bgcolor: '#ef9a9a' },
                            }),
                          }}>
                          <TableCell padding="checkbox">
                            <Checkbox size="small" checked={checked}
                              onClick={e => e.stopPropagation()} onChange={() => toggleLot(i)} />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontWeight: ri === 0 ? 600 : 400 }}>
                            {ri === 0 ? lot.pName : ''}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{lot.lotNum}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{lot.iName}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{fmtDate(lot.oriTransDt)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: 11 }}>
                            {lot.oriTransQty} {lot.packing}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{fmtDate(lot.fromDt)}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{fmtDate(lot.toDt)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: 12, fontWeight: 500 }}>{lot.balQty}</TableCell>
                          <TableCell align="right" sx={{ fontSize: 12 }}>{lot.rentRate}</TableCell>
                          {billable === 'Y' && (
                            <TableCell align="right" sx={{ fontSize: 12, fontWeight: 600 }}>
                              ₹{fmt(lot.amount)}
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

          <Stack direction="row" justifyContent="flex-end" spacing={2} mt={2}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />}
              onClick={() => { setStep(0); setLots([]); }}>
              Back
            </Button>
            {/* Review & Generate hidden for Non-Billable — no bills are produced */}
            {billable === 'Y' && (
              <Button variant="contained" endIcon={<ArrowForwardIcon />}
                disabled={selectedLots.size === 0} onClick={goToGenerate}>
                Review &amp; Generate
              </Button>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── STEP 2: Confirm and Generate ───────────────────────────────── */}
      {step === 2 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>Review Bill Summary</Typography>

          {/* Per-party summary — shown in randomized bill generation order */}
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            Bill generation order (randomized)
          </Typography>
          {(() => {
            const byParty = {};
            [...selectedLots].forEach(i => {
              const lot = lots[i];
              if (!byParty[lot.partyID]) byParty[lot.partyID] = { pName: lot.pName, lots: [], gross: 0 };
              byParty[lot.partyID].lots.push(lot);
              byParty[lot.partyID].gross += lot.amount || 0;
            });
            const updatingIDs = new Set(duplicates.map(d => d.fkPartyID));
            return shuffledPartyOrder.filter(id => byParty[id]).map((partyID, idx) => {
              const p = byParty[partyID];
              const isUpdate = updatingIDs.has(partyID);
              return (
                <Box key={partyID} sx={{ mb: 1, p: 1.5, border: '1px solid', borderColor: isUpdate ? 'warning.main' : 'divider', borderRadius: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip label={idx + 1} size="small" sx={{ fontSize: 11, height: 20, minWidth: 28 }} />
                      <Typography variant="body2" fontWeight={700}>{p.pName}</Typography>
                      {isUpdate && <Chip label="Updating existing" size="small" color="warning" sx={{ fontSize: 10, height: 18 }} />}
                    </Stack>
                    <Typography variant="body2" fontWeight={600}>
                      ₹{fmt(p.gross)} &nbsp;({p.lots.length} lots)
                    </Typography>
                  </Stack>
                </Box>
              );
            });
          })()}

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Company</Typography>
              <Typography variant="body2" fontWeight={600}>{compID}</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Bill Date</Typography>
              <Typography variant="body2" fontWeight={600}>{fmtDate(billDate)}</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Period</Typography>
              <Typography variant="body2" fontWeight={600}>{fmtDate(billFrom)} — {fmtDate(billTo)}</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Total Lots</Typography>
              <Typography variant="body2" fontWeight={600}>{selectedLots.size}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" justifyContent="flex-end" spacing={2} mt={3}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="contained" color="success"
              startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
              disabled={generating} onClick={doGenerate}>
              {generating ? 'Generating...' : 'Generate Bills'}
            </Button>
          </Stack>
        </Paper>
      )}

      {/* ── DONE: Results ───────────────────────────────────────────────── */}
      {isDone && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={2}>
            <CheckCircleIcon color="success" />
            <Typography variant="h6" color="success.main">
              {(() => {
                const newCount    = generated.filter(b => !b.isUpdate).length;
                const updateCount = generated.filter(b =>  b.isUpdate).length;
                const parts = [];
                if (newCount)    parts.push(`${newCount} bill(s) generated`);
                if (updateCount) parts.push(`${updateCount} bill(s) updated`);
                return parts.join(', ') + ' successfully';
              })()}
            </Typography>
          </Stack>

          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Action</TableCell>
                  <TableCell>Bill Number</TableCell>
                  <TableCell>Party</TableCell>
                  <TableCell>Bill Date</TableCell>
                  <TableCell align="right">Lots</TableCell>
                  <TableCell align="right">Gross Amt</TableCell>
                  <TableCell align="right">Net Amt</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...generated].sort((a, b) => a.billNum.localeCompare(b.billNum)).map(b => (
                  <TableRow key={b.pkBillID} hover>
                    <TableCell>
                      <Chip
                        label={b.isUpdate ? 'Updated' : 'New'}
                        size="small"
                        color={b.isUpdate ? 'warning' : 'success'}
                        sx={{ fontSize: 10, height: 18 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{b.billNum}</TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{b.pName}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{fmtDate(b.billDate)}</TableCell>
                    <TableCell align="right">{b.lotCount}</TableCell>
                    <TableCell align="right">₹{fmt(b.grossAmt)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>₹{fmt(b.netAmt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack direction="row" justifyContent="flex-end" mt={2}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={reset}>
              Generate More Bills
            </Button>
          </Stack>
        </Paper>
      )}
      {/* ── Zero-rate warning dialog ────────────────────────────────────── */}
      <Dialog open={zeroRateOpen} onClose={() => setZeroRateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1}>
            <WarningAmberIcon color="error" />
            <Typography variant="h6">Lots with Zero Rate</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            One or more selected lots have a <strong>Rate of Zero</strong>. These lots will
            generate a bill with zero amount. Do you want to proceed?
          </Typography>
          <Box mt={1.5}>
            {[...selectedLots].filter(i => !lots[i]?.rentRate).map(i => (
              <Typography key={i} variant="body2" color="error" sx={{ py: 0.25 }}>
                â€¢ {lots[i].pName} — Lot {lots[i].lotNum}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setZeroRateOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error"
            onClick={() => { setZeroRateOpen(false); setStep(2); }}>
            Proceed Anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Duplicate-bill confirmation dialog ─────────────────────────── */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1}>
            <WarningAmberIcon color="warning" />
            <Typography variant="h6">Bills Already Exist</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" mb={1.5}>
            The following {duplicates.length === 1 ? 'party has' : 'parties have'} already
            been billed for <strong>{fmtDate(billDate)}</strong>. Proceeding will load lots
            for all selected parties — you can still review before generating.
          </Typography>
          {duplicates.map(d => (
            <Box key={d.pkBillID}
              sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5,
                    borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" fontWeight={600}>{d.pName}</Typography>
              <Typography variant="body2" color="text.secondary">
                Bill {d.BillNum} &nbsp;|&nbsp; Net ₹{fmt(d.NetAmt)}
              </Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={fetchLots}>
            Proceed Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
