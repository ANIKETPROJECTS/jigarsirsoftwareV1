// ─────────────────────────────────────────────────────────────────────────────
// location.js  —  /api/masters/locations
//
// PURPOSE:
//   CRUD for the mLocation master — named spots inside a godown.
//   Example: Godown "G01" → Locations "L1", "L2", "FRONT-BAY"
//   Lots stored in a godown can be assigned a specific Location so warehouse
//   staff know exactly where to find the goods.
//
// MASTER TYPE: SHARED (group-level)
//   Locations belong to a godown, and godowns are shared across all companies
//   in the same group. Therefore locations are also shared group-level data.
//
// READ  → any company (primary or secondary) reads from its own DB copy.
//         All copies are kept in sync automatically by syncToGroup().
//
// WRITE → only the PRIMARY company of the group can create / edit / delete.
//         After every write, syncToGroup() upserts the record into every
//         sibling company database (Promise.all in parallel).
//         Secondary company users receive HTTP 403 if they attempt a write.
//
// ROUTES:
//   GET    /api/masters/locations             – all locations for the group
//   GET    /api/masters/locations?godownID=x  – filtered by one godown
//   GET    /api/masters/locations/:id         – single location by UUID
//   POST   /api/masters/locations             – create (Primary only)
//   PUT    /api/masters/locations/:id         – update (Primary only)
//   DELETE /api/masters/locations/:id         – soft-delete Active→'N' (Primary only)
// ─────────────────────────────────────────────────────────────────────────────
const router             = require('express').Router();
const { gudfGenSerialID } = require('../../utils/serialID');
const requireAuth        = require('../../middleware/auth');
const requirePermission  = require('../../middleware/permission');
const defineLocation     = require('../../models/company/Location');
const defineGodown       = require('../../models/company/Godown');
const { syncToGroup }    = require('../../utils/syncToGroup');

// Every route in this file requires a valid JWT.
// requireAuth decodes the token and attaches:
//   req.user  — { userId, compID, groupID, branchID, isPrimary, roleID, … }
//   req.db    — Sequelize instance for the logged-in company's database
router.use(requireAuth);

// ── GET /api/masters/locations ───────────────────────────────────────────────
// Returns all active locations for the current user's group.
// Optional query param ?godownID=<pkGodownID> narrows the result to one godown.
// ?slim=1 → pkLocationID + LocationCode + LocationName + Active only (used by
//            transaction form dropdowns — no MASTERS.CanView required)
// Used by:
//   - LocationListPage (management table)
//   - Lot entry forms (dropdown: "which bay in this godown?")
router.get('/', (req, res, next) => {
  if (req.query.slim) return next();
  requirePermission('MASTERS', 'CanView')(req, res, next);
}, async (req, res) => {
  try {
    const Location = defineLocation(req.db);

    // Build the WHERE clause — always scope to the group; optionally filter by godown
    const where = { fkGroupID: req.user.groupID, Active: 'Y' };
    if (req.query.godownID) {
      where.fkGodownID = req.query.godownID;
    }

    const opts = {
      where,
      order: [
        ['fkGodownID',   'ASC'],   // group by godown first
        ['LocationCode', 'ASC'],   // then alphabetical by code within each godown
      ],
    };
    if (req.query.slim) {
      opts.attributes = ['pkLocationID', 'LocationCode', 'LocationName', 'Active'];
    }

    const rows = await Location.findAll(opts);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load locations' });
  }
});

// ── GET /api/masters/locations/:id ──────────────────────────────────────────
// Fetch a single location by its UUID — used by the edit form to pre-fill fields.
router.get('/:id', requirePermission('MASTERS', 'CanView'), async (req, res) => {
  try {
    const Location = defineLocation(req.db);
    const row = await Location.findOne({
      where: { pkLocationID: req.params.id, fkGroupID: req.user.groupID },
    });
    if (!row) return res.status(404).json({ error: 'Location not found' });
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Failed to load location' });
  }
});

