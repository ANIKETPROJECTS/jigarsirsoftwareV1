// comboData.js  —  /api/masters/combo-data
//
// CRUD for VCComboData — group-shared dropdown lookup values.
// READ  → any company reads its own copy (fkCompID scoped).
// WRITE → Primary company only; after every write, changes sync to all
//         sibling company DBs with each sibling's own fkCompID substituted.
const router               = require('express').Router();
const requireAuth          = require('../../middleware/auth');
const requirePermission    = require('../../middleware/permission');
const defineVCComboData    = require('../../models/company/VCComboData');
const connectionManager    = require('../../config/connectionManager');

router.use(requireAuth);

// ── sync helper ──────────────────────────────────────────────────────────────
// Upserts or soft-deletes the record in every sibling company DB,
// substituting each sibling's own compID into fkCompID.
async function syncComboToGroup({ req, record, operation }) {
  const { groupID, compID: primaryCompID, branchID } = req.user;
  const siblings = connectionManager.getGroupCompanyIDs(groupID)
    .filter((cid) => cid !== primaryCompID);
  if (siblings.length === 0) return;

  await Promise.all(siblings.map(async (sibCompID) => {
    const db = connectionManager.getDB(sibCompID);
    if (!db) return;
    const Model = defineVCComboData(db);

    if (operation === 'upsert') {
      await Model.upsert({ ...record, fkCompID: sibCompID });
    } else if (operation === 'softDelete') {
      await Model.update({ VCActive: 'N' }, {
        where: {
          fkCompID:   sibCompID,
          fkBranchID: branchID,
          VCPurpose:  record.VCPurpose,
          VCCode:     record.VCCode,
        },
      });
    }
  }));
}

// ── GET / ────────────────────────────────────────────────────────────────────
router.get('/', requirePermission('COMBO_DATA', 'CanView'), async (req, res) => {
  try {
    const VCComboData = defineVCComboData(req.db);
    const where = { fkCompID: req.user.compID, fkBranchID: req.user.branchID };
    if (req.query.purpose) where.VCPurpose = req.query.purpose;
    if (req.query.active !== 'all') where.VCActive = 'Y';
    const rows = await VCComboData.findAll({
      where,
      order: [['VCPurpose', 'ASC'], ['VCSrtOrd', 'ASC'], ['VCData', 'ASC']],
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load combo data' }); }
});

// ── GET /:purpose/:code ───────────────────────────────────────────────────────
router.get('/:purpose/:code', requirePermission('COMBO_DATA', 'CanView'), async (req, res) => {
  try {
    const VCComboData = defineVCComboData(req.db);
    const row = await VCComboData.findOne({
      where: {
        fkCompID:   req.user.compID,
        fkBranchID: req.user.branchID,
        VCPurpose:  req.params.purpose,
        VCCode:     req.params.code,
      },
    });
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load record' }); }
});

// ── POST / ───────────────────────────────────────────────────────────────────
router.post('/', requirePermission('COMBO_DATA', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add combo data' });

  const { VCPurpose, VCCode, VCData, VCDesc, VCSrtOrd, VCActive } = req.body;
  if (!VCPurpose || !VCCode || !VCData)
    return res.status(400).json({ error: 'VCPurpose, VCCode and VCData are required' });

  try {
    const VCComboData = defineVCComboData(req.db);
    const existing = await VCComboData.findOne({
      where: {
        fkCompID:   req.user.compID,
        fkBranchID: req.user.branchID,
        VCPurpose:  VCPurpose.trim(),
        VCCode:     VCCode.trim().toUpperCase(),
      },
    });
    if (existing) return res.status(409).json({ error: 'A record with this Purpose and Code already exists' });

    const record = {
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      VCPurpose:  VCPurpose.trim(),
      VCCode:     VCCode.trim().toUpperCase(),
      VCData:     VCData.trim(),
      VCDesc:     VCDesc?.trim() || '',
      VCSrtOrd:   VCSrtOrd != null ? parseInt(VCSrtOrd, 10) : 1,
      VCActive:   VCActive || 'Y',
    };

    const row = await VCComboData.create(record);
    await syncComboToGroup({ req, record: row.dataValues, operation: 'upsert' });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create record' }); }
});

// ── PUT /:purpose/:code ───────────────────────────────────────────────────────
router.put('/:purpose/:code', requirePermission('COMBO_DATA', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit combo data' });

  const { VCData, VCDesc, VCSrtOrd, VCActive } = req.body;
  if (!VCData) return res.status(400).json({ error: 'VCData is required' });

  try {
    const VCComboData = defineVCComboData(req.db);
    const where = {
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      VCPurpose:  req.params.purpose,
      VCCode:     req.params.code,
    };

    // Check existence first — MySQL reports 0 affected rows when nothing changed,
    // so we cannot rely on the update count to detect "not found".
    const existing = await VCComboData.findOne({ where });
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const updates = {
      VCData:   VCData.trim(),
      VCDesc:   VCDesc?.trim() || '',
      VCSrtOrd: VCSrtOrd != null ? parseInt(VCSrtOrd, 10) : 0,
      VCActive: VCActive || 'Y',
    };
    await VCComboData.update(updates, { where });

    // Sync the full updated record to siblings
    const record = { ...where, ...updates };
    await syncComboToGroup({ req, record, operation: 'upsert' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update record' }); }
});

// ── DELETE /:purpose/:code ────────────────────────────────────────────────────
router.delete('/:purpose/:code', requirePermission('COMBO_DATA', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete combo data' });

  try {
    const VCComboData = defineVCComboData(req.db);
    const [n] = await VCComboData.update({ VCActive: 'N' }, {
      where: {
        fkCompID:   req.user.compID,
        fkBranchID: req.user.branchID,
        VCPurpose:  req.params.purpose,
        VCCode:     req.params.code,
      },
    });
    if (n === 0) return res.status(404).json({ error: 'Record not found' });

    await syncComboToGroup({
      req,
      record: { VCPurpose: req.params.purpose, VCCode: req.params.code },
      operation: 'softDelete',
    });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete record' }); }
});

module.exports = router;
