// SHARED MASTER — Item  /api/masters/items
//
// Items (commodities) are group-level — all companies in the group deal with
// the same physical goods. The item list is defined ONCE by the Primary company
// and automatically copied to all sibling companies via syncToGroup().
//
// FLOW:
//   GET  -> any company reads from its own DB copy (req.db).
//   POST/PUT/DELETE -> Primary writes to its DB, syncToGroup() propagates to siblings.
//   Non-primary write -> HTTP 403 immediately.
const router            = require('express').Router();
const { Op }            = require('sequelize');
const { gudfGenSerialID } = require('../../utils/serialID');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineItem        = require('../../models/company/Item');
const { syncToGroup }   = require('../../utils/syncToGroup');

router.use(requireAuth);

// GET /api/masters/items -- any company reads its local copy
// ?slim=1 → pkItemID + iName only, active only (used by transaction form dropdowns — no CanView required)
router.get('/', (req, res, next) => {
  if (req.query.slim) return next();
  requirePermission('ITEM_MASTER', 'CanView')(req, res, next);
}, async (req, res) => {
  try {
    const Item  = defineItem(req.db);
    const where = { fkCompID: req.user.compID };
    const opts  = { where, order: [['iName', 'ASC']] };
    if (req.query.slim) {
      where.Active     = 'Y';
      opts.attributes  = ['pkItemID', 'iName', 'Active'];
    }
    const rows = await Item.findAll(opts);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load items' }); }
});

// GET /api/masters/items/:id
router.get('/:id', requirePermission('ITEM_MASTER', 'CanView'), async (req, res) => {
  try {
    const Item = defineItem(req.db);
    const row  = await Item.findOne({ where: { pkItemID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load item' }); }
});

// POST /api/masters/items -- Primary company only
router.post('/', requirePermission('ITEM_MASTER', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add items' });

  const { iName, iGroup, iType, iNote } = req.body;
  if (!iName || !iGroup || !iType)
    return res.status(400).json({ error: 'Name, Group and Type are required' });

  try {
    const Item   = defineItem(req.db);
    const { compID, groupID, branchID } = req.user;
    const dupItem = await Item.findOne({ where: { fkCompID: compID, iName: iName.trim() } });
    if (dupItem) return res.status(409).json({ error: `Item '${iName.trim()}' already exists` });
    const serialKey = `${groupID}!MITEM!PKITEMID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Item ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Item ID' });
    const record = {
      pkItemID:   `${groupID}!${n}`,
      ItemID:     n,
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      iName:      iName.trim(),
      iGroup:     iGroup.trim(),
      iType:      iType.trim().toUpperCase(),
      iNote:      iNote || '',
      Active:     'Y',
      fkUserID:   req.user.userId,
      CrMod:      new Date(),
    };
    const row = await Item.create(record);
    await syncToGroup({ req, modelFactory: defineItem, record: row.dataValues, operation: 'upsert', pkField: 'pkItemID' });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create item' }); }
});

// PUT /api/masters/items/:id -- Primary company only
router.put('/:id', requirePermission('ITEM_MASTER', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit items' });

  const { iName, iGroup, iType, iNote, Active } = req.body;
  if (!iName || !iGroup || !iType)
    return res.status(400).json({ error: 'Name, Group and Type are required' });

  try {
    const Item    = defineItem(req.db);
    const dupItem = await Item.findOne({ where: { fkCompID: req.user.compID, iName: iName.trim(), pkItemID: { [Op.ne]: req.params.id } } });
    if (dupItem) return res.status(409).json({ error: `Item '${iName.trim()}' already exists` });
    const updated = {
      iName: iName.trim(), iGroup: iGroup.trim(), iType: iType.trim().toUpperCase(),
      iNote: iNote || '', Active: Active || 'Y', fkUserID: req.user.userId, CrMod: new Date(),
    };
    const [n] = await Item.update(updated, { where: { pkItemID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Item not found' });

    const row = await Item.findOne({ where: { pkItemID: req.params.id } });
    await syncToGroup({ req, modelFactory: defineItem, record: row.dataValues, operation: 'upsert', pkField: 'pkItemID' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update item' }); }
});

// DELETE /api/masters/items/:id -- soft delete; Primary company only
router.delete('/:id', requirePermission('ITEM_MASTER', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete items' });
  try {
    const Item = defineItem(req.db);
    const [n]  = await Item.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkItemID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Item not found' });
    await syncToGroup({ req, modelFactory: defineItem, record: { pkItemID: req.params.id }, operation: 'softDelete', pkField: 'pkItemID' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete item' }); }
});

module.exports = router;
