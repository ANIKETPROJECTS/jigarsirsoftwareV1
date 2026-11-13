// uploads.js — File upload / retrieval for GMS documents
//
// Folder layout on disk:
//   backend/uploads/Documents/
//     PickupPhotos/{faYear}/           → {CompCode}{GatePass}{FaYear}.jpg
//                                          e.g.  ADS12026-2027.jpg
//     TransDocuments/{faYear}/         → {pkTransID}_{serial}.{ext}
//                                          e.g.  ADS!HO!234_1.pdf
//                                          (arrival AND dispatch/transfer documents — merged)
//     StockPhotos/{faYear}/{monthYear}/→ {LotNum}_{serial}.jpg
//                                          e.g.  AD26023_1.jpg
//
// faYear  : full-year string  e.g. '2026-2027'
// monthYear: Mon+YY string    e.g. 'Apr26'
//
// Endpoints:
//   POST/GET/DELETE /pickup-photo
//   POST/GET/DELETE /trans-docs
//   POST/GET/DELETE /arrival
//   POST/GET/DELETE /stock-photos
//   POST            /check-dispatch-docs  — bulk existence check (dispatch list)
//   POST            /check-lots           — bulk existence check (balance report)

const router      = require('express').Router();
const multer      = require('multer');
const path        = require('path');
const fs          = require('fs');
const sharp       = require('sharp');
const { PDFDocument } = require('pdf-lib');
const requireAuth = require('../middleware/auth');

const DOCS_ROOT       = path.join(__dirname, '../../uploads/Documents');
const IMAGE_MAX_BYTES = 100 * 1024;        // 100 KB target
const PDF_MAX_BYTES   =   1 * 1024 * 1024; // 1 MB target

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extension from mime type
function fileExt(mimetype) {
  if (mimetype === 'application/pdf') return '.pdf';
  if (mimetype === 'image/jpeg')      return '.jpg';
  if (mimetype === 'image/png')       return '.png';
  if (mimetype === 'image/gif')       return '.gif';
  if (mimetype === 'image/webp')      return '.webp';
  return '.jpg';
}

// Sanitise a path segment used as a folder name (faYear, monthYear, compCode …).
// Allows letters, digits, hyphen, underscore only.
function safeSeg(s) {
  return String(s || '').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 50);
}

// Compress image to ≤100 KB.
async function compressImage(buffer) {
  if (buffer.length <= IMAGE_MAX_BYTES) return { buffer, ext: null };
  for (const quality of [82, 68, 55, 42]) {
    const out = await sharp(buffer).jpeg({ quality, progressive: true }).toBuffer();
    if (out.length <= IMAGE_MAX_BYTES) return { buffer: out, ext: '.jpg' };
  }
  const { width = 1280 } = await sharp(buffer).metadata();
  for (const scale of [0.75, 0.55, 0.4]) {
    const out = await sharp(buffer)
      .resize(Math.round(width * scale))
      .jpeg({ quality: 60, progressive: true })
      .toBuffer();
    if (out.length <= IMAGE_MAX_BYTES) return { buffer: out, ext: '.jpg' };
  }
  const out = await sharp(buffer).resize(800).jpeg({ quality: 50, progressive: true }).toBuffer();
  return { buffer: out, ext: '.jpg' };
}

// Compress PDF to ≤1 MB via pdf-lib Flate recompression.
async function compressPDF(buffer) {
  if (buffer.length <= PDF_MAX_BYTES) return buffer;
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const out  = Buffer.from(await doc.save());
    return out.length < buffer.length ? out : buffer;
  } catch {
    return buffer;
  }
}

// Next serial number: count existing files in dir whose basename starts with prefix.
function nextSerial(dir, prefix) {
  let existing = [];
  try { existing = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)); } catch {}
  return existing.length + 1;
}

// Multer instance for images + PDFs
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images and PDFs are allowed'), ok);
  },
});

