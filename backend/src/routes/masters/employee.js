// SHARED MASTER -- Employee  /api/masters/employees
//
// Employees are the labour pool shared across all companies in the group.
// The same workers (loaders, supervisors) work across ADS, TEST, VLCO etc.
//
// FLOW:
//   GET  -> any company reads from its own DB copy (req.db).
//   POST/PUT/DELETE -> Primary writes, syncToGroup() propagates to siblings.
//   Non-primary write -> HTTP 403 immediately.
const router            = require('express').Router();
const { Op }            = require('sequelize');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineEmployee    = require('../../models/company/Employee');
const { syncToGroup }   = require('../../utils/syncToGroup');

router.use(requireAuth);

// GET /api/masters/employees -- any company reads its local copy
router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Employee = defineEmployee(req.db);
    const rows     = await Employee.findAll({
      where: { fkCompID: req.user.compID },
      order: [['eName', 'ASC']],
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load employees' }); }
});

// GET /api/masters/employees/:id
router.get('/:id', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Employee = defineEmployee(req.db);
    const row      = await Employee.findOne({ where: { pkEmpID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load employee' }); }
});

// POST /api/masters/employees -- Primary company only
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add employees' });

  const { eName, eShortName, eAddress, eContect, eType, eDesignation,
          eBoardRegNum, eToliNum, eBoardName, eNote } = req.body;
  if (!eName || !eShortName || !eType || !eDesignation)
    return res.status(400).json({ error: 'Name, Short Name, Type and Designation are required' });

  try {
    const Employee = defineEmployee(req.db);
    const { compID, groupID, branchID } = req.user;
    const dupEmp = await Employee.findOne({ where: { fkCompID: compID, eName: eName.trim() } });
    if (dupEmp) return res.status(409).json({ error: `Employee '${eName.trim()}' already exists` });
    const serialKey = `${groupID}!mEmployee!pkEmpId`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Employee ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Employee ID' });
    const record   = {
      pkEmpID:      `${groupID}!${n}`,
      EmpID:        n,
      fkCompID:     req.user.compID,
      fkBranchID:   req.user.branchID,
      eName:        eName.trim(),
      eShortName:   eShortName.trim(),
      eAddress:     (eAddress || '').trim(),
      eContect:     (eContect || '').trim(),
      eType:        eType.trim(),
      eDesignation: eDesignation.trim(),
      eBoardRegNum: (eBoardRegNum || '').trim(),
      eToliNum:     (eToliNum || '').trim(),
      eBoardName:   (eBoardName || '').trim(),
      eNote:        eNote || '',
      Active:       'Y',
      fkUserID:     req.user.userId,
      CrMod:        new Date(),
    };
    const row = await Employee.create(record);
    await syncToGroup({ req, modelFactory: defineEmployee, record: row.dataValues, operation: 'upsert', pkField: 'pkEmpID' });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create employee' }); }
});

// PUT /api/masters/employees/:id -- Primary company only
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit employees' });

  const { eName, eShortName, eAddress, eContect, eType, eDesignation,
          eBoardRegNum, eToliNum, eBoardName, eNote, Active } = req.body;
  if (!eName || !eShortName || !eType || !eDesignation)
    return res.status(400).json({ error: 'Name, Short Name, Type and Designation are required' });

  try {
    const Employee = defineEmployee(req.db);
    const dupEmp = await Employee.findOne({ where: { fkCompID: req.user.compID, eName: eName.trim(), pkEmpID: { [Op.ne]: req.params.id } } });
    if (dupEmp) return res.status(409).json({ error: `Employee '${eName.trim()}' already exists` });
    const updated  = {
      eName:        eName.trim(),
      eShortName:   eShortName.trim(),
      eAddress:     (eAddress || '').trim(),
      eContect:     (eContect || '').trim(),
      eType:        eType.trim(),
      eDesignation: eDesignation.trim(),
      eBoardRegNum: (eBoardRegNum || '').trim(),
      eToliNum:     (eToliNum || '').trim(),
      eBoardName:   (eBoardName || '').trim(),
      eNote:        eNote || '',
      Active:       Active || 'Y',
      CrMod:        new Date(),
    };
    const [n] = await Employee.update(updated, { where: { pkEmpID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Employee not found' });

    const row = await Employee.findOne({ where: { pkEmpID: req.params.id } });
    await syncToGroup({ req, modelFactory: defineEmployee, record: row.dataValues, operation: 'upsert', pkField: 'pkEmpID' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update employee' }); }
});

// DELETE /api/masters/employees/:id -- soft delete; Primary company only
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete employees' });
  try {
    const Employee = defineEmployee(req.db);
    const [n]      = await Employee.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkEmpID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Employee not found' });
    await syncToGroup({ req, modelFactory: defineEmployee, record: { pkEmpID: req.params.id }, operation: 'softDelete', pkField: 'pkEmpID' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to delete employee' }); }
});

module.exports = router;
