// COMPANY-SPECIFIC MASTER -- Rate Chart  /api/masters/ratechart
//
// Contract rates are per-company -- ADS rates are separate from TEST rates.
// Two rate types with different required fields:
//   GR (Godown Rent) -- fixed BillRate charged to party; no hamali/labour fields.
//   HM (Hamali)      -- TransType required; LabourRate paid to workers; BillRate also used (OA/OC/VC etc.).
// No syncToGroup: each company sets its own rates independently.
const router            = require('express').Router();
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineRateChart   = require('../../models/company/RateChart');

router.use(requireAuth);

// GET /api/masters/ratechart -- optional ?partyID=xxx filter
router.get('/', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const RateChart = defineRateChart(req.db);
    const where = { fkCompID: req.user.compID };
    if (req.query.partyID !== undefined) where.fkPartyID = req.query.partyID;
    const rows  = await RateChart.findAll({
      where,
      attributes: ['pkRateChartID', 'fkPartyID', 'fkItemID', 'RateType', 'TransType',
                   'PackingType', 'FromDt', 'ToDt', 'UnitFrom', 'UnitTo', 'ChargeType',
                   'HamaliCode', 'BillRate', 'LabourRate', 'Note', 'Active'],
      order: [['fkPartyID', 'ASC'], ['FromDt', 'DESC']],
    });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load rate chart' }); }
});

// GET /api/masters/ratechart/:id
router.get('/:id', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const RateChart = defineRateChart(req.db);
    const row       = await RateChart.findOne({ where: { pkRateChartID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Rate not found' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Failed to load rate' }); }
});

// POST /api/masters/ratechart -- conditional validation based on RateType
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  const {
    fkPartyID, fkItemID, RateType, TransType, PackingType,
    FromDt, ToDt, UnitFrom, UnitTo, ChargeType, HamaliCode,
    BillRate, LabourRate, Note,
  } = req.body;

  const isGR = RateType === 'GR';

  if (!PackingType || !FromDt)
    return res.status(400).json({ error: 'Packing and From Date are required' });
  if (isGR && !BillRate)
    return res.status(400).json({ error: 'Bill Rate is required for Godown Rent' });
  try {
    const RateChart = defineRateChart(req.db);
    const { compID, branchID } = req.user;
    const serialKey = `${compID}!${branchID}!RATECHART!PKRATECHARTID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Rate Chart ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Rate Chart ID' });
    const row       = await RateChart.create({
      pkRateChartID: buildSerialKey(compID, branchID, n),
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      fkPartyID:  fkPartyID || '0',
      fkItemID:   isGR ? '' : (fkItemID  || ''),
      RateType:   RateType || 'HM',
      TransType:  isGR ? '' : (TransType  || ''),
      PackingType,
      FromDt,
      ToDt:       ToDt       || null,
      UnitFrom:   UnitFrom   || 0,
      UnitTo:     UnitTo     || 99999,
      ChargeType: isGR ? '' : (ChargeType || ''),
      HamaliCode: isGR ? '' : (HamaliCode || ''),
      BillRate:   BillRate   || 0,
      LabourRate: isGR ? 0  : (LabourRate || 0),
      Note:       Note       || '',
      Active:     'Y',
      fkUserID:   req.user.userId,
      CrMod:      new Date(),
    });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create rate' }); }
});

// PUT /api/masters/ratechart/:id -- same conditional validation as POST
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  const {
    fkPartyID, fkItemID, RateType, TransType, PackingType,
    FromDt, ToDt, UnitFrom, UnitTo, ChargeType, HamaliCode,
    BillRate, LabourRate, Note, Active,
  } = req.body;

  const isGR = RateType === 'GR';

  if (!PackingType || !FromDt)
    return res.status(400).json({ error: 'Packing and From Date are required' });
  if (isGR && !BillRate)
    return res.status(400).json({ error: 'Bill Rate is required for Godown Rent' });
  try {
    const RateChart = defineRateChart(req.db);
    const [n]       = await RateChart.update(
      {
        fkPartyID:  fkPartyID || '0',
        fkItemID:   isGR ? '' : (fkItemID  || ''),
        RateType:   RateType || 'HM',
        TransType:  isGR ? '' : (TransType  || ''),
        PackingType,
        FromDt,
        ToDt:       ToDt || null,
        UnitFrom,   UnitTo,
        ChargeType: isGR ? '' : (ChargeType || ''),
        HamaliCode: isGR ? '' : (HamaliCode || ''),
        BillRate:   BillRate   || 0,
        LabourRate: isGR ? 0  : (LabourRate || 0),
        Note:       Note || '',
        Active:     Active || 'Y',
        fkUserID:   req.user.userId,
        CrMod:      new Date(),
      },
      { where: { pkRateChartID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Rate not found' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update rate' }); }
});

// DELETE /api/masters/ratechart/:id -- soft delete
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  try {
    const RateChart = defineRateChart(req.db);
    const [n]       = await RateChart.update(
      { Active: 'N' },
      { where: { pkRateChartID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Rate not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete rate' }); }
});

module.exports = router;
