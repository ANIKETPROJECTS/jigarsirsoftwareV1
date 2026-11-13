// ─────────────────────────────────────────────────────────────────────────────
// docFile.js  —  /api/masters/docfiles
//
// CRUD + file upload for the DocumentsFile master.
// Files stored at: backend/uploads/Documents/DocFiles/
// Served statically at:  /uploads/Documents/DocFiles/<filename>
//
// ROUTES:
//   GET    /api/masters/docfiles/doctypes   — distinct DocType values (combo)
//   GET    /api/masters/docfiles            — list all docs for company (with party/godown JOIN)
//   GET    /api/masters/docfiles/:id        — single record
//   POST   /api/masters/docfiles            — create + file upload (multipart/form-data)
//   PUT    /api/masters/docfiles/:id        — update (file re-upload optional)
//   DELETE /api/masters/docfiles/:id        — hard delete: DB row + physical file
// ─────────────────────────────────────────────────────────────────────────────
const router              = require('express').Router();
const multer              = require('multer');
const path                = require('path');
const fs                  = require('fs');
const sharp               = require('sharp');
const { PDFDocument }     = require('pdf-lib');
const requireAuth         = require('../../middleware/auth');
const requirePermission   = require('../../middleware/permission');
const { gudfGenSerialID } = require('../../utils/serialID');
const defineDocumentsFile = require('../../models/company/DocumentsFile');

const DOC_FILES_DIR = path.join(__dirname, '../../../uploads/Documents/DocFiles');
const DOC_MAX_BYTES = 300 * 1024; // 300 KB target

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Multer: accept images + PDFs, memory storage ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB hard ceiling before compression
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images and PDF files are allowed'), ok);
  },
});

// ── Compression helpers ───────────────────────────────────────────────────────

// Compress image to ≤300 KB using progressive quality reduction then scaling.
async function compressDocImage(buffer) {
  if (buffer.length <= DOC_MAX_BYTES) return { buffer, ext: null };
  for (const quality of [88, 75, 62, 50]) {
    const out = await sharp(buffer).jpeg({ quality, progressive: true }).toBuffer();
    if (out.length <= DOC_MAX_BYTES) return { buffer: out, ext: '.jpg' };
  }
  const { width = 1920 } = await sharp(buffer).metadata();
  for (const scale of [0.8, 0.65, 0.5]) {
    const out = await sharp(buffer)
      .resize(Math.round(width * scale))
      .jpeg({ quality: 65, progressive: true })
      .toBuffer();
    if (out.length <= DOC_MAX_BYTES) return { buffer: out, ext: '.jpg' };
  }
  // Last resort: resize to 1400px wide
  const out = await sharp(buffer).resize(1400).jpeg({ quality: 55, progressive: true }).toBuffer();
  return { buffer: out, ext: '.jpg' };
}

// Lossless PDF structural optimisation via pdf-lib.
// Only the cross-reference table is compressed — content streams (images,
// fonts, page data) are never modified, so the original layout and quality
// are fully preserved.  Size reduction is typically small (a few %).
// If pdf-lib fails or the result is larger, the original buffer is returned.
async function compressDocPDF(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const out  = Buffer.from(await doc.save({ useObjectStreams: true }));
    return out.length < buffer.length ? out : buffer;
  } catch {
    return buffer;
  }
}

// ── Filename builder ──────────────────────────────────────────────────────────
// Format: DocType_PartyNameOrGodownNum_MMMYYYY_N.ext
// N = the numeric suffix of pkDocID to guarantee uniqueness.
function buildFileName(docType, suffix, toDt, pkDocID, ext) {
  const dt  = new Date(toDt);
  const mon = MONTHS[dt.getMonth()] || 'UNK';
  const yr  = dt.getFullYear();
  // Extract numeric tail from pkDocID (e.g. 'BHW!3' → '3')
  const tail = String(pkDocID).split('!').pop();
  const base = [
    String(docType || 'DOC').replace(/[^a-zA-Z0-9]/g, '_'),
    String(suffix  || 'GENDOC').replace(/[^a-zA-Z0-9]/g, '_'),
    `${mon}${yr}`,
    tail,
  ].join('_');
  return base.slice(0, 190) + ext;
}

// Sanitise a file extension from mimetype
function mimeToExt(mimetype) {
  if (mimetype === 'application/pdf') return '.pdf';
  if (mimetype === 'image/png')       return '.png';
  if (mimetype === 'image/gif')       return '.gif';
  if (mimetype === 'image/webp')      return '.webp';
  return '.jpg';
}

router.use(requireAuth);

