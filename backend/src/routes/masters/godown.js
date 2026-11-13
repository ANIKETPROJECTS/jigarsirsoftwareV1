// SHARED MASTER -- Godown  /api/masters/godowns
//
// Godowns (warehouses) are the physical buildings shared across all companies in the group.
// Which party uses which godown is tracked in PartyGodownLink (company-specific).
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
const defineGodown      = require('../../models/company/Godown');
const { syncToGroup }   = require('../../utils/syncToGroup');

router.use(requireAuth);

// GET /api/masters/godowns -- any company reads its local copy
// ?slim=1 → pkGodownID + gNum only, active only (used by transaction form dropdowns — no CanView required)
router.get('/', (req, res, next) => {
  if (req.query.slim) return next();
  requirePermission('MASTERS', 'CanView')(req, res, next);
}, async (req, res) => {
  try {
    const Godown = defineGodown(req.db);
    const opts   = { where: { fkCompID: req.user.compID, Active: 'Y' }, order: [['gNum', 'ASC']] };
    if (req.query.slim) opts.attributes = ['pkGodownID', 'gNum', 'Active'];
    const rows   = await Godown.findAll(opts);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load godowns' }); }
});

// GET /api/masters/godowns/:id
router.get('/:id', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Godown = defineGodown(req.db);
    const row    = await Godown.findOne({ where: { pkGodownID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Godown not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load godown' }); }
});

// POST /api/masters/godowns -- Primary company only
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add godowns' });

  const { gNum, gRate, gSqrft, gAmt, gOwner, gAdd, gStartDt, gEndDt, gNote } = req.body;
  if (!gNum) return res.status(400).json({ error: 'Godown number is required' });

  try {
    const Godown = defineGodown(req.db);
    const { compID, groupID, branchID } = req.user;
    const dupGod = await Godown.findOne({ where: { fkCompID: compID, gNum: gNum.trim().toUpperCase(), gOwner: (gOwner || '').trim() } });
    if (dupGod) return res.status(409).json({ error: `Godown '${gNum.trim()}' with owner '${(gOwner || '').trim()}' already exists` });
    const serialKey = `${groupID}!MGODOWN!PKGODOWNID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Godown ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Godown ID' });
    const record = {
      pkGodownID: `${groupID}!${n}`,
      GodownID:   n,
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      gNum:       gNum.trim().toUpperCase(),
      gRate:      gRate || null,
      gSqrft:     gSqrft || null,
      gAmt:       gAmt || null,
      gOwner:     (gOwner || '').trim(),
      gAdd:       gAdd || '',
      gStartDt:   gStartDt ? new Date(gStartDt) : null,
      gEndDt:     gEndDt   ? new Date(gEndDt)   : null,
      gNote:      gNote || '',
      Active:     'Y',
      fkUserID:   req.user.userId,
      CrMod:      new Date(),
    };
    const row = await Godown.create(record);
    await syncToGroup({ req, modelFactory: defineGodown, record: row.dataValues, operation: 'upsert', pkField: 'pkGodownID' });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create godown' }); }
});

// PUT /api/masters/godowns/:id -- Primary company only
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit godowns' });

  const { gNum, gRate, gSqrft, gAmt, gOwner, gAdd, gStartDt, gEndDt, gNote, Active } = req.body;
  if (!gNum) return res.status(400).json({ error: 'Godown number is required' });

  try {
    const Godown  = defineGodown(req.db);
    const dupGod = await Godown.findOne({ where: { fkCompID: req.user.compID, gNum: gNum.trim().toUpperCase(), gOwner: (gOwner || '').trim(), pkGodownID: { [Op.ne]: req.params.id } } });
    if (dupGod) return res.status(409).json({ error: `Godown '${gNum.trim()}' with owner '${(gOwner || '').trim()}' already exists` });
    const updated = {
      gNum:     gNum.trim().toUpperCase(),
      gRate:    gRate || null,
      gSqrft:   gSqrft || null,
      gAmt:     gAmt || null,
      gOwner:   (gOwner || '').trim(),
      gAdd:     gAdd || '',
      gStartDt: gStartDt ? new Date(gStartDt) : null,
      gEndDt:   gEndDt   ? new Date(gEndDt)   : null,
      gNote:    gNote || '',
      Active:   Active || 'Y',
      CrMod:    new Date(),
    };
    const [n] = await Godown.update(updated, { where: { pkGodownID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Godown not found' });

    const row = await Godown.findOne({ where: { pkGodownID: req.params.id } });
    await syncToGroup({ req, modelFactory: defineGodown, record: row.dataValues, operation: 'upsert', pkField: 'pkGodownID' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update godown' }); }
});

// DELETE /api/masters/godowns/:id -- soft delete; Primary company only
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete godowns' });
  try {
    const Godown = defineGodown(req.db);
    const [n]    = await Godown.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkGodownID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Godown not found' });
    await syncToGroup({ req, modelFactory: defineGodown, record: { pkGodownID: req.params.id }, operation: 'softDelete', pkField: 'pkGodownID' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete godown' }); }
});

module.exports = router;
