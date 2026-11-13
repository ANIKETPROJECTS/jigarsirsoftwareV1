require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');

const app = express();

// Security headers — CSP disabled so HTTP LAN access works.
// (Helmet's default CSP includes upgrade-insecure-requests which breaks plain-HTTP deploys.)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — allow same-origin (production build) + configured dev URL
app.use(cors({
  origin: (origin, cb) => cb(null, true), // allow all origins for LAN testing
  credentials: true,
}));

// Body parser — 50 MB limit to handle large HTML payloads for email PDF generation
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limit auth endpoints (login brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter — DoS protection for all other endpoints.
// 300 requests per IP per minute is generous for normal use (a page load
// typically triggers 5-15 calls). Anything beyond that is abnormal traffic.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 300,             // 300 requests per IP per minute
  message: { error: 'Too many requests. Please slow down and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health', // never throttle health checks
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Group companies — returns all companies in the logged-in user's group.
// Used by list pages for company filter dropdowns.
const requireAuth       = require('./middleware/auth');
const connectionManager = require('./config/connectionManager');
app.get('/api/group-companies', requireAuth, (req, res) => {
  const companies = connectionManager.getGroupCompanyDetails(req.user.groupID);
  res.json(companies.map(({ pkCompID, CompName, CompAlias }) => ({ pkCompID, CompName, CompAlias })));
});

// Static file serving for uploaded documents
// Cross-Origin-Resource-Policy header allows the frontend (different port) to load images
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Apply general rate limiter to all API routes
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/masters/states',    require('./routes/masters/state'));
app.use('/api/masters/taxes',     require('./routes/masters/tax'));
app.use('/api/masters/holidays',  require('./routes/masters/holiday'));
app.use('/api/masters/banks',     require('./routes/masters/bank'));
app.use('/api/masters/parties',   require('./routes/masters/party'));
app.use('/api/masters/items',     require('./routes/masters/item'));
app.use('/api/masters/godowns',   require('./routes/masters/godown'));
app.use('/api/masters/employees',         require('./routes/masters/employee'));
app.use('/api/masters/ratechart',         require('./routes/masters/ratechart'));
app.use('/api/masters/party-godown-links', require('./routes/masters/partygodownlink'));
app.use('/api/masters/locations',          require('./routes/masters/location'));
app.use('/api/masters/docfiles',           require('./routes/masters/docFile'));
app.use('/api/combo',                     require('./routes/combo'));
app.use('/api/masters/combo-data',        require('./routes/masters/comboData'));

// ── Transaction routes ────────────────────────────────────────────────────────
app.use('/api/transactions/arrivals',         require('./routes/transactions/arrival'));
app.use('/api/transactions/dispatches',       require('./routes/transactions/dispatch'));
app.use('/api/transactions/attendance',       require('./routes/transactions/attendance'));
app.use('/api/transactions/hamali',           require('./routes/transactions/hamali'));
app.use('/api/transactions/transfer-opn-bal', require('./routes/transactions/transferOpnBal'));
app.use('/api/transactions/transfer-db',      require('./routes/transactions/transferBetweenDb'));
app.use('/api/transactions/mod-rate',         require('./routes/transactions/modRate'));

// ── Billing routes ────────────────────────────────────────────────────────────
app.use('/api/billing/bills',       require('./routes/billing/billTrHmGen'));
app.use('/api/billing/godrent',     require('./routes/billing/billGen'));
app.use('/api/billing/receipts',    require('./routes/billing/receipt'));
app.use('/api/billing/bill-letter',   require('./routes/billing/billLetter'));
app.use('/api/billing/bill-numbers',  require('./routes/billing/billNumberEdit'));

// ── Report routes ─────────────────────────────────────────────────────────────
app.use('/api/reports/hamali-report',     require('./routes/reports/hamaliReport'));
app.use('/api/reports/balance-report',    require('./routes/reports/balanceReport'));
app.use('/api/reports/audit-report',      require('./routes/reports/auditReport'));
app.use('/api/reports/bill-report',       require('./routes/reports/billReport'));
app.use('/api/reports/receipt-report',    require('./routes/reports/receiptReport'));
app.use('/api/reports/templates',         require('./routes/reports/templates'));

// ── Upload routes ─────────────────────────────────────────────────────────────
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/dashboard', require('./routes/dashboard'));

// ── Admin routes ─────────────────────────────────────────────────────────────
// These endpoints manage the system configuration: groups, companies, roles,
// permissions, and users. All require ADMIN module permission (set in mPermission).
app.use('/api/admin/company-groups', require('./routes/admin/companygroup'));
app.use('/api/admin/companies',      require('./routes/admin/company'));
app.use('/api/admin/roles',          require('./routes/admin/role'));
app.use('/api/admin/permissions',    require('./routes/admin/permission'));
app.use('/api/admin/users',          require('./routes/admin/user'));
app.use('/api/admin/up-serial-num',  require('./routes/admin/upSerialNum'));
app.use('/api/admin/backup',         require('./routes/admin/backup'));

// ── Serve React frontend (production build) ───────────────────────────────────
// Vite builds to frontend/dist. The catch-all sends index.html for every
// non-API path so React Router can handle client-side navigation.
// Only active when the dist folder exists (i.e. after running npm run build).
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (require('fs').existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // 404 handler (dev mode — frontend runs separately on Vite port)
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });
};

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

module.exports = app;
