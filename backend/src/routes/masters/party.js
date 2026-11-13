// COMPANY-SPECIFIC MASTER -- Party  /api/masters/parties
//
// Parties (customers/merchants) are per-company -- ADS has its own customer list,
// TEST has its own. Billing, contract rates, and godown assignments are all
// linked to a party within a specific company.
// No syncToGroup: each company maintains its own customer base.
const router            = require('express').Router();
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');
const { QueryTypes, Op } = require('sequelize');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const defineParty       = require('../../models/company/Party');
const connectionManager = require('../../config/connectionManager');

router.use(requireAuth);

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/;

// GET /api/masters/parties -- scoped to current company
router.get('/', requirePermission('PARTY', 'CanView'), async (req, res) => {
  try {
    const Party = defineParty(req.db);
    const opts  = { where: { fkCompID: req.user.compID }, order: [['pAlias', 'ASC']] };
    if (req.query.slim) opts.attributes = ['pkPartyID', 'fkCompID', 'pName', 'pAlias', 'Active'];
    const rows  = await Party.findAll(opts);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load parties' }); }
});

// GET /api/masters/parties/group -- active parties across every company in the group
// Uses UNION ALL across all company DBs (same pattern as arrivals list).
// Falls back to current company's mParty if group info is unavailable.
router.get('/group', requireAuth, async (req, res) => {
  try {
    const { groupID } = req.user;
    const companies = connectionManager.getGroupCompanyDetails(groupID);

    let sql;
    if (companies.length > 1) {
      const parts = companies.map(({ dbName }) =>
        `SELECT pkPartyID, fkCompID, pName, pAlias, pCode, Active ` +
        `FROM \`${dbName}\`.mParty WHERE Active = 'Y'`
      );
      sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) _p ORDER BY pName ASC`;
    } else {
      sql = "SELECT pkPartyID, fkCompID, pName, pAlias, pCode, Active FROM mParty WHERE Active = 'Y' ORDER BY pName ASC";
    }

    const rows = await req.db.query(sql, { type: QueryTypes.SELECT });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load group parties' }); }
});

// GET /api/masters/parties/vam -- active parties (vamParty equivalent) across all group company DBs.
// Each company has its own MySQL DB so we UNION ALL across mParty tables.
// vamParty is a pass-through view of mParty; querying mParty directly is equivalent and safe.
// Returns pkPartyID, pName, pCode, fkCompID (Party Name, Party Code, Company Code).
router.get('/vam', requireAuth, async (req, res) => {
  try {
    const { groupID } = req.user;
    const companies = connectionManager.getGroupCompanyDetails(groupID);

    let sql;
    if (companies.length > 1) {
      const parts = companies.map(({ dbName }) =>
        `SELECT pkPartyID, pName, pCode, fkCompID ` +
        `FROM \`${dbName}\`.mParty WHERE Active = 'Y'`
      );
      sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) _p ORDER BY pName ASC`;
    } else {
      sql = `SELECT pkPartyID, pName, pCode, fkCompID FROM mParty WHERE Active = 'Y' ORDER BY pName ASC`;
    }

    const rows = await req.db.query(sql, { type: QueryTypes.SELECT });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to load parties' }); }
});

// GET /api/masters/parties/:id/contract-rates
// Returns active contract rates (ToDt IS NULL, Active='Y') for the party — view only.
router.get('/:id/contract-rates', requirePermission('PARTY', 'CanView'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT rc.pkRateChartID, rc.RateType, rc.TransType, rc.PackingType,
              rc.FromDt, rc.UnitFrom, rc.UnitTo,
              rc.ChargeType, rc.HamaliCode, rc.BillRate, rc.LabourRate, rc.Note,
              i.iName AS ItemName
       FROM   RateChart rc
       LEFT JOIN mItem i ON i.pkItemID = rc.fkItemID
       WHERE  rc.fkPartyID = ? AND rc.fkCompID = ? AND rc.ToDt IS NULL AND rc.Active = 'Y'
       ORDER  BY rc.RateType, rc.TransType, rc.PackingType`,
      { replacements: [req.params.id, req.user.compID] }
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to load contract rates' });
  }
});

