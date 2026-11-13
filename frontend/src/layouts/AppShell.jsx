import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  AppBar, Box, Collapse, Drawer, Toolbar, Typography,
  List, ListItemButton, ListItemIcon, ListItemText, Divider,
  IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert, CircularProgress, InputAdornment,
} from '@mui/material';
import api from '../services/api';
import PublicIcon         from '@mui/icons-material/Public';
import PercentIcon        from '@mui/icons-material/Percent';
import EventIcon          from '@mui/icons-material/Event';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import PeopleIcon         from '@mui/icons-material/People';
import Inventory2Icon     from '@mui/icons-material/Inventory2';
import WarehouseIcon      from '@mui/icons-material/Warehouse';
import BadgeIcon          from '@mui/icons-material/Badge';
import LogoutIcon         from '@mui/icons-material/Logout';
import VpnKeyIcon         from '@mui/icons-material/VpnKey';
import VisibilityIcon     from '@mui/icons-material/Visibility';
import VisibilityOffIcon  from '@mui/icons-material/VisibilityOff';
import CorporateFareIcon  from '@mui/icons-material/CorporateFare';
import BusinessIcon       from '@mui/icons-material/Business';
import SecurityIcon       from '@mui/icons-material/Security';
import LockIcon           from '@mui/icons-material/Lock';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import LinkIcon           from '@mui/icons-material/Link';
import ListAltIcon        from '@mui/icons-material/ListAlt';
import RequestQuoteIcon   from '@mui/icons-material/RequestQuote';
import LocationOnIcon     from '@mui/icons-material/LocationOn';
import FolderIcon         from '@mui/icons-material/Folder';
import LocalShippingIcon  from '@mui/icons-material/LocalShipping';
import EventNoteIcon      from '@mui/icons-material/EventNote';
import SummarizeIcon      from '@mui/icons-material/Summarize';
import SwapHorizIcon      from '@mui/icons-material/SwapHoriz';
import ReceiptLongIcon    from '@mui/icons-material/ReceiptLong';
import ExpandLessIcon     from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon     from '@mui/icons-material/ExpandMore';
import MenuIcon           from '@mui/icons-material/Menu';
import BackupIcon         from '@mui/icons-material/Backup';
import DashboardIcon      from '@mui/icons-material/Dashboard';
import { useAuth } from '../contexts/AuthContext';

const DRAWER_WIDTH = 220;

