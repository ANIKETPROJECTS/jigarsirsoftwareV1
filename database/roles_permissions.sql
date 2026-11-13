-- ─────────────────────────────────────────────────────────
-- GMS — User Roles, Permissions & Client Portal Tables
-- Run AFTER schema.sql
-- ─────────────────────────────────────────────────────────

USE gms_db;

-- ─────────────────────────────────────────────────────────
-- ROLE DEFINITIONS
-- pkRoleID values: SUPER_ADMIN, ADMIN, DATA_ENTRY, BILLING, VIEWER, CLIENT
-- IsGlobal='Y' means the user can switch between all companies (Super Admin only)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mRole (
  pkRoleID    VARCHAR(20)   NOT NULL,
  RoleName    VARCHAR(50)   NOT NULL,
  RoleDesc    VARCHAR(200),
  IsGlobal    VARCHAR(2)    NOT NULL DEFAULT 'N',
  Active      VARCHAR(2)    NOT NULL DEFAULT 'Y',
  PRIMARY KEY (pkRoleID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─────────────────────────────────────────────────────────
-- PERMISSION MATRIX
-- One row per (Role × Module). All CRUD + Print + Export flags.
-- Backend middleware reads this table to gate every API call.
-- ModuleCode values mirror the route groups in Express.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mPermission (
  fkRoleID    VARCHAR(20)   NOT NULL,
  ModuleCode  VARCHAR(30)   NOT NULL,
  CanView     VARCHAR(2)    NOT NULL DEFAULT 'N',
  CanAdd      VARCHAR(2)    NOT NULL DEFAULT 'N',
  CanEdit     VARCHAR(2)    NOT NULL DEFAULT 'N',
  CanDelete   VARCHAR(2)    NOT NULL DEFAULT 'N',
  CanPrint    VARCHAR(2)    NOT NULL DEFAULT 'N',
  CanExport   VARCHAR(2)    NOT NULL DEFAULT 'N',
  PRIMARY KEY (fkRoleID, ModuleCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─────────────────────────────────────────────────────────
-- CLIENT PARTY ASSIGNMENT
-- Links a CLIENT-role user to a party group (and optionally a single party).
-- A client may be assigned to the entire group (fkPartyID = NULL)
-- or restricted to one specific party.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mClientParty (
  pkClientPartyID  VARCHAR(100) NOT NULL,
  fkUserID         VARCHAR(100) NOT NULL,
  fkCompID         VARCHAR(10)  NOT NULL,
  pGroup           VARCHAR(30)  NOT NULL,
  fkPartyID        VARCHAR(100),              -- NULL = all parties in group
  Active           VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkAdminUserID    VARCHAR(100) NOT NULL,
  CrMod            DATETIME     NOT NULL,
  PRIMARY KEY (pkClientPartyID),
  KEY idx_cp_user  (fkUserID),
  KEY idx_cp_group (fkCompID, pGroup)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─────────────────────────────────────────────────────────
-- DISPATCH REQUEST — HEADER
-- Created by a CLIENT user through the portal.
-- ReqStatus lifecycle: PENDING → REVIEWED → APPROVED / REJECTED → CONVERTED
-- When CONVERTED: ConvertedTxnID links to the actual tStockEntry pkTransID.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tDispatchRequest1 (
  pkDReqID        VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL DEFAULT 'HO',
  DReqNum         VARCHAR(20)   NOT NULL,
  DReqDt          DATETIME      NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  ReqStatus       VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  ReqNote         TEXT,
  fkClientUserID  VARCHAR(100)  NOT NULL,
  ReviewedBy      VARCHAR(100),
  ReviewedDt      DATETIME,
  ReviewNote      TEXT,
  ConvertedTxnID  VARCHAR(100),
  FaYear          VARCHAR(10)   NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkDReqID),
  KEY idx_dreq_comp   (fkCompID, DReqDt),
  KEY idx_dreq_party  (fkPartyID),
  KEY idx_dreq_status (ReqStatus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─────────────────────────────────────────────────────────
-- DISPATCH REQUEST — LINE ITEMS
-- One row per lot the client wants dispatched.
-- fkGodownID is optional (client may not know which bay).
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tDispatchRequest2 (
  cpkDReqID     VARCHAR(100)  NOT NULL,
  cpkSrno       INT           NOT NULL,
  fkLotID       VARCHAR(100)  NOT NULL,
  ReqQty        DECIMAL(10,4) NOT NULL DEFAULT 0,
  fkGodownID    VARCHAR(100),
  ItemDesc      VARCHAR(100),
  Note          TEXT,
  PRIMARY KEY (cpkDReqID, cpkSrno),
  KEY idx_dreq2_lot (fkLotID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─────────────────────────────────────────────────────────
-- ADD fkRoleID TO mUser (if not already present)
-- Default 'ADMIN' covers any existing users created before this migration.
-- ─────────────────────────────────────────────────────────
-- NOTE: ALTER TABLE is run separately (see roles_permissions.sql execution notes)
-- Run this manually if fkRoleID column does not exist:
-- ALTER TABLE mUser ADD COLUMN fkRoleID VARCHAR(20) NOT NULL DEFAULT 'ADMIN' AFTER UserPassword;


-- ─────────────────────────────────────────────────────────
-- SEED: Role definitions
-- ─────────────────────────────────────────────────────────
INSERT INTO mRole (pkRoleID, RoleName, RoleDesc, IsGlobal, Active)
VALUES
  ('SUPER_ADMIN', 'Super Administrator', 'Global access across all companies — full permissions including user management, backup, restore, system settings', 'Y', 'Y'),
  ('ADMIN',       'Administrator',        'Company-level full operational access. Cannot manage users, system settings, or restore backups', 'N', 'Y'),
  ('DATA_ENTRY',  'Data Entry Operator',  'Arrival, Dispatch, Receipt, Hamali, Attendance entries — View + Add + Edit only (no Delete, no Billing)', 'N', 'Y'),
  ('BILLING',     'Billing User',          'Godown Rent and Hamali/Transport billing, Bill and Receipt reports only', 'N', 'Y'),
  ('VIEWER',      'Viewer',                'Read-only access to all reports and views — no Add, Edit, or Delete', 'N', 'Y'),
  ('CLIENT',      'Client User',           'External client portal — view own stock and submit dispatch requests only', 'N', 'Y')
ON DUPLICATE KEY UPDATE RoleName = VALUES(RoleName);


-- ─────────────────────────────────────────────────────────
-- SEED: Permission matrix
-- Modules:
--   MASTERS           → State, Tax, Holiday, Bank, Party, Godown, Item, Employee, Unit
--   ARRIVAL           → Arrival transaction entry (TransType='ARV')
--   DISPATCH          → Dispatch transaction entry (TransType='DEP')
--   RECEIPT_ENTRY     → Payment receipt entry
--   HAMALI            → Hamali calculation entry
--   ATTENDANCE        → Daily attendance
--   ARRIVAL_NOTES     → Arrival notes / lot remarks
--   BILLING_GODRENT   → Godown rent bill generation
--   BILLING_OTHER     → Transport and Hamali bill generation
--   REPORTS           → All report views
--   USER_MGMT         → User creation, role assignment
--   BACKUP            → Database backup
--   RESTORE           → Database restore
--   SYSTEM_SETTINGS   → System configuration, date locks, FA year
--   DB_TRANSFER       → Cross-company data transfer
--   OB_TRANSFER       → Opening balance carry-forward
--   UNLOCK_BILLS      → Unlock / cancel locked bills
--   CLIENT_STOCK      → Client portal: view assigned stock
--   CLIENT_DISPATCH   → Client portal: submit and track dispatch requests
-- ─────────────────────────────────────────────────────────
INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES
-- ── SUPER_ADMIN: everything allowed ──────────────────────
('SUPER_ADMIN','MASTERS',          'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','ARRIVAL',          'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','DISPATCH',         'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','RECEIPT_ENTRY',    'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','HAMALI',           'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','ATTENDANCE',       'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','ARRIVAL_NOTES',    'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','BILLING_GODRENT',  'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','BILLING_OTHER',    'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','REPORTS',          'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','USER_MGMT',        'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','BACKUP',           'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','RESTORE',          'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','SYSTEM_SETTINGS',  'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','DB_TRANSFER',      'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','OB_TRANSFER',      'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','UNLOCK_BILLS',     'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','CLIENT_STOCK',     'Y','Y','Y','Y','Y','Y'),
('SUPER_ADMIN','CLIENT_DISPATCH',  'Y','Y','Y','Y','Y','Y'),

-- ── ADMIN: full operations, no user/system management ────
('ADMIN','MASTERS',         'Y','Y','Y','Y','Y','Y'),
('ADMIN','ARRIVAL',         'Y','Y','Y','Y','Y','Y'),
('ADMIN','DISPATCH',        'Y','Y','Y','Y','Y','Y'),
('ADMIN','RECEIPT_ENTRY',   'Y','Y','Y','Y','Y','Y'),
('ADMIN','HAMALI',          'Y','Y','Y','Y','Y','Y'),
('ADMIN','ATTENDANCE',      'Y','Y','Y','Y','Y','Y'),
('ADMIN','ARRIVAL_NOTES',   'Y','Y','Y','Y','Y','Y'),
('ADMIN','BILLING_GODRENT', 'Y','Y','Y','Y','Y','Y'),
('ADMIN','BILLING_OTHER',   'Y','Y','Y','Y','Y','Y'),
('ADMIN','REPORTS',         'Y','Y','Y','Y','Y','Y'),
('ADMIN','USER_MGMT',       'N','N','N','N','N','N'),
('ADMIN','BACKUP',          'N','N','N','N','N','N'),
('ADMIN','RESTORE',         'N','N','N','N','N','N'),
('ADMIN','SYSTEM_SETTINGS', 'N','N','N','N','N','N'),
('ADMIN','DB_TRANSFER',     'N','N','N','N','N','N'),
('ADMIN','OB_TRANSFER',     'N','N','N','N','N','N'),
('ADMIN','UNLOCK_BILLS',    'N','N','N','N','N','N'),
('ADMIN','CLIENT_STOCK',    'Y','Y','Y','Y','Y','Y'),
('ADMIN','CLIENT_DISPATCH', 'Y','Y','Y','Y','Y','Y'),

-- ── DATA_ENTRY: Add+Edit operational entries, no Delete, no Billing ──
('DATA_ENTRY','MASTERS',         'Y','N','N','N','N','N'),
('DATA_ENTRY','ARRIVAL',         'Y','Y','Y','N','N','N'),
('DATA_ENTRY','DISPATCH',        'Y','Y','Y','N','N','N'),
('DATA_ENTRY','RECEIPT_ENTRY',   'Y','Y','Y','N','N','N'),
('DATA_ENTRY','HAMALI',          'Y','Y','Y','N','N','N'),
('DATA_ENTRY','ATTENDANCE',      'Y','Y','Y','N','N','N'),
('DATA_ENTRY','ARRIVAL_NOTES',   'Y','Y','Y','N','N','N'),
('DATA_ENTRY','BILLING_GODRENT', 'N','N','N','N','N','N'),
('DATA_ENTRY','BILLING_OTHER',   'N','N','N','N','N','N'),
('DATA_ENTRY','REPORTS',         'Y','N','N','N','N','N'),
('DATA_ENTRY','USER_MGMT',       'N','N','N','N','N','N'),
('DATA_ENTRY','BACKUP',          'N','N','N','N','N','N'),
('DATA_ENTRY','RESTORE',         'N','N','N','N','N','N'),
('DATA_ENTRY','SYSTEM_SETTINGS', 'N','N','N','N','N','N'),
('DATA_ENTRY','DB_TRANSFER',     'N','N','N','N','N','N'),
('DATA_ENTRY','OB_TRANSFER',     'N','N','N','N','N','N'),
('DATA_ENTRY','UNLOCK_BILLS',    'N','N','N','N','N','N'),
('DATA_ENTRY','CLIENT_STOCK',    'N','N','N','N','N','N'),
('DATA_ENTRY','CLIENT_DISPATCH', 'N','N','N','N','N','N'),

-- ── BILLING: billing + bill reports only ─────────────────
('BILLING','MASTERS',         'N','N','N','N','N','N'),
('BILLING','ARRIVAL',         'N','N','N','N','N','N'),
('BILLING','DISPATCH',        'N','N','N','N','N','N'),
('BILLING','RECEIPT_ENTRY',   'N','N','N','N','N','N'),
('BILLING','HAMALI',          'N','N','N','N','N','N'),
('BILLING','ATTENDANCE',      'N','N','N','N','N','N'),
('BILLING','ARRIVAL_NOTES',   'N','N','N','N','N','N'),
('BILLING','BILLING_GODRENT', 'Y','Y','Y','Y','Y','Y'),
('BILLING','BILLING_OTHER',   'Y','Y','Y','Y','Y','Y'),
('BILLING','REPORTS',         'Y','N','N','N','Y','Y'),
('BILLING','USER_MGMT',       'N','N','N','N','N','N'),
('BILLING','BACKUP',          'N','N','N','N','N','N'),
('BILLING','RESTORE',         'N','N','N','N','N','N'),
('BILLING','SYSTEM_SETTINGS', 'N','N','N','N','N','N'),
('BILLING','DB_TRANSFER',     'N','N','N','N','N','N'),
('BILLING','OB_TRANSFER',     'N','N','N','N','N','N'),
('BILLING','UNLOCK_BILLS',    'N','N','N','N','N','N'),
('BILLING','CLIENT_STOCK',    'N','N','N','N','N','N'),
('BILLING','CLIENT_DISPATCH', 'N','N','N','N','N','N'),

-- ── VIEWER: read + print + export only ───────────────────
('VIEWER','MASTERS',         'Y','N','N','N','N','N'),
('VIEWER','ARRIVAL',         'Y','N','N','N','N','N'),
('VIEWER','DISPATCH',        'Y','N','N','N','N','N'),
('VIEWER','RECEIPT_ENTRY',   'Y','N','N','N','N','N'),
('VIEWER','HAMALI',          'Y','N','N','N','N','N'),
('VIEWER','ATTENDANCE',      'Y','N','N','N','N','N'),
('VIEWER','ARRIVAL_NOTES',   'Y','N','N','N','N','N'),
('VIEWER','BILLING_GODRENT', 'Y','N','N','N','Y','Y'),
('VIEWER','BILLING_OTHER',   'Y','N','N','N','Y','Y'),
('VIEWER','REPORTS',         'Y','N','N','N','Y','Y'),
('VIEWER','USER_MGMT',       'N','N','N','N','N','N'),
('VIEWER','BACKUP',          'N','N','N','N','N','N'),
('VIEWER','RESTORE',         'N','N','N','N','N','N'),
('VIEWER','SYSTEM_SETTINGS', 'N','N','N','N','N','N'),
('VIEWER','DB_TRANSFER',     'N','N','N','N','N','N'),
('VIEWER','OB_TRANSFER',     'N','N','N','N','N','N'),
('VIEWER','UNLOCK_BILLS',    'N','N','N','N','N','N'),
('VIEWER','CLIENT_STOCK',    'Y','N','N','N','N','N'),
('VIEWER','CLIENT_DISPATCH', 'N','N','N','N','N','N'),

-- ── CLIENT: portal access only ───────────────────────────
('CLIENT','MASTERS',         'N','N','N','N','N','N'),
('CLIENT','ARRIVAL',         'N','N','N','N','N','N'),
('CLIENT','DISPATCH',        'N','N','N','N','N','N'),
('CLIENT','RECEIPT_ENTRY',   'N','N','N','N','N','N'),
('CLIENT','HAMALI',          'N','N','N','N','N','N'),
('CLIENT','ATTENDANCE',      'N','N','N','N','N','N'),
('CLIENT','ARRIVAL_NOTES',   'N','N','N','N','N','N'),
('CLIENT','BILLING_GODRENT', 'N','N','N','N','N','N'),
('CLIENT','BILLING_OTHER',   'N','N','N','N','N','N'),
('CLIENT','REPORTS',         'N','N','N','N','N','N'),
('CLIENT','USER_MGMT',       'N','N','N','N','N','N'),
('CLIENT','BACKUP',          'N','N','N','N','N','N'),
('CLIENT','RESTORE',         'N','N','N','N','N','N'),
('CLIENT','SYSTEM_SETTINGS', 'N','N','N','N','N','N'),
('CLIENT','DB_TRANSFER',     'N','N','N','N','N','N'),
('CLIENT','OB_TRANSFER',     'N','N','N','N','N','N'),
('CLIENT','UNLOCK_BILLS',    'N','N','N','N','N','N'),
('CLIENT','CLIENT_STOCK',    'Y','N','N','N','N','N'),
('CLIENT','CLIENT_DISPATCH', 'Y','Y','N','N','N','N')
ON DUPLICATE KEY UPDATE
  CanView   = VALUES(CanView),
  CanAdd    = VALUES(CanAdd),
  CanEdit   = VALUES(CanEdit),
  CanDelete = VALUES(CanDelete),
  CanPrint  = VALUES(CanPrint),
  CanExport = VALUES(CanExport);


-- ─────────────────────────────────────────────────────────
-- Set the seeded ADMIN user to SUPER_ADMIN role
-- ─────────────────────────────────────────────────────────
UPDATE mUser SET fkRoleID = 'SUPER_ADMIN' WHERE UserCode = 'ADMIN' AND fkCompID = 'ADS';
