// ADMIN -- Permission  /api/admin/permissions
//
// Uses AdminPermission model which reads/writes directly to gms_admin.
// mPermission has composite PK: (fkRoleID, ModuleCode).
// One row = one Role's access to one Module (MASTERS, ARRIVAL, BILLING, REPORTS, ADMIN).
//
// PUT /:roleID upserts the full permission matrix for that role in one call.
// After saving, currently logged-in users with this role will see the new permissions
// after their next login OR after the 5-minute permission cache expires.
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const AdminPermission   = require('../../models/admin/Permission');
const { clearCache }    = requirePermission;

router.use(requireAuth);

// GET /api/admin/permissions/:roleID -- all module rows for one role
router.get('/:roleID', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const rows = await AdminPermission.findAll({ where: { fkRoleID: req.params.roleID } });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load permissions' }); }
});

// PUT /api/admin/permissions/:roleID -- save full matrix (upsert each module row)
// Body: { permissions: [{ ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport }] }
router.put('/:roleID', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  const { permissions } = req.body;
  if (!Array.isArray(permissions) || permissions.length === 0)
    return res.status(400).json({ error: 'permissions array is required' });
  try {
    await Promise.all(
      permissions.map((p) =>
        AdminPermission.upsert({
          fkRoleID:   req.params.roleID,
          ModuleCode: p.ModuleCode,
          CanView:    p.CanView   ? 'Y' : 'N',
          CanAdd:     p.CanAdd    ? 'Y' : 'N',
          CanEdit:    p.CanEdit   ? 'Y' : 'N',
          CanDelete:  p.CanDelete ? 'Y' : 'N',
          CanPrint:   p.CanPrint  ? 'Y' : 'N',
          CanExport:  p.CanExport ? 'Y' : 'N',
        })
      )
    );
    // Bust this role's permission cache immediately so the new permissions take
    // effect on the very next API call — no logout/login or 5-minute wait needed.
    clearCache(req.params.roleID);
    res.json({ saved: true });
  } catch { res.status(500).json({ error: 'Failed to save permissions' }); }
});

module.exports = router;
