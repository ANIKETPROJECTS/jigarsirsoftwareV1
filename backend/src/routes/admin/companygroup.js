// ADMIN -- Company Group  /api/admin/company-groups
//
// Uses AdminCompanyGroup model which reads/writes directly to gms_admin.
// A Company Group is the top-level owner: "BHW" contains ADS, TEST etc.
// Roles, users, and shared masters all use groupID as their scope key.
// All routes require ADMIN module permission.
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const AdminCompanyGroup = require('../../models/admin/CompanyGroup');

router.use(requireAuth);

// GET /api/admin/company-groups -- global list, no group filter
router.get('/', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const rows = await AdminCompanyGroup.findAll({ order: [['pkGroupID', 'ASC']] });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load company groups' }); }
});

// POST /api/admin/company-groups
// pkGroupID is user-defined (e.g. 'BHW', 'VLCO'). Cannot change after creation
// because it is used as a foreign key in every master and transaction table.
router.post('/', requirePermission('ADMIN', 'CanAdd'), async (req, res) => {
  const { pkGroupID, GroupName } = req.body;
  if (!pkGroupID || !GroupName)
    return res.status(400).json({ error: 'Group ID and Group Name are required' });
  try {
    const row = await AdminCompanyGroup.create({
      pkGroupID: pkGroupID.trim().toUpperCase(),
      GroupName: GroupName.trim(),
      Active:    'Y',
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Group ID already exists' });
    res.status(500).json({ error: 'Failed to create company group' });
  }
});

// PUT /api/admin/company-groups/:id -- update name or active flag only
router.put('/:id', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  const { GroupName, Active } = req.body;
  if (!GroupName) return res.status(400).json({ error: 'Group Name is required' });
  try {
    const [n] = await AdminCompanyGroup.update(
      { GroupName: GroupName.trim(), Active: Active || 'Y' },
      { where: { pkGroupID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Company group not found' });
    res.json({ updated: true });
  } catch { res.status(500).json({ error: 'Failed to update company group' }); }
});

// DELETE /api/admin/company-groups/:id -- soft delete (Active='N')
// Row is kept because pkGroupID is referenced by companies, users, and masters.
router.delete('/:id', requirePermission('ADMIN', 'CanDelete'), async (req, res) => {
  try {
    const [n] = await AdminCompanyGroup.update(
      { Active: 'N' },
      { where: { pkGroupID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Company group not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete company group' }); }
});

module.exports = router;
