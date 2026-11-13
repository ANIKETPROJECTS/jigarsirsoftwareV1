// ADMIN -- Role  /api/admin/roles
//
// Uses AdminRole model which reads/writes directly to gms_admin.
// A Role is a named permission set (e.g. "Administrator", "Billing Clerk").
// Assigning a Role to a User gives all permissions defined for that Role.
// Changing a Role's permissions instantly affects all users with that role
// (after the 5-minute permission cache expires in middleware/permission.js).
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const AdminRole         = require('../../models/admin/Role');

router.use(requireAuth);

// GET /api/admin/roles -- optional ?groupID=XYZ filter
router.get('/', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const where = req.query.groupID ? { fkGroupID: req.query.groupID } : {};
    const rows  = await AdminRole.findAll({ where, order: [['fkGroupID', 'ASC'], ['RoleName', 'ASC']] });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load roles' }); }
});

// POST /api/admin/roles
// pkRoleID must be globally unique (referenced by mUser and mPermission without groupID).
router.post('/', requirePermission('ADMIN', 'CanAdd'), async (req, res) => {
  const { pkRoleID, RoleName, fkGroupID } = req.body;
  if (!pkRoleID || !RoleName || !fkGroupID)
    return res.status(400).json({ error: 'Group, Role ID and Role Name are required' });
  try {
    const row = await AdminRole.create({
      pkRoleID:  pkRoleID.trim().toUpperCase(),
      fkGroupID: fkGroupID.trim().toUpperCase(),
      RoleName:  RoleName.trim(),
      Active:    'Y',
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Role ID already exists' });
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /api/admin/roles/:id -- update name or active flag; pkRoleID cannot be changed
router.put('/:id', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  const { RoleName, Active } = req.body;
  if (!RoleName) return res.status(400).json({ error: 'Role Name is required' });
  try {
    const [n] = await AdminRole.update(
      { RoleName: RoleName.trim(), Active: Active || 'Y' },
      { where: { pkRoleID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Role not found' });
    res.json({ updated: true });
  } catch { res.status(500).json({ error: 'Failed to update role' }); }
});

// DELETE /api/admin/roles/:id -- soft delete; row kept because users still reference it
router.delete('/:id', requirePermission('ADMIN', 'CanDelete'), async (req, res) => {
  try {
    const [n] = await AdminRole.update(
      { Active: 'N' },
      { where: { pkRoleID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Role not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete role' }); }
});

module.exports = router;
