// ─────────────────────────────────────────────────────────────────────────────
// Godown Link Page — Editable Grid
//
// Matches the VB6 "Party Godown Link - Add" screen:
//   1. Select a Party at the top.
//   2. The grid below loads all godown assignments for that party.
//   3. Every row is directly editable — no separate form page.
//   4. "Add Row" appends a blank row at the bottom.
//   5. Each row has its own Save (✓) and Delete (✕) buttons.
//
// Data model:
//   - Rows that have never been saved have _isNew = true → POST on save.
//   - Existing rows → PUT on save.
//   - Delete = soft delete (Active = 'N') for saved rows; just remove from
//     state for unsaved rows.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Button, Checkbox, CircularProgress, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import AddIcon          from '@mui/icons-material/Add';
import CheckCircleIcon  from '@mui/icons-material/CheckCircle';
import DeleteIcon       from '@mui/icons-material/Delete';
import SaveIcon         from '@mui/icons-material/Save';
import api            from '../../services/api';
import { useAuth }    from '../../contexts/AuthContext';

// Sort saved rows: GodownNum → LinkType → active (ToDt null) first, expired last.
// Unsaved new rows always stay at the bottom.
// godownsMap: Map<pkGodownID, gNum> passed in so we can sort by the display name.
function sortLinks(rows, godownsMap) {
  const saved   = rows.filter((r) => !r._isNew);
  const unsaved = rows.filter((r) => r._isNew);
  saved.sort((a, b) => {
    const aGdn = godownsMap.get(a.fkGodownID) || '';
    const bGdn = godownsMap.get(b.fkGodownID) || '';
    if (aGdn !== bGdn) return aGdn.localeCompare(bGdn);
    if (a.LinkType !== b.LinkType) return a.LinkType.localeCompare(b.LinkType);
    // null ToDt = still active → comes first; non-null = expired → goes down
    const aExpired = Boolean(a.ToDt), bExpired = Boolean(b.ToDt);
    return aExpired === bExpired ? 0 : aExpired ? 1 : -1;
  });
  return [...saved, ...unsaved];
}

// Blank template for a new (unsaved) row
const BLANK_ROW = () => ({
  _isNew:     true,
  _dirty:     false,
  _saving:    false,
  pkLinkID:   null,
  fkGodownID: '',
  FromDt:     '',
  ToDt:       '',
  LinkType:   '',
  Active:     'Y',
  Note:       '',
});

