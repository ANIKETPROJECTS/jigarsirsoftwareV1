import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Button, TextField, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Tooltip, Chip, Alert, CircularProgress,
  Autocomplete, Grid, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import AddIcon           from '@mui/icons-material/Add';
import EditIcon          from '@mui/icons-material/Edit';
import DeleteIcon        from '@mui/icons-material/Delete';
import SearchIcon        from '@mui/icons-material/Search';
import ClearIcon         from '@mui/icons-material/Clear';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf';
import PhotoCameraIcon   from '@mui/icons-material/PhotoCamera';
import PhotoLibraryIcon  from '@mui/icons-material/PhotoLibrary';
import CloseIcon         from '@mui/icons-material/Close';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const TRANS_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'ARV',     label: 'Arrival' },
  { value: 'DESPRET', label: 'Return'  },
  { value: 'IN',      label: 'In'      },
];

const TYPE_CHIP = {
  ARV:     { label: 'Arrival', color: 'success' },
  DESPRET: { label: 'Return',  color: 'warning' },
  IN:      { label: 'In',      color: 'info'    },
};

const PERIODS = [
  { value: '7',   label: '1 Week'   },
  { value: '15',  label: '15 Days'  },
  { value: '30',  label: '1 Month'  },
  { value: '60',  label: '2 Months' },
  { value: '150', label: '5 Months' },
  { value: '365', label: '1 Year'   },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

const todayStr = new Date().toISOString().slice(0, 10);

export default function ArrivalListPage() {
  const navigate = useNavigate();
  const { can }  = useAuth();

  // Master data for filter dropdowns
  const [parties,   setParties]   = useState([]);
  const [items,     setItems]     = useState([]);
  const [godowns,   setGodowns]   = useState([]);
  const [companies, setCompanies] = useState([]);

  // Filters
  const [period,      setPeriod]      = useState('7');
  const [fromDt,      setFromDt]      = useState(daysAgo(7));
  const [toDt,        setToDt]        = useState(todayStr);
  const [transType,   setTransType]   = useState('');
  const [selParty,    setSelParty]    = useState(null);
  const [selItem,     setSelItem]     = useState(null);
  const [selGodown,   setSelGodown]   = useState(null);
  const [selCompany,  setSelCompany]  = useState('');
  const [lotNum,      setLotNum]      = useState('');

  // Table data
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [deleting, setDeleting] = useState('');

  // Stock photo modal
  const [photoModal,       setPhotoModal]       = useState({ open: false, row: null });
  const [modalPhotos,      setModalPhotos]      = useState([]);
  const [modalPending,     setModalPending]     = useState([]);
  const [modalLoading,     setModalLoading]     = useState(false);
  const [modalUploading,   setModalUploading]   = useState(false);
  const modalCameraRef  = useRef(null);
  const modalGalleryRef = useRef(null);

  const STATIC_BASE = (import.meta.env.VITE_API_BASE_URL || '/api')
    .replace(/\/api\/?$/, '');

  // Load master data once
  useEffect(() => {
    Promise.all([
      api.get('/masters/parties/group'),
      api.get('/masters/items', { params: { slim: 1 } }),
      api.get('/masters/godowns', { params: { slim: 1 } }),
      api.get('/group-companies'),
    ]).then(([pRes, iRes, gRes, cRes]) => {
      setParties(pRes.data.filter((r) => r.Active === 'Y'));
      setItems(iRes.data);
      setGodowns(gRes.data);
      setCompanies(cRes.data);
    }).catch(() => {});
  }, []);

  // When period changes → recompute fromDt, reset toDt to today
  const handlePeriodChange = (val) => {
    setPeriod(val);
    setFromDt(daysAgo(Number(val)));
    setToDt(todayStr);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { fromDt, toDt };
      if (transType)          params.transType  = transType;
      if (selParty)           params.partyID    = selParty.pkPartyID;
      if (selItem)            params.itemID     = selItem.pkItemID;
      if (selGodown)          params.godownID   = selGodown.pkGodownID;
      if (selCompany)         params.companyID  = selCompany;
      if (lotNum.trim())      params.lotNum     = lotNum.trim();
      const { data } = await api.get('/transactions/arrivals', { params });
      data.sort((a, b) => {
        const dtCmp = new Date(b.TransDt || 0) - new Date(a.TransDt || 0);
        if (dtCmp !== 0) return dtCmp;
        return String(b.TransTm || '').localeCompare(String(a.TransTm || ''));
      });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  }, [fromDt, toDt, transType, selParty, selItem, selGodown, selCompany, lotNum]);

  useEffect(() => { load(); }, [load]);

  const handlePrintNote = async (row) => {
    try {
      const res = await api.get(`/transactions/arrivals/${row.pkTransID}/note`, {
        params:       { partyCompID: row.fkCompID },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch {
      alert('Failed to generate arrival note');
    }
  };

  const handleOpenPhotos = async (row) => {
    setPhotoModal({ open: true, row });
    setModalPhotos([]);
    setModalPending([]);
    setModalLoading(true);
    try {
      const { data } = await api.get('/uploads/stock-photos', { params: { lotNum: row.LotNum } });
      setModalPhotos(data);
    } catch {}
    setModalLoading(false);
  };

  const handleClosePhotos = () => {
    modalPending.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotoModal({ open: false, row: null });
    setModalPhotos([]);
    setModalPending([]);
  };

  const handleModalPhotoChange = (e) => {
    const files = Array.from(e.target.files);
    setModalPending((prev) => [
      ...prev,
      ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
    e.target.value = '';
  };

  const removeModalPending = (idx) => {
    setModalPending((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleModalUpload = async () => {
    if (!modalPending.length || !photoModal.row?.LotNum) return;
    setModalUploading(true);
    try {
      const fd = new FormData();
      modalPending.forEach((p) => fd.append('photos', p.file));
      fd.append('lotNum', photoModal.row.LotNum);
      const { data } = await api.post('/uploads/stock-photos', fd);
      modalPending.forEach((p) => URL.revokeObjectURL(p.preview));
      setModalPhotos((prev) => [...prev, ...data]);
      setModalPending([]);
    } catch {
      setError('Photo upload failed');
    }
    setModalUploading(false);
  };

  const handleModalDelete = async (photo) => {
    try {
      await api.delete('/uploads/stock-photos', {
        params: { lotNum: photoModal.row.LotNum, filename: photo.filename },
      });
      setModalPhotos((prev) => prev.filter((p) => p.filename !== photo.filename));
    } catch {}
  };

  const handleDelete = async (row) => {
    const label = row.LotNum ? `Lot ${row.LotNum}` : `Trans ${row.pkTransID}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeleting(row.pkTransID);
    try {
      await api.delete(`/transactions/arrivals/${row.pkTransID}`);
      setRows((p) => p.filter((r) => r.pkTransID !== row.pkTransID));
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting('');
    }
  };

  const clearFilters = () => {
    setPeriod('7');
    setFromDt(daysAgo(7));
    setToDt(todayStr);
    setTransType('');
    setSelParty(null);
    setSelItem(null);
    setSelGodown(null);
    setSelCompany('');
    setLotNum('');
  };

  const acProps = { size: 'small', fullWidth: true };

  return (
    <Box>
      {/* ── Page header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <LocalShippingIcon color="primary" sx={{ mr: 1 }} />
        <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
          Arrival / Return / In
        </Typography>
        {can('ARRIVAL', 'CanAdd') && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => navigate('/transactions/arrivals/new')}>
            New Entry
          </Button>
        )}
      </Box>

      {/* ── Filters ── */}
      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>

        {/* Row 1: Period, Dates, Type, Lot, Search */}
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={6} sm={2}>
            <TextField label="Period" select size="small" fullWidth
              value={period} onChange={(e) => handlePeriodChange(e.target.value)}>
              {PERIODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="From Date" type="date" size="small" fullWidth
              value={fromDt} onChange={(e) => setFromDt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="To Date" type="date" size="small" fullWidth
              value={toDt} onChange={(e) => setToDt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="Type" select size="small" fullWidth
              value={transType} onChange={(e) => setTransType(e.target.value)}>
              {TRANS_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="Lot No." size="small" fullWidth
              value={lotNum} onChange={(e) => setLotNum(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <Button variant="outlined" fullWidth startIcon={<SearchIcon />} onClick={load}>
              Search
            </Button>
          </Grid>
        </Grid>

        {/* Row 2: Party, Item, Godown, Company, Clear */}
        <Grid container spacing={1.5} alignItems="center" sx={{ mt: 1, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Grid item xs={12} sm={3}>
            <Autocomplete {...acProps}
              options={parties}
              getOptionLabel={(o) => `${o.pName} (${o.pCode})`}
              renderOption={(props, o) => (
                <li {...props} key={o.pkPartyID}>
                  {o.pName}&nbsp;
                  <span style={{ color: '#666', fontSize: 12 }}>({o.pCode})</span>&nbsp;
                  <span style={{ color: '#1565C0', fontSize: 11, fontWeight: 600 }}>[{o.fkCompID}]</span>
                </li>
              )}
              filterOptions={(opts, { inputValue }) => {
                const q = inputValue.toLowerCase();
                return opts.filter((o) =>
                  (o.pName || '').toLowerCase().includes(q) ||
                  (o.pCode || '').toLowerCase().includes(q) ||
                  (o.fkCompID || '').toLowerCase().includes(q)
                );
              }}
              value={selParty}
              onChange={(_, v) => setSelParty(v)}
              isOptionEqualToValue={(o, v) => o.pkPartyID === v.pkPartyID}
              renderInput={(params) => <TextField {...params} label="Party" />}
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <Autocomplete {...acProps}
              options={items}
              getOptionLabel={(o) => o.iName || ''}
              value={selItem}
              onChange={(_, v) => setSelItem(v)}
              isOptionEqualToValue={(o, v) => o.pkItemID === v.pkItemID}
              renderInput={(params) => <TextField {...params} label="Item" />}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <Autocomplete {...acProps}
              options={godowns}
              getOptionLabel={(o) => o.gNum || ''}
              value={selGodown}
              onChange={(_, v) => setSelGodown(v)}
              isOptionEqualToValue={(o, v) => o.pkGodownID === v.pkGodownID}
              renderInput={(params) => <TextField {...params} label="Godown No." />}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <TextField label="Company" select size="small" fullWidth
              value={selCompany} onChange={(e) => setSelCompany(e.target.value)}>
              <MenuItem value=""><em>All Companies</em></MenuItem>
              {companies.map((c) => (
                <MenuItem key={c.pkCompID} value={c.pkCompID}>
                  {c.pkCompID} — {c.CompName || c.CompAlias}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={2}>
            <Button variant="outlined" color="inherit" fullWidth startIcon={<ClearIcon />}
              onClick={clearFilters}>
              Clear
            </Button>
          </Grid>
        </Grid>

      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={1}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#E3F2FD' }}>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Co.</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Lot No.</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Party</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Item</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Qty</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Packing</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Pack Wt.</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Godown No.</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ color: '#BDBDBD', py: 4 }}>
                    No entries found
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => {
                const chip = TYPE_CHIP[row.TransType] || { label: row.TransType, color: 'default' };
                return (
                  <TableRow key={row.pkTransID} hover>
                    <TableCell>
                      <Chip label={chip.label} color={chip.color} size="small" />
                    </TableCell>
                    <TableCell>
                      <Chip label={row.fkCompID} size="small" variant="outlined"
                        sx={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }} />
                    </TableCell>
                    <TableCell>{fmtDate(row.TransDt)}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{row.LotNum || '—'}</TableCell>
                    <TableCell>{row.pName || row.fkPartyID}</TableCell>
                    <TableCell>{[row.iName, row.ItemExtDesc].filter(Boolean).join(' ') || row.fkItemID}</TableCell>
                    <TableCell align="right">{Number(row.TransQty).toLocaleString()}</TableCell>
                    <TableCell>{row.Packing || '—'}</TableCell>
                    <TableCell align="right">
                      {row.PackWght ? Number(row.PackWght).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {row.godown1Num || '—'}
                      {row.godown2Num ? `/${row.godown2Num}` : ''}
                    </TableCell>
                    <TableCell align="center">
                      {(can('ARRIVAL', 'CanEdit') || can('ARRIVAL', 'CanAdd') || can('ARRIVAL', 'CanDelete')) && (
                        <Tooltip title="Arrival Note">
                          <IconButton size="small" color="primary"
                            onClick={() => handlePrintNote(row)}>
                            <PictureAsPdfIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {row.LotNum && (
                        <Tooltip title="Stock Photos">
                          <IconButton size="small" color="success"
                            onClick={() => handleOpenPhotos(row)}>
                            <PhotoCameraIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {can('ARRIVAL', 'CanEdit') && (
                        <Tooltip title="Edit">
                          <IconButton size="small"
                            onClick={() => navigate('/transactions/arrivals/edit', { state: { id: row.pkTransID } })}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {can('ARRIVAL', 'CanDelete') && (
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error"
                            disabled={deleting === row.pkTransID}
                            onClick={() => handleDelete(row)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {/* ── Stock Photos Modal ── */}
      <Dialog open={photoModal.open} onClose={handleClosePhotos} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PhotoCameraIcon color="success" />
            <Typography fontWeight={700}>
              Stock Photos — {photoModal.row?.LotNum}
            </Typography>
          </Box>
          <IconButton size="small" onClick={handleClosePhotos}><CloseIcon /></IconButton>
        </DialogTitle>

        <DialogContent dividers>
          {modalLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {/* Saved photos grid */}
              {modalPhotos.length > 0 ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
                  {modalPhotos.map((p) => (
                    <Box key={p.filename} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={`${STATIC_BASE}${p.url}`}
                        alt={p.filename}
                        onClick={() => window.open(`${STATIC_BASE}${p.url}`, '_blank')}
                        sx={{ height: 110, width: 110, objectFit: 'cover', borderRadius: 1,
                              border: '1px solid #ccc', cursor: 'pointer',
                              '&:hover': { opacity: 0.85 } }}
                      />
                      <IconButton size="small" onClick={() => handleModalDelete(p)}
                        sx={{ position: 'absolute', top: -8, right: -8,
                              bgcolor: 'error.main', color: '#fff', width: 22, height: 22,
                              '&:hover': { bgcolor: 'error.dark' } }}>
                        <CloseIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  No photos saved yet for this lot.
                </Typography>
              )}

              {/* Pending photos */}
              {modalPending.length > 0 && (
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" color="success.main" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
                    {modalPending.length} new photo{modalPending.length > 1 ? 's' : ''} selected — click Upload to save
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {modalPending.map((p, i) => (
                      <Box key={i} sx={{ position: 'relative' }}>
                        <Box component="img" src={p.preview} alt={`new-${i}`}
                          sx={{ height: 90, width: 90, objectFit: 'cover', borderRadius: 1,
                                border: '2px dashed #2e7d32' }} />
                        <IconButton size="small" onClick={() => removeModalPending(i)}
                          sx={{ position: 'absolute', top: -8, right: -8,
                                bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                                '&:hover': { bgcolor: 'error.dark' } }}>
                          <CloseIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Hidden inputs */}
              <input type="file" accept="image/*" capture="environment" multiple
                ref={modalCameraRef} style={{ display: 'none' }} onChange={handleModalPhotoChange} />
              <input type="file" accept="image/*" multiple
                ref={modalGalleryRef} style={{ display: 'none' }} onChange={handleModalPhotoChange} />

              {/* Add buttons */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <Button variant="outlined" size="small" startIcon={<PhotoCameraIcon />}
                  onClick={() => modalCameraRef.current?.click()}>
                  Camera
                </Button>
                <Button variant="outlined" size="small" startIcon={<PhotoLibraryIcon />}
                  onClick={() => modalGalleryRef.current?.click()}>
                  Gallery / Computer
                </Button>
              </Box>
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button onClick={handleClosePhotos} color="inherit">Close</Button>
          {modalPending.length > 0 && (
            <Button
              variant="contained"
              color="success"
              startIcon={modalUploading ? <CircularProgress size={16} color="inherit" /> : <PhotoCameraIcon />}
              onClick={handleModalUpload}
              disabled={modalUploading}
            >
              {modalUploading ? 'Uploading…' : `Upload ${modalPending.length} Photo${modalPending.length > 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