// ── GET /doctypes ─────────────────────────────────────────────────────────────
// Returns sorted unique DocType values already saved for this company.
// Used to pre-populate the freeSolo Autocomplete in the form.
router.get('/doctypes', requirePermission('DOCUMENTS', 'CanView'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT DISTINCT DocType FROM DocumentsFile
       WHERE fkCompID = ? AND Active = 'Y'
       ORDER BY DocType ASC`,
      { replacements: [req.user.compID] }
    );
    res.json(rows.map((r) => r.DocType));
  } catch {
    res.status(500).json({ error: 'Failed to load doc types' });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
// List all documents for the company. JOINs party and godown for display names.
// Optional filters: ?docType= ?active=Y
router.get('/', requirePermission('DOCUMENTS', 'CanView'), async (req, res) => {
  try {
    const { docType, active } = req.query;
    const conditions = ['d.fkCompID = ?'];
    const params     = [req.user.compID];

    if (docType) { conditions.push('d.DocType = ?'); params.push(docType); }
    if (active)  { conditions.push('d.Active = ?');  params.push(active); }

    const [rows] = await req.db.query(
      `SELECT d.*,
              p.pName  AS PartyName,
              g.gNum   AS GodownNum
       FROM DocumentsFile d
       LEFT JOIN mParty  p ON p.pkPartyID  = d.fkPartyID
       LEFT JOIN mGodown g ON g.pkGodownID = d.fkGodownID
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.CrMod DESC`,
      { replacements: params }
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission('DOCUMENTS', 'CanView'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT d.*,
              p.pName  AS PartyName,
              g.gNum   AS GodownNum
       FROM DocumentsFile d
       LEFT JOIN mParty  p ON p.pkPartyID  = d.fkPartyID
       LEFT JOIN mGodown g ON g.pkGodownID = d.fkGodownID
       WHERE d.pkDocID = ? AND d.fkCompID = ?
       LIMIT 1`,
      { replacements: [req.params.id, req.user.compID] }
    );
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load document' });
  }
});

