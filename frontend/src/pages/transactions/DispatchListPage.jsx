// DispatchListPage.jsx — List of Dispatch / Transfer / Out stock entries
//
// Shows DESP / TRF / OUT entries across all companies in the group.
// TransQty is stored as NEGATIVE in DB (stock leaving); fmtQty takes absolute value for display.
// Gate Pass PDF and email can be triggered directly from the list without opening the form.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Menu,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Tooltip, Chip, Alert, CircularProgress,
  Autocomplete, Grid,
} from '@mui/material';
import AddIcon           from '@mui/icons-material/Add';
import EditIcon          from '@mui/icons-material/Edit';
import DeleteIcon        from '@mui/icons-material/Delete';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ShareIcon         from '@mui/icons-material/Share';
import EmailIcon         from '@mui/icons-material/Email';
import WhatsAppIcon      from '@mui/icons-material/WhatsApp';
import ClearIcon         from '@mui/icons-material/Clear';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const TRANS_TYPES = [
  { value: '',     label: 'All Types'  },
  { value: 'DESP', label: 'Despatch'  },
  { value: 'TRF',  label: 'Transfer'  },
  { value: 'OUT',  label: 'Out'       },
];

const TYPE_CHIP = {
  DESP: { label: 'Despatch', color: 'primary'  },
  TRF:  { label: 'Transfer', color: 'secondary'},
  OUT:  { label: 'Out',      color: 'default'  },
};

