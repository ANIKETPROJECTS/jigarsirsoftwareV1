// ─────────────────────────────────────────────────────────────────────────────
// auth.js  —  Login, token verification, permission refresh
//
// All data in this route comes from gms_admin (Company, User, Permission).
// No company database is touched during auth — auth is global.
//
// JWT payload after login:
//   { userId, compID, groupID, branchID, userCode, userFullName, roleID, isPrimary }
//
// isPrimary = true  → user logged into the Primary company of their group.
//             Only Primary company users can CREATE/EDIT shared masters
//             (State, Holiday, Item, Godown, Employee).
//             Secondary company users can only VIEW shared masters.
// ─────────────────────────────────────────────────────────────────────────────
const router      = require('express').Router();
const bcrypt      = require('bcrypt');
const jwt         = require('jsonwebtoken');
const AdminCompany = require('../models/admin/Company');
const AdminUser    = require('../models/admin/User');
const requireAuth  = require('../middleware/auth');
const { buildPermissionMap } = require('../middleware/permission');
const connectionManager = require('../config/connectionManager');

// ── Account-level login lockout ───────────────────────────────────────────────
// Tracks failed attempts per compID+userCode, independent of IP.
// Key: "compID:userCode" (lowercased). Value: { attempts, lockedUntil }
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;                    // lock after 5 consecutive failures
const LOCKOUT_MS    = 15 * 60 * 1000;      // locked for 15 minutes

function getAttemptKey(compID, userCode) {
  return `${String(compID).toLowerCase()}:${String(userCode).toLowerCase()}`;
}
function recordFailure(key) {
  const rec = loginAttempts.get(key) || { attempts: 0, lockedUntil: 0 };
  rec.attempts += 1;
  if (rec.attempts >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.attempts    = 0; // reset counter so next lock triggers on 5 more failures
  }
  loginAttempts.set(key, rec);
}
function clearAttempts(key) {
  loginAttempts.delete(key);
}

// GET /api/auth/companies
// Called by the login screen to populate the company dropdown.
// Returns all active companies from gms_admin.
router.get('/companies', async (req, res) => {
  try {
    const companies = await AdminCompany.findAll({
      where:      { Active: 'Y' },
      attributes: ['pkCompID', 'CompName', 'CompAlias', 'fkGroupID'],
      order:      [['CompName', 'ASC']],
    });
    res.json(companies);
  } catch {
    res.status(500).json({ error: 'Failed to load companies' });
  }
});

// POST /api/auth/login
// Flow:
//   1. User picks a company from dropdown (e.g. ADS) and enters UserCode + password.
//   2. Look up company in gms_admin to get groupID and IsPrimary.
//   3. Look up user by groupID + UserCode (users belong to a group, not a single company).
//   4. Verify password with bcrypt.
//   5. Build JWT payload including isPrimary flag.
//   6. Return token + full permission map (used by frontend can() helper).
router.post('/login', async (req, res) => {
  const { compID, userCode, password } = req.body;
  if (!compID || !userCode || !password)
    return res.status(400).json({ error: 'Company, user code and password are required' });

  // ── Lockout check (before any DB query to avoid load during attack) ──────
  const attemptKey = getAttemptKey(compID, userCode);
  const rec = loginAttempts.get(attemptKey);
  if (rec?.lockedUntil && Date.now() < rec.lockedUntil) {
    const remainingMin = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `Account locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
    });
  }

  try {
    // Step 1: validate company and get group + primary status
    const company = await AdminCompany.findOne({ where: { pkCompID: compID, Active: 'Y' } });
    if (!company) {
      recordFailure(attemptKey);
      return res.status(401).json({ error: 'Invalid company, user code or password' });
    }

    // Step 2: find user within this group
    const user = await AdminUser.findOne({
      where: { fkGroupID: company.fkGroupID, UserCode: userCode, Active: 'Y' },
    });
    if (!user) {
      recordFailure(attemptKey);
      return res.status(401).json({ error: 'Invalid company, user code or password' });
    }

    // Step 3: verify password
    const valid = await bcrypt.compare(password, user.UserPassword);
    if (!valid) {
      recordFailure(attemptKey);
      const updatedRec = loginAttempts.get(attemptKey);
      if (updatedRec?.lockedUntil) {
        return res.status(429).json({ error: 'Account locked for 15 minutes due to too many failed attempts.' });
      }
      return res.status(401).json({ error: 'Invalid company, user code or password' });
    }

    // Success — clear any recorded failures
    clearAttempts(attemptKey);

    // Step 4: build JWT payload
    // isPrimary controls whether this session can write shared masters.
    const payload = {
      userId:       user.pkUserId,
      compID,                            // selected company (e.g. 'ADS')
      groupID:      company.fkGroupID,   // group this company belongs to (e.g. 'BHW')
      branchID:     user.fkBranchID,
      userCode:     user.UserCode,
      userFullName: user.UserFullName,
      roleID:       user.fkRoleID,
      isPrimary:    company.IsPrimary === 'Y', // true = can write shared masters
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    const permissions = await buildPermissionMap(user.fkRoleID);

    res.json({ token, user: payload, permissions });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/change-password — logged-in user changes their own password
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Current password and new password are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  try {
    const user = await AdminUser.findOne({ where: { pkUserId: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.UserPassword);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await user.update({ UserPassword: hashed, CrMod: new Date() });

    res.json({ message: 'Password changed successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/auth/me — verify token and return current user info
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/permissions — refresh the user's permission map
// Called by frontend after an admin changes this user's role.
router.get('/permissions', requireAuth, async (req, res) => {
  try {
    const permissions = await buildPermissionMap(req.user.roleID);
    res.json({ roleID: req.user.roleID, permissions });
  } catch {
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

module.exports = router;