const NAV = [
  {
    group: 'MASTERS',
    moduleCode: 'MASTERS',
    items: [
      { label: 'State',         path: '/masters/state',         icon: <PublicIcon fontSize="small" />,        moduleCode: 'MASTERS' },
      { label: 'Tax',           path: '/masters/tax',           icon: <PercentIcon fontSize="small" />,       moduleCode: 'MASTERS' },
      { label: 'Holiday',       path: '/masters/holiday',       icon: <EventIcon fontSize="small" />,         moduleCode: 'MASTERS' },
      { label: 'Bank',          path: '/masters/bank',          icon: <AccountBalanceIcon fontSize="small" />, moduleCode: 'MASTERS' },
      { label: 'Party',         path: '/masters/parties',       icon: <PeopleIcon fontSize="small" />,        moduleCode: 'PARTY' },
      { label: 'Item',          path: '/masters/items',         icon: <Inventory2Icon fontSize="small" />,    moduleCode: 'ITEM_MASTER' },
      { label: 'Godown',        path: '/masters/godowns',       icon: <WarehouseIcon fontSize="small" />,     moduleCode: 'MASTERS' },
      { label: 'Employee',      path: '/masters/employees',     icon: <BadgeIcon fontSize="small" />,         moduleCode: 'MASTERS' },
      { label: 'Contract Rate', path: '/masters/ratechart',     icon: <RequestQuoteIcon fontSize="small" />,  moduleCode: 'MASTERS' },
      { label: 'Godown Link',   path: '/masters/godown-links',  icon: <LinkIcon fontSize="small" />,          moduleCode: 'MASTERS' },
      { label: 'Location',      path: '/masters/locations',     icon: <LocationOnIcon fontSize="small" />,    moduleCode: 'MASTERS' },
      { label: 'Document Files', path: '/masters/docfiles',     icon: <FolderIcon fontSize="small" />,        moduleCode: 'DOCUMENTS' },
      { label: 'Combo Data',    path: '/masters/combo-data',   icon: <ListAltIcon fontSize="small" />,       moduleCode: 'COMBO_DATA' },
    ],
  },
  {
    group: 'TRANSACTIONS',
    moduleCode: 'ARRIVAL',
    items: [
      { label: 'Arrival / Return / In',  path: '/transactions/arrivals',   icon: <LocalShippingIcon fontSize="small" /> },
      { label: 'Dispatch Entry',         path: '/transactions/dispatches', icon: <LocalShippingIcon fontSize="small" />, moduleCode: 'DELIVERY' },
      { label: 'Hamali Cal. Entry',      path: '/transactions/hamali',     icon: <RequestQuoteIcon  fontSize="small" />, moduleCode: 'HAMALI' },
      { label: 'Transaction Rate Entry', path: '/transactions/mod-rate',   icon: <RequestQuoteIcon  fontSize="small" />, moduleCode: 'MOD_RATE' },
      { label: 'Attendance Entry',       path: '/transactions/attendance', icon: <EventNoteIcon     fontSize="small" />, moduleCode: 'ATTENDANCE' },
    ],
  },
  {
    group: 'REPORTS',
    moduleCode: 'HAMALI_REP',
    items: [
      { label: 'Balance Report',      path: '/reports/balance-report', icon: <SummarizeIcon fontSize="small" />, moduleCode: 'BAL_REP' },
      { label: 'Hamali Cal. Report', path: '/reports/hamali-report',  icon: <SummarizeIcon fontSize="small" />, moduleCode: 'HAMALI_REP' },
      { label: 'Bill Report',        path: '/reports/bill-report',    icon: <SummarizeIcon fontSize="small" />, moduleCode: 'BILL_REP' },
      { label: 'Receipt Report',     path: '/reports/receipt-report', icon: <SummarizeIcon fontSize="small" />, moduleCode: 'RECEIPT_REP' },
      { label: 'Audit Report',       path: '/reports/audit-report',   icon: <SummarizeIcon fontSize="small" />, moduleCode: 'AUDIT_REP' },
    ],
  },
  {
    group: 'BILLING',
    moduleCode: 'BILL_GEN',
    items: [
      { label: 'Bill Generation (Tr/Hm/Gen)', path: '/billing/bills',       icon: <ReceiptLongIcon fontSize="small" />, moduleCode: 'BILL_GEN' },
      { label: 'Godown Rent Bills',           path: '/billing/godrent',     icon: <ReceiptLongIcon fontSize="small" />, moduleCode: 'BILL_GEN' },
      { label: 'Receipt Entry',               path: '/billing/receipts',    icon: <ReceiptLongIcon fontSize="small" />, moduleCode: 'RECEIPT_ENTRY' },
      { label: 'Bill Letter & Ack.',          path: '/billing/bill-letter',   icon: <ReceiptLongIcon fontSize="small" />, moduleCode: 'BILL_LETTER' },
      { label: 'Bill Number Editor',          path: '/billing/bill-numbers',  icon: <ReceiptLongIcon fontSize="small" />, moduleCode: 'BILL_NUM_EDIT' },
    ],
  },
  {
    group: 'TRANSFER',
    moduleCode: 'TRF_OPN_BAL',
    items: [
      { label: 'Transfer Opening Balance', path: '/transactions/transfer-opn-bal',   icon: <SwapHorizIcon fontSize="small" /> },
      { label: 'Transfer Between DB',      path: '/transactions/transfer-between-db', icon: <SwapHorizIcon fontSize="small" />, moduleCode: 'TRF_DB' },
    ],
  },
  {
    group: 'ADMIN',
    moduleCode: 'ADMIN',
    items: [
      { label: 'Company Group',      path: '/admin/company-groups', icon: <CorporateFareIcon fontSize="small" /> },
      { label: 'Company',           path: '/admin/companies',      icon: <BusinessIcon fontSize="small" /> },
      { label: 'Role',              path: '/admin/roles',          icon: <SecurityIcon fontSize="small" /> },
      { label: 'Permission',        path: '/admin/permissions',    icon: <LockIcon fontSize="small" /> },
      { label: 'User',              path: '/admin/users',          icon: <ManageAccountsIcon fontSize="small" /> },
      { label: 'Update Serial No.', path: '/admin/up-serial-num', icon: <ManageAccountsIcon fontSize="small" />, moduleCode: 'UP_SERIAL_NUM' },
      { label: 'Database Backup',   path: '/admin/database-backup', icon: <BackupIcon fontSize="small" /> },
    ],
  },
];

const PATH_LABELS = NAV.flatMap((g) => g.items).reduce((acc, { path, label }) => {
  acc[path] = label;
  return acc;
}, {});