const PERIODS = [
  { value: '2',   label: '2 Days'   },
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
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

const todayStr = new Date().toISOString().slice(0, 10);

export default function DispatchListPage() {
  const navigate = useNavigate();
  const { can }  = useAuth();

  const [parties,   setParties]   = useState([]);
  const [items,     setItems]     = useState([]);
  const [godowns,   setGodowns]   = useState([]);
  const [companies, setCompanies] = useState([]);

  const [period,     setPeriod]     = useState('2');
  const [fromDt,     setFromDt]     = useState(daysAgo(2));
  const [toDt,       setToDt]       = useState(todayStr);
  const [transType,  setTransType]  = useState('');
  const [selParty,   setSelParty]   = useState(null);
  const [selItem,    setSelItem]    = useState(null);
  const [selGodown,  setSelGodown]  = useState(null);
  const [selCompany, setSelCompany] = useState('');
  const [lotNum,     setLotNum]     = useState('');
  const [gatePass,   setGatePass]   = useState('');

  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [deleting,    setDeleting]    = useState('');
  const [shareAnchor, setShareAnchor] = useState(null);
  const [shareRow,    setShareRow]    = useState(null);

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

  const handlePeriodChange = (val) => {
    setPeriod(val);
    setFromDt(daysAgo(Number(val)));
    setToDt(todayStr);
  };

  const clearFilters = () => {
    setPeriod('2');
    setFromDt(daysAgo(2));
    setToDt(todayStr);
    setTransType('');
    setSelParty(null);
    setSelItem(null);
    setSelGodown(null);
    setSelCompany('');
    setLotNum('');
    setGatePass('');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { fromDt, toDt };
      if (transType)     params.transType = transType;
      if (selParty)      params.partyID   = selParty.pkPartyID;
      if (selItem)       params.itemID    = selItem.pkItemID;
      if (selGodown)     params.godownID  = selGodown.pkGodownID;
      if (selCompany)    params.companyID = selCompany;
      if (lotNum.trim())    params.lotNum    = lotNum.trim();
      if (gatePass.trim()) params.gatePass  = gatePass.trim();
      const { data } = await api.get('/transactions/dispatches', { params });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dispatch entries');
    } finally {
      setLoading(false);
    }
  }, [fromDt, toDt, transType, selParty, selItem, selGodown, selCompany, lotNum, gatePass]);

  useEffect(() => { load(); }, [load]);

  const handleViewGatePass = async (row) => {
    try {
      const res = await api.get(`/transactions/dispatches/${row.pkTransID}/gatepass`, {
        params:       { partyCompID: row.fkCompID },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch {
      alert('Failed to generate Gate Pass PDF');
    }
  };

  const handleShareOpen  = (e, row) => { setShareAnchor(e.currentTarget); setShareRow(row); };
  const handleShareClose = ()       => { setShareAnchor(null); setShareRow(null); };

  const handleShareEmail = async () => {
    const row = shareRow;
    handleShareClose();
    try {
      await api.post(`/transactions/dispatches/${row.pkTransID}/email`, { partyCompID: row.fkCompID });
      alert('Email sent successfully');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send email');
    }
  };

  const handleShareWhatsApp = () => {
    const row = shareRow;
    handleShareClose();
    const qty     = fmtQty(row.TransQty);
    const packing = row.Packing || '';
    const lot     = row.LotNum  || '';
    const gp      = row.GatePass || '';
    const type    = TYPE_CHIP[row.TransType]?.label || row.TransType;
    const itemStr = [row.iName, row.ItemExtDesc].filter(Boolean).join(' ');
    const msg = `*${type} Entry*\nDate: ${fmtDate(row.TransDt)}\nParty: ${row.pName}\nItem: ${itemStr}\nQty: ${qty} ${packing}\nLot No.: ${lot}\nGate Pass: ${gp}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete dispatch ${row.LotNum || row.pkTransID} (${TYPE_CHIP[row.TransType]?.label})?\nThis cannot be undone.`)) return;
    setDeleting(row.pkTransID);
    setError('');
    try {
      await api.delete(`/transactions/dispatches/${row.pkTransID}`);
      setRows((prev) => prev.filter((r) => r.pkTransID !== row.pkTransID));
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting('');
    }
  };

  // Dispatch TransQty is stored as negative in DB; show the absolute value to the user
  const fmtQty = (v) => {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return Math.abs(n % 1 === 0 ? Math.round(n) : n.toFixed(2));
  };

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
        <LocalShippingIcon color="primary" />
        <Typography variant="h5" fontWeight="bold">Dispatch Entry</Typography>
        <Box sx={{ flexGrow: 1 }} />
        {can('DELIVERY', 'CanAdd') && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => navigate('/transactions/dispatches/new')}>
            New Dispatch
          </Button>
        )}
      </Box>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={2}>
            <TextField select fullWidth size="small" label="Period" value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}>
              {PERIODS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <TextField fullWidth size="small" label="From Date" type="date" value={fromDt}
              onChange={(e) => { setFromDt(e.target.value); setPeriod(''); }}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <TextField fullWidth size="small" label="To Date" type="date" value={toDt}
              onChange={(e) => { setToDt(e.target.value); setPeriod(''); }}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField select fullWidth size="small" label="Type" value={transType}
              onChange={(e) => setTransType(e.target.value)}>
              {TRANS_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete size="small" options={parties}
              getOptionLabel={(o) => `${o.pCode} — ${o.pName}`}
              value={selParty} onChange={(_, v) => setSelParty(v)}
              renderInput={(p) => <TextField {...p} label="Party" />} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete size="small" options={items}
              getOptionLabel={(o) => o.iName}
              value={selItem} onChange={(_, v) => setSelItem(v)}
              renderInput={(p) => <TextField {...p} label="Item" />} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete size="small" options={godowns}
              getOptionLabel={(o) => `${o.gNum} — ${o.gName || ''}`}
              value={selGodown} onChange={(_, v) => setSelGodown(v)}
              renderInput={(p) => <TextField {...p} label="Godown" />} />
          </Grid>
          {companies.length > 1 && (
            <Grid item xs={12} sm={6} md={2}>
              <TextField select fullWidth size="small" label="Company" value={selCompany}
                onChange={(e) => setSelCompany(e.target.value)}>
                <MenuItem value="">All Companies</MenuItem>
                {companies.map((c) => <MenuItem key={c.pkCompID} value={c.pkCompID}>{c.CompAlias || c.CompName}</MenuItem>)}
              </TextField>
            </Grid>
          )}
          <Grid item xs={12} sm={6} md={2}>
            <TextField fullWidth size="small" label="Lot No." value={lotNum}
              onChange={(e) => setLotNum(e.target.value)} />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField fullWidth size="small" label="Gate Pass" value={gatePass}
              onChange={(e) => setGatePass(e.target.value)} />
          </Grid>
          <Grid item xs={12} sm={6} md={1}>
            <Button fullWidth variant="outlined" size="small" color="inherit"
              startIcon={<ClearIcon />} onClick={clearFilters}>
              Clear
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              {['Type', 'Date', 'GP No.', 'Lot No.', 'Party', 'Item', 'Qty', 'Packing', 'Godown', 'Vehicle', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ color: 'black', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4 }}><CircularProgress /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4, color: 'text.secondary' }}>No dispatch entries found</TableCell></TableRow>
            ) : rows.map((row) => {
              const chip = TYPE_CHIP[row.TransType] || { label: row.TransType, color: 'default' };
              const godownStr = [row.godown1Num, row.godown2Num].filter(Boolean).join(' + ') || '—';
              return (
                <TableRow key={row.pkTransID} hover>
                  <TableCell>
                    <Chip label={chip.label} color={chip.color} size="small" />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(row.TransDt)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.GatePass || '—'}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{row.LotNum || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.pName}</TableCell>
                  <TableCell>{row.itemDesc || row.iName || '—'}</TableCell>
                  <TableCell align="right">{fmtQty(row.TransQty)}</TableCell>
                  <TableCell>{row.Packing || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{godownStr}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.VehiNum || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {/* Gate Pass PDF */}
                    <Tooltip title="View Gate Pass">
                      <IconButton size="small" color="primary" onClick={() => handleViewGatePass(row)}>
                        <LocalShippingIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {/* Share */}
                    <Tooltip title="Share">
                      <IconButton size="small" color="info" onClick={(e) => handleShareOpen(e, row)}>
                        <ShareIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {/* Edit */}
                    {can('DELIVERY', 'CanEdit') && (
                      <Tooltip title="Edit">
                        <IconButton size="small" color="warning"
                          onClick={() => navigate(`/transactions/dispatches/${encodeId(row.pkTransID)}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {/* Delete */}
                    {can('DELIVERY', 'CanDelete') && (
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error"
                          disabled={deleting === row.pkTransID}
                          onClick={() => handleDelete(row)}>
                          {deleting === row.pkTransID
                            ? <CircularProgress size={16} />
                            : <DeleteIcon fontSize="small" />}
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

      {/* Share dropdown menu */}
      <Menu anchorEl={shareAnchor} open={Boolean(shareAnchor)} onClose={handleShareClose}>
        <MenuItem onClick={handleShareEmail}>
          <EmailIcon fontSize="small" sx={{ mr: 1 }} /> Email
        </MenuItem>
        <MenuItem onClick={handleShareWhatsApp}>
          <WhatsAppIcon fontSize="small" sx={{ mr: 1, color: '#25D366' }} /> WhatsApp
        </MenuItem>
      </Menu>
    </Box>
  );
}
