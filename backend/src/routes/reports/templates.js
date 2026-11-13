// Report Templates — /api/reports/templates
//
// CRUD for VCTemplate rows (per company, per report type).
// Access: requireAuth only — called from within report pages that
// have already checked their own module permission (e.g. BAL_REP).
//
// cpkTemplID format: compID!branchID!N  (e.g. ADS!HO!1)
// SerialID key:      compID!branchID!TEMPLATEID!PKTEMPLID
//
// All DB operations use raw SQL (db.query) instead of Sequelize ORM to avoid:
//   - bulkCreate silently dropping rows on composite-PK tables
//   - findAll returning TEXT columns as Buffer objects with raw:true

const router      = require('express').Router();
const requireAuth = require('../../middleware/auth');
const defineVCTemplate = require('../../models/company/VCTemplate');  // kept for auto-sync only
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');

router.use(requireAuth);

// ── GET / — list templates for a report type ───────────────────────────────────
// Query param: ?repName=BAL_REP
router.get('/', async (req, res) => {
  try {
    const db      = req.db;
    const compID  = req.user.compID;
    const repName = req.query.repName || 'BAL_REP';

    defineVCTemplate(db);   // triggers model.sync() → auto-creates table if missing

    const [rows] = await db.query(
      `SELECT cpkTemplID, Template_Name, Template_Desc
       FROM VCTemplate
       WHERE fkCompID = ? AND Rep_Name = ?
       GROUP BY cpkTemplID, Template_Name, Template_Desc
       ORDER BY Template_Name`,
      { replacements: [compID, repName] }
    );

    res.json(rows);
  } catch (err) {
    console.error('[Templates list]', err.message);
    res.status(500).json({ error: `Failed to load templates: ${err.message}` });
  }
});


// ── GET /:id — fetch all rows for one template ────────────────────────────────
// Returns structured filters + printSettings the frontend can apply directly.
router.get('/:id', async (req, res) => {
  try {
    const db      = req.db;
    const compID  = req.user.compID;
    const templID = req.params.id;

    // Raw SQL avoids Sequelize returning TEXT columns as Buffer objects
    const [rows] = await db.query(
      `SELECT cpkSrno, Template_Name, Template_Desc, Rep_Name,
              Field_Name, Operator, Field_Value
       FROM VCTemplate
       WHERE cpkTemplID = ? AND fkCompID = ?
       ORDER BY cpkSrno ASC`,
      { replacements: [templID, compID] }
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    // Field_Value is stored as JSON string — parse each row back to its native type
    const parsed = rows.map((r) => {
      let value = r.Field_Value;
      try { value = JSON.parse(String(r.Field_Value)); } catch { /* leave as raw string */ }
      return { ...r, Field_Value: value };
    });

    const printRow   = parsed.find((r) => r.Field_Name === 'Print_Settings');
    const reportType = parsed.find((r) => r.Field_Name === 'reportType')?.Field_Value || 'party-bal-detail';

    // Build filters map: { pGroup: [...], fkPartyID: [...], ... }
    const filters = {};
    parsed.forEach((r) => {
      if (r.Field_Name && r.Field_Name !== 'reportType' && r.Field_Name !== 'Print_Settings') {
        filters[r.Field_Name] = r.Field_Value;
      }
    });

    res.json({
      cpkTemplID:    templID,
      Template_Name: rows[0].Template_Name,
      Template_Desc: rows[0].Template_Desc,
      Rep_Name:      rows[0].Rep_Name,
      reportType,
      filters,
      printSettings: printRow?.Field_Value || {},
    });
  } catch (err) {
    console.error('[Templates fetch]', err.message);
    res.status(500).json({ error: `Failed to load template: ${err.message}` });
  }
});


// ── POST / — save a new template ──────────────────────────────────────────────
// Body: { templateName, templateDesc?, repName, reportType, filters, printSettings, replaceId? }
//
// One logical template = N rows in VCTemplate:
//   Row 0: Field_Name='reportType'
//   Row 1..N-1: one row per filter that has selections (pGroup, fkPartyID, fkItemID, fkGodownID1)
//   Last row: Field_Name='Print_Settings'
router.post('/', async (req, res) => {
  try {
    const db       = req.db;
    const compID   = req.user.compID;
    const branchID = req.user.branchID;
    const {
      templateName,
      templateDesc  = '',
      repName       = 'BAL_REP',
      reportType    = 'party-bal-detail',
      filters       = {},
      printSettings = {},
      replaceId,
    } = req.body;

    if (!templateName) return res.status(400).json({ error: 'templateName is required' });

    defineVCTemplate(db);   // ensure table exists

    // Delete existing rows when replacing
    if (replaceId) {
      await db.query(
        'DELETE FROM VCTemplate WHERE cpkTemplID = ? AND fkCompID = ?',
        { replacements: [replaceId, compID] }
      );
    }

    // Sequential cpkTemplID: ADS!HO!1, ADS!HO!2, …
    let templID = replaceId;
    if (!templID) {
      const serialKey = `${compID}!${branchID}!TEMPLATEID!PKTEMPLID`;
      const n = await gudfGenSerialID(db, serialKey, 'Template ID', 'Y');
      if (n === -1) return res.status(500).json({ error: 'Failed to generate Template ID' });
      templID = buildSerialKey(compID, branchID, n);
    }

    // Build rows array
    const toInsert = [];
    let srno = 0;
    const addRow = (fieldName, operator, fieldValue) => {
      toInsert.push([
        templID,
        srno++,
        compID,
        branchID,
        templateName,
        templateDesc,
        repName,
        fieldName,
        operator,
        JSON.stringify(fieldValue),
      ]);
    };

    addRow('reportType', 'EQ', reportType);

    ['pGroup', 'fkPartyID', 'fkItemID', 'fkGodownID1'].forEach((field) => {
      const ids = filters[field];
      if (Array.isArray(ids) && ids.length > 0) addRow(field, 'IN', ids);
    });

    addRow('Print_Settings', 'SETTINGS', printSettings);

    // Raw multi-row INSERT — reliable with composite PKs, avoids bulkCreate issues
    const colList = 'cpkTemplID, cpkSrno, fkCompID, fkBranchID, Template_Name, Template_Desc, Rep_Name, Field_Name, Operator, Field_Value';
    const placeholders = toInsert.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(', ');
    await db.query(
      `INSERT INTO VCTemplate (${colList}) VALUES ${placeholders}`,
      { replacements: toInsert.flat() }
    );

    res.json({ success: true, cpkTemplID: templID, rows: toInsert.length });
  } catch (err) {
    console.error('[Templates save]', err.message);
    res.status(500).json({ error: `Failed to save template: ${err.message}` });
  }
});


// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db      = req.db;
    const compID  = req.user.compID;
    const templID = req.params.id;

    const [result] = await db.query(
      'DELETE FROM VCTemplate WHERE cpkTemplID = ? AND fkCompID = ?',
      { replacements: [templID, compID] }
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error('[Templates delete]', err.message);
    res.status(500).json({ error: `Failed to delete template: ${err.message}` });
  }
});

module.exports = router;