// GET /api/masters/parties/:id/godown-links
// Returns active godown links (ToDt IS NULL, Active='Y') for the party — view only.
router.get('/:id/godown-links', requirePermission('PARTY', 'CanView'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT gl.pkLinkID, gl.LinkType, gl.FromDt, gl.Note,
              g.gNum AS GodownNum,
              COALESCE(vc.VCData, gl.LinkType) AS LinkTypeName
       FROM   PartyGodownLink gl
       LEFT JOIN mGodown g ON g.pkGodownID = gl.fkGodownID
       LEFT JOIN VCComboData vc
              ON vc.VCCode     = gl.LinkType
             AND vc.VCPurpose  = 'LinkType'
             AND vc.fkCompID   = gl.fkCompID
             AND vc.fkBranchID = ?
             AND vc.VCActive   = 'Y'
       WHERE  gl.fkPartyID = ? AND gl.fkCompID = ? AND gl.ToDt IS NULL AND gl.Active = 'Y'
       ORDER  BY COALESCE(vc.VCData, gl.LinkType), g.gNum, gl.FromDt`,
      { replacements: [req.user.branchID, req.params.id, req.user.compID] }
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to load godown links' });
  }
});

// GET /api/masters/parties/:id
router.get('/:id', requirePermission('PARTY', 'CanView'), async (req, res) => {
  try {
    const Party = defineParty(req.db);
    const row   = await Party.findOne({ where: { pkPartyID: req.params.id, fkCompID: req.user.compID } });
    if (!row) return res.status(404).json({ error: 'Party not found' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Failed to load party' }); }
});

// POST /api/masters/parties
router.post('/', requirePermission('PARTY', 'CanAdd'), async (req, res) => {
  const { pCode, pAlias, pName, pGroup, pRef, pBillType, pEmail, pBillAdd,
          pStartDate, pLotReNumFlg, StFlagGodRent, StFlagTrans, pLotType,
          GSTNo, fkStateID, pNote } = req.body;
  const gstRequired = !!req.user.isPrimary;
  if (!pCode || !pAlias || !pGroup || !pBillType || !pStartDate || !pLotType || !fkStateID ||
      (gstRequired && !GSTNo))
    return res.status(400).json({ error: 'Code, Alias, Group, BillType, StartDate, LotType and State are required' });
  if (GSTNo && !GSTIN_REGEX.test(GSTNo.trim().toUpperCase()))
    return res.status(400).json({ error: 'Invalid GSTIN format. Expected 15 chars e.g. 22AAAAA0000A1Z5' });
  try {
    const Party  = defineParty(req.db);
    const { compID, branchID } = req.user;
    const dupPName = await Party.findOne({ where: { fkCompID: compID, pName: (pName || '').trim().toUpperCase() } });
    if (dupPName && (pName || '').trim()) return res.status(409).json({ error: `Party Name '${(pName || '').trim()}' already exists` });
    const dupCode = await Party.findOne({ where: { fkCompID: compID, pCode: pCode.trim().toUpperCase() } });
    if (dupCode) return res.status(409).json({ error: `Party Code '${pCode.trim()}' already exists` });
    const dupAlias = await Party.findOne({ where: { fkCompID: compID, pAlias: pAlias.trim().toUpperCase() } });
    if (dupAlias) return res.status(409).json({ error: `Party Short Name '${pAlias.trim()}' already exists` });
    const serialKey = `${compID}!${branchID}!MPARTY!PKPARTYID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Party ID', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Party ID' });
    const row    = await Party.create({
      pkPartyID:     buildSerialKey(compID, branchID, n),
      PartyID:       n,
      fkCompID:      req.user.compID,
      fkBranchID:    req.user.branchID,
      pCode:         pCode.trim().toUpperCase(),
      pAlias:        pAlias.trim().toUpperCase(),
      pName:         (pName || '').trim().toUpperCase(),
      pGroup:        pGroup.trim().toUpperCase(),
      pRef:          (pRef || '').trim(),
      pBillType:     pBillType.trim(),
      pEmail:        (pEmail || '').trim(),
      pBillAdd:      pBillAdd || '',
      pStartDate:    new Date(pStartDate),
      pLotReNumFlg:  pLotReNumFlg ? 'Y' : 'N',
      StFlagGodRent: StFlagGodRent ? 'Y' : 'N',
      StFlagTrans:   StFlagTrans   ? 'Y' : 'N',
      pLotType:      pLotType.trim(),
      GSTNo:         GSTNo ? GSTNo.trim().toUpperCase() : '',
      fkStateID:     String(fkStateID).trim(),
      pNote:         pNote || '',
      Active:        'Y',
      fkUserID:      req.user.userId,
      CrMod:         new Date(),
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Duplicate party code or alias' });
    res.status(500).json({ error: err.message || 'Failed to create party' });
  }
});

