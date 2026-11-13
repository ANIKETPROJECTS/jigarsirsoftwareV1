// COMPANY-SPECIFIC MASTER -- Tax  /api/masters/taxes
//
// Tax rates are per-company -- ADS may have different tax codes from TEST.
// No syncToGroup: each company sets its own tax configuration independently.
// Composite PK: (fkCompID, TaxCode, TaxFromDt) -- a new rate period is a new row.
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineTax         = require('../../models/company/Tax');

router.use(requireAuth);

// GET /api/masters/taxes -- scoped to current company
router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Tax  = defineTax(req.db);
    const rows = await Tax.findAll({
      where: { fkCompID: req.user.compID },
      order: [['TaxCode', 'ASC'], ['TaxFromDt', 'ASC']],
    });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load taxes' }); }
});

// POST /api/masters/taxes
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  const { TaxCode, TaxFromDt, TaxToDt, TaxType, TaxRate, TaxDesc } = req.body;
  if (!TaxCode || !TaxFromDt || !TaxType || TaxRate == null)
    return res.status(400).json({ error: 'TaxCode, TaxFromDt, TaxType and TaxRate are required' });
  try {
    const Tax = defineTax(req.db);
    const row = await Tax.create({
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      TaxCode:    TaxCode.trim().toUpperCase(),
      TaxFromDt:  new Date(TaxFromDt),
      TaxToDt:    TaxToDt ? new Date(TaxToDt) : null,
      TaxType:    TaxType.trim().toUpperCase(),
      TaxRate:    parseFloat(TaxRate),
      TaxDesc:    TaxDesc || '',
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Tax entry already exists for this code and date' });
    res.status(500).json({ error: err.message || 'Failed to create tax' });
  }
});

// PUT /api/masters/taxes/:taxCode/:taxFromDt -- composite key update
router.put('/:taxCode/:taxFromDt', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  const { TaxToDt, TaxType, TaxRate, TaxDesc } = req.body;
  if (!TaxType || TaxRate == null)
    return res.status(400).json({ error: 'TaxType and TaxRate are required' });
  try {
    const Tax = defineTax(req.db);
    const [n] = await Tax.update(
      { TaxToDt: TaxToDt ? new Date(TaxToDt) : null, TaxType: TaxType.trim().toUpperCase(), TaxRate: parseFloat(TaxRate), TaxDesc: TaxDesc || '' },
      { where: { fkCompID: req.user.compID, TaxCode: req.params.taxCode, TaxFromDt: new Date(req.params.taxFromDt) } }
    );
    if (n === 0) return res.status(404).json({ error: 'Tax entry not found' });
    res.json({ updated: true });
  } catch { res.status(500).json({ error: 'Failed to update tax' }); }
});

// DELETE /api/masters/taxes/:taxCode/:taxFromDt -- hard delete (tax rows have no Active flag)
router.delete('/:taxCode/:taxFromDt', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  try {
    const Tax = defineTax(req.db);
    const n   = await Tax.destroy({
      where: { fkCompID: req.user.compID, TaxCode: req.params.taxCode, TaxFromDt: new Date(req.params.taxFromDt) },
    });
    if (n === 0) return res.status(404).json({ error: 'Tax entry not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete tax' }); }
});

module.exports = router;