function resolveTitle(pathname) {
  if (PATH_LABELS[pathname]) return PATH_LABELS[pathname];
  if (pathname.endsWith('/new')) {
    const parent = pathname.slice(0, pathname.lastIndexOf('/new'));
    const base   = PATH_LABELS[parent];
    return base ? `New ${base}` : 'New';
  }
  if (pathname.endsWith('/edit')) {
    const withoutEdit = pathname.slice(0, pathname.lastIndexOf('/'));
    const parent      = withoutEdit.slice(0, withoutEdit.lastIndexOf('/'));
    const base        = PATH_LABELS[parent];
    return base ? `Edit ${base}` : 'Edit';
  }
  return 'GMS';
}

export default function AppShell() {
  const { user, logout, can } = useAuth();
  const location = useLocation();

  // ── Change Password dialog state ─────────────────────────────────────────
  const EMPTY_PW = { current: '', newPw: '', confirm: '' };
  const [pwOpen,    setPwOpen]    = useState(false);
  const [pwForm,    setPwForm]    = useState(EMPTY_PW);
  const [pwShow,    setPwShow]    = useState({ current: false, newPw: false, confirm: false });
  const [pwError,   setPwError]   = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const openPwDialog  = () => { setPwForm(EMPTY_PW); setPwError(''); setPwSuccess(false); setPwOpen(true); };
  const closePwDialog = () => { if (!pwLoading) setPwOpen(false); };
  const toggleShow    = (field) => setPwShow((p) => ({ ...p, [field]: !p[field] }));

  const handlePwChange = async () => {
    const { current, newPw, confirm } = pwForm;
    if (!current || !newPw || !confirm) { setPwError('All fields are required'); return; }
    if (newPw.length < 6)               { setPwError('New password must be at least 6 characters'); return; }
    if (newPw !== confirm)              { setPwError('New password and confirm password do not match'); return; }
    setPwError(''); setPwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: newPw });
      setPwSuccess(true);
      setTimeout(() => setPwOpen(false), 1500);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  // true = sidebar visible, false = completely hidden
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('gms_sidebar') !== 'closed'
  );

  const toggleSidebar = () =>
    setSidebarOpen((prev) => {
      localStorage.setItem('gms_sidebar', prev ? 'closed' : 'open');
      return !prev;
    });

  const hideSidebar = () => {
    localStorage.setItem('gms_sidebar', 'closed');
    setSidebarOpen(false);
  };

  // Only TRANSACTIONS open by default; all others collapsed
  const [openGroups, setOpenGroups] = useState(
    () => NAV.reduce((acc, { group }) => ({ ...acc, [group]: group === 'TRANSACTIONS' }), {})
  );

  const toggleGroup = (group) =>
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));

  useEffect(() => {
    document.title = `${resolveTitle(location.pathname)} | GMS`;
  }, [location.pathname]);

  // Slide transition for drawer + AppBar
  const slideDuration = (theme) => ({
    duration: sidebarOpen
      ? theme.transitions.duration.enteringScreen
      : theme.transitions.duration.leavingScreen,
    easing: theme.transitions.easing.sharp,
  });

  const widthTransition = (theme) =>
    theme.transitions.create(['width', 'margin'], slideDuration(theme));

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── AppBar ─────────────────────────────────────────────────────────── */}
      <AppBar
        position="fixed"
        elevation={2}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          bgcolor: '#1565C0',
          width:  sidebarOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%',
          ml:     sidebarOpen ? `${DRAWER_WIDTH}px` : 0,
          transition: (t) => widthTransition(t),
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 52 }}>
          {/* Hamburger — always visible in the AppBar */}
          <Tooltip title={sidebarOpen ? 'Hide menu' : 'Show menu'}>
            <IconButton
              color="inherit"
              size="small"
              onClick={toggleSidebar}
              sx={{ mr: 1.5 }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Typography variant="h6" fontWeight={700} letterSpacing={2} sx={{ mr: 1 }}>
            GMS
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8, flexGrow: 1 }}>
            Godown Management System
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.9 }}>
            {user?.userFullName} &nbsp;|&nbsp; {user?.compID}
          </Typography>
          <Tooltip title="Change Password">
            <IconButton color="inherit" size="small" onClick={openPwDialog} sx={{ mr: 0.5 }}>
              <VpnKeyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Logout">
            <IconButton color="inherit" size="small" onClick={logout}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {/* ── Sidebar Drawer — slides fully in/out ───────────────────────────── */}
      <Drawer
        variant="permanent"
        sx={{
          width: sidebarOpen ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            borderRight: '1px solid #E3F2FD',
            bgcolor: '#FAFCFF',
            // Slide the paper itself left when hidden
            transform: sidebarOpen ? 'translateX(0)' : `translateX(-${DRAWER_WIDTH}px)`,
            visibility: sidebarOpen ? 'visible' : 'hidden',
            transition: (t) =>
              t.transitions.create(['transform', 'visibility', 'width'], slideDuration(t)),
          },
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 52 }} />

        <Box sx={{ overflow: 'auto', mt: 1 }}>
          {/* Dashboard — always visible */}
          <List dense disablePadding>
            <ListItemButton
              component={Link}
              to="/"
              selected={location.pathname === '/'}
              onClick={hideSidebar}
              sx={{
                borderRadius: 1, mx: 0.5, mb: 0.25,
                '&.Mui-selected': {
                  bgcolor: '#E3F2FD',
                  '&:hover': { bgcolor: '#BBDEFB' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: location.pathname === '/' ? '#1565C0' : 'inherit' }}>
                <DashboardIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="Dashboard"
                slotProps={{ primary: { fontSize: 13, fontWeight: location.pathname === '/' ? 600 : 400 } }}
              />
            </ListItemButton>
            <Divider sx={{ my: 0.5 }} />
          </List>

          {NAV.map(({ group, moduleCode, items }) => {
            const anyItemVisible = items.some(({ moduleCode: iMC }) => iMC && can(iMC, 'CanView'));
            if (!can(moduleCode, 'CanView') && !anyItemVisible) return null;
            const isOpen = openGroups[group] ?? true;

            return (
              <List key={group} dense disablePadding>

                {/* Group header */}
                <ListItemButton
                  onClick={() => toggleGroup(group)}
                  sx={{
                    py: 0.5, px: 1.5,
                    bgcolor: '#E3F2FD',
                    '&:hover': { bgcolor: '#BBDEFB' },
                  }}
                >
                  <ListItemText
                    primary={group}
                    slotProps={{ primary: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: '#1565C0' } }}
                  />
                  {isOpen
                    ? <ExpandLessIcon sx={{ fontSize: 16, color: '#1565C0' }} />
                    : <ExpandMoreIcon sx={{ fontSize: 16, color: '#1565C0' }} />
                  }
                </ListItemButton>

                {/* Nav items */}
                <Collapse in={isOpen} timeout="auto" unmountOnExit>
                  {items.map(({ label, path, icon, moduleCode: itemMC }) => {
                    if (itemMC && !can(itemMC, 'CanView')) return null;
                    const active = location.pathname === path ||
                                   location.pathname.startsWith(path + '/');
                    return (
                      <ListItemButton
                        key={path}
                        component={Link}
                        to={path}
                        selected={active}
                        onClick={hideSidebar}
                        sx={{
                          borderRadius: 1, mx: 0.5, mb: 0.25,
                          '&.Mui-selected': {
                            bgcolor: '#E3F2FD',
                            '&:hover': { bgcolor: '#BBDEFB' },
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 32, color: active ? '#1565C0' : 'inherit' }}>
                          {icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={label}
                          slotProps={{ primary: { fontSize: 13, fontWeight: active ? 600 : 400, noWrap: true } }}
                        />
                      </ListItemButton>
                    );
                  })}
                </Collapse>

                <Divider sx={{ my: 0.5 }} />
              </List>
            );
          })}
        </Box>
      </Drawer>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          bgcolor: '#F5F7FA',
          minHeight: '100vh',
          width: sidebarOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%',
          transition: (t) => widthTransition(t),
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 52 }} />
        <Outlet />
      </Box>

      {/* ── Change Password Dialog ───────────────────────────────────────────── */}
      <Dialog open={pwOpen} onClose={closePwDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Change Password</DialogTitle>
        <DialogContent>
          {pwSuccess ? (
            <Alert severity="success" sx={{ mt: 1 }}>Password changed successfully.</Alert>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {pwError && <Alert severity="error">{pwError}</Alert>}
              {[
                { field: 'current', label: 'Current Password' },
                { field: 'newPw',   label: 'New Password' },
                { field: 'confirm', label: 'Confirm New Password' },
              ].map(({ field, label }) => (
                <TextField
                  key={field}
                  label={label}
                  size="small"
                  fullWidth
                  type={pwShow[field] ? 'text' : 'password'}
                  value={pwForm[field]}
                  onChange={(e) => setPwForm((p) => ({ ...p, [field]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handlePwChange()}
                  disabled={pwLoading}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => toggleShow(field)} edge="end">
                          {pwShow[field] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              ))}
            </Box>
          )}
        </DialogContent>
        {!pwSuccess && (
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={closePwDialog} disabled={pwLoading}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handlePwChange}
              disabled={pwLoading}
              startIcon={pwLoading ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {pwLoading ? 'Saving…' : 'Change Password'}
            </Button>
          </DialogActions>
        )}
      </Dialog>
    </Box>
  );
}