// Multer instance for images only (stock photos)
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('Only images allowed for stock photos'), ok);
  },
});

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// 1. PICKUP PHOTOS  (dispatch gate-pass photos)
// ─────────────────────────────────────────────────────────────────────────────
//
// Dir : PickupPhotos/{faYear}/
// File: {CompCode}{GatePass}{FaYear}.jpg   e.g. ADS12026-2027.jpg
//
// Body / Query params:  compCode, gatePass, faYear

function pickupPhotoFilename(compCode, gatePass, faYear) {
  return `${safeSeg(compCode)}${gatePass}${safeSeg(faYear)}.jpg`;
}

function pickupPhotoDir(faYear) {
  return path.join(DOCS_ROOT, 'PickupPhotos', safeSeg(faYear));
}

// POST /api/uploads/pickup-photo
router.post('/pickup-photo', upload.single('photo'), async (req, res) => {
  const { compCode, gatePass, faYear } = req.body;
  if (!compCode || !gatePass || !faYear)
    return res.status(400).json({ error: 'compCode, gatePass and faYear required' });
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  const dir = pickupPhotoDir(faYear);
  fs.mkdirSync(dir, { recursive: true });

  // Compress and always save as .jpg
  const compressed = await compressImage(req.file.buffer);
  const buf        = compressed.buffer;
  const filename   = pickupPhotoFilename(compCode, gatePass, faYear);
  fs.writeFileSync(path.join(dir, filename), buf);

  res.json({
    filename,
    url: `/uploads/Documents/PickupPhotos/${safeSeg(faYear)}/${filename}`,
  });
});

// GET /api/uploads/pickup-photo?compCode=&gatePass=&faYear=
router.get('/pickup-photo', (req, res) => {
  const { compCode, gatePass, faYear } = req.query;
  if (!compCode || !gatePass || !faYear)
    return res.status(400).json({ error: 'compCode, gatePass and faYear required' });

  const dir      = pickupPhotoDir(faYear);
  const filename = pickupPhotoFilename(compCode, gatePass, faYear);
  const exists   = fs.existsSync(path.join(dir, filename));

  res.json({
    url: exists ? `/uploads/Documents/PickupPhotos/${safeSeg(faYear)}/${filename}` : null,
  });
});