// ── POST /api/masters/locations ──────────────────────────────────────────────
// Create a new location.
// PRIMARY company only — secondary users get HTTP 403.
// After create, syncToGroup() upserts the record into all sibling DBs.
router.post('/', requirePermission('MASTERS', 'CanAdd'), async (req, res) => {
  // Enforce Primary-only write rule
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can add locations' });

  const { fkGodownID, LocationCode, LocationName, lsqrft, lNote } = req.body;

  // Validate required fields
  if (!fkGodownID || !LocationCode || !LocationName)
    return res.status(400).json({ error: 'Godown, Location Code and Location Name are required' });

  // Verify the referenced godown exists and belongs to this group
  // This prevents orphaned location records if a bad UUID is sent.
  try {
    const Godown = defineGodown(req.db);
    const godown = await Godown.findOne({
      where: { pkGodownID: fkGodownID, fkCompID: req.user.compID },
    });
    if (!godown)
      return res.status(400).json({ error: 'Selected godown not found in this group' });
  } catch {
    return res.status(500).json({ error: 'Failed to validate godown' });
  }

  try {
    const Location = defineLocation(req.db);
    const { groupID, branchID } = req.user;
    const serialKey = `${groupID}!${branchID}!MLOCATION!PKLOCATIONID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Location ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Location ID' });

    const record = {
      pkLocationID: `${groupID}!${n}`,
      fkGroupID:    req.user.groupID,          // scope to this group
      fkBranchID:   req.user.branchID,         // branch of the creating user
      fkGodownID:   fkGodownID,
      LocationCode: LocationCode.trim().toUpperCase(),
      LocationName: LocationName.trim(),
      lsqrft:       lsqrft != null && lsqrft !== '' ? parseFloat(lsqrft) : null,
      lNote:        lNote || '',
      Active:       'Y',
      fkUserID:     req.user.userId,
      CrMod:        new Date(),
    };

    const row = await Location.create(record);

    // Sync the new record to all sibling company databases in this group.
    // syncToGroup() runs Model.upsert(record) on each sibling DB in parallel.
    // If a sibling sync fails, it logs the error but does NOT roll back the primary write.
    await syncToGroup({
      req,
      modelFactory: defineLocation,
      record:       row.dataValues,
      operation:    'upsert',
      pkField:      'pkLocationID',
    });

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create location' });
  }
});

// ── PUT /api/masters/locations/:id ──────────────────────────────────────────
// Update an existing location.
// PRIMARY company only.
// syncToGroup() propagates the change to all sibling DBs.
router.put('/:id', requirePermission('MASTERS', 'CanEdit'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can edit locations' });

  const { fkGodownID, LocationCode, LocationName, lsqrft, lNote, Active } = req.body;

  if (!fkGodownID || !LocationCode || !LocationName)
    return res.status(400).json({ error: 'Godown, Location Code and Location Name are required' });

  try {
    const Location = defineLocation(req.db);

    const updated = {
      fkGodownID:   fkGodownID,
      LocationCode: LocationCode.trim().toUpperCase(),
      LocationName: LocationName.trim(),
      lsqrft:       lsqrft != null && lsqrft !== '' ? parseFloat(lsqrft) : null,
      lNote:        lNote || '',
      Active:       Active || 'Y',
      fkUserID:     req.user.userId,
      CrMod:        new Date(),
    };

    const [n] = await Location.update(updated, {
      where: { pkLocationID: req.params.id, fkGroupID: req.user.groupID },
    });
    if (n === 0) return res.status(404).json({ error: 'Location not found' });

    // Fetch the full updated record to pass to syncToGroup
    const row = await Location.findOne({ where: { pkLocationID: req.params.id } });

    await syncToGroup({
      req,
      modelFactory: defineLocation,
      record:       row.dataValues,
      operation:    'upsert',
      pkField:      'pkLocationID',
    });

    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update location' });
  }
});

// ── DELETE /api/masters/locations/:id ───────────────────────────────────────
// Soft-delete: sets Active = 'N'.
// The record is never physically removed so that historical lot records that
// reference this location continue to display the correct location name.
// PRIMARY company only.
router.delete('/:id', requirePermission('MASTERS', 'CanDelete'), async (req, res) => {
  if (!req.user.isPrimary)
    return res.status(403).json({ error: 'Only the Primary company can delete locations' });

  try {
    const Location = defineLocation(req.db);

    const [n] = await Location.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkLocationID: req.params.id, fkGroupID: req.user.groupID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Location not found' });

    // Sync the deactivation to all sibling DBs
    await syncToGroup({
      req,
      modelFactory: defineLocation,
      record:       { pkLocationID: req.params.id },
      operation:    'softDelete',
      pkField:      'pkLocationID',
    });

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete location' });
  }
});

module.exports = router;