// PUT /api/masters/parties/:id
router.put('/:id', requirePermission('PARTY', 'CanEdit'), async (req, res) => {
  const { pCode, pAlias, pName, pGroup, pRef, pBillType, pEmail, pBillAdd,
          pStartDate, pLotReNumFlg, StFlagGodRent, StFlagTrans, pLotType,
          GSTNo, fkStateID, pNote, Active } = req.body;
  const gstRequired = !!req.user.isPrimary;
  if (!pCode || !pAlias || !pGroup || !pBillType || !pStartDate || !pLotType || !fkStateID ||
      (gstRequired && !GSTNo))
    return res.status(400).json({ error: 'Code, Alias, Group, BillType, StartDate, LotType and State are required' });
  if (GSTNo && !GSTIN_REGEX.test(GSTNo.trim().toUpperCase()))
    return res.status(400).json({ error: 'Invalid GSTIN format. Expected 15 chars e.g. 22AAAAA0000A1Z5' });
  try {
    const Party = defineParty(req.db);
    const dupPName = await Party.findOne({ where: { fkCompID: req.user.compID, pName: (pName || '').trim().toUpperCase(), pkPartyID: { [Op.ne]: req.params.id } } });
    if (dupPName && (pName || '').trim()) return res.status(409).json({ error: `Party Name '${(pName || '').trim()}' already exists` });
    const dupCode = await Party.findOne({ where: { fkCompID: req.user.compID, pCode: pCode.trim().toUpperCase(), pkPartyID: { [Op.ne]: req.params.id } } });
    if (dupCode) return res.status(409).json({ error: `Party Code '${pCode.trim()}' already exists` });
    const dupAlias = await Party.findOne({ where: { fkCompID: req.user.compID, pAlias: pAlias.trim().toUpperCase(), pkPartyID: { [Op.ne]: req.params.id } } });
    if (dupAlias) return res.status(409).json({ error: `Party Short Name '${pAlias.trim()}' already exists` });
    const [n]   = await Party.update({
      pCode:         pCode.trim().toUpperCase(),
      pAlias:        pAlias.trim().toUpperCase(),
      pName:         (pName || '').trim().toUpperCase(),
      pGroup:        pGroup.trim().toUpperCase(),
      pRef:          (pRef || '').trim(),
      pBillType:     pBillType.trim(),
      pEmail:        (pEmail || '').trim(),
      pBillAdd:      pBillAdd || '',
      pStartDate:    new Date(pStartDate),
      pLotReNumFlg:  pLotReNumFlg ? 'Y' : 'N',
      StFlagGodRent: StFlagGodRent ? 'Y' : 'N',
      StFlagTrans:   StFlagTrans   ? 'Y' : 'N',
      pLotType:      pLotType.trim(),
      GSTNo:         GSTNo ? GSTNo.trim().toUpperCase() : '',
      fkStateID:     String(fkStateID).trim(),
      pNote:         pNote || '',
      Active:        Active || 'Y',
      CrMod:         new Date(),
    }, { where: { pkPartyID: req.params.id, fkCompID: req.user.compID } });
    if (n === 0) return res.status(404).json({ error: 'Party not found' });
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to update party' }); }
});

// DELETE /api/masters/parties/:id -- soft delete
router.delete('/:id', requirePermission('PARTY', 'CanDelete'), async (req, res) => {
  try {
    const Party = defineParty(req.db);
    const [n]   = await Party.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkPartyID: req.params.id, fkCompID: req.user.compID } }
    );
    if (n === 0) return res.status(404).json({ error: 'Party not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete party' }); }
});

module.exports = router;
