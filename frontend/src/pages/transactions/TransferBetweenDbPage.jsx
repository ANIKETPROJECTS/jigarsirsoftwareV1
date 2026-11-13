// Transfer Between DataBase  (migrated from VB6 frmTrfDB.frm)
//
// Moves open stock lots from a party in the CURRENT company database to a
// party in a DIFFERENT (or same) company database.
//
// Workflow:
//   1. Page loads: fetches group company list + old company info from /init.
//   2. User selects destination company → branch auto-fills from init data.
//   3. User selects old party, new party, and sets the cutoff date (fromDt).
//   4. User clicks "Load Lots" → grid populates with all open lots as of fromDt.
//   5. All rows are selected by default; user can deselect, right-click to
//      Select All / Deselect All / Invert Selection.
//   6. Options: "Generate New Lot Numbers" (default OFF), "Reset Lot Serial" (default ON).
//   7. User clicks "Create" → POST /execute; busy spinner during transfer.
//
// Key VB6 runtime defaults (from udfInitialiseControls lines 1168-1169):
//   chkGenLotNum   = vbUnchecked  → genLotNum   = false
//   chkResetLotNum = vbChecked    → resetLotNum  = true

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, Grid, TextField, MenuItem, Divider, FormControlLabel,
  Chip, Menu,
} from '@mui/material';
import SwapHorizIcon   from '@mui/icons-material/SwapHoriz';
import RefreshIcon     from '@mui/icons-material/Refresh';
import PlayArrowIcon   from '@mui/icons-material/PlayArrow';
import api from '../../services/api';

