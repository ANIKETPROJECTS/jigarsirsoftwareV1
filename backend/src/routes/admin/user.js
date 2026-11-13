// ADMIN -- User  /api/admin/users
//
// Uses AdminUser model which reads/writes directly to gms_admin.
// Users belong to a Company Group (fkGroupID), not a single company.
// At login, they choose which company to work in -- that compID goes into the JWT.
// Passwords are stored as bcrypt hashes; never returned in GET responses.
//
// PK convention: pkUserId = fkGroupID!UserCode  (e.g. "BHW!ADMIN")
// Both fields are uppercased before use, so the PK is always deterministic.
const router   = require('express').Router();
const bcrypt   = require('bcrypt');
const { Op }   = require('sequelize');
const requireAuth       = require('../../middleware/auth');
const requirePermission = require('../../middleware/permission');
const AdminUser         = require('../../models/admin/User');
const adminDB           = require('../../config/adminDatabase');

router.use(requireAuth);

// ── GET /api/admin/users -- optional ?groupID=XYZ filter ────────────────────
router.get('/', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const where = req.query.groupID ? { fkGroupID: req.query.groupID } : {};
    const rows  = await AdminUser.findAll({
      where,
      attributes: { exclude: ['UserPassword'] },
      order:      [['fkGroupID', 'ASC'], ['UserFullName', 'ASC']],
    });
    res.json(rows);
  } catch { res.status(500).json({ error: 'Failed to load users' }); }
});

// ── GET /api/admin/users/:id ─────────────────────────────────────────────────
router.get('/:id', requirePermission('ADMIN', 'CanView'), async (req, res) => {
  try {
    const row = await AdminUser.findOne({
      where:      { pkUserId: req.params.id },
      attributes: { exclude: ['UserPassword'] },
    });
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Failed to load user' }); }
});

// ── POST /api/admin/users -- create user; PK = fkGroupID!UserCode ────────────
router.post('/', requirePermission('ADMIN', 'CanAdd'), async (req, res) => {
  const { UserCode, UserFullName, password, fkRoleID, fkGroupID } = req.body;
  if (!UserCode || !UserFullName || !password || !fkRoleID || !fkGroupID)
    return res.status(400).json({ error: 'Group, User Code, Full Name, Password and Role are required' });

  const groupID  = fkGroupID.trim().toUpperCase();
  const code     = UserCode.trim().toUpperCase();
  const pkUserId = `${groupID}!${code}`;

  try {
    const hashed = await bcrypt.hash(password, 10);
    const row    = await AdminUser.create({
      pkUserId,
      fkGroupID:    groupID,
      fkBranchID:   'HO',
      UserCode:     code,
      UserFullName: UserFullName.trim(),
      UserPassword: hashed,
      fkRoleID:     fkRoleID.trim().toUpperCase(),
      Active:       'Y',
      CrMod:        new Date(),
    });
    const { UserPassword: _pw, ...safe } = row.toJSON();
    res.status(201).json(safe);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'User Code already exists in this group' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ── PUT /api/admin/users/:id ─────────────────────────────────────────────────
// Because PK = fkGroupID!UserCode, any change to those fields requires updating
// the PK itself — done via raw SQL so the WHERE can use the old value.
router.put('/:id', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  const { fkGroupID, UserCode, UserFullName, password, fkRoleID, Active } = req.body;
  if (!fkGroupID || !UserCode || !UserFullName || !fkRoleID)
    return res.status(400).json({ error: 'Group, User Code, Full Name and Role are required' });

  const groupID     = fkGroupID.trim().toUpperCase();
  const code        = UserCode.trim().toUpperCase();
  const newPkUserId = `${groupID}!${code}`;
  const oldPkUserId = req.params.id;

  try {
    // Duplicate check: new PK must not already exist (unless it IS this user)
    if (newPkUserId !== oldPkUserId) {
      const dup = await AdminUser.findOne({ where: { pkUserId: newPkUserId } });
      if (dup) return res.status(409).json({ error: 'User Code already exists in this group' });
    }

    let passwordClause = '';
    const replacements = [
      newPkUserId, groupID, code, UserFullName.trim(),
      fkRoleID.trim().toUpperCase(), Active || 'Y', new Date(),
    ];

    if (password && password.trim() !== '') {
      passwordClause = ', UserPassword = ?';
      replacements.push(await bcrypt.hash(password.trim(), 10));
    }

    replacements.push(oldPkUserId);

    const [result] = await adminDB.query(
      `UPDATE mUser
          SET pkUserId = ?, fkGroupID = ?, UserCode = ?, UserFullName = ?,
              fkRoleID = ?, Active = ?, CrMod = ?${passwordClause}
        WHERE pkUserId = ?`,
      { replacements }
    );

    const affected = result?.affectedRows ?? result;
    if (affected === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ updated: true, pkUserId: newPkUserId });
  } catch { res.status(500).json({ error: 'Failed to update user' }); }
});

// ── DELETE /api/admin/users/:id -- soft delete ───────────────────────────────
router.delete('/:id', requirePermission('ADMIN', 'CanDelete'), async (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    const [n] = await AdminUser.update(
      { Active: 'N', CrMod: new Date() },
      { where: { pkUserId: req.params.id } }
    );
    if (n === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Failed to delete user' }); }
});

// ── POST /api/admin/users/migrate-pks ────────────────────────────────────────
// One-time migration: rewrites any UUID-based pkUserId to fkGroupID!UserCode.
// Safe to run multiple times (skips rows already in the correct format).
router.post('/migrate-pks', requirePermission('ADMIN', 'CanEdit'), async (req, res) => {
  try {
    const users = await AdminUser.findAll();
    let updated = 0, skipped = 0;

    for (const user of users) {
      const expected = `${user.fkGroupID}!${user.UserCode}`;
      if (user.pkUserId === expected) { skipped++; continue; }

      await adminDB.query(
        'UPDATE mUser SET pkUserId = ? WHERE pkUserId = ?',
        { replacements: [expected, user.pkUserId] }
      );
      updated++;
    }

    res.json({ message: 'Migration complete', updated, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Migration failed' });
  }
});

module.exports = router;
