// Admin — Database Backup  /api/admin/backup
//
// Runs mysqldump for one or more databases, compresses with gzip,
// and saves to the server's /backups folder.
//
// Key mysqldump options used:
//   --single-transaction   : InnoDB hot backup — no table locks during dump
//   --quick                : fetch rows one at a time, avoids RAM spike
//   --hex-blob             : safe binary/BLOB serialisation
//   --routines             : include stored procedures / functions
//   --triggers             : include triggers
//   --default-character-set=utf8mb4
//   --databases <name>     : includes CREATE DATABASE + USE — makes restore self-contained
//
// Password is passed via a temporary MySQL option file (--defaults-extra-file).
// This works reliably on Windows AND Linux; MYSQL_PWD is deprecated and
// ignored by some MySQL/Windows builds.
const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');
const { spawn }         = require('child_process');
const zlib              = require('zlib');
const fs                = require('fs');
const path              = require('path');
const os                = require('os');
const crypto            = require('crypto');

router.use(requireAuth);

const ADMIN_DB     = process.env.ADMIN_DB_NAME || 'gms_admin';
// Full path to mysqldump executable.
// On Linux it is usually in PATH; on Windows it often is not.
// Set MYSQLDUMP_PATH in .env if `mysqldump` is not on the system PATH.
const MYSQLDUMP_EXE = process.env.MYSQLDUMP_PATH || 'mysqldump';
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(__dirname, '../../../backups');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fmtBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