function fmtDate(val) {
  if (!val) return '—';
  const s = typeof val === 'string' ? val : new Date(val).toISOString();
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export default function TransferBetweenDbPage() {
  const navigate = useNavigate();
  const { can } = useAuth();

  // ── Init data ──────────────────────────────────────────────────────────────
  const [oldComp,    setOldComp]    = useState(null);       // { compID, branchID, compName }
  const [companies,  setCompanies]  = useState([]);          // destination company list
  const [initLoading, setInitLoading] = useState(true);
  const [initError,   setInitError]   = useState('');

  // ── Form selections ────────────────────────────────────────────────────────
  const [newCompID,   setNewCompID]   = useState('');
  const [newBranchID, setNewBranchID] = useState('');
  const [oldPartyID,  setOldPartyID]  = useState('');
  const [newPartyID,  setNewPartyID]  = useState('');
  const [fromDt,      setFromDt]      = useState(new Date().toISOString().slice(0, 10));

  // ── Party lists ────────────────────────────────────────────────────────────
  const [oldParties, setOldParties] = useState([]);
  const [newParties, setNewParties] = useState([]);
  const [partiesLoading, setPartiesLoading] = useState(false);

  // ── Lot grid ───────────────────────────────────────────────────────────────
  const [lots,        setLots]        = useState([]);
  const [faYear,      setFaYear]      = useState('');
  const [selected,    setSelected]    = useState(new Set()); // Set of pfkLotID
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError,   setLotsError]   = useState('');

  // ── Options (VB6 runtime defaults) ────────────────────────────────────────
  const [genLotNum,   setGenLotNum]   = useState(false);  // chkGenLotNum  = vbUnchecked
  const [resetLotNum, setResetLotNum] = useState(true);   // chkResetLotNum = vbChecked

  // ── Execution ──────────────────────────────────────────────────────────────
  const [executing,  setExecuting]  = useState(false);
  const [execResult, setExecResult] = useState(null);
  const [execError,  setExecError]  = useState('');

  // ── Right-click context menu ───────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState(null); // { mouseX, mouseY }

  // ── Load init data on mount ────────────────────────────────────────────────
  useEffect(() => {
    api.get('/transactions/transfer-db/init')
      .then(({ data }) => {
        setOldComp(data.oldComp || null);
        setCompanies(data.companies || []);
      })
      .catch((err) => {
        setInitError(err.response?.data?.error || 'Failed to load company list');
      })
      .finally(() => setInitLoading(false));
  }, []);

  // ── Load parties when old comp (always logged-in user's) is ready ──────────
  useEffect(() => {
    if (!oldComp) return;
    api.get('/transactions/transfer-db/old-parties')
      .then(({ data }) => setOldParties(data || []))
      .catch(() => {});
  }, [oldComp]);

  // ── Load new parties when destination company changes ──────────────────────
  const loadNewParties = useCallback((compID, branchID) => {
    if (!compID || !branchID) { setNewParties([]); return; }
    setPartiesLoading(true);
    api.get('/transactions/transfer-db/new-parties', { params: { newCompID: compID, newBranchID: branchID } })
      .then(({ data }) => setNewParties(data || []))
      .catch(() => setNewParties([]))
      .finally(() => setPartiesLoading(false));
  }, []);

  // Handle destination company selection (cascades to branch + new parties)
  const handleNewCompChange = (e) => {
    const compID = e.target.value;
    setNewCompID(compID);
    setNewPartyID('');
    setLots([]);
    setSelected(new Set());
    setExecResult(null);
    setExecError('');

    const found = companies.find((c) => c.pkCompID === compID);
    const branchID = found?.fkBranchID || '';
    setNewBranchID(branchID);
    loadNewParties(compID, branchID);
  };

  // sameCompBranch: true when destination = source (VB6 mFv.bCondFlg = False)
  const sameCompBranch = Boolean(
    oldComp && newCompID === oldComp.compID && newBranchID === oldComp.branchID
  );

  // ── Load lots ──────────────────────────────────────────────────────────────
  const handleLoadLots = async () => {
    if (!oldPartyID || !fromDt) return;
    setLotsLoading(true);
    setLotsError('');
    setLots([]);
    setSelected(new Set());
    setExecResult(null);
    setExecError('');
    try {
      const { data } = await api.get('/transactions/transfer-db/lots', {
        params: { partyID: oldPartyID, fromDt },
      });
      const lotList = data.lots || [];
      setLots(lotList);
      setFaYear(data.faYear || '');
      // All rows selected by default (VB6: ccolTranfSel column initialised to True for all rows)
      setSelected(new Set(lotList.map((l) => l.pfkLotID)));
      if (lotList.length === 0) setLotsError('No open lots found for this party and date');
    } catch (err) {
      setLotsError(err.response?.data?.error || 'Failed to load lots');
    } finally {
      setLotsLoading(false);
    }
  };

  // ── Row selection helpers ──────────────────────────────────────────────────
  const toggleRow   = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll   = () => setSelected(new Set(lots.map((l) => l.pfkLotID)));
  const deselectAll = () => setSelected(new Set());
  const invertSel   = () => setSelected(new Set(lots.filter((l) => !selected.has(l.pfkLotID)).map((l) => l.pfkLotID)));

  const allSelected  = lots.length > 0 && selected.size === lots.length;
  const someSelected = selected.size > 0 && selected.size < lots.length;

  // ── Right-click context menu ───────────────────────────────────────────────
  const handleContextMenu = (e) => {
    if (lots.length === 0) return;
    e.preventDefault();
    setCtxMenu({ mouseX: e.clientX, mouseY: e.clientY });
  };
  const closeCtxMenu = () => setCtxMenu(null);

  // ── Execute transfer ───────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (selected.size === 0 || !newCompID || !newPartyID) return;
    setExecuting(true);
    setExecError('');
    setExecResult(null);

    const selectedLots = lots.filter((l) => selected.has(l.pfkLotID));

    try {
      const { data } = await api.post('/transactions/transfer-db/execute', {
        newCompID,
        newBranchID,
        oldPartyID,
        newPartyID,
        fromDt,
        faYear,
        genLotNum,
        resetLotNum,
        sameCompBranch,
        selectedLots,
      });
      setExecResult(data);
      // Clear grid on success
      setLots([]);
      setSelected(new Set());
    } catch (err) {
      setExecError(err.response?.data?.error || 'Transfer failed');
    } finally {
      setExecuting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (initLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const canLoadLots = Boolean(oldPartyID && fromDt);
  const canCreate   = selected.size > 0 && Boolean(newCompID && newPartyID) && !executing && can('TRF_DB', 'CanAdd');

  return (
    <Box onContextMenu={handleContextMenu}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <SwapHorizIcon color="primary" />
        <Typography variant="h5" fontWeight="bold">Transfer Between DataBase</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          color="success"
          startIcon={executing ? <CircularProgress size={18} color="inherit" /> : <PlayArrowIcon />}
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {executing ? 'Transferring…' : 'Create'}
        </Button>
        <Button variant="outlined" onClick={() => navigate(-1)}>Exit</Button>
      </Box>

      {initError  && <Alert severity="error" sx={{ mb: 2 }}>{initError}</Alert>}
      {execError  && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setExecError('')}>{execError}</Alert>}
      {lotsError  && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setLotsError('')}>{lotsError}</Alert>}

      {sameCompBranch && newCompID && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Warning: Destination company and branch are the SAME as the source. Lot serial will be reset to 0 for the new party.
        </Alert>
      )}

      {/* ── Form panel ──────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2 }}>

        {/* Row 1: Date + FaYear */}
        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={6} sm={3} md={2}>
            <TextField
              label="Date" type="date" value={fromDt} size="small" fullWidth
              InputLabelProps={{ shrink: true }}
              onChange={(e) => {
                setFromDt(e.target.value);
                setFaYear('');
                setLots([]);
                setSelected(new Set());
                setExecResult(null);
              }}
            />
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <TextField
              label="FaYear" value={faYear || '—'} size="small" fullWidth
              slotProps={{ input: { readOnly: true } }}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />

        {/* Row 2: From Company + From Party → To Company + To Party */}
        <Grid container spacing={2} alignItems="flex-end">

          {/* FROM group */}
          <Grid item xs={12} sm={5}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="From Company"
                  value={oldComp ? `${oldComp.compName} (${oldComp.compID})` : '—'}
                  size="small" fullWidth
                  slotProps={{ input: { readOnly: true } }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select label="From Party" value={oldPartyID} size="small" fullWidth
                  onChange={(e) => {
                    setOldPartyID(e.target.value);
                    setLots([]);
                    setSelected(new Set());
                    setExecResult(null);
                  }}
                >
                  <MenuItem value=""><em>— Select —</em></MenuItem>
                  {oldParties.map((p) => (
                    <MenuItem key={p.pkPartyID} value={p.pkPartyID}>
                      {p.pName}{p.pCode ? ` (${p.pCode})` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
          </Grid>

          {/* Arrow divider */}
          <Grid item xs={12} sm={2} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', pb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
              <Divider orientation="vertical" flexItem sx={{ height: 32 }} />
              <Typography variant="h6" sx={{ mx: 1, color: 'primary.main' }}>→</Typography>
              <Divider orientation="vertical" flexItem sx={{ height: 32 }} />
            </Box>
          </Grid>

          {/* TO group */}
          <Grid item xs={12} sm={5}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  select label="To Company" value={newCompID} size="small" fullWidth
                  onChange={handleNewCompChange}
                >
                  <MenuItem value=""><em>— Select —</em></MenuItem>
                  {companies.map((c) => (
                    <MenuItem key={c.pkCompID} value={c.pkCompID}>
                      {c.CompName}{c.CompAlias ? ` (${c.CompAlias})` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select label="To Party" value={newPartyID} size="small" fullWidth
                  disabled={!newCompID || partiesLoading}
                  onChange={(e) => { setNewPartyID(e.target.value); setExecResult(null); }}
                >
                  <MenuItem value=""><em>— Select —</em></MenuItem>
                  {newParties.map((p) => (
                    <MenuItem key={p.pkPartyID} value={p.pkPartyID}>
                      {p.pName}{p.pCode ? ` (${p.pCode})` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
          </Grid>

        </Grid>

        <Divider sx={{ my: 1.5 }} />

        {/* Row 3: Checkboxes + Load Lots */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Checkbox checked={genLotNum} onChange={(e) => setGenLotNum(e.target.checked)} size="small" />
            }
            label={<Typography variant="body2">Generate New Lot Nos.</Typography>}
          />
          <FormControlLabel
            control={
              <Checkbox checked={resetLotNum} onChange={(e) => setResetLotNum(e.target.checked)} size="small" />
            }
            label={<Typography variant="body2">Reset Lot Serials</Typography>}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="outlined" size="medium"
            startIcon={lotsLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={handleLoadLots}
            disabled={!canLoadLots || lotsLoading}
          >
            Load Lots
          </Button>
        </Box>

      </Paper>

      {/* ── Lots grid ───────────────────────────────────────────────────── */}
      <Paper sx={{ mb: 2 }}>
        <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2">
            Lots to Transfer
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Chip
            label={`${selected.size} / ${lots.length} Lots selected`}
            size="small"
            color={selected.size > 0 ? 'primary' : 'default'}
            variant="outlined"
          />
          <Button size="small" onClick={selectAll}   disabled={lots.length === 0}>Select All</Button>
          <Button size="small" onClick={deselectAll} disabled={lots.length === 0} color="inherit">Deselect All</Button>
          <Button size="small" onClick={invertSel}   disabled={lots.length === 0}>Invert</Button>
        </Box>
        <Divider />

        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ bgcolor: 'primary.main' }}>
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={allSelected ? deselectAll : selectAll}
                    disabled={lots.length === 0}
                    sx={{ color: 'black', '&.Mui-checked': { color: 'black' }, '&.MuiCheckbox-indeterminate': { color: 'black' } }}
                  />
                </TableCell>
                {['Lot No.', 'Item', 'Balance', 'Arr. Qty', 'Arr. Date', 'OpFlg', 'FaYear'].map((h) => (
                  <TableCell key={h} sx={{ bgcolor: 'primary.main', fontWeight: 'bold', color: 'black', whiteSpace: 'nowrap' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {lotsLoading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : lots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    {canLoadLots ? 'Click "Load Lots" to fetch available lots' : 'Select a party and cut-off date, then click Load Lots'}
                  </TableCell>
                </TableRow>
              ) : lots.map((lot) => {
                const isSel = selected.has(lot.pfkLotID);
                return (
                  <TableRow
                    key={lot.pfkLotID}
                    hover
                    selected={isSel}
                    onClick={() => toggleRow(lot.pfkLotID)}
                    sx={{ cursor: 'pointer', bgcolor: isSel ? 'action.selected' : undefined }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={isSel}
                        onChange={() => toggleRow(lot.pfkLotID)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{lot.LotNum || '—'}</TableCell>
                    <TableCell>
                      {lot.iName || '—'}
                      {lot.ItemExtDesc ? <Typography variant="caption" display="block" color="text.secondary">{lot.ItemExtDesc}</Typography> : null}
                    </TableCell>
                    <TableCell align="right">{parseFloat(lot.Balance).toFixed(2)}</TableCell>
                    <TableCell align="right">{parseFloat(lot.TransQty).toFixed(2)}{lot.Packing ? ` ${lot.Packing}` : ''}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(lot.OriTransDt)}</TableCell>
                    <TableCell>
                      <Chip label={lot.OpFlg || '—'} size="small" color={lot.OpFlg === 'Y' ? 'warning' : 'default'} />
                    </TableCell>
                    <TableCell>{lot.FaYear || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Right-click context menu ─────────────────────────────────────── */}
      <Menu
        open={ctxMenu !== null}
        onClose={closeCtxMenu}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX } : undefined}
      >
        <MenuItem onClick={() => { selectAll(); closeCtxMenu(); }}>Select All</MenuItem>
        <MenuItem onClick={() => { deselectAll(); closeCtxMenu(); }}>Deselect All</MenuItem>
        <MenuItem onClick={() => { invertSel(); closeCtxMenu(); }}>Invert Selection</MenuItem>
      </Menu>

      {/* ── Transfer result ──────────────────────────────────────────────── */}
      {execResult && (
        <Paper sx={{ p: 2 }}>
          <Alert severity="success" sx={{ mb: 1 }}>
            {execResult.message || 'Transfer complete'} — {execResult.processed?.length || 0} lot(s) transferred.
          </Alert>
          {execResult.processed?.length > 0 && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'success.light' }}>
                    {['#', 'New Lot No.'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 'bold' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {execResult.processed.map((r, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{r.LotNum}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
}