export default function GodownLinkPage() {
  const { can } = useAuth();

  const [parties,   setParties]   = useState([]);
  const [godowns,   setGodowns]   = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [partyID,   setPartyID]   = useState('');
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(false);

  // Ref so keyboard handler always sees latest partyID without stale closure
  const partyIDRef   = useRef(partyID);
  // godownsRef mirrors state so loadLinks (empty-dep callback) can sort without stale closure
  const godownsRef   = useRef([]);
  const gridRef      = useRef(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  useEffect(() => { partyIDRef.current = partyID; }, [partyID]);

  // After saving a new row we add a blank row and trigger this effect to
  // focus the first field (Godown selector) of that new row automatically.
  useEffect(() => {
    if (focusTrigger === 0 || !gridRef.current) return;
    const id = setTimeout(() => {
      const trs = gridRef.current?.querySelectorAll('tr');
      const last = trs?.[trs.length - 1];
      last?.querySelector('.MuiSelect-select, input')?.focus();
    }, 30);
    return () => clearTimeout(id);
  }, [focusTrigger]);

  // Load parties, godowns, and link type combo on mount.
  // LinkType loaded from VCComboData (VCPurpose='LinkType', filtered by compID+branchID on backend).
  // Also register [Insert] key shortcut to add a row (when a party is selected).
  useEffect(() => {
    api.get('/masters/parties').then((r) => setParties(r.data.filter((p) => p.Active === 'Y'))).catch(() => {});
    api.get('/masters/godowns').then((r) => { setGodowns(r.data); godownsRef.current = r.data; }).catch(() => {});
    api.get('/combo?purpose=LinkType').then((r) => setLinkTypes(r.data)).catch(() => {});

    function handleKey(e) {
      if (e.key === 'Insert' && partyIDRef.current) {
        e.preventDefault();
        setRows((prev) => [...prev, BLANK_ROW()]);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // When a party is selected, load their godown links
  const loadLinks = useCallback(async (pid) => {
    if (!pid) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await api.get(`/masters/party-godown-links?partyID=${pid}`);
      const godownsMap = new Map(godownsRef.current.map((g) => [g.pkGodownID, g.gNum]));
      setRows(sortLinks(res.data.map((d) => ({
        _isNew:     false,
        _dirty:     false,
        _saving:    false,
        pkLinkID:   d.pkLinkID,
        fkGodownID: d.fkGodownID,
        FromDt:     d.FromDt ? d.FromDt.substring(0, 10) : '',
        ToDt:       d.ToDt   ? d.ToDt.substring(0, 10)   : '',
        LinkType:   d.LinkType,
        Active:     d.Active,
        Note:       d.Note || '',
      })), godownsMap));
    } finally { setLoading(false); }
  }, []);

  function handlePartyChange(e) {
    const pid = e.target.value;
    setPartyID(pid);
    loadLinks(pid);
  }

  // Update a single field in a single row by its index.
  // Mark _dirty on existing rows so the save button turns orange.
  function updateCell(index, field, value) {
    setRows((prev) => prev.map((row, i) =>
      i === index ? { ...row, [field]: value, _dirty: !row._isNew } : row
    ));
  }

  // Append a blank editable row at the bottom
  function addRow() {
    setRows((prev) => [...prev, BLANK_ROW()]);
  }

  // Save one row — POST if new, PUT if existing
  async function saveRow(index) {
    const row = rows[index];
    const missing = [];
    if (!row.fkGodownID) missing.push('Godown');
    if (!row.FromDt)     missing.push('From Date');
    if (!row.LinkType)   missing.push('Link Type');
    if (missing.length > 0) {
      alert(`Required field(s) missing: ${missing.join(', ')}`);
      return;
    }
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, _saving: true } : r));
    const payload = {
      fkPartyID:  partyID,
      fkGodownID: row.fkGodownID,
      FromDt:     row.FromDt,
      ToDt:       row.ToDt || null,
      LinkType:   row.LinkType,
      Active:     row.Active,
      Note:       row.Note,
    };
    try {
      const godownsMap = new Map(godownsRef.current.map((g) => [g.pkGodownID, g.gNum]));
      if (row._isNew) {
        const res = await api.post('/masters/party-godown-links', payload);
        setRows((prev) => {
          const updated = prev.map((r, i) =>
            i === index ? { ...r, pkLinkID: res.data.pkLinkID, _isNew: false, _dirty: false, _saving: false } : r
          );
          return [...sortLinks(updated, godownsMap), BLANK_ROW()];
        });
        setFocusTrigger((t) => t + 1);
      } else {
        await api.put(`/masters/party-godown-links/${row.pkLinkID}`, payload);
        setRows((prev) => sortLinks(prev.map((r, i) => i === index ? { ...r, _dirty: false, _saving: false } : r), godownsMap));
      }
    } catch (err) {
      setRows((prev) => prev.map((r, i) => i === index ? { ...r, _saving: false } : r));
      alert(err.response?.data?.error || 'Save failed');
    }
  }

  // Delete a row — soft delete for saved rows, splice for new unsaved rows
  async function deleteRow(index) {
    const row = rows[index];
    if (row._isNew) {
      // Never saved — just remove from the grid
      setRows((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    if (!window.confirm('Deactivate this godown link?')) return;
    try {
      await api.delete(`/masters/party-godown-links/${row.pkLinkID}`);
      setRows((prev) => prev.map((r, i) => i === index ? { ...r, Active: 'N' } : r));
    } catch { alert('Delete failed'); }
  }

  const validLinkTypes = linkTypes.filter((t) => t.VCCode);

  const godownName = (id) => godowns.find((g) => g.pkGodownID === id)?.gNum || '';

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>
          Godown Link Master
        </Typography>
      </Toolbar>

      {/* Party selector at top — matching the VB6 "Party Name:" field */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 320 }}>
            <InputLabel>Party Name</InputLabel>
            <Select value={partyID} label="Party Name" onChange={handlePartyChange}>
              <MenuItem value=""><em>— Select Party —</em></MenuItem>
              {parties.map((p) => (
                <MenuItem key={p.pkPartyID} value={p.pkPartyID}>
                  {p.pName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {partyID && can('MASTERS', 'CanAdd') && (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={addRow}>
              Add Row
            </Button>
          )}
          {partyID && (
            <Typography variant="caption" color="text.secondary">
              Shortcut: <strong>Insert</strong> key to add row
            </Typography>
          )}
        </Stack>
      </Paper>

      {/* Editable grid — shown only after a party is selected */}
      {loading && <CircularProgress sx={{ mt: 2 }} />}

      {!loading && partyID && (
        <Paper sx={{ overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: '#dbeafe' }}>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, width: 50 }}>Sr</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, minWidth: 130 }}>Godown No *</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, minWidth: 140 }}>From Date *</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, minWidth: 140 }}>To Date</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, minWidth: 150 }}>Link Type *</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, width: 70  }}>Active</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, minWidth: 160 }}>Note</TableCell>
                <TableCell sx={{ color: '#0d47a1', fontWeight: 700, width: 80  }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody ref={gridRef}>
              {rows.map((row, index) => (
                <TableRow
                  key={row.pkLinkID || `new-${index}`}
                  sx={{ bgcolor: row._isNew ? '#F1F8FF' : 'inherit' }}
                >
                  {/* Sr No — just the row number */}
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>{index + 1}</TableCell>

                  {/* Godown selector */}
                  <TableCell sx={{ p: 0.5 }}>
                    <Select
                      size="small"
                      value={row.fkGodownID}
                      onChange={(e) => updateCell(index, 'fkGodownID', e.target.value)}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      displayEmpty
                      sx={{ minWidth: 110, fontSize: 13 }}
                    >
                      <MenuItem value=""><em>Select</em></MenuItem>
                      {godowns.map((g) => (
                        <MenuItem key={g.pkGodownID} value={g.pkGodownID} sx={{ fontSize: 13 }}>
                          {g.gNum}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>

                  {/* From Date */}
                  <TableCell sx={{ p: 0.5 }}>
                    <TextField
                      type="date"
                      size="small"
                      value={row.FromDt}
                      onChange={(e) => updateCell(index, 'FromDt', e.target.value)}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: 130 }}
                      slotProps={{ htmlInput: { style: { fontSize: 13, padding: '4px 8px' } } }}
                    />
                  </TableCell>

                  {/* To Date */}
                  <TableCell sx={{ p: 0.5 }}>
                    <TextField
                      type="date"
                      size="small"
                      value={row.ToDt}
                      onChange={(e) => updateCell(index, 'ToDt', e.target.value)}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: 130 }}
                      slotProps={{ htmlInput: { style: { fontSize: 13, padding: '4px 8px' } } }}
                    />
                  </TableCell>

                  {/* Link Type */}
                  <TableCell sx={{ p: 0.5 }}>
                    <Select
                      size="small"
                      value={row.LinkType}
                      onChange={(e) => updateCell(index, 'LinkType', e.target.value)}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      displayEmpty
                      sx={{ minWidth: 130, fontSize: 13 }}
                    >
                      <MenuItem value=""><em>Select</em></MenuItem>
                      {validLinkTypes.length > 0
                        ? validLinkTypes.map((t) => (
                            <MenuItem key={t.VCCode} value={t.VCCode} sx={{ fontSize: 13 }}>{t.VCData}</MenuItem>
                          ))
                        : ['Insurance', 'Own', 'Rent', 'Shared'].map((t) => (
                            <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>{t}</MenuItem>
                          ))
                      }
                    </Select>
                  </TableCell>

                  {/* Active checkbox */}
                  <TableCell sx={{ p: 0.5, textAlign: 'center' }}>
                    <Checkbox
                      checked={row.Active === 'Y'}
                      onChange={(e) => updateCell(index, 'Active', e.target.checked ? 'Y' : 'N')}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      size="small"
                    />
                  </TableCell>

                  {/* Note */}
                  <TableCell sx={{ p: 0.5 }}>
                    <TextField
                      size="small"
                      value={row.Note}
                      onChange={(e) => updateCell(index, 'Note', e.target.value)}
                      disabled={!can('MASTERS', 'CanEdit') && !row._isNew}
                      sx={{ width: 150 }}
                      slotProps={{ htmlInput: { style: { fontSize: 13, padding: '4px 8px' } } }}
                    />
                  </TableCell>

                  {/* Save + Delete */}
                  <TableCell sx={{ p: 0.5, whiteSpace: 'nowrap' }}>
                    {/* Save button — 3 states:
                        green  CheckCircle = saved & clean (disabled)
                        blue   SaveIcon    = new row, never saved
                        orange SaveIcon    = existing row edited but not yet saved */}
                    {row._saving ? (
                      <IconButton size="small" disabled><CircularProgress size={14} /></IconButton>
                    ) : !row._isNew && !row._dirty ? (
                      <Tooltip title="Saved">
                        <IconButton size="small" disabled sx={{ color: 'success.main !important' }}>
                          <CheckCircleIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : can('MASTERS', row._isNew ? 'CanAdd' : 'CanEdit') ? (
                      <Tooltip title={row._isNew ? 'Save new row' : 'Save changes'}>
                        <IconButton
                          size="small"
                          onClick={() => saveRow(index)}
                          sx={{ color: row._isNew ? 'primary.main' : 'warning.main' }}
                        >
                          <SaveIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    {can('MASTERS', 'CanDelete') && (
                      <Tooltip title={row._isNew ? 'Remove row' : 'Deactivate'}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => deleteRow(index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                    No godown links found for this party. Click "Add Row" or press [Insert] to create one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}

      {!partyID && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Select a party above to view and manage their godown assignments.
        </Typography>
      )}
    </Box>
  );
}
