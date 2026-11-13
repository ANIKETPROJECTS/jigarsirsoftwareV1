import { useEffect, useState, useMemo } from 'react';
import {
  Box, Paper, Typography, Chip, CircularProgress, Alert, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Divider, IconButton, Tooltip, LinearProgress,
} from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts';
import MoveToInboxIcon   from '@mui/icons-material/MoveToInbox';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import WarehouseIcon     from '@mui/icons-material/Warehouse';
import Inventory2Icon    from '@mui/icons-material/Inventory2';
import RefreshIcon       from '@mui/icons-material/Refresh';
import WarningIcon       from '@mui/icons-material/Warning';
import CheckCircleIcon   from '@mui/icons-material/CheckCircle';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}-${MONTHS[dt.getMonth()]}-${dt.getFullYear()}`;
}
function fmtNum(n, dec = 0) {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}
function fmtAmt(n) {
  return '₹' + fmtNum(n, 2);
}

const AGING_META = {
  '0-30d':   { label: '0 – 30 days',   color: '#1b5e20', bg: '#e8f5e9', barColor: '#2e7d32' },
  '31-60d':  { label: '31 – 60 days',  color: '#e65100', bg: '#fff8e1', barColor: '#f9a825' },
  '61-90d':  { label: '61 – 90 days',  color: '#bf360c', bg: '#fff3e0', barColor: '#ef6c00' },
  '90-180d': { label: '90 – 180 days', color: '#b71c1c', bg: '#ffebee', barColor: '#c62828' },
  '180+d':   { label: '180+ days',     color: '#4a148c', bg: '#f3e5f5', barColor: '#7b1fa2' },
};
const AGING_ORDER = ['0-30d', '31-60d', '61-90d', '90-180d', '180+d'];

function docTag(daysLeft) {
  const d = parseInt(daysLeft ?? 9999);
  if (d < 0)   return { label: 'Expired',  color: '#fff', bg: '#c62828' };
  if (d <= 7)  return { label: 'Critical', color: '#fff', bg: '#e64a19' };
  if (d <= 30) return { label: 'Warning',  color: '#fff', bg: '#f9a825' };
  return             { label: 'Valid',     color: '#fff', bg: '#2e7d32' };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const { data: d } = await api.get('/dashboard');
      setData(d);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthStr = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const totalAgingLots = useMemo(() =>
    (data?.lotAging || []).reduce((s, r) => s + Number(r.lotCount), 0), [data]);

  const maxOutstanding = useMemo(() =>
    Math.max(...(data?.outstanding || []).map(r => Number(r.outstandingAmt)), 1), [data]);

  const expiringSoon = useMemo(() =>
    (data?.agreements || []).filter(d => parseInt(d.daysLeft) <= 90), [data]);

  const collectionRatio = useMemo(() => {
    const collected    = Number(data?.monthRcpt?.rcptAmt          || 0);
    const outstanding  = Number(data?.outstandingBill?.totalAmt   || 0);
    const total = collected + outstanding;
    if (!total) return 0;
    return Math.min(100, Math.round((collected / total) * 100));
  }, [data]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, maxWidth: 1400, mx: 'auto' }}>

      {/* ── SECTION 1: Header ──────────────────────────────────────────────── */}
      <Paper elevation={0} sx={{
        mb: 3, p: { xs: 2, sm: 3 }, borderRadius: 3, color: '#fff', overflow: 'hidden',
        position: 'relative',
        background: 'linear-gradient(135deg, #0d2137 0%, #1565C0 60%, #1976d2 100%)',
      }}>
        <Box sx={{ position:'absolute', right:-40, top:-40, width:200, height:200,
          borderRadius:'50%', background:'rgba(255,255,255,0.05)', pointerEvents:'none' }} />
        <Box sx={{ position:'absolute', right:80, bottom:-60, width:140, height:140,
          borderRadius:'50%', background:'rgba(255,255,255,0.07)', pointerEvents:'none' }} />

        <Box sx={{ display:'flex', flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between' }}>
          <Box>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5, mb:0.5 }}>
              <WarehouseIcon sx={{ fontSize: 28, opacity: 0.9 }} />
              <Typography variant="h5" fontWeight={800} letterSpacing={0.3}>
                Godown Management System
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>{dateStr}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {user?.userFullName || user?.userCode}{user?.compID ? ` — ${user.compID}` : ''}
            </Typography>
          </Box>
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={load} disabled={loading}
                sx={{ color:'rgba(255,255,255,0.8)', '&:hover':{ color:'#fff', bgcolor:'rgba(255,255,255,0.12)' } }}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && (
        <Box sx={{ display:'flex', justifyContent:'center', py: 12 }}>
          <CircularProgress />
        </Box>
      )}

      {/* ── SIMPLE VIEW (non-admin): today's arrival & dispatch entries ──── */}
      {!loading && data?.mode === 'simple' && (
        <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'1fr 1fr' }, gap: 3 }}>
          <TodayEntryTable
            title="Today's Arrivals"
            rows={data.todayArv}
            color="#1b5e20"
            icon={<MoveToInboxIcon fontSize="small" />}
          />
          <TodayEntryTable
            title="Today's Dispatches"
            rows={data.todayDsp}
            color="#4a148c"
            icon={<LocalShippingIcon fontSize="small" />}
            showGatePass={true}
          />
        </Box>
      )}

      {/* ── FULL DASHBOARD (Administrator / Sub Administrator roles) ──────── */}
      {!loading && data?.mode === 'full' && (
        <Stack spacing={3}>

          {/* ── SECTION 2: Today's Activity KPIs ──────────────────────────── */}
          <SectionTitle title="Today's Activity" subtitle="Live counts for all group companies" />
          <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap: 2 }}>
            <KpiCard label="Arrivals (Tonnes)"  value={Number(data.todayArv.totalTons || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              sub={`${fmtNum(data.todayArv.cnt)} lots · ${fmtNum(data.todayArv.totalQty)} pkgs`}
              color="#1b5e20" bg="linear-gradient(135deg,#e8f5e9,#f1f8e9)"
              icon={<MoveToInboxIcon   sx={{ fontSize:28, color:'#2e7d32', opacity:0.5 }} />} />
            <KpiCard label="Dispatches (Tonnes)" value={Number(data.todayDsp.totalTons || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              sub={`${fmtNum(data.todayDsp.cnt)} lots · ${fmtNum(data.todayDsp.totalQty)} pkgs`}
              color="#4a148c" bg="linear-gradient(135deg,#f3e5f5,#fce4ec)"
              icon={<LocalShippingIcon sx={{ fontSize:28, color:'#6a1b9a', opacity:0.5 }} />} />
            <KpiCard label="Stock in Godown"   value={fmtNum(data.stockSummary.totalLots)}
              sub="active lots"
              color="#1565C0" bg="linear-gradient(135deg,#e3f2fd,#e8eaf6)"
              icon={<WarehouseIcon     sx={{ fontSize:28, color:'#1565C0', opacity:0.5 }} />} />
            <KpiCard label="Stock (Tonnes)"    value={Number(data.stockSummary.totalTons || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              sub={`${fmtNum(data.stockSummary.totalQty)} pkgs in stock`}
              color="#004d40" bg="linear-gradient(135deg,#e0f2f1,#e8f5e9)"
              icon={<Inventory2Icon    sx={{ fontSize:28, color:'#00695c', opacity:0.5 }} />} />
          </Box>

          {/* ── SECTION 2b: Shared packing color map (consistent across both charts) */}
          {/* ── SECTION 2b: 7-Day Packing-wise Arrival+Dispatch Chart ────── */}
          {(() => {
            const allNames = [...new Set([
              ...(data.arvPackNames || []),
              ...(data.dspPackNames || []),
              ...(data.arvPackNamesMonth || []),
              ...(data.dspPackNamesMonth || []),
            ])].sort();
            const colorMap = buildPackColorMap(allNames);
            return (
              <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'1fr 1fr' }, gap: 2 }}>
                <PackingTrendChart
                  packTrend={data.packTrend || []}
                  arvPackNames={data.arvPackNames || []}
                  dspPackNames={data.dspPackNames || []}
                  colorMap={colorMap}
                  months={MONTHS}
                />
                <PackingMonthChart
                  packMonthTrend={data.packMonthTrend || []}
                  arvPackNames={data.arvPackNamesMonth || []}
                  dspPackNames={data.dspPackNamesMonth || []}
                  colorMap={colorMap}
                  months={MONTHS}
                />
              </Box>
            );
          })()}

          {/* ── SECTION 3 + 4: Lot Aging & Month Billing ──────────────────── */}
          <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'1fr 1fr' }, gap: 3 }}>

            {/* SECTION 3: Lot Aging */}
            <SectionPaper title="Party Lot Aging" subtitle="Lots currently in storage by age">
              {AGING_ORDER.map((key) => {
                const meta = AGING_META[key];
                const row  = (data.lotAging || []).find(r => r.ageBucket === key) || { lotCount: 0, totalQty: 0, totalTons: 0 };
                const pct  = totalAgingLots ? Math.round((Number(row.lotCount) / totalAgingLots) * 100) : 0;
                return (
                  <Box key={key} sx={{ mb: 2 }}>
                    <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:0.5 }}>
                      <Box>
                        <Typography variant="body2" fontWeight={700} sx={{ color: meta.color }}>
                          {meta.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fmtNum(row.lotCount)} lots &nbsp;|&nbsp; {fmtNum(row.totalQty, 0)} pkgs &nbsp;|&nbsp;{' '}
                          {Number(row.totalTons || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} T
                        </Typography>
                      </Box>
                      <Typography variant="h6" fontWeight={800} sx={{ color: meta.color }}>{pct}%</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{
                        height: 8, borderRadius: 4,
                        bgcolor: meta.bg,
                        '& .MuiLinearProgress-bar': { bgcolor: meta.barColor, borderRadius: 4 },
                      }}
                    />
                  </Box>
                );
              })}
            </SectionPaper>

            {/* SECTION 5: Month Billing Summary */}
            <SectionPaper title={`${monthStr} — Billing`} subtitle="Bills generated vs receipts collected">
              <Stack spacing={2.5}>
                <Box>
                  <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.5 }}>
                    <Typography variant="body2" color="text.secondary" fontWeight={600}>Bills Generated</Typography>
                    <Typography variant="body2" fontWeight={700} color="#1565C0">
                      {fmtNum(data.monthBill.billCount)} bills
                    </Typography>
                  </Box>
                  <Typography variant="h5" fontWeight={900} color="#1565C0">
                    {fmtAmt(data.monthBill.billAmt)}
                  </Typography>
                </Box>

                <Divider />

                <Box>
                  <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.5 }}>
                    <Typography variant="body2" color="text.secondary" fontWeight={600}>Receipts Collected</Typography>
                    <Typography variant="body2" fontWeight={700} color="#1b5e20">
                      {fmtNum(data.monthRcpt.rcptCount)} receipts
                    </Typography>
                  </Box>
                  <Typography variant="h5" fontWeight={900} color="#1b5e20">
                    {fmtAmt(data.monthRcpt.rcptAmt)}
                  </Typography>
                </Box>

                <Divider />

                <Box>
                  <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.5 }}>
                    <Typography variant="body2" color="text.secondary" fontWeight={600}>Outstanding Bills</Typography>
                    <Typography variant="body2" fontWeight={700} color="#b71c1c">
                      {fmtNum(data.outstandingBill?.billCount || 0)} bills
                    </Typography>
                  </Box>
                  <Typography variant="h5" fontWeight={900} color="#b71c1c">
                    {fmtAmt(data.outstandingBill?.totalAmt || 0)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display:'block', mt:0.5 }}>
                    Godown Rent: {fmtAmt(data.outstandingBill?.godrentAmt || 0)}&nbsp;|&nbsp;
                    Hamali: {fmtAmt(data.outstandingBill?.hamaliAmt || 0)}&nbsp;|&nbsp;
                    General: {fmtAmt(data.outstandingBill?.genAmt || 0)}
                  </Typography>
                </Box>

                <Divider />

                <Box>
                  <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.75 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      Collection Rate
                    </Typography>
                    <Typography variant="caption" fontWeight={700}
                      sx={{ color: collectionRatio >= 80 ? '#2e7d32' : collectionRatio >= 50 ? '#e65100' : '#b71c1c' }}>
                      {collectionRatio}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={collectionRatio}
                    sx={{
                      height: 10, borderRadius: 5,
                      bgcolor: '#f5f5f5',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 5,
                        bgcolor: collectionRatio >= 80 ? '#2e7d32' : collectionRatio >= 50 ? '#ef6c00' : '#c62828',
                      },
                    }}
                  />
                </Box>

              </Stack>
            </SectionPaper>
          </Box>

          {/* ── SECTION 6: Outstanding Payments ────────────────────────────── */}
          <SectionTitle title="Outstanding Payments" subtitle="Top parties with pending bill balances" />
          <Paper elevation={2} sx={{ borderRadius: 3, overflow:'hidden' }}>
            {(!data.outstanding || data.outstanding.length === 0) ? (
              <Box sx={{ py:5, textAlign:'center' }}>
                <CheckCircleIcon sx={{ fontSize:48, color:'success.main', mb:1, opacity:0.7 }} />
                <Typography color="text.secondary">No outstanding bills found</Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor:'#f1f3f9' }}>
                      <TableCell sx={{ fontWeight:700, fontSize:12 }}>#</TableCell>
                      <TableCell sx={{ fontWeight:700, fontSize:12 }}>Party Name</TableCell>
                      <TableCell align="center" sx={{ fontWeight:700, fontSize:12 }}>Bills</TableCell>
                      <TableCell align="right" sx={{ fontWeight:700, fontSize:12 }}>Outstanding</TableCell>
                      <TableCell sx={{ fontWeight:700, fontSize:12, minWidth:160 }}>Amount Bar</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.outstanding.map((row, i) => {
                      const pct = Math.round((Number(row.outstandingAmt) / maxOutstanding) * 100);
                      const color = i === 0 ? '#b71c1c' : i <= 2 ? '#e65100' : '#1565C0';
                      return (
                        <TableRow key={i} hover>
                          <TableCell sx={{ color:'text.secondary', fontSize:12 }}>{i + 1}</TableCell>
                          <TableCell sx={{ fontWeight:600 }}>{row.pName}</TableCell>
                          <TableCell align="center">
                            <Chip label={row.billCount} size="small"
                              sx={{ bgcolor:'#e3f2fd', color:'#1565C0', fontWeight:700, fontSize:11, height:20 }} />
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight={800} sx={{ color, fontSize:14, fontVariantNumeric:'tabular-nums' }}>
                              {fmtAmt(row.outstandingAmt)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <LinearProgress
                              variant="determinate"
                              value={pct}
                              sx={{
                                height:6, borderRadius:3,
                                bgcolor:'#f5f5f5',
                                '& .MuiLinearProgress-bar':{ bgcolor: color, borderRadius:3 },
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {/* ── SECTION 7: Godown & Party Agreement Expiry ─────────────────── */}
          <SectionTitle
            title="Agreement Expiry Tracker"
            subtitle="Godown & Party Agreements — expiring or recently expired"
            badge={expiringSoon.filter(d => parseInt(d.daysLeft) <= 30).length}
          />
          <Paper elevation={2} sx={{ borderRadius: 3, overflow:'hidden' }}>
            {(!data.agreements || data.agreements.length === 0) ? (
              <Box sx={{ py:5, textAlign:'center' }}>
                <CheckCircleIcon sx={{ fontSize:48, color:'success.main', mb:1, opacity:0.7 }} />
                <Typography color="text.secondary">No agreement documents found</Typography>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: 380 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {['Status','Doc Type','Description','Godown / Party','Valid From','Expiry','Days Left'].map((h, i) => (
                        <TableCell key={h} sx={{
                          fontWeight:700, fontSize:12, bgcolor:'#f1f3f9', color:'#37474f',
                          textAlign: i === 6 ? 'right' : 'left',
                          minWidth:[88,120,180,140,100,105,80][i],
                        }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.agreements.map((doc, i) => {
                      const tag  = docTag(doc.daysLeft);
                      const days = parseInt(doc.daysLeft);
                      const rowBg = days < 0 ? '#fff5f5' : days <= 7 ? '#fff8f0' : days <= 30 ? '#fffef0' : undefined;
                      return (
                        <TableRow key={doc.pkDocID || i}
                          sx={{ bgcolor: rowBg, '&:hover':{ filter:'brightness(0.97)' } }}>
                          <TableCell>
                            <Chip label={tag.label} size="small" sx={{
                              bgcolor: tag.bg, color: tag.color,
                              fontWeight:700, fontSize:11, height:22,
                            }} />
                          </TableCell>
                          <TableCell sx={{ fontWeight:700, fontSize:13 }}>{doc.DocType}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>{doc.DocDiscrption}</Typography>
                            {doc.Note && <Typography variant="caption" color="text.secondary" display="block">{doc.Note}</Typography>}
                          </TableCell>
                          <TableCell>
                            {doc.GodownNum && <Chip label={`G-${doc.GodownNum}`} size="small" variant="outlined"
                              sx={{ mr:0.5, fontSize:11, height:20 }} />}
                            <Typography variant="body2" component="span">{doc.PartyName || ''}</Typography>
                          </TableCell>
                          <TableCell sx={{ color:'text.secondary', fontSize:12 }}>{fmtDate(doc.FromDt)}</TableCell>
                          <TableCell sx={{ fontWeight:700, color: days < 0 ? '#b71c1c' : days <= 30 ? '#e65100' : '#1b5e20', fontSize:13 }}>
                            {fmtDate(doc.ToDt)}
                          </TableCell>
                          <TableCell align="right">
                            <Box sx={{
                              display:'inline-block', px:1.2, py:0.2, borderRadius:2,
                              bgcolor: days < 0 ? '#ffebee' : days <= 7 ? '#fff3e0' : days <= 30 ? '#fffde7' : '#e8f5e9',
                            }}>
                              <Typography sx={{ fontWeight:800, fontSize:13,
                                color: days < 0 ? '#b71c1c' : days <= 7 ? '#e65100' : days <= 30 ? '#f9a825' : '#2e7d32' }}>
                                {days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                              </Typography>
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {/* ── SECTIONS 8 & 9: Recent Arrivals & Dispatches ──────────────── */}
          <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'1fr 1fr' }, gap: 3 }}>
            <RecentTable
              title="Recent Arrivals"
              rows={data.recentArv}
              color="#1b5e20"
              icon={<MoveToInboxIcon fontSize="small" />}
            />
            <RecentTable
              title="Recent Dispatches"
              rows={data.recentDsp}
              color="#4a148c"
              icon={<LocalShippingIcon fontSize="small" />}
              showGatePass={true}
            />
          </Box>

        </Stack>
      )}
    </Box>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TodayEntryTable({ title, rows, color, icon, showGatePass = false }) {
  return (
    <Paper elevation={2} sx={{ borderRadius:3, overflow:'hidden' }}>
      <Box sx={{
        px:2.5, py:1.75, borderBottom:'1px solid', borderColor:'divider',
        background:'linear-gradient(90deg,#f8f9ff,#fff)',
        display:'flex', alignItems:'center', gap:1,
      }}>
        <Box sx={{ color }}>{icon}</Box>
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
        <Chip label={rows?.length || 0} size="small"
          sx={{ ml:'auto', bgcolor: color, color:'#fff', fontWeight:700, fontSize:11, height:20 }} />
      </Box>
      {(!rows || rows.length === 0) ? (
        <Box sx={{ py:5, textAlign:'center' }}>
          <Typography variant="body2" color="text.secondary">No entries today</Typography>
        </Box>
      ) : (
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor:'#f7f8fc' }}>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>#</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Party</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>{showGatePass ? 'Gate Pass' : 'Lot No.'}</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Item</TableCell>
                <TableCell align="right" sx={{ fontWeight:700, fontSize:11 }}>Qty / Packing</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Type</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ fontSize:11, color:'text.secondary' }}>{i + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth:140 }}>{r.pName || '—'}</Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize:12 }}>
                    {showGatePass ? (r.GatePass || '—') : (r.LotNum || '—')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth:130 }}>{r.ItemName || '—'}</Typography>
                    {r.ItemExtDesc && (
                      <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth:130 }}>
                        {r.ItemExtDesc}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontSize={13} fontWeight={700} sx={{ color }}>
                      {fmtNum(r.TransQty)}{r.Packing ? ' ' + r.Packing : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={TRANS_LABEL[r.TransType] || r.TransType} size="small"
                      sx={{ bgcolor:'#f1f3f9', fontWeight:600, fontSize:11, height:20 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}

function SectionTitle({ title, subtitle, badge }) {
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
        <Typography variant="h6" fontWeight={800} color="#263238">{title}</Typography>
        {badge > 0 && (
          <Chip icon={<WarningIcon sx={{ fontSize:14, color:'#fff !important' }} />}
            label={badge} size="small"
            sx={{ bgcolor:'#e53935', color:'#fff', fontWeight:700, height:22, fontSize:11 }} />
        )}
      </Box>
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
    </Box>
  );
}

function SectionPaper({ title, subtitle, children }) {
  return (
    <Paper elevation={2} sx={{ borderRadius:3, overflow:'hidden' }}>
      <Box sx={{ px:2.5, py:1.75, borderBottom:'1px solid', borderColor:'divider',
        background:'linear-gradient(90deg,#f8f9ff,#fff)' }}>
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
      <Box sx={{ p:2.5 }}>{children}</Box>
    </Paper>
  );
}

function KpiCard({ label, value, sub, color, bg, icon }) {
  return (
    <Paper elevation={1} sx={{ p:2, borderRadius:3, background:bg, position:'relative' }}>
      <Box sx={{ position:'absolute', right:12, top:12 }}>{icon}</Box>
      <Typography variant="h4" fontWeight={900} sx={{ color, lineHeight:1.1, letterSpacing:-0.5 }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color, opacity:0.7, fontWeight:600, display:'block' }}>
        {sub}
      </Typography>
      <Typography variant="caption" sx={{ color:'text.secondary', fontWeight:700, fontSize:11, display:'block', mt:0.5 }}>
        {label}
      </Typography>
    </Paper>
  );
}

function MonthStatBox({ label, tons, qty, color }) {
  return (
    <Box sx={{ p:1.5, bgcolor:'grey.50', borderRadius:2, border:'1px solid', borderColor:'grey.200' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>{label}</Typography>
      <Typography variant="h6" fontWeight={900} sx={{ color, lineHeight:1.1 }}>{fmtNum(tons, 3)} T</Typography>
      <Typography variant="caption" color="text.secondary">{fmtNum(qty)} pkgs</Typography>
    </Box>
  );
}

// User-specified colors for known packing types
const NAMED_PACK_COLORS = {
  'Bags':    '#F0F01F',
  'Drums':   '#F21A07',
  'Cartons': '#A8F207',
  'Carbo':   '#07F2E2',
  'J.Bags':  '#9E5C05',
  'Bundle':  '#C707F2',
  'Tank':    '#F28C07',
};

// Fallback palette for unlisted packings
const PACK_COLORS = [
  '#c62828','#42a5f5','#1b5e20','#66bb6a','#0d47a1',
  '#e91e63','#4e342e','#00838f','#558b2f','#ad1457',
  '#ff7043','#1565C0','#7b1fa2','#e65100','#0277bd',
];
// Unique color for index i — never repeats, skips already-named colors
function packColor(i, usedSet) {
  for (let k = i; ; k++) {
    const c = k < PACK_COLORS.length
      ? PACK_COLORS[k]
      : `hsl(${(k * 137.508) % 360}, 62%, 42%)`;
    if (!usedSet || !usedSet.has(c)) return c;
  }
}

// Build a color map for all packing names — named ones first, rest get unique fallbacks
function buildPackColorMap(allNames) {
  const usedColors = new Set(Object.values(NAMED_PACK_COLORS));
  const map = {};
  let dynIdx = 0;
  for (const p of allNames) {
    if (NAMED_PACK_COLORS[p]) {
      map[p] = NAMED_PACK_COLORS[p];
    } else {
      const c = packColor(dynIdx++, usedColors);
      usedColors.add(c);
      map[p] = c;
    }
  }
  return map;
}

function PackTooltip({ active, payload, label, formatLabel }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const sorted = [...payload].filter(p => Number(p.value) > 0).sort((a, b) => b.value - a.value);
  const fmtT = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (
    <Paper sx={{ p: 1.5, minWidth: 150, boxShadow: 4, fontSize: 12, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {formatLabel(label)}
      </Typography>
      <Typography variant="body2" fontWeight={800} sx={{ mb: sorted.length ? 0.75 : 0, fontSize: 13 }}>
        Total: {fmtT(total)} T
      </Typography>
      {sorted.map(p => (
        <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 1.5 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.fill, flexShrink: 0 }} />
          <Typography variant="caption">{p.name}: {fmtT(p.value)} T</Typography>
        </Box>
      ))}
    </Paper>
  );
}

function PackingTrendChart({ packTrend, arvPackNames, dspPackNames, colorMap, months }) {
  const allPackNames = useMemo(
    () => [...new Set([...arvPackNames, ...dspPackNames])].sort(),
    [arvPackNames, dspPackNames]
  );
  const hasData = allPackNames.length > 0;

  // Flatten: each date → two data points (ARV then DSP), each carrying packing values
  const flatData = useMemo(() => {
    if (!hasData) return [];
    const rows = [];
    for (const d of packTrend) {
      const [y, mo, dd] = (d.date || '').split('-');
      const dateLabel = `${dd}-${months[parseInt(mo, 10) - 1] || ''}`;
      const arv = { xKey: `${d.date}_ARV`, group: 'ARV', dateLabel };
      const dsp = { xKey: `${d.date}_DSP`, group: 'DSP', dateLabel };
      for (const p of allPackNames) {
        arv[p] = d[`arv_${p}`] || 0;
        dsp[p] = d[`dsp_${p}`] || 0;
      }
      rows.push(arv, dsp);
    }
    return rows;
  }, [packTrend, allPackNames, hasData, months]);

  const fmtTons = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Custom X tick: shows "ARV"/"DESP", total tonnes, and date (on ARV only)
  const renderTick = ({ x, y, payload, index }) => {
    const isArv  = payload.value.endsWith('_ARV');
    const entry  = flatData[index] || {};
    const total  = allPackNames.reduce((s, p) => s + (Number(entry[p]) || 0), 0);
    const totStr = total.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + 'T';
    return (
      <g>
        <text x={x} y={y + 13} textAnchor="middle" fontSize={11}
          fill={isArv ? '#1b5e20' : '#b71c1c'} fontWeight={700}>
          {isArv ? 'ARV' : 'DESP'}
        </text>
        <text x={x} y={y + 25} textAnchor="middle" fontSize={10} fill="#546e7a">
          {totStr}
        </text>
        {isArv && (
          <text x={x + 14} y={y + 38} textAnchor="middle" fontSize={10} fill="#90a4ae">
            {entry.dateLabel}
          </text>
        )}
      </g>
    );
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        7-Day Arrival &amp; Dispatch by Packing
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Tonnes — last 7 days including today
      </Typography>
      {!hasData ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No packing data for the last 7 days</Typography>
        </Box>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={flatData} margin={{ top: 4, right: 16, left: 0, bottom: 10 }}
            barCategoryGap="8%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false} />
            <XAxis dataKey="xKey" tick={renderTick} interval={0} tickLine={false} axisLine={false} height={62} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={fmtTons} width={52} />
            <ReTooltip
              content={(props) => (
                <PackTooltip {...props} formatLabel={(key) => {
                  const [date, grp] = key.split('_');
                  const [y, mo, dd] = (date || '').split('-');
                  return `${dd}-${months[parseInt(mo, 10) - 1]}-${y} · ${grp}`;
                }} />
              )}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {allPackNames.map((p, i) => (
              <Bar key={p} dataKey={p} stackId="a"
                fill={colorMap?.[p] ?? buildPackColorMap([p])[p]}
                radius={i === allPackNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}

function PackingMonthChart({ packMonthTrend, arvPackNames, dspPackNames, colorMap, months }) {
  const allPackNames = useMemo(
    () => [...new Set([...arvPackNames, ...dspPackNames])].sort(),
    [arvPackNames, dspPackNames]
  );
  const hasData = allPackNames.length > 0;

  const flatData = useMemo(() => {
    if (!hasData) return [];
    const rows = [];
    for (const d of packMonthTrend) {
      const [y, mo] = (d.month || '').split('-');
      const monthLabel = `${months[parseInt(mo, 10) - 1] || ''}-${String(y).slice(2)}`;
      const arv = { xKey: `${d.month}_ARV`, group: 'ARV', monthLabel };
      const dsp = { xKey: `${d.month}_DSP`, group: 'DSP', monthLabel };
      for (const p of allPackNames) {
        arv[p] = d[`arv_${p}`] || 0;
        dsp[p] = d[`dsp_${p}`] || 0;
      }
      rows.push(arv, dsp);
    }
    return rows;
  }, [packMonthTrend, allPackNames, hasData, months]);

  const fmtTons = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const renderTick = ({ x, y, payload, index }) => {
    const isArv = payload.value.endsWith('_ARV');
    const entry = flatData[index] || {};
    const total = allPackNames.reduce((s, p) => s + (Number(entry[p]) || 0), 0);
    const totStr = total.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + 'T';
    return (
      <g>
        <text x={x} y={y + 13} textAnchor="middle" fontSize={11}
          fill={isArv ? '#1b5e20' : '#b71c1c'} fontWeight={700}>
          {isArv ? 'ARV' : 'DESP'}
        </text>
        <text x={x} y={y + 25} textAnchor="middle" fontSize={10} fill="#546e7a">
          {totStr}
        </text>
        {isArv && (
          <text x={x + 16} y={y + 38} textAnchor="middle" fontSize={10} fill="#90a4ae">
            {entry.monthLabel}
          </text>
        )}
      </g>
    );
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        6-Month Arrival &amp; Dispatch by Packing
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Tonnes — last 6 months including current month
      </Typography>
      {!hasData ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No packing data for the last 6 months</Typography>
        </Box>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={flatData} margin={{ top: 4, right: 16, left: 0, bottom: 10 }}
            barCategoryGap="8%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false} />
            <XAxis dataKey="xKey" tick={renderTick} interval={0} tickLine={false} axisLine={false} height={62} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={fmtTons} width={52} />
            <ReTooltip
              content={(props) => (
                <PackTooltip {...props} formatLabel={(key) => {
                  const [mo, grp] = key.split('_');
                  const [y, m] = (mo || '').split('-');
                  return `${months[parseInt(m, 10) - 1]}-${y} · ${grp}`;
                }} />
              )}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {allPackNames.map((p, i) => (
              <Bar key={p} dataKey={p} stackId="a"
                fill={colorMap?.[p] ?? buildPackColorMap([p])[p]}
                radius={i === allPackNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}

const TRANS_LABEL = { ARV:'Arrival', RET:'Return', IN:'In', DESP:'Dispatch', TRF:'Transfer', OUT:'Out' };

// showGatePass=true  → dispatch layout: Date | Party | GatePass | Item | Qty
// showGatePass=false → arrival layout:  Date | Party | Lot No.  | Item | Qty
function RecentTable({ title, rows, color, icon, showGatePass = false }) {
  return (
    <Paper elevation={2} sx={{ borderRadius:3, overflow:'hidden' }}>
      <Box sx={{
        px:2.5, py:1.75, borderBottom:'1px solid', borderColor:'divider',
        background:'linear-gradient(90deg,#f8f9ff,#fff)',
        display:'flex', alignItems:'center', gap:1,
      }}>
        <Box sx={{ color }}>{icon}</Box>
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      </Box>
      {(!rows || rows.length === 0) ? (
        <Box sx={{ py:4, textAlign:'center' }}>
          <Typography variant="body2" color="text.secondary">No transactions today</Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor:'#f7f8fc' }}>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Date</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Party</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>{showGatePass ? 'Gate Pass' : 'Lot No.'}</TableCell>
                <TableCell sx={{ fontWeight:700, fontSize:11 }}>Item</TableCell>
                <TableCell align="right" sx={{ fontWeight:700, fontSize:11 }}>Qty / Packing</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ fontSize:12, color:'text.secondary', whiteSpace:'nowrap' }}>{fmtDate(r.TransDt)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth:130 }}>{r.pName || '—'}</Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize:12 }}>
                    {showGatePass ? (r.GatePass || '—') : (r.LotNum || '—')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth:130 }}>{r.ItemName || '—'}</Typography>
                    {r.ItemExtDesc && (
                      <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth:130 }}>
                        {r.ItemExtDesc}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontSize={13} fontWeight={700} sx={{ color }}>
                      {fmtNum(r.TransQty)}{r.Packing ? ' ' + r.Packing : ''}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