// Write a temporary MySQL option file containing the password.
// --defaults-extra-file must be the FIRST argument and works on Windows + Linux.
// The file is deleted in a finally block regardless of success or failure.
function makeTmpOptionFile() {
  const tmpPath = path.join(os.tmpdir(), `gms-dump-${crypto.randomBytes(6).toString('hex')}.cnf`);
  const pwd = (process.env.DB_PASSWORD || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  fs.writeFileSync(tmpPath, `[client]\npassword="${pwd}"\n`);
  return tmpPath;
}

// Run mysqldump for one DB → saves compressed .sql.gz
// Resolves with { filename, sizeBytes, warnings } — warnings is stderr text (non-fatal notes).
function runDump(dbName) {
  return new Promise((resolve, reject) => {
    const filename = `backup-${dbName}-${nowStr()}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, filename);
    const optFile  = makeTmpOptionFile();

    // --defaults-extra-file MUST be first argument
    const args = [
      `--defaults-extra-file=${optFile}`,
      `--host=${process.env.DB_HOST || 'localhost'}`,
      `--port=${process.env.DB_PORT || 3306}`,
      `--user=${process.env.DB_USER}`,
      '--single-transaction',
      '--quick',
      '--hex-blob',
      '--routines',
      '--triggers',
      '--default-character-set=utf8mb4',
      '--databases', dbName,
    ];

    const dump = spawn(MYSQLDUMP_EXE, args);
    const gzip = zlib.createGzip({ level: 6 });
    const out  = fs.createWriteStream(filePath);

    const stderr = [];
    dump.stderr.on('data', (d) => stderr.push(d));
    dump.stdout.pipe(gzip).pipe(out);

    let dumpCode = null;
    let finished = false;
    let settled  = false;

    function deleteTmp() { try { fs.unlinkSync(optFile); } catch {} }

    function cleanup(err) {
      if (settled) return;
      settled = true;
      deleteTmp();
      try { fs.unlinkSync(filePath); } catch {}
      reject(err);
    }

    function tryResolve() {
      if (settled || dumpCode === null || !finished) return;
      settled = true;
      deleteTmp();
      const warnings = Buffer.concat(stderr).toString().trim();
      if (dumpCode !== 0) {
        try { fs.unlinkSync(filePath); } catch {}
        reject(new Error(`mysqldump failed (exit ${dumpCode}): ${warnings.slice(0, 600) || 'unknown error'}`));
      } else {
        const stat = fs.statSync(filePath);
        resolve({ filename, sizeBytes: stat.size, warnings });
      }
    }

    dump.on('close', (code) => { dumpCode = code; tryResolve(); });
    out.on('finish', () => { finished = true; tryResolve(); });
    out.on('error', (e) => cleanup(e));
    dump.on('error', (e) => cleanup(
      new Error(`Cannot start mysqldump: ${e.message}. Make sure mysqldump is installed and in PATH.`)
    ));
  });
}

// ── GET /api/admin/backup/test ─────────────────────────────────────────────────
// Runs `mysqldump --version` + a no-data connection test and returns all output.
// Use this to diagnose PATH / authentication problems.
router.get('/test', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  const results = {};

  // 1. Is mysqldump in PATH?
  await new Promise((resolve) => {
    const p = spawn(MYSQLDUMP_EXE, ['--version']);
    const out = []; const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('close', (code) => {
      results.version = {
        ok: code === 0,
        stdout: Buffer.concat(out).toString().trim(),
        stderr: Buffer.concat(err).toString().trim(),
        exitCode: code,
      };
      resolve();
    });
    p.on('error', (e) => {
      results.version = { ok: false, error: e.message };
      resolve();
    });
  });

  // 2. Test connection — dump only the structure of the admin DB (no data, fast)
  await new Promise((resolve) => {
    const optFile = makeTmpOptionFile();
    const args = [
      `--defaults-extra-file=${optFile}`,
      `--host=${process.env.DB_HOST || 'localhost'}`,
      `--port=${process.env.DB_PORT || 3306}`,
      `--user=${process.env.DB_USER}`,
      '--no-data',
      '--databases', process.env.ADMIN_DB_NAME || 'gms_admin',
    ];
    const p = spawn(MYSQLDUMP_EXE, args);
    const out = []; const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('close', (code) => {
      try { fs.unlinkSync(optFile); } catch {}
      const stdout = Buffer.concat(out).toString();
      results.connection = {
        ok: code === 0 && stdout.length > 10,
        exitCode: code,
        stdoutBytes: stdout.length,
        stdoutPreview: stdout.slice(0, 300),
        stderr: Buffer.concat(err).toString().trim(),
      };
      resolve();
    });
    p.on('error', (e) => {
      try { fs.unlinkSync(optFile); } catch {}
      results.connection = { ok: false, error: e.message };
      resolve();
    });
  });

  res.json(results);
});

// Validate filename — only allow our own backup file names (prevent path traversal)
function validFilename(f) {
  return f && /^backup-[\w.-]+-\d{8}-\d{6}\.sql\.gz$/.test(f);
}

// ── GET /api/admin/backup/info ─────────────────────────────────────────────────
// Returns all companies (with DB names), the admin DB, and existing backup files.
router.get('/info', requirePermission('ADMIN', 'CanView'), (req, res) => {
  try {
    const companies = [...connectionManager._companyInfo.values()]
      .map(({ pkCompID, CompName, CompAlias, dbName, fkGroupID }) => ({ pkCompID, CompName, CompAlias, dbName, fkGroupID }))
      .sort((a, b) => a.CompName.localeCompare(b.CompName));

    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR)
          .filter((f) => f.endsWith('.sql.gz'))
          .map((f) => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { filename: f, sizeBytes: stat.size, size: fmtBytes(stat.size), mtime: stat.mtime };
          })
          .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
      : [];

    res.json({ companies, adminDb: { name: ADMIN_DB, label: `Admin DB (${ADMIN_DB})` }, files, backupDir: BACKUP_DIR });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/backup/run ─────────────────────────────────────────────────
// Body: { databases: ['gms_ads', 'gms_admin', ...] }
// Runs mysqldump for each DB sequentially, returns { results, errors }.
router.post('/run', requirePermission('ADMIN', 'CanAdd'), async (req, res) => {
  const { databases } = req.body;
  if (!Array.isArray(databases) || !databases.length)
    return res.status(400).json({ error: 'Select at least one database to back up.' });

  // Allow only known DB names to prevent arbitrary dumps
  const knownDbs = new Set([
    ADMIN_DB,
    ...[...connectionManager._companyInfo.values()].map((c) => c.dbName),
  ]);
  const invalid = databases.filter((db) => !knownDbs.has(db));
  if (invalid.length)
    return res.status(400).json({ error: `Unknown database(s): ${invalid.join(', ')}` });

  const results = [];
  const errors  = [];

  for (const db of databases) {
    try {
      const r = await runDump(db);
      results.push({ db, filename: r.filename, size: fmtBytes(r.sizeBytes), sizeBytes: r.sizeBytes, warnings: r.warnings || '' });
    } catch (e) {
      errors.push({ db, error: e.message });
    }
  }

  res.json({ results, errors });
});

// ── GET /api/admin/backup/download/:filename ───────────────────────────────────
router.get('/download/:filename', requirePermission('ADMIN', 'CanView'), (req, res) => {
  const { filename } = req.params;
  if (!validFilename(filename))
    return res.status(400).json({ error: 'Invalid filename.' });

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: 'File not found.' });

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/gzip');
  fs.createReadStream(filePath).pipe(res);
});

// ── DELETE /api/admin/backup/:filename ─────────────────────────────────────────
router.delete('/:filename', requirePermission('ADMIN', 'CanDelete'), (req, res) => {
  const { filename } = req.params;
  if (!validFilename(filename))
    return res.status(400).json({ error: 'Invalid filename.' });

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: 'File not found.' });

  fs.unlinkSync(filePath);
  res.json({ message: 'Deleted.' });
});

module.exports = router;
