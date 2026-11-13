// SHARED MASTER — Holiday  /api/masters/holidays
// All companies in a group observe the same holidays.
// READ:  any company can read from their own DB copy.
// WRITE: Primary company only; syncToGroup() copies to siblings automatically.
const router            = require('express').Router();
const { Op }            = require('sequelize');
const { gudfGenSerialID } = require('../../utils/serialID');
const { getFaYear }       = require('../../utils/faYear');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineHoliday     = require('../../models/company/Holiday');
const { syncToGroup }   = require('../../utils/syncToGroup');

router.use(requireAuth);

router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Holiday = defineHoliday(req.db);
    const rows = await Holiday.findAll({
      where: { fkCompID: req.user.compID },
      order: [['hDate', 'DESC']],
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load holidays' }); }
});

router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add holidays' });
  const { hDate, hName, hBoard, hOffice, hNote } = req.body;
  if (!hDate || !hName) return res.status(400).json({ error: 'Date and Name are required' });
  try {
    const Holiday = defineHoliday(req.db);
    const { compID, groupID, branchID } = req.user;
    const hFaYear = await getFaYear(req.db, req.user.compID, hDate);
    const dupHld = await Holiday.findOne({ where: { fkCompID: compID, hName: hName.trim().toUpperCase(), hFaYear } });
    if (dupHld) return res.status(409).json({ error: `Holiday '${hName.trim()}' already exists for FY ${hFaYear}` });
    const serialKey = `${groupID}!MHOLIDAY!PKHLDID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Holiday ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Holiday ID' });
    const record  = {
      pkHldID: `${groupID}!${n}`, HldID: n, fkCompID: req.user.compID, fkBranchID: req.user.branchID,
      hDate: new Date(hDate), hFaYear,
      hBoard: hBoard ? 'Y' : 'N', hOffice: hOffice ? 'Y' : 'N',
      hName: hName.trim().toUpperCase(), hNote: hNote || '', Active: 'Y', fkUserID: req.user.userId, CrMod: new Date(),
    };
    const row = await Holiday.create(record);
    await syncToGroup({ req, modelFactory: defineHoliday, record: row.dataValues, operation: 'upsert', pkField: 'pkHldID' });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create holiday' }); }
});

router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit holidays' });
  const { hDate, hName, hBoard, hOffice, hNote, Active } = req.body;
  if (!hDate || !hName) return res.status(400).json({ error: 'Date and Name are required' });
  try {
    const Holiday = defineHoliday(req.db);
    const hFaYear = await getFaYear(req.db, req.user.compID, hDate);
    const dupHld = await Holiday.findOne({ where: { fkCompID: req.user.compID, hName: hName.trim().toUpperCase(), hFaYear, pkHldID: { [Op.ne]: req.params.id } } });
    if (dupHld) return res.status(409).json({ error: `Holiday '${hName.trim()}' already exists for FY ${hFaYear}` });
    const updated = {
      hDate: new Date(hDate), hFaYear,
      hBoard: hBoard ? 'Y' : 'N', hOffice: hOffice ? 'Y' : 'N',
      hName: hName.trim().toUpperCase(), hNote: hNote || '', Active: Active || 'Y', CrMod: new Date(),
    };
    const [n] = await Holiday.update(updated, { where: { pkHldID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Holiday not found' });
    const row = await Holiday.findOne({ where: { pkHldID: req.params.id } });
    await syncToGroup({ req, modelFactory: defineHoliday, record: row.dataValues, operation: 'upsert', pkField: 'pkHldID' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update holiday' }); }
});

router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete holidays' });
  try {
    const Holiday = defineHoliday(req.db);
    const [n] = await Holiday.update({ Active: 'N', CrMod: new Date() }, { where: { pkHldID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Holiday not found' });
    await syncToGroup({ req, modelFactory: defineHoliday, record: { pkHldID: req.params.id }, operation: 'softDelete', pkField: 'pkHldID' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete holiday' }); }
});

module.exports = router;
