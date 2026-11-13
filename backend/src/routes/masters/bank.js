// COMPANY-SPECIFIC MASTER -- Bank  /api/masters/banks
//
// Bank accounts are per-company -- ADS has its own accounts, TEST has its own.
// No syncToGroup: each company manages its own banking independently.
const router            = require('express').Router();
const { Op }            = require('sequelize');
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineBank        = require('../../models/company/Bank');

router.use(requireAuth);

// GET /api/masters/banks -- scoped to current company
router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Bank = defineBank(req.db);
    const rows = await Bank.findAll({
      where: { fkCompID: req.user.compID },
      order: [['bName', 'ASC']],
    });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load banks' }); }
});

// POST /api/masters/banks
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  const { bName, bAcNo, bIFSC, bBranch, bPrimeryFlg, bNote } = req.body;
  if (!bName || !bAcNo)
    return res.status(400).json({ error: 'Bank name and account number are required' });
  try {
    const Bank = defineBank(req.db);
    const { compID, branchID } = req.user;
    const dupBank = await Bank.findOne({ where: { fkCompID: compID, bName: bName.trim().toUpperCase(), bAcNo: bAcNo.trim() } });
    if (dupBank) return res.status(409).json({ error: `Bank '${bName.trim()}' with account number '${bAcNo.trim()}' already exists` });
    const serialKey = `${compID}!${branchID}!MBANK!PKBANKID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Bank ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Bank ID' });
    const row  = await Bank.create({
      pkBankID:    buildSerialKey(compID, branchID, n),
      bName:       bName.trim().toUpperCase(),
      bAcNo:       bAcNo.trim(),
      bIFSC:       (bIFSC || '').trim().toUpperCase(),
      bBranch:     (bBranch || '').trim(),
      bPrimeryFlg: bPrimeryFlg ? 'Y' : 'N',
      fkCompID:    req.user.compID,
      Active:      'Y',
      bNote:       bNote || '',
    });
    res.status(201).json(row);
  } catch { res.status(500).json({ error: 'Failed to create bank' }); }
});

// PUT /api/masters/banks/:id
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  const { bName, bAcNo, bIFSC, bBranch, bPrimeryFlg, bNote, Active } = req.body;
  if (!bName || !bAcNo)
    return res.status(400).json({ error: 'Bank name and account number are required' });
  try {
    const Bank = defineBank(req.db);
    const dupBank = await Bank.findOne({ where: { fkCompID: req.user.compID, bName: bName.trim().toUpperCase(), bAcNo: bAcNo.trim(), pkBankID: { [Op.ne]: req.params.id } } });
    if (dupBank) return res.status(409).json({ error: `Bank '${bName.trim()}' with account number '${bAcNo.trim()}' already exists` });
    const [n]  = await Bank.update(
      { bName: bName.trim().toUpperCase(), bAcNo: bAcNo.trim(), bIFSC: (bIFSC || '').trim().toUpperCase(),
        bBranch: (bBranch || '').trim(), bPrimeryFlg: bPrimeryFlg ? 'Y' : 'N',
        bNote: bNote || '', Active: Active || 'Y' },
      { where: { pkBankID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Bank not found' });
    res.json({ updated: true });
  } catch { res.status(500).json({ error: 'Failed to update bank' }); }
});

// DELETE /api/masters/banks/:id -- soft delete
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  try {
    const Bank = defineBank(req.db);
    const [n]  = await Bank.update(
      { Active: 'N' },
      { where: { pkBankID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Bank not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete bank' }); }
});

module.exports = router;
