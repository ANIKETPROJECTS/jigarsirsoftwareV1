-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_admin.sql
-- Run this script ONCE in MySQL Workbench to create the mRole table
-- and seed an initial ADMIN role for group BHW.
--
-- NOTE: mCompanyGroup and the fkGroupID columns on existing tables were already
-- created in migrate_group.sql. This file only adds what is new for Phase 4.
-- ─────────────────────────────────────────────────────────────────────────────

USE gms_db;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. mRole — Role Master
--    A Role is a named permission template. Users are assigned a Role; the Role
--    determines what they can view, add, edit, delete, print, and export.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mRole (
  pkRoleID  VARCHAR(20) NOT NULL COMMENT 'Short code e.g. ADMIN, BILLING, VIEW_ONLY',
  fkGroupID VARCHAR(10) NOT NULL COMMENT 'Which company group owns this role',
  RoleName  VARCHAR(50) NOT NULL COMMENT 'Display name e.g. Administrator',
  Active    VARCHAR(2)  NOT NULL DEFAULT 'Y' COMMENT 'Y=Active N=Inactive',
  PRIMARY KEY (pkRoleID),
  KEY idx_role_group (fkGroupID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed: Initial roles for group BHW
--    ADMIN role gets full access to everything.
--    After running this script, go to Permissions page in the web app
--    and tick all checkboxes for ADMIN role.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO mRole (pkRoleID, fkGroupID, RoleName, Active) VALUES
  ('ADMIN',    'BHW', 'Administrator', 'Y'),
  ('BILLING',  'BHW', 'Billing Clerk', 'Y'),
  ('VIEW',     'BHW', 'View Only',     'Y');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. mPermission — already exists from original schema.
--    If you are starting fresh and it does not exist, run this:
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mPermission (
  fkRoleID   VARCHAR(20) NOT NULL COMMENT 'References mRole.pkRoleID',
  ModuleCode VARCHAR(30) NOT NULL COMMENT 'e.g. MASTERS, ARRIVAL, BILLING, REPORTS, ADMIN',
  CanView    VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanAdd     VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanEdit    VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanDelete  VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanPrint   VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanExport  VARCHAR(2)  NOT NULL DEFAULT 'N',
  PRIMARY KEY (fkRoleID, ModuleCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed: Full permissions for ADMIN role across all modules
--    After this, the ADMIN user can access every page and every button.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES
  ('ADMIN', 'MASTERS',  'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'PARTY',    'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'ARRIVAL',  'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'DELIVERY', 'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'BILLING',  'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'REPORTS',  'Y','Y','Y','Y','Y','Y'),
  ('ADMIN', 'ADMIN',    'Y','Y','Y','Y','Y','Y');

-- View-only permissions for VIEW role
INSERT IGNORE INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES
  ('VIEW', 'MASTERS',  'Y','N','N','N','Y','Y'),
  ('VIEW', 'PARTY',    'Y','N','N','N','Y','Y'),
  ('VIEW', 'ARRIVAL',  'Y','N','N','N','Y','Y'),
  ('VIEW', 'DELIVERY', 'Y','N','N','N','Y','Y'),
  ('VIEW', 'BILLING',  'Y','N','N','N','Y','Y'),
  ('VIEW', 'REPORTS',  'Y','N','N','N','Y','Y'),
  ('VIEW', 'ADMIN',    'N','N','N','N','N','N');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Update existing user(s) to use the ADMIN role.
--    Replace 'YOUR_USER_CODE' with your actual user code.
--    After this, that user will see the full ADMIN navigation section.
-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE mUser SET fkRoleID = 'ADMIN' WHERE UserCode = 'YOUR_USER_CODE' AND fkGroupID = 'BHW';

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Verify:
--   SELECT * FROM mRole;
--   SELECT * FROM mPermission;
-- ─────────────────────────────────────────────────────────────────────────────
