// ADMIN -- Company  /api/admin/companies
//
// Uses AdminCompany model which reads/writes directly to gms_admin.
// A Company is one legal entity within a Group (e.g. ADS within BHW group).
//
// New fields vs the original single-DB design:
//   dbName    -- MySQL database name for this company (e.g. 'gms_ads')
//   IsPrimary -- 'Y' = this company can write shared masters; siblings are read-only.
//
// After creating a company, connectionManager.addCompany() is called immediately
// so the new database connection is registered without needing a server restart.
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const AdminCompany      = require('../../models/admin/Company');
const connectionManager = require('../../config/connectionManager');

router.use(requireAuth);

// GET /api/admin/companies -- optional ?groupID=XYZ filter
router.get('/', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const where = req.query.groupID ? { fkGroupID: req.query.groupID } : {};
    const rows  = await AdminCompany.findAll({
      where,
      order: [['fkGroupID', 'ASC'], ['CompName', 'ASC']],
    });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load companies' }); }
});

// POST /api/admin/companies
// Admin chooses which group and whether this company is the Primary.
// dbName must match the actual MySQL database that was created for this company.
router.post('/', requirePermission('ADMIN', 'CanAdd'), async (req, res) => {
  const { pkCompID, CompName, CompAlias, fkGroupID, dbName, IsPrimary } = req.body;
  if (!pkCompID || !CompName || !CompAlias || !fkGroupID || !dbName)
    return res.status(400).json({ error: 'Company ID, Name, Alias, Group and DB Name are required' });
  try {
    const row = await AdminCompany.create({
      pkCompID:  pkCompID.trim().toUpperCase(),
      fkGroupID: fkGroupID.trim().toUpperCase(),
      CompName:  CompName.trim(),
      CompAlias: CompAlias.trim(),
      dbName:    dbName.trim().toLowerCase(),
      IsPrimary: IsPrimary ? 'Y' : 'N',
      Active:    'Y',
      fkUserID:  req.user.userId,
      CrMod:     new Date(),
    });

    // Register the new DB connection in memory so login works immediately.
    // connectionManager._register() creates a Sequelize pool for dbName.
    connectionManager.addCompany(row.dataValues);

    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Company ID already exists' });
    res.status(500).json({ error: err.message || 'Failed to create company' });
  }
});

// PUT /api/admin/companies/:id
// dbName and fkGroupID cannot be changed -- they are structural and referenced everywhere.
router.put('/:id', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  const { CompName, CompAlias, IsPrimary, Active } = req.body;
  if (!CompName || !CompAlias)
    return res.status(400).json({ error: 'Company Name and Alias are required' });
  try {
    const [n] = await AdminCompany.update(
      { CompName: CompName.trim(), CompAlias: CompAlias.trim(),
        IsPrimary: IsPrimary ? 'Y' : 'N', Active: Active || 'Y',
        fkUserID: req.user.userId, CrMod: new Date() },
      { where: { pkCompID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({ updated: true });
  } catch { res.status(500).json({ error: 'Failed to update company' }); }
});

// DELETE /api/admin/companies/:id -- soft delete (Active='N')
// Row is kept because pkCompID is referenced by Party, Transaction, and Bill records.
router.delete('/:id', requirePermission('ADMIN', 'CanDelete'), async (req, res) => {
  try {
    const [n] = await AdminCompany.update(
      { Active: 'N' },
      { where: { pkCompID: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete company' }); }
});

module.exports = router;