// DELETE /api/uploads/pickup-photo?compCode=&gatePass=&faYear=
router.delete('/pickup-photo', (req, res) => {
  const { compCode, gatePass, faYear } = req.query;
  if (!compCode || !gatePass || !faYear)
    return res.status(400).json({ error: 'compCode, gatePass and faYear required' });

  const filename = pickupPhotoFilename(compCode, gatePass, faYear);
  const filePath = path.join(pickupPhotoDir(faYear), filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
  res.json({ deleted: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TRANSACTION DOCUMENTS  (dispatch / transfer / out)
// ─────────────────────────────────────────────────────────────────────────────
//
// Dir : TransDocuments/{faYear}/
// File: {pkTransID}_{serial}.{ext}   e.g. ADS!HO!234_1.pdf
//
// Body / Query params:  transID, faYear

function transDocsDir(faYear) {
  return path.join(DOCS_ROOT, 'TransDocuments', safeSeg(faYear));
}

// POST /api/uploads/trans-docs
router.post('/trans-docs', upload.single('file'), async (req, res) => {
  const { transID, faYear } = req.body;
  if (!transID || !faYear) return res.status(400).json({ error: 'transID and faYear required' });
  if (!req.file)           return res.status(400).json({ error: 'No file uploaded' });

  const dir = transDocsDir(faYear);
  fs.mkdirSync(dir, { recursive: true });

  const prefix = `${transID}_`;
  const serial  = nextSerial(dir, prefix);

  let buf = req.file.buffer;
  let ext = fileExt(req.file.mimetype);
  if (req.file.mimetype === 'application/pdf') {
    buf = await compressPDF(buf);
  } else {
    const compressed = await compressImage(buf);
    buf = compressed.buffer;
    if (compressed.ext) ext = compressed.ext;
  }

  const filename = `${transID}_${serial}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  res.json({
    filename,
    serial,
    url: `/uploads/Documents/TransDocuments/${safeSeg(faYear)}/${filename}`,
  });
});

// GET /api/uploads/trans-docs?transID=&faYear= (faYear optional — omit to scan all years)
router.get('/trans-docs', (req, res) => {
  const { transID, faYear } = req.query;
  if (!transID) return res.status(400).json({ error: 'transID required' });

  const prefix = `${transID}_`;
  const sortFiles = (a, b) => {
    const na = parseInt(a.replace(/.*_(\d+)\..*/, '$1'), 10);
    const nb = parseInt(b.replace(/.*_(\d+)\..*/, '$1'), 10);
    return na - nb;
  };

  if (faYear) {
    const dir = transDocsDir(faYear);
    const fy  = safeSeg(faYear);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort(sortFiles); } catch {}
    return res.json(files.map((f) => ({ filename: f, url: `/uploads/Documents/TransDocuments/${fy}/${f}` })));
  }

  // Scan all year subdirs
  const baseDir = path.join(DOCS_ROOT, 'TransDocuments');
  const results = [];
  try {
    for (const fy of fs.readdirSync(baseDir)) {
      const fyDir = path.join(baseDir, fy);
      try { if (!fs.statSync(fyDir).isDirectory()) continue; } catch { continue; }
      try {
        fs.readdirSync(fyDir).filter((f) => f.startsWith(prefix)).sort(sortFiles)
          .forEach((f) => results.push({ filename: f, url: `/uploads/Documents/TransDocuments/${fy}/${f}` }));
      } catch {}
    }
  } catch {}
  res.json(results);
});

// DELETE /api/uploads/trans-docs?transID=&faYear=&filename=
router.delete('/trans-docs', (req, res) => {
  const { transID, faYear, filename } = req.query;
  if (!transID || !faYear || !filename)
    return res.status(400).json({ error: 'transID, faYear and filename required' });

  const safeName = path.basename(filename);
  if (!safeName.startsWith(`${transID}_`))
    return res.status(400).json({ error: 'Filename does not belong to this transaction' });

  const filePath = path.join(transDocsDir(faYear), safeName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ARRIVAL DOCUMENTS  (arrival / DespReturn / TransIn)
// ─────────────────────────────────────────────────────────────────────────────
//
// Merged into TransDocuments — same folder as dispatch/transfer documents.
// Dir : TransDocuments/{faYear}/
// File: {pkTransID}_{serial}.{ext}   e.g. ADS!HO!234_1.pdf
//
// Body / Query params:  transID, faYear

// POST /api/uploads/arrival
router.post('/arrival', upload.single('file'), async (req, res) => {
  const { transID, faYear } = req.body;
  if (!transID || !faYear) return res.status(400).json({ error: 'transID and faYear required' });
  if (!req.file)           return res.status(400).json({ error: 'No file uploaded' });

  const dir = transDocsDir(faYear);
  fs.mkdirSync(dir, { recursive: true });

  const prefix = `${transID}_`;
  const serial  = nextSerial(dir, prefix);

  let buf = req.file.buffer;
  let ext = fileExt(req.file.mimetype);
  if (req.file.mimetype === 'application/pdf') {
    buf = await compressPDF(buf);
  } else {
    const compressed = await compressImage(buf);
    buf = compressed.buffer;
    if (compressed.ext) ext = compressed.ext;
  }

  const filename = `${transID}_${serial}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  res.json({
    filename,
    serial,
    url: `/uploads/Documents/TransDocuments/${safeSeg(faYear)}/${filename}`,
  });
});

// GET /api/uploads/arrival?transID=&faYear= (faYear optional — omit to scan all years)
// Also scans legacy ArrivalDocuments/ for backward compatibility.
router.get('/arrival', (req, res) => {
  const { transID, faYear } = req.query;
  if (!transID) return res.status(400).json({ error: 'transID required' });

  const prefix = `${transID}_`;
  const sortFiles = (a, b) => {
    const na = parseInt(a.replace(/.*_(\d+)\..*/, '$1'), 10);
    const nb = parseInt(b.replace(/.*_(\d+)\..*/, '$1'), 10);
    return na - nb;
  };

  function scanYearDirs(baseDir, folderLabel) {
    const found = [];
    try {
      for (const fy of fs.readdirSync(baseDir)) {
        const fyDir = path.join(baseDir, fy);
        try { if (!fs.statSync(fyDir).isDirectory()) continue; } catch { continue; }
        try {
          fs.readdirSync(fyDir).filter((f) => f.startsWith(prefix)).sort(sortFiles)
            .forEach((f) => found.push({ filename: f, url: `/uploads/Documents/${folderLabel}/${fy}/${f}` }));
        } catch {}
      }
    } catch {}
    return found;
  }

  if (faYear) {
    const fy = safeSeg(faYear);
    // Check TransDocuments first, then legacy ArrivalDocuments
    let files = [];
    try {
      files = fs.readdirSync(transDocsDir(faYear)).filter((f) => f.startsWith(prefix)).sort(sortFiles)
                .map((f) => ({ filename: f, url: `/uploads/Documents/TransDocuments/${fy}/${f}` }));
    } catch {}
    if (files.length === 0) {
      const legacyDir = path.join(DOCS_ROOT, 'ArrivalDocuments', fy);
      try {
        files = fs.readdirSync(legacyDir).filter((f) => f.startsWith(prefix)).sort(sortFiles)
                  .map((f) => ({ filename: f, url: `/uploads/Documents/ArrivalDocuments/${fy}/${f}` }));
      } catch {}
    }
    return res.json(files);
  }

  // Scan all year subdirs in both folders
  const results = [
    ...scanYearDirs(path.join(DOCS_ROOT, 'TransDocuments'),  'TransDocuments'),
    ...scanYearDirs(path.join(DOCS_ROOT, 'ArrivalDocuments'), 'ArrivalDocuments'),
  ];
  res.json(results);
});

// DELETE /api/uploads/arrival?transID=&faYear=&filename=
router.delete('/arrival', (req, res) => {
  const { transID, faYear, filename } = req.query;
  if (!transID || !faYear || !filename)
    return res.status(400).json({ error: 'transID, faYear and filename required' });

  const safeName = path.basename(filename);
  if (!safeName.startsWith(`${transID}_`))
    return res.status(400).json({ error: 'Filename does not belong to this transaction' });

  const filePath = path.join(transDocsDir(faYear), safeName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. STOCK PHOTOS  (godown lot photos)
// ─────────────────────────────────────────────────────────────────────────────
//
// Dir : StockPhotos/{faYear}/{monthYear}/   e.g. StockPhotos/2026-2027/Apr26/
// File: {LotNum}_{serial}.jpg              e.g. AD26023_1.jpg
//
// Body / Query params:  lotNum, faYear, monthYear

function stockPhotosDir(faYear, monthYear) {
  return path.join(DOCS_ROOT, 'StockPhotos', safeSeg(faYear), safeSeg(monthYear));
}

// POST /api/uploads/stock-photos — upload one or more photos for a lot
router.post('/stock-photos', photoUpload.array('photos', 30), async (req, res) => {
  const { lotNum, faYear, monthYear } = req.body;
  if (!lotNum || !faYear || !monthYear)
    return res.status(400).json({ error: 'lotNum, faYear and monthYear required' });
  if (!req.files?.length)
    return res.status(400).json({ error: 'No files uploaded' });

  const dir = stockPhotosDir(faYear, monthYear);
  fs.mkdirSync(dir, { recursive: true });

  const prefix   = `${lotNum}_`;
  let startSerial = nextSerial(dir, prefix);

  const fy  = safeSeg(faYear);
  const myr = safeSeg(monthYear);

  const saved = await Promise.all(req.files.map(async (file, i) => {
    const compressed = await compressImage(file.buffer);
    // Stock photos are always stored as .jpg
    const buf      = compressed.buffer;
    const serial   = startSerial + i;
    const filename = `${lotNum}_${serial}.jpg`;
    fs.writeFileSync(path.join(dir, filename), buf);
    return {
      filename,
      url: `/uploads/Documents/StockPhotos/${fy}/${myr}/${filename}`,
    };
  }));

  res.json(saved);
});

// GET /api/uploads/stock-photos?lotNum=&faYear=&monthYear= (faYear/monthYear optional)
router.get('/stock-photos', (req, res) => {
  const { lotNum, faYear, monthYear } = req.query;
  if (!lotNum) return res.status(400).json({ error: 'lotNum required' });

  const prefix   = `${lotNum}_`;
  const isImg    = (f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f);
  const sortFiles = (a, b) => {
    const na = parseInt(a.replace(/.*_(\d+)\..*/, '$1'), 10);
    const nb = parseInt(b.replace(/.*_(\d+)\..*/, '$1'), 10);
    return na - nb;
  };

  if (faYear && monthYear) {
    const dir = stockPhotosDir(faYear, monthYear);
    const fy  = safeSeg(faYear);
    const myr = safeSeg(monthYear);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && isImg(f)).sort(sortFiles);
    } catch {}
    return res.json(files.map((f) => ({ filename: f, url: `/uploads/Documents/StockPhotos/${fy}/${myr}/${f}` })));
  }

  // Scan all year/month subdirs
  const baseDir = path.join(DOCS_ROOT, 'StockPhotos');
  const results = [];
  try {
    for (const fy of fs.readdirSync(baseDir)) {
      const fyDir = path.join(baseDir, fy);
      try { if (!fs.statSync(fyDir).isDirectory()) continue; } catch { continue; }
      try {
        for (const myr of fs.readdirSync(fyDir)) {
          const myrDir = path.join(fyDir, myr);
          try { if (!fs.statSync(myrDir).isDirectory()) continue; } catch { continue; }
          try {
            fs.readdirSync(myrDir).filter((f) => f.startsWith(prefix) && isImg(f)).sort(sortFiles)
              .forEach((f) => results.push({ filename: f, url: `/uploads/Documents/StockPhotos/${fy}/${myr}/${f}` }));
          } catch {}
        }
      } catch {}
    }
  } catch {}
  res.json(results);
});

// DELETE /api/uploads/stock-photos?lotNum=&faYear=&monthYear=&filename=
router.delete('/stock-photos', (req, res) => {
  const { lotNum, faYear, monthYear, filename } = req.query;
  if (!lotNum || !faYear || !monthYear || !filename)
    return res.status(400).json({ error: 'lotNum, faYear, monthYear and filename required' });

  const safeName = path.basename(filename);
  if (!safeName.startsWith(`${lotNum}_`))
    return res.status(400).json({ error: 'Filename does not belong to this lot' });

  const filePath = path.join(stockPhotosDir(faYear, monthYear), safeName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK EXISTENCE CHECKS
// ─────────────────────────────────────────────────────────────────────────────

// Recursively list all filenames under a base directory (1 level deep by default).
// Returns a flat array of basenames.
function listFilesInSubdirs(base) {
  const names = [];
  try {
    for (const entry of fs.readdirSync(base)) {
      const full = path.join(base, entry);
      if (fs.statSync(full).isDirectory()) {
        try {
          fs.readdirSync(full).forEach((f) => names.push(f));
        } catch {}
      }
    }
  } catch {}
  return names;
}

// Two-level deep listing (faYear / monthYear / files).
function listFilesInTwoLevelSubdirs(base) {
  const names = [];
  try {
    for (const fy of fs.readdirSync(base)) {
      const fyDir = path.join(base, fy);
      if (!fs.statSync(fyDir).isDirectory()) continue;
      try {
        for (const myr of fs.readdirSync(fyDir)) {
          const myrDir = path.join(fyDir, myr);
          if (!fs.statSync(myrDir).isDirectory()) continue;
          try {
            fs.readdirSync(myrDir).forEach((f) => names.push(f));
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return names;
}

// ── POST /api/uploads/check-dispatch-docs ────────────────────────────────────
// Bulk-check whether a dispatch entry has a pickup photo and/or trans-doc.
// Body:
//   entries: [{ transID, faYear, compCode?, gatePass? }, ...]
// Response:
//   { 'ADS!HO!1': true, 'ADS!HO!2': false, ... }
router.post('/check-dispatch-docs', (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) return res.json({});

  // Pre-read TransDocuments subdirs once
  const allTransDocs = listFilesInSubdirs(path.join(DOCS_ROOT, 'TransDocuments'));

  const result = {};
  for (const { transID, faYear, compCode, gatePass } of entries) {
    if (!transID) continue;

    // Check pickup photo  — only possible when compCode + gatePass are provided
    let hasPhoto = false;
    if (compCode && gatePass && faYear) {
      const filename = pickupPhotoFilename(compCode, gatePass, faYear);
      const filePath = path.join(pickupPhotoDir(faYear), filename);
      hasPhoto = fs.existsSync(filePath);
    }

    // Check TransDocuments — search across faYear subdirs (or just the given year)
    const prefix = `${transID}_`;
    const hasDocs = allTransDocs.some((f) => f.startsWith(prefix));

    result[String(transID)] = hasPhoto || hasDocs;
  }

  res.json(result);
});

// ── POST /api/uploads/check-lots ─────────────────────────────────────────────
// Bulk-check whether a lot has stock photos and/or arrival documents.
// Body:
//   lots: [{ lotNum, transID? }, ...]
// Response:
//   { 'AD26023': { hasPhotos: true, hasDocs: false }, ... }
//
// Scans across all faYear/monthYear subdirs so callers don't need to pass them.
router.post('/check-lots', (req, res) => {
  const { lots, lotNums } = req.body;  // accept both new (lots[]) and old (lotNums[]) shapes

  // Normalise: old callers pass lotNums:string[], new callers pass lots:[{lotNum,transID?}]
  const entries = Array.isArray(lots)
    ? lots
    : Array.isArray(lotNums) ? lotNums.map((l) => ({ lotNum: String(l) })) : [];

  if (!entries.length) return res.json({});

  // Pre-read all files across StockPhotos (2-level), TransDocuments (1-level),
  // and legacy ArrivalDocuments (1-level) for backward compatibility.
  const allPhotos   = listFilesInTwoLevelSubdirs(path.join(DOCS_ROOT, 'StockPhotos'));
  const allTransDoc = listFilesInSubdirs(path.join(DOCS_ROOT, 'TransDocuments'));
  const allArvDoc   = listFilesInSubdirs(path.join(DOCS_ROOT, 'ArrivalDocuments'));
  const allArrDocs  = [...allTransDoc, ...allArvDoc];

  const result = {};
  for (const { lotNum: rawLot, transID } of entries) {
    const lotNum = String(rawLot || '');
    if (!lotNum) continue;

    const photoPrefix = `${lotNum}_`;
    const hasPhotos   = allPhotos.some((f) => f.startsWith(photoPrefix));

    // Docs keyed by pkTransID (new) or lotNum (legacy); search both TransDocuments + ArrivalDocuments
    const docPrefix = transID ? `${transID}_` : `${lotNum}_`;
    const hasDocs   = allArrDocs.some((f) => f.startsWith(docPrefix))
                   || allArrDocs.some((f) => f.startsWith(`${lotNum}_`));

    result[lotNum] = { hasPhotos, hasDocs };
  }

  res.json(result);
});

module.exports = router;