// ── POST / ───────────────────────────────────────────────────────────────────
// Create a new document record + upload file.
// Expects multipart/form-data with field "docFile" for the file.
router.post('/', requirePermission('DOCUMENTS', 'CanAdd'), upload.single('docFile'), async (req, res) => {
  const { DocType, DocDiscrption, fkPartyID, fkGodownID, FromDt, ToDt, Note, Active } = req.body;

  if (!DocType)       return res.status(400).json({ error: 'Doc Type is required' });
  if (!DocDiscrption) return res.status(400).json({ error: 'Description is required' });
  if (!FromDt)        return res.status(400).json({ error: 'From Date is required' });
  if (!ToDt)          return res.status(400).json({ error: 'To Date is required' });
  if (!req.file)      return res.status(400).json({ error: 'Please upload a file' });
  if (FromDt > ToDt)  return res.status(400).json({ error: 'From Date cannot be after To Date' });

  const { groupID, branchID, compID } = req.user;

  try {
    // Generate PK
    const serialKey = `${groupID}!${branchID}!DocumentsFile!pkDocID`;
    const n = await gudfGenSerialID(req.db, serialKey, 'Document File PK', 'Y');
    if (n === -1) return res.status(500).json({ error: 'Failed to generate Document ID' });
    const pkDocID = `${groupID}!${n}`;

    // Resolve display name for filename (party name OR godown num OR GENDOC)
    let filenameSuffix = 'GENDOC';
    if (fkPartyID) {
      const [pRows] = await req.db.query(
        'SELECT pName FROM mParty WHERE pkPartyID = ? LIMIT 1',
        { replacements: [fkPartyID] }
      );
      if (pRows.length) filenameSuffix = pRows[0].pName;
    } else if (fkGodownID) {
      const [gRows] = await req.db.query(
        'SELECT gNum FROM mGodown WHERE pkGodownID = ? LIMIT 1',
        { replacements: [fkGodownID] }
      );
      if (gRows.length) filenameSuffix = gRows[0].gNum;
    }

    // Compress file and determine final extension
    let fileBuffer;
    let finalExt;
    if (req.file.mimetype === 'application/pdf') {
      fileBuffer = await compressDocPDF(req.file.buffer);
      finalExt   = '.pdf';
    } else {
      const result = await compressDocImage(req.file.buffer);
      fileBuffer   = result.buffer;
      finalExt     = result.ext || mimeToExt(req.file.mimetype);
    }

    // Build filename and save to disk
    const fileName = buildFileName(DocType, filenameSuffix, ToDt, pkDocID, finalExt);
    fs.mkdirSync(DOC_FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOC_FILES_DIR, fileName), fileBuffer);

    // Insert DB record
    const DocFile = defineDocumentsFile(req.db);
    const record = {
      pkDocID,
      fkCompID:      compID,
      DocType:       DocType.trim(),
      DocDiscrption: DocDiscrption.trim(),
      fkPartyID:     fkPartyID  || null,
      fkGodownID:    fkGodownID || null,
      FromDt,
      ToDt,
      FileName:      fileName,
      Note:          Note || null,
      Active:        Active || 'Y',
      fkUserID:      req.user.userId,
      CrMod:         new Date(),
    };

    const row = await DocFile.create(record);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save document' });
  }
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────
// Update an existing document. File re-upload is optional.
// If a new file is supplied, the old file is deleted from disk.
router.put('/:id', requirePermission('DOCUMENTS', 'CanEdit'), upload.single('docFile'), async (req, res) => {
  const { DocType, DocDiscrption, fkPartyID, fkGodownID, FromDt, ToDt, Note, Active } = req.body;

  if (!DocType)       return res.status(400).json({ error: 'Doc Type is required' });
  if (!DocDiscrption) return res.status(400).json({ error: 'Description is required' });
  if (!FromDt)        return res.status(400).json({ error: 'From Date is required' });
  if (!ToDt)          return res.status(400).json({ error: 'To Date is required' });
  if (FromDt > ToDt)  return res.status(400).json({ error: 'From Date cannot be after To Date' });

  try {
    // Fetch existing record to get old filename
    const [existing] = await req.db.query(
      'SELECT pkDocID, FileName FROM DocumentsFile WHERE pkDocID = ? AND fkCompID = ? LIMIT 1',
      { replacements: [req.params.id, req.user.compID] }
    );
    if (!existing.length) return res.status(404).json({ error: 'Document not found' });

    const updates = {
      DocType:       DocType.trim(),
      DocDiscrption: DocDiscrption.trim(),
      fkPartyID:     fkPartyID  || null,
      fkGodownID:    fkGodownID || null,
      FromDt,
      ToDt,
      Note:          Note || null,
      Active:        Active || 'Y',
      fkUserID:      req.user.userId,
      CrMod:         new Date(),
    };

    if (req.file) {
      // Resolve suffix for new filename
      let filenameSuffix = 'GENDOC';
      if (fkPartyID) {
        const [pRows] = await req.db.query(
          'SELECT pName FROM mParty WHERE pkPartyID = ? LIMIT 1',
          { replacements: [fkPartyID] }
        );
        if (pRows.length) filenameSuffix = pRows[0].pName;
      } else if (fkGodownID) {
        const [gRows] = await req.db.query(
          'SELECT gNum FROM mGodown WHERE pkGodownID = ? LIMIT 1',
          { replacements: [fkGodownID] }
        );
        if (gRows.length) filenameSuffix = gRows[0].gNum;
      }

      let fileBuffer;
      let finalExt;
      if (req.file.mimetype === 'application/pdf') {
        fileBuffer = await compressDocPDF(req.file.buffer);
        finalExt   = '.pdf';
      } else {
        const result = await compressDocImage(req.file.buffer);
        fileBuffer   = result.buffer;
        finalExt     = result.ext || mimeToExt(req.file.mimetype);
      }

      const fileName    = buildFileName(DocType, filenameSuffix, ToDt, req.params.id, finalExt);
      const oldFileName = existing[0].FileName;

      fs.mkdirSync(DOC_FILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(DOC_FILES_DIR, fileName), fileBuffer);

      // Only delete the old file if the name changed; if same name, the write
      // above already replaced the content in-place — deleting would remove it.
      if (oldFileName !== fileName) {
        const oldPath = path.join(DOC_FILES_DIR, oldFileName);
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
      }

      updates.FileName = fileName;
    }

    const DocFile = defineDocumentsFile(req.db);
    const [n] = await DocFile.update(updates, {
      where: { pkDocID: req.params.id, fkCompID: req.user.compID },
    });
    if (n === 0) return res.status(404).json({ error: 'Document not found' });

    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update document' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// Hard delete: removes the DB row AND the physical file from disk.
router.delete('/:id', requirePermission('DOCUMENTS', 'CanDelete'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT FileName FROM DocumentsFile WHERE pkDocID = ? AND fkCompID = ? LIMIT 1',
      { replacements: [req.params.id, req.user.compID] }
    );
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(DOC_FILES_DIR, rows[0].FileName);

    // Remove DB row first
    const DocFile = defineDocumentsFile(req.db);
    await DocFile.destroy({ where: { pkDocID: req.params.id, fkCompID: req.user.compID } });

    // Then remove physical file (best-effort: don't fail if file is already gone)
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete document' });
  }
});

module.exports = router;
