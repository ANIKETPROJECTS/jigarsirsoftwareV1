// ─────────────────────────────────────────────────────────────────────────────
// permission.js  —  Role-based access control middleware
//
// mPermission lives in gms_admin (not in any company database).
// This middleware reads permissions from req.adminDB, caches them in memory
// for 5 minutes, and checks whether the user's role allows the requested action.
//
// Cache key: roleID
// Cache structure: Map<roleID, { ModuleCode: permissionRow }>
// Cache expiry: 5 minutes — so permission changes take effect within 5 minutes
//               without needing a server restart.
//
// Usage in routes:
//   router.get('/', requireAuth, requirePermission('MASTERS', 'CanView'), handler);
//   router.post('/', requireAuth, requirePermission('MASTERS', 'CanAdd'),  handler);
// ─────────────────────────────────────────────────────────────────────────────
const AdminPermission = require('../models/admin/Permission');

// In-memory cache so we don't hit gms_admin on every API call
const cache     = new Map();
let   cacheTime = 0;

function clearIfExpired() {
  const now = Date.now();
  if (now > cacheTime) {
    cache.clear();
    cacheTime = now + 5 * 60 * 1000; // 5 minutes
  }
}

async function rolePermissions(roleID) {
  clearIfExpired();
  if (!cache.has(roleID)) {
    // AdminPermission model uses adminDB directly (defined in admin/Permission.js)
    const rows = await AdminPermission.findAll({ where: { fkRoleID: roleID } });
    const map  = {};
    for (const r of rows) map[r.ModuleCode] = r;
    cache.set(roleID, map);
  }
  return cache.get(roleID);
}

// requirePermission('MASTERS', 'CanAdd') returns an Express middleware function
module.exports = function requirePermission(moduleCode, action) {
  return async function checkPermission(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const perms = await rolePermissions(req.user.roleID);
      if (!perms[moduleCode] || perms[moduleCode][action] !== 'Y') {
        return res.status(403).json({ error: `Access denied: ${action} on ${moduleCode}` });
      }
      next();
    } catch {
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

// Exported so the permission save route can bust the cache immediately after a PUT.
// Without this, users had to wait up to 5 minutes for saved permissions to take effect.
module.exports.clearCache = function (roleID) {
  if (roleID) {
    cache.delete(roleID);  // bust one role's cache
  } else {
    cache.clear();         // bust all (used on server restart equivalent)
    cacheTime = 0;
  }
};

// Used by auth route to build the full permissions map sent to the frontend at login
module.exports.buildPermissionMap = async function (roleID) {
  const rows = await AdminPermission.findAll({ where: { fkRoleID: roleID } });
  const map  = {};
  for (const r of rows) {
    map[r.ModuleCode] = {
      CanView:   r.CanView   === 'Y',
      CanAdd:    r.CanAdd    === 'Y',
      CanEdit:   r.CanEdit   === 'Y',
      CanDelete: r.CanDelete === 'Y',
      CanPrint:  r.CanPrint  === 'Y',
      CanExport: r.CanExport === 'Y',
    };
  }
  return map;
};
