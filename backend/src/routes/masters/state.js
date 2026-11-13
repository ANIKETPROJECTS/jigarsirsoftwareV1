// ─────────────────────────────────────────────────────────────────────────────
// state.js  —  /api/masters/states
//
// SHARED MASTER — read from the logged-in company's own database (req.db),
// which holds a synced copy of the group's state list.
//
// WRITE RULE:
//   Only the Primary company of a group can add / edit / delete.
//   Secondary company users get HTTP 403 if they try to write.
//   On every write from Primary, syncToGroup() copies the change to every
//   sibling company database in the same group automatically.
// ─────────────────────────────────────────────────────────────────────────────
const router            = require('express').Router();
const { Op }            = require('sequelize');
const { gudfGenSerialID } = require('../../utils/serialID');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineState       = require('../../models/company/State');
const { syncToGroup }   = require('../../utils/syncToGroup');

router.use(requireAuth);

// GET /api/masters/states
// Any company (primary or secondary) can view their local copy.
router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const State = defineState(req.db);
    const rows  = await State.findAll({
      where: { fkCompID: req.user.compID, Active: 'Y' },
      order: [['sName', 'ASC']],
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load states' }); }
});

// POST /api/masters/states  — Primary company only
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add state entries' });

  const { sInitial, sName, sCode, sNote } = req.body;
  if (!sName || !sInitial || !sCode)
    return res.status(400).json({ error: 'Initial, Name and Code are required' });

  try {
    const State  = defineState(req.db);
    const { compID, groupID, branchID } = req.user;
    const dupName = await State.findOne({ where: { fkCompID: compID, sName: sName.trim().toUpperCase() } });
    if (dupName) return res.status(409).json({ error: `State Name '${sName.trim()}' already exists` });
    const dupCode = await State.findOne({ where: { fkCompID: compID, sCode: sCode.trim().toUpperCase() } });
    if (dupCode) return res.status(409).json({ error: `State Code '${sCode.trim()}' already exists` });
    const serialKey = `${groupID}!MSTATE!PKSTATEID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'State ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate State ID' });
    const record = {
      pkStateID:  `${groupID}!${n}`,
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      StateID:  n,
      sInitial: sInitial.trim().toUpperCase(),
      sName:    sName.trim().toUpperCase(),
      sCode:    sCode.trim().toUpperCase(),
      sNote:    sNote || '',
      Active:   'Y',
      fkUserID: req.user.userId,
      CrMod:    new Date(),
    };
    const row = await State.create(record);

    // Sync the new record to all sibling company databases in the same group
    await syncToGroup({ req, modelFactory: defineState, record: row.dataValues, operation: 'upsert', pkField: 'pkStateID' });

    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create state' }); }
});

// PUT /api/masters/states/:id  — Primary company only
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit state entries' });

  const { sInitial, sName, sCode, sNote } = req.body;
  if (!sName || !sInitial || !sCode)
    return res.status(400).json({ error: 'Initial, Name and Code are required' });

  try {
    const State = defineState(req.db);
    const { compID } = req.user;
    const dupName = await State.findOne({ where: { fkCompID: compID, sName: sName.trim().toUpperCase(), pkStateID: { [Op.ne]: req.params.id } } });
    if (dupName) return res.status(409).json({ error: `State Name '${sName.trim()}' already exists` });
    const dupCode = await State.findOne({ where: { fkCompID: compID, sCode: sCode.trim().toUpperCase(), pkStateID: { [Op.ne]: req.params.id } } });
    if (dupCode) return res.status(409).json({ error: `State Code '${sCode.trim()}' already exists` });
    const updated = {
      sInitial: sInitial.trim().toUpperCase(),
      sName:    sName.trim().toUpperCase(),
      sCode:    sCode.trim().toUpperCase(),
      sNote: sNote || '', fkUserID: req.user.userId, CrMod: new Date(),
    };
    const [n] = await State.update(updated, {
      where: { pkStateID: req.params.id, fkCompID: req.user.compID },
    });
    if (n === 0) return res.status(404).json({ error: 'State not found' });

    const row = await State.findOne({ where: { pkStateID: req.params.id } });
    await syncToGroup({ req, modelFactory: defineState, record: row.dataValues, operation: 'upsert', pkField: 'pkStateID' });

    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update state' }); }
});

// DELETE /api/masters/states/:id  — soft delete; Primary company only
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete state entries' });
  try {
    const State = defineState(req.db);
    const [n]   = await State.update(
      { Active: 'N' },
      { where: { pkStateID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'State not found' });

    await syncToGroup({ req, modelFactory: defineState, record: { pkStateID: req.params.id }, operation: 'softDelete', pkField: 'pkStateID' });

    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete state' }); }
});

module.exports = router;
