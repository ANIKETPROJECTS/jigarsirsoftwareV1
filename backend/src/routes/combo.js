// SHARED MASTER -- Combo Data  /api/combo
//
// VCComboData holds dropdown list values used across all forms:
//   PackingType (Bag/Loose/Tarpaulin), ItemType, HamaliType, Designation, etc.
// Scoped per company (fkCompID); values are managed directly in the database.
// READ-ONLY from the API.
const router            = require('express').Router();
const requireAuth       = require('../middleware/auth');
const requirePermission = require('../middleware/permission');
const defineVCComboData = require('../models/company/VCComboData');

router.use(requireAuth);

// GET /api/combo?purpose=PackingType
// Returns combo values for the given VCPurpose filtered to the user's group and branch.
router.get('/', async (req, res) => {
  const { purpose } = req.query;
  if (!purpose) return res.status(400).json({ error: 'purpose query param is required' });
  try {
    const VCComboData = defineVCComboData(req.db);
    const rows        = await VCComboData.findAll({
      attributes: ['VCCode', 'VCData', 'VCSrtOrd'],
      where: {
        fkCompID:  req.user.compID,
        VCPurpose: purpose,
        VCActive:  'Y',
      },
      order: [['VCSrtOrd', 'ASC'], ['VCData', 'ASC']],
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load combo data' }); }
});

module.exports = router;
