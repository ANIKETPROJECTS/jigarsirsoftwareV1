import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, MenuItem, IconButton, Button, Chip, Typography, Tooltip,
} from '@mui/material';
import AddIcon          from '@mui/icons-material/Add';
import DeleteIcon       from '@mui/icons-material/Delete';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api              from '../services/api';

const EMPTY_ROW = (fkGodownID = '') => ({
  fkGodownID, fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '',
});

// Shared Location/Batch grid used in ArrivalFormPage and DispatchFormPage.
//
// Props:
//   rows           – array of row objects
//   onChange       – (rows) => void
//   godownOptions  – [{ pkGodownID, gNum }] — max 2 items from parent godown selection
//   targetTotalQty – parent form's total qty for match validation
//   submitted      – bool; triggers error highlights
//   mode           – 'generic' (default) | 'desp'
//                    'desp': Batch No. becomes a dropdown (loaded from batch-list API),
//                    column order is Godown → Batch → Location → Qty → Remark,
//                    Location is disabled until a batch is selected.
//   pfkOriLotID    – required for desp mode (used to fetch batch-list)
//   partyCompID    – forwarded to batch-list API for cross-company queries
export default function LocBatchGrid({
  rows,
  onChange,
  godownOptions = [],
  targetTotalQty = 0,
  submitted,
  mode = 'generic',
  pfkOriLotID = '',
  partyCompID = '',
  label = 'Location / Batch Detail',
}) {
  const [locations,  setLocations]  = useState({});
  const [batchLists, setBatchLists] = useState({});
  const [locWithBal, setLocWithBal] = useState({}); // { 'godownID|batchNum': [{ fkLocationID, LocationCode, LocationName, balQty }] }
  const loadedRef      = useRef(new Set());
  const batchLoadedRef = useRef(new Set());
  const locBalLoadedRef = useRef(new Set());

  const isDesp   = mode === 'desp';
  const isSingle = godownOptions.length === 1;
  const singleGID = isSingle ? godownOptions[0]?.pkGodownID : null;

  const loadLocations = useCallback(async (godownID) => {
    if (!godownID || loadedRef.current.has(godownID)) return;
    loadedRef.current.add(godownID);
    try {
      const { data } = await api.get('/masters/locations', { params: { godownID, slim: 1 } });
      setLocations((prev) => ({ ...prev, [godownID]: Array.isArray(data) ? data : [] }));
    } catch {
      setLocations((prev) => ({ ...prev, [godownID]: [] }));
    }
  }, []);

  const loadBatches = useCallback(async (godownID) => {
    if (!godownID || !pfkOriLotID || !isDesp) return;
    if (batchLoadedRef.current.has(godownID)) return;
    batchLoadedRef.current.add(godownID);
    try {
      const { data } = await api.get('/transactions/dispatches/batch-list', {
        params: { pfkOriLotID, godownID, partyCompID },
      });
      setBatchLists((prev) => ({ ...prev, [godownID]: Array.isArray(data) ? data : [] }));
    } catch {
      setBatchLists((prev) => ({ ...prev, [godownID]: [] }));
    }
  }, [pfkOriLotID, partyCompID, isDesp]);

  const loadLocBal = useCallback(async (godownID, batchNum) => {
    if (!godownID || !batchNum || !pfkOriLotID || !isDesp) return;
    const key = `${godownID}|${batchNum}`;
    if (locBalLoadedRef.current.has(key)) return;
    locBalLoadedRef.current.add(key);
    try {
      const { data } = await api.get('/transactions/dispatches/location-list', {
        params: { pfkOriLotID, godownID, batchNum, partyCompID },
      });
      setLocWithBal((prev) => ({ ...prev, [key]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      console.error('loadLocBal failed:', err?.response?.data || err.message, { godownID, batchNum, pfkOriLotID });
      locBalLoadedRef.current.delete(key); // allow retry on next open
      setLocWithBal((prev) => ({ ...prev, [key]: [] }));
    }
  }, [pfkOriLotID, partyCompID, isDesp]);

  // Preload for single godown
  useEffect(() => {
    if (singleGID) {
      loadLocations(singleGID);
      loadBatches(singleGID);
    }
  }, [singleGID, loadLocations, loadBatches]);

  // Preload locations for all godown IDs already in rows (edit-mode multi-godown case).
  // loadLocations uses a ref cache so duplicate calls are no-ops.
  useEffect(() => {
    rows.forEach((r) => {
      if (r.fkGodownID) loadLocations(r.fkGodownID);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — rows are populated before LocBatchGrid first renders

  // Re-fetch batches and clear location-balance cache when the selected lot changes
  useEffect(() => {
    if (!isDesp || !singleGID || !pfkOriLotID) return;
    batchLoadedRef.current.delete(singleGID);
    locBalLoadedRef.current.clear();
    setBatchLists({});
    setLocWithBal({});
    loadBatches(singleGID);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pfkOriLotID]);

  // Load locWithBal whenever a row has a batchNum — covers both edit-mode load
  // and auto-fill from lot selection (where pfkOriLotID doesn't change again).
  // loadLocBal uses a ref-based cache so duplicate calls are no-ops.
  useEffect(() => {
    if (!isDesp || !pfkOriLotID) return;
    rows.forEach((row) => {
      const gid = row.fkGodownID || singleGID;
      if (gid && row.batchNum) {
        loadLocations(gid);
        loadLocBal(gid, row.batchNum);
      }
    });
  }, [rows, isDesp, pfkOriLotID, singleGID, loadLocBal, loadLocations]);

  // Auto-assign single godown to all rows when singleGID changes.
  // Clears location when godown changes so stale location IDs from the old
  // godown are not saved (fixes IN entries where user changes GodownID1 after
  // lot selection — old godown would otherwise stay in the locbatch rows).
  useEffect(() => {
    if (!singleGID) return;
    const needsUpdate = rows.some((r) => r.fkGodownID !== singleGID);
    if (needsUpdate) {
      onChange(rows.map((r) =>
        r.fkGodownID === singleGID
          ? r
          : { ...r, fkGodownID: singleGID, fkLocationID: '', locationCode: '' }
      ));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleGID]);

  const updateRow = (idx, patch) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const addRow = () => onChange([...rows, EMPTY_ROW(singleGID || '')]);

  const removeRow = (idx) => {
    if (rows.length === 1) {
      onChange([EMPTY_ROW(singleGID || '')]);
    } else {
      onChange(rows.filter((_, i) => i !== idx));
    }
  };

  const gridTotal  = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
  const hasData    = rows.some((r) => r.batchNum?.trim() || parseFloat(r.qty) > 0);
  const totalMatch = !hasData || targetTotalQty <= 0 || Math.abs(gridTotal - targetTotalQty) < 0.01;

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {label}
      </Typography>

      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 120 }}>Godown</TableCell>
              {isDesp ? (
                <>
                  <TableCell sx={{ minWidth: 200 }}>Batch No. *</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Location</TableCell>
                </>
              ) : (
                <>
                  <TableCell sx={{ minWidth: 180 }}>Location</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>Batch No. *</TableCell>
                </>
              )}
              <TableCell sx={{ minWidth: 100 }}>Qty</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Remark</TableCell>
              <TableCell sx={{ width: 36, p: 0 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => {
              const gid       = isSingle ? singleGID : row.fkGodownID;
              const locs      = locations[gid] || [];
              const batches   = batchLists[gid] || [];
              const rowActive = !!(row.batchNum?.trim() || row.fkLocationID || parseFloat(row.qty) > 0);

              // ── Godown cell ──────────────────────────────────────────────────
              const godownCell = (
                <TableCell key="gd">
                  {isSingle ? (
                    <Chip label={godownOptions[0].gNum} size="small" sx={{ fontWeight: 600 }} />
                  ) : (
                    <TextField select size="small" fullWidth
                      value={row.fkGodownID}
                      error={submitted && rowActive && !row.fkGodownID}
                      onChange={(e) => {
                        const newGID = e.target.value;
                        updateRow(idx, { fkGodownID: newGID, fkLocationID: '', batchNum: '' });
                        loadLocations(newGID);
                        if (isDesp) loadBatches(newGID);
                      }}
                      SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}>
                      <MenuItem value=""><em>— Select —</em></MenuItem>
                      {godownOptions.map((g) => (
                        <MenuItem key={g.pkGodownID} value={g.pkGodownID}>{g.gNum}</MenuItem>
                      ))}
                    </TextField>
                  )}
                </TableCell>
              );

              // ── Batch cell — dropdown in desp mode, free-text otherwise ─────
              const batchCell = isDesp ? (
                <TableCell key="bn">
                  <TextField select size="small" fullWidth
                    value={row.batchNum}
                    disabled={!gid}
                    error={submitted && rowActive && !row.batchNum?.trim()}
                    helperText={submitted && rowActive && !row.batchNum?.trim() ? 'Required' : ''}
                    SelectProps={{
                      renderValue: (val) => {
                        if (!val) return '';
                        const locKey = `${gid}|${val}`;
                        const locList = locWithBal[locKey] || [];
                        const locEntry = locList.find((b) => b.fkLocationID === row.fkLocationID);
                        const locName = locEntry
                          ? (locEntry.LocationCode
                              ? `${locEntry.LocationCode} – ${locEntry.LocationName}`
                              : locEntry.LocationName || '')
                          : (row.locationCode || row.fkLocationID || '');
                        return [val, locName, row.qty].filter(Boolean).join(' | ');
                      },
                      onOpen: () => { loadBatches(gid); loadLocations(gid); },
                      MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } },
                    }}
                    onChange={(e) => {
                      const bn = e.target.value;
                      // Clear stale locBal cache for old batch so a re-select always retries
                      if (row.batchNum && row.batchNum !== bn) {
                        locBalLoadedRef.current.delete(`${gid}|${row.batchNum}`);
                      }
                      updateRow(idx, { batchNum: bn, fkLocationID: '' });
                      if (bn) loadLocBal(gid, bn);
                    }}>
                    <MenuItem value=""><em>— Select batch —</em></MenuItem>
                    {(() => {
                      // In edit mode the saved batch may have 0 balance and won't appear
                      // in the API result (HAVING SUM > 0). Inject it so it stays selectable.
                      const visible = (row.batchNum && !batches.find(b => b.batchNum === row.batchNum))
                        ? [...batches, { batchNum: row.batchNum, balQty: 0 }]
                        : batches;
                      return visible.length > 0
                        ? visible.map((b) => (
                            <MenuItem key={b.batchNum} value={b.batchNum}>
                              {b.batchNum}
                              <Typography component="span" variant="caption"
                                sx={{ ml: 1.5, color: 'text.secondary' }}>
                                Bal: {b.balQty}
                              </Typography>
                            </MenuItem>
                          ))
                        : pfkOriLotID && <MenuItem disabled value="">No batch data found</MenuItem>;
                    })()}
                  </TextField>
                </TableCell>
              ) : (
                <TableCell key="bn">
                  <TextField size="small" fullWidth
                    placeholder="e.g. NA"
                    value={row.batchNum}
                    error={submitted && rowActive && !row.batchNum?.trim()}
                    helperText={submitted && rowActive && !row.batchNum?.trim() ? 'Required (NA if none)' : ''}
                    onChange={(e) => updateRow(idx, { batchNum: e.target.value })}
                  />
                </TableCell>
              );

              // ── Location cell — disabled until batch chosen (desp mode) ─────
              // In desp mode: if locWithBal has entries for this godown+batch, show them
              // with balance qty; otherwise fall back to the plain mLocation list.
              const locBalKey  = `${gid}|${row.batchNum}`;
              // In desp mode: only show locations from tstockentry_locbatch for this godown+batch.
              // null = not yet fetched; [] = fetched but empty.
              const balEntries = (isDesp && row.batchNum)
                ? (locWithBal[locBalKey] ?? null)
                : null;
              const locLabel = (b) =>
                b.LocationCode ? `${b.LocationCode} – ${b.LocationName}` : (b.LocationName || '—');
              const locationCell = (
                <TableCell key="loc">
                  <TextField select size="small" fullWidth
                    value={row.fkLocationID}
                    error={submitted && rowActive && !row.fkLocationID}
                    disabled={!gid || (isDesp && !row.batchNum)}
                    SelectProps={{
                      renderValue: (val) => {
                        if (!val) return '';
                        const found = isDesp
                          ? (balEntries || []).find((b) => b.fkLocationID === val)
                          : locs.find((l) => l.pkLocationID === val);
                        return found ? locLabel(found) : (row.locationCode || val);
                      },
                      onOpen: () => {
                        if (isDesp && row.batchNum) loadLocBal(gid, row.batchNum);
                        else loadLocations(gid);
                      },
                      MenuProps: { PaperProps: { sx: { minWidth: 300 } } },
                    }}
                    onChange={(e) => {
                      const locID = e.target.value;
                      const locEntry = isDesp
                        ? (balEntries || []).find((b) => b.fkLocationID === locID)
                        : locs.find((l) => l.pkLocationID === locID);
                      updateRow(idx, {
                        fkLocationID: locID,
                        locationCode: locEntry?.LocationCode || '',
                      });
                    }}>
                    <MenuItem value=""><em>— Select —</em></MenuItem>
                    {isDesp
                      ? (balEntries && balEntries.length > 0
                          ? balEntries.map((b, bi) => {
                              const locKey = b.fkLocationID || `__empty_${bi}`;
                              const locVal = b.fkLocationID || '';
                              return (
                                <MenuItem key={locKey} value={locVal}>
                                  <Box sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                                    <span>{locLabel(b) || '(No location)'}</span>
                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                      Bal: {Number(b.balQty).toFixed(2)}
                                    </Typography>
                                  </Box>
                                </MenuItem>
                              );
                            })
                          : <MenuItem disabled value="">{row.batchNum ? 'No location data for this batch' : 'Select a batch first'}</MenuItem>
                        )
                      : locs.map((l) => (
                          <MenuItem key={l.pkLocationID} value={l.pkLocationID}>
                            {l.LocationCode ? `${l.LocationCode} – ${l.LocationName}` : l.LocationName}
                          </MenuItem>
                        ))
                    }
                  </TextField>
                </TableCell>
              );

              return (
                <TableRow key={idx}>
                  {godownCell}
                  {isDesp ? <>{batchCell}{locationCell}</> : <>{locationCell}{batchCell}</>}

                  {/* Qty */}
                  <TableCell>
                    <TextField size="small" fullWidth type="number"
                      value={row.qty}
                      disabled={isDesp && !row.batchNum}
                      error={submitted && rowActive && !row.qty}
                      onChange={(e) => updateRow(idx, { qty: e.target.value })}
                    />
                  </TableCell>

                  {/* Remark */}
                  <TableCell>
                    <TextField size="small" fullWidth
                      value={row.remark}
                      onChange={(e) => updateRow(idx, { remark: e.target.value })}
                    />
                  </TableCell>

                  {/* Delete / Clear */}
                  <TableCell sx={{ p: 0 }}>
                    <IconButton size="small" onClick={() => removeRow(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Footer */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={addRow} variant="outlined">
          Add Row
        </Button>
        {hasData && (
          <Typography variant="body2"
            sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5,
                  color: totalMatch ? 'success.main' : 'error.main' }}>
            Grid Total: {gridTotal.toFixed(2)}
            {targetTotalQty > 0 && ` / ${targetTotalQty.toFixed(2)}`}
            {!totalMatch && (
              <Tooltip title="Grid total must match Total Qty">
                <WarningAmberIcon fontSize="small" />
              </Tooltip>
            )}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
