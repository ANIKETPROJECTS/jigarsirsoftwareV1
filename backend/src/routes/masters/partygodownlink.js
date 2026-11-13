// COMPANY-SPECIFIC MASTER -- Party Godown Link  /api/masters/party-godown-links
//
// Tracks which godowns a party is assigned to, for what period (FromDt..ToDt),
// and whether the arrangement is Owner/Rent/Insurance etc (LinkType).
// Used in transaction entry to filter godown options by selected party,
// and in reports to show godown occupancy per party.
// No syncToGroup: assignments are per-company business decisions.
const router                = require('express').Router();
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const requireAuth           = require('../../middleware/auth');
const requirePermission     = require('../../middleware/permission');
const definePartyGodownLink = require('../../models/company/PartyGodownLink');

router.use(requireAuth);

// GET /api/masters/party-godown-links -- optional ?partyID=xxx filter
// ?slim=1 → fkGodownID only, used by transaction forms to filter godown dropdowns (no MASTERS.CanView required)
router.get('/', (req, res, next) => {
  if (req.query.slim) return next();
  requirePermission('MASTERS', 'CanView')(req, res, next);
}, async (req, res) => {
  try {
    const PartyGodownLink = definePartyGodownLink(req.db);
    const where           = { fkCompID: req.user.compID };
    if (req.query.partyID) where.fkPartyID = req.query.partyID;
    const opts = { where, order: [['fkPartyID', 'ASC'], ['FromDt', 'DESC']] };
    if (req.query.slim) opts.attributes = ['fkGodownID'];
    const rows = await PartyGodownLink.findAll(opts);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load godown links' }); }
});

// GET /api/masters/party-godown-links/:id
router.get('/:id', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const PartyGodownLink = definePartyGodownLink(req.db);
    const row             = await PartyGodownLink.findOne({ where: { pkLinkID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Link not found' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Failed to load link' }); }
});

// POST /api/masters/party-godown-links
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  const { fkPartyID, fkGodownID, LinkType, FromDt, ToDt, Note } = req.body;
  if (!fkPartyID || !fkGodownID || !LinkType || !FromDt)
    return res.status(400).json({ error: 'Party, Godown, Link Type and From Date are required' });
  try {
    const PartyGodownLink = definePartyGodownLink(req.db);
    const { compID, branchID } = req.user;
    const serialKey = `${compID}!${branchID}!PartyGodownLink!pkLinkId`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Link ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Link ID' });
    const row             = await PartyGodownLink.create({
      pkLinkID:   buildSerialKey(compID, branchID, n),
      fkCompID:   req.user.compID,
      fkBranchID: req.user.branchID,
      fkPartyID,
      fkGodownID,
      LinkType,
      FromDt,
      ToDt:     ToDt || null,
      Note:     Note || '',
      Active:   'Y',
      fkUserID: req.user.userId,
      CrMod:    new Date(),
    });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to create godown link' }); }
});

// PUT /api/masters/party-godown-links/:id
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  const { fkPartyID, fkGodownID, LinkType, FromDt, ToDt, Note, Active } = req.body;
  if (!fkPartyID || !fkGodownID || !LinkType || !FromDt)
    return res.status(400).json({ error: 'Party, Godown, Link Type and From Date are required' });
  try {
    const PartyGodownLink = definePartyGodownLink(req.db);
    const [n]             = await PartyGodownLink.update(
      { fkPartyID, fkGodownID, LinkType, FromDt, ToDt: ToDt || null,
        Note: Note || '', Active: Active || 'Y', fkUserID: req.user.userId, CrMod: new Date() },
      { where: { pkLinkID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Link not found' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update godown link' }); }
});

// DELETE /api/masters/party-godown-links/:id -- soft delete
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  try {
    const PartyGodownLink = definePartyGodownLink(req.db);
    const [n]             = await PartyGodownLink.update(
      { Active: 'N' },
      { where: { pkLinkID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Link not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete godown link' }); }
});

module.exports = router;
