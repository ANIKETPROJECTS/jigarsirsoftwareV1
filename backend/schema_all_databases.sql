-- ============================================================
-- GMS Web Application  -  Complete Database Schema
-- ============================================================
-- Databases created:
--   gms_admin   Central admin (CompanyGroup, Company, User, Role, Permission)
--   gms_ads     ADS   company (BHW  Group - PRIMARY)
--   gms_test    TEST  company (BHW  Group - secondary)
--   gms_vlco    VLCO  company (VLCO Group - PRIMARY)
--   gms_test1   TEST1 company (VLCO Group - secondary)
--
-- How to run:
--   mysql -u root -p < schema_all_databases.sql
--
-- After running, generate a real bcrypt hash and set admin passwords:
--   cd gms-web/backend
--   node -e "require('bcrypt').hash('Admin@123',10).then(h=>console.log(h))"
--   Then paste the output into:
--   UPDATE gms_admin.mUser SET UserPassword='<hash>' WHERE pkUserId IN ('bhw-admin-001','vlco-admin-001');
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ============================================================
-- DATABASE 1 : gms_admin   (Central / Admin database)
-- ============================================================
DROP DATABASE IF EXISTS gms_admin;
CREATE DATABASE gms_admin
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gms_admin;

-- mCompanyGroup ---------------------------------------------------
CREATE TABLE mCompanyGroup (
  pkGroupID VARCHAR(10)  NOT NULL  COMMENT 'Short code  e.g. BHW, VLCO',
  GroupName VARCHAR(50)  NOT NULL,
  Active    VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (pkGroupID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- mCompany --------------------------------------------------------
-- dbName    : actual MySQL database for this company  e.g. gms_ads
-- IsPrimary : Y = can write shared masters;  N = read-only on shared masters
CREATE TABLE mCompany (
  pkCompID  VARCHAR(10)  NOT NULL  COMMENT 'Short code  e.g. ADS, TEST',
  fkGroupID VARCHAR(10)  NOT NULL,
  CompName  VARCHAR(30)  NOT NULL,
  CompAlias VARCHAR(15)  NOT NULL,
  dbName    VARCHAR(50)  NOT NULL  COMMENT 'MySQL DB name  e.g. gms_ads',
  IsPrimary VARCHAR(2)   NOT NULL DEFAULT 'N'
                                  COMMENT 'Y = Primary; can write shared masters',
  Active    VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID  VARCHAR(100) NOT NULL,
  CrMod     DATETIME     NOT NULL,
  PRIMARY KEY (pkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- mRole -----------------------------------------------------------
CREATE TABLE mRole (
  pkRoleID  VARCHAR(20) NOT NULL  COMMENT 'e.g. BHW_ADMIN, VLCO_USER',
  fkGroupID VARCHAR(10) NOT NULL,
  RoleName  VARCHAR(50) NOT NULL,
  Active    VARCHAR(2)  NOT NULL DEFAULT 'Y',
  PRIMARY KEY (pkRoleID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- mPermission -----------------------------------------------------
-- Composite PK: fkRoleID + ModuleCode
-- Modules: MASTERS, ARRIVAL, DELIVERY, BILLING, REPORTS, ADMIN
CREATE TABLE mPermission (
  fkRoleID   VARCHAR(20) NOT NULL,
  ModuleCode VARCHAR(30) NOT NULL,
  CanView    VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanAdd     VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanEdit    VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanDelete  VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanPrint   VARCHAR(2)  NOT NULL DEFAULT 'N',
  CanExport  VARCHAR(2)  NOT NULL DEFAULT 'N',
  PRIMARY KEY (fkRoleID, ModuleCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- mUser -----------------------------------------------------------
-- Users belong to a Group, not a single company.
-- At login they choose which company to work in.
CREATE TABLE mUser (
  pkUserId     VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkGroupID    VARCHAR(10)  NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL DEFAULT 'HO',
  UserCode     VARCHAR(10)  NOT NULL,
  UserFullName VARCHAR(30)  NOT NULL,
  UserPassword VARCHAR(255) NOT NULL  COMMENT 'bcrypt hash',
  fkRoleID     VARCHAR(20)  NOT NULL  DEFAULT 'ADMIN',
  Active       VARCHAR(2)   NOT NULL DEFAULT 'Y',
  CrMod        DATETIME     NOT NULL,
  PRIMARY KEY (pkUserId),
  UNIQUE KEY uq_user_group_code (fkGroupID, UserCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Seed: gms_admin ──────────────────────────────────────────

INSERT INTO mCompanyGroup (pkGroupID, GroupName, Active) VALUES
  ('BHW',  'Bhagwati Warehousing', 'Y'),
  ('VLCO', 'VLCO Group',           'Y');

INSERT INTO mCompany (pkCompID, fkGroupID, CompName, CompAlias, dbName, IsPrimary, Active, fkUserID, CrMod) VALUES
  ('ADS',   'BHW',  'Aditya Stores', 'ADS',   'gms_ads',   'Y', 'Y', 'SYSTEM', NOW()),
  ('TEST',  'BHW',  'Test BHW',      'TEST',  'gms_test',  'N', 'Y', 'SYSTEM', NOW()),
  ('VLCO',  'VLCO', 'VLCO Company',  'VLCO',  'gms_vlco',  'Y', 'Y', 'SYSTEM', NOW()),
  ('TEST1', 'VLCO', 'Test VLCO',     'TEST1', 'gms_test1', 'N', 'Y', 'SYSTEM', NOW());

INSERT INTO mRole (pkRoleID, fkGroupID, RoleName, Active) VALUES
  ('BHW_ADMIN',  'BHW',  'Administrator', 'Y'),
  ('BHW_USER',   'BHW',  'Regular User',  'Y'),
  ('VLCO_ADMIN', 'VLCO', 'Administrator', 'Y'),
  ('VLCO_USER',  'VLCO', 'Regular User',  'Y');

-- BHW Admin: full access to all modules
INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport) VALUES
  ('BHW_ADMIN', 'MASTERS',  'Y','Y','Y','Y','Y','Y'),
  ('BHW_ADMIN', 'ARRIVAL',  'Y','Y','Y','Y','Y','Y'),
  ('BHW_ADMIN', 'DELIVERY', 'Y','Y','Y','Y','Y','Y'),
  ('BHW_ADMIN', 'BILLING',  'Y','Y','Y','Y','Y','Y'),
  ('BHW_ADMIN', 'REPORTS',  'Y','Y','Y','Y','Y','Y'),
  ('BHW_ADMIN', 'ADMIN',    'Y','Y','Y','Y','Y','Y'),
-- BHW User: view masters; add/edit transactions; no delete; no admin
  ('BHW_USER',  'MASTERS',  'Y','N','N','N','N','N'),
  ('BHW_USER',  'ARRIVAL',  'Y','Y','Y','N','Y','Y'),
  ('BHW_USER',  'DELIVERY', 'Y','Y','Y','N','Y','Y'),
  ('BHW_USER',  'BILLING',  'Y','Y','Y','N','Y','Y'),
  ('BHW_USER',  'REPORTS',  'Y','N','N','N','Y','Y'),
  ('BHW_USER',  'ADMIN',    'N','N','N','N','N','N'),
-- VLCO Admin
  ('VLCO_ADMIN','MASTERS',  'Y','Y','Y','Y','Y','Y'),
  ('VLCO_ADMIN','ARRIVAL',  'Y','Y','Y','Y','Y','Y'),
  ('VLCO_ADMIN','DELIVERY', 'Y','Y','Y','Y','Y','Y'),
  ('VLCO_ADMIN','BILLING',  'Y','Y','Y','Y','Y','Y'),
  ('VLCO_ADMIN','REPORTS',  'Y','Y','Y','Y','Y','Y'),
  ('VLCO_ADMIN','ADMIN',    'Y','Y','Y','Y','Y','Y'),
-- VLCO User
  ('VLCO_USER', 'MASTERS',  'Y','N','N','N','N','N'),
  ('VLCO_USER', 'ARRIVAL',  'Y','Y','Y','N','Y','Y'),
  ('VLCO_USER', 'DELIVERY', 'Y','Y','Y','N','Y','Y'),
  ('VLCO_USER', 'BILLING',  'Y','Y','Y','N','Y','Y'),
  ('VLCO_USER', 'REPORTS',  'Y','N','N','N','Y','Y'),
  ('VLCO_USER', 'ADMIN',    'N','N','N','N','N','N');

-- Default Admin Users
-- IMPORTANT: Replace UserPassword with a real bcrypt hash before go-live.
-- Generate: node -e "require('bcrypt').hash('Admin@123',10).then(h=>console.log(h))"
-- Then:     UPDATE gms_admin.mUser SET UserPassword='<hash>' WHERE pkUserId IN ('bhw-admin-001','vlco-admin-001');
INSERT INTO mUser (pkUserId, fkGroupID, fkBranchID, UserCode, UserFullName, UserPassword, fkRoleID, Active, CrMod) VALUES
  ('bhw-admin-001',  'BHW',  'HO', 'ADMIN', 'BHW Administrator',  'CHANGE_ME_RUN_BCRYPT', 'BHW_ADMIN',  'Y', NOW()),
  ('vlco-admin-001', 'VLCO', 'HO', 'ADMIN', 'VLCO Administrator', 'CHANGE_ME_RUN_BCRYPT', 'VLCO_ADMIN', 'Y', NOW());


-- ============================================================
-- COMPANY DATABASE TABLE STRUCTURE
-- Shared masters   : mState, mHoliday, mItem, mGodown, mEmployee, mLocation, VCComboData
-- Company masters  : mTax, mBank, mParty, RateChart, PartyGodownLink
--
-- PKs for shared masters use UUID (randomUUID in Node).
-- VB6 equivalent: GroupID!SerialNum  e.g. BHW!1
-- Web equivalent: UUID v4  e.g. 3f6c1a2b-...
--
-- PKs for company masters also UUID.
-- VB6 equivalent: CompanyID!BranchID!SerialNum  e.g. ADS!HO!1
-- ============================================================


-- ============================================================
-- DATABASE 2 : gms_ads   (BHW group - PRIMARY company)
-- ============================================================
DROP DATABASE IF EXISTS gms_ads;
CREATE DATABASE gms_ads
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gms_ads;

-- SHARED: mState --------------------------------------------------
CREATE TABLE mState (
  pkStateID  VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkGroupID  VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  StateID    INT          NOT NULL  COMMENT 'Running display number',
  sInitial   VARCHAR(4)   NOT NULL,
  sName      VARCHAR(30)  NOT NULL,
  sCode      VARCHAR(4)   NOT NULL,
  sNote      TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL,
  CrMod      DATETIME     NOT NULL,
  PRIMARY KEY (pkStateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: mHoliday ------------------------------------------------
CREATE TABLE mHoliday (
  pkHldID    VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkGroupID  VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  HldID      INT          NOT NULL,
  hDate      DATETIME     NOT NULL,
  hFaYear    VARCHAR(10)  NOT NULL  COMMENT 'e.g. 2425 for Apr 2024 - Mar 2025',
  hBoard     VARCHAR(2)   NOT NULL DEFAULT 'N'  COMMENT 'Labour board holiday Y/N',
  hOffice    VARCHAR(2)   NOT NULL DEFAULT 'N'  COMMENT 'Office holiday Y/N',
  hName      VARCHAR(30)  NOT NULL,
  hNote      TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL,
  CrMod      DATETIME     NOT NULL,
  PRIMARY KEY (pkHldID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: mItem ---------------------------------------------------
CREATE TABLE mItem (
  pkItemID   VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkGroupID  VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  ItemID     INT          NOT NULL,
  iName      VARCHAR(30)  NOT NULL,
  iGroup     VARCHAR(15)  NOT NULL  COMMENT 'e.g. AGRI, INDU, FMCG',
  iType      VARCHAR(5)   NOT NULL,
  iNote      TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL,
  CrMod      DATETIME     NOT NULL,
  PRIMARY KEY (pkItemID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: mGodown -------------------------------------------------
CREATE TABLE mGodown (
  pkGodownID VARCHAR(100)  NOT NULL  COMMENT 'UUID',
  fkGroupID  VARCHAR(10)   NOT NULL,
  fkBranchID VARCHAR(10)   NOT NULL,
  GodownID   INT           NOT NULL,
  gNum       VARCHAR(5)    NOT NULL  COMMENT 'Short code  e.g. A1, B2',
  gRate      DECIMAL(6,2)  DEFAULT NULL  COMMENT 'Rent rate per sq ft',
  gSqrft     DECIMAL(8,2)  DEFAULT NULL  COMMENT 'Area in sq ft',
  gAmt       DECIMAL(8,2)  DEFAULT NULL  COMMENT 'Monthly rent amount',
  gOwner     VARCHAR(30)   DEFAULT NULL,
  gAdd       TEXT,
  gStartDt   DATETIME      DEFAULT NULL,
  gEndDt     DATETIME      DEFAULT NULL,
  gNote      TEXT,
  Active     VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100)  NOT NULL,
  CrMod      DATETIME      NOT NULL,
  PRIMARY KEY (pkGodownID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: mEmployee -----------------------------------------------
CREATE TABLE mEmployee (
  pkEmpID      VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkGroupID    VARCHAR(10)  NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL,
  EmpID        INT          NOT NULL,
  eName        VARCHAR(50)  NOT NULL,
  eShortName   VARCHAR(20)  NOT NULL,
  eAddress     TEXT         NOT NULL,
  eContect     VARCHAR(50)  NOT NULL  COMMENT 'Contact number',
  eType        VARCHAR(20)  NOT NULL  COMMENT 'e.g. Permanent, Contractual',
  eDesignation VARCHAR(20)  NOT NULL,
  eBoardRegNum VARCHAR(15)  NOT NULL  COMMENT 'Labour board registration number',
  eToliNum     VARCHAR(10)  NOT NULL  COMMENT 'Toli / gang number',
  eBoardName   VARCHAR(50)  NOT NULL,
  eNote        TEXT         NOT NULL,
  Active       VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL,
  CrMod        DATETIME     NOT NULL,
  PRIMARY KEY (pkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: mLocation  (named spots inside a godown) ---------------
-- New master — not present in the original VB6 system.
-- Allows tracking exactly WHERE inside a godown a lot is stored.
-- Example: Godown "G01" → Location "L1" (Left Side Row 1)
-- fkGodownID references pkGodownID in mGodown (same database).
-- Shared master: Primary company writes; syncToGroup() keeps siblings in sync.
CREATE TABLE mLocation (
  pkLocationID VARCHAR(100)  NOT NULL  COMMENT 'UUID v4',
  fkGroupID    VARCHAR(10)   NOT NULL,
  fkBranchID   VARCHAR(10)   NOT NULL,
  fkGodownID   VARCHAR(100)  NOT NULL  COMMENT 'pkGodownID from mGodown',
  LocationCode VARCHAR(10)   NOT NULL  COMMENT 'Short code e.g. L1, FRONT, BAY-A',
  LocationName VARCHAR(50)   NOT NULL  COMMENT 'Full name e.g. Left Side Row 1',
  lNote        TEXT,
  Active       VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100)  NOT NULL,
  CrMod        DATETIME      NOT NULL,
  PRIMARY KEY (pkLocationID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SHARED: VCComboData  (dropdown lookup values) -------------------
-- Composite PK: (fkGroupID, fkBranchID, VCPurpose, VCCode)
-- VCPurpose examples: PackingType, TransType, RateType,
--                     ItemGroup, ItemType, ChargeType, HamaliCode,
--                     LinkType, EmpType, Designation, BillType, LotType
CREATE TABLE VCComboData (
  fkGroupID  VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  VCPurpose  VARCHAR(30)  NOT NULL  COMMENT 'Dropdown category',
  VCCode     VARCHAR(30)  NOT NULL  COMMENT 'Internal code stored in master fields',
  VCData     VARCHAR(100) NOT NULL  COMMENT 'Display label in dropdown',
  VCSrtOrd   INT          NOT NULL DEFAULT 0,
  VCActive   VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (fkGroupID, fkBranchID, VCPurpose, VCCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COMPANY: mTax ---------------------------------------------------
-- Composite PK: company + branch + TaxCode + TaxFromDt
-- Hard delete (no Active flag on Tax table)
CREATE TABLE mTax (
  fkCompID   VARCHAR(10)   NOT NULL,
  fkBranchID VARCHAR(10)   NOT NULL,
  TaxCode    VARCHAR(30)   NOT NULL,
  TaxFromDt  DATETIME      NOT NULL  COMMENT 'Rate effective from',
  TaxToDt    DATETIME      DEFAULT NULL  COMMENT 'NULL = currently active rate',
  TaxType    VARCHAR(2)    NOT NULL  COMMENT 'e.g. ST=State Tax, CS=Central',
  TaxRate    DECIMAL(5,2)  NOT NULL,
  TaxDesc    VARCHAR(100)  DEFAULT NULL,
  PRIMARY KEY (fkCompID, fkBranchID, TaxCode, TaxFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COMPANY: mBank --------------------------------------------------
CREATE TABLE mBank (
  pkBankID    VARCHAR(100) NOT NULL  COMMENT 'UUID',
  bName       VARCHAR(50)  NOT NULL,
  bAcNo       VARCHAR(50)  NOT NULL,
  bIFSC       VARCHAR(20)  NOT NULL DEFAULT '',
  bBranch     VARCHAR(30)  NOT NULL DEFAULT '',
  bPrimeryFlg VARCHAR(3)   NOT NULL DEFAULT 'N'  COMMENT 'Y = primary account',
  fkCompID    VARCHAR(10)  NOT NULL,
  Active      VARCHAR(3)   NOT NULL DEFAULT 'Y',
  bNote       TEXT,
  PRIMARY KEY (pkBankID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COMPANY: mParty -------------------------------------------------
CREATE TABLE mParty (
  pkPartyID     VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkCompID      VARCHAR(10)  NOT NULL,
  fkBranchID    VARCHAR(10)  NOT NULL,
  PartyID       INT          NOT NULL,
  pName         VARCHAR(50)  DEFAULT NULL,
  pAlias        VARCHAR(20)  NOT NULL,
  pCode         VARCHAR(3)   NOT NULL  COMMENT 'Short code  e.g. JNB',
  pGroup        VARCHAR(30)  NOT NULL,
  pRef          VARCHAR(30)  DEFAULT NULL,
  pBillType     VARCHAR(5)   NOT NULL  COMMENT 'LOT, WT, UNIT',
  pEmail        VARCHAR(200) DEFAULT NULL,
  pBillAdd      TEXT,
  pStartDate    DATETIME     NOT NULL,
  pLotReNumFlg  VARCHAR(2)   NOT NULL DEFAULT 'N',
  StFlagGodRent VARCHAR(2)   NOT NULL DEFAULT 'Y'  COMMENT 'Y = eligible for godown rent billing',
  StFlagTrans   VARCHAR(2)   NOT NULL DEFAULT 'Y'  COMMENT 'Y = eligible for hamali billing',
  pLotType      VARCHAR(5)   NOT NULL  COMMENT 'OPEN, SEAL',
  GSTNo         VARCHAR(30)  NOT NULL,
  fkStateID     VARCHAR(100) NOT NULL,
  pNote         TEXT,
  Active        VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100) NOT NULL,
  CrMod         DATETIME     NOT NULL,
  PRIMARY KEY (pkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COMPANY: RateChart  (Contract Rates) ----------------------------
-- RateType GR = Godown Rent : BillRate required; fkItemID/TransType/HamaliCode/ChargeType blank
-- RateType HM = Hamali      : TransType required; BillRate = 0
CREATE TABLE RateChart (
  pkRateChartID VARCHAR(100)   NOT NULL  COMMENT 'UUID',
  fkCompID      VARCHAR(10)    NOT NULL,
  fkBranchID    VARCHAR(10)    NOT NULL,
  fkPartyID     VARCHAR(100)   NOT NULL,
  fkItemID      VARCHAR(100)   NOT NULL DEFAULT ''  COMMENT 'Empty for Godown Rent',
  RateType      VARCHAR(5)     NOT NULL  COMMENT 'GR = Godown Rent; HM = Hamali',
  TransType     VARCHAR(10)    NOT NULL DEFAULT ''  COMMENT 'ARV/DEP; empty for GR',
  PackingType   VARCHAR(20)    NOT NULL,
  FromDt        DATE           NOT NULL,
  ToDt          DATE           DEFAULT NULL  COMMENT 'NULL = current active rate',
  UnitFrom      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  UnitTo        DECIMAL(10,2)  NOT NULL DEFAULT 99999,
  ChargeType    VARCHAR(20)    NOT NULL DEFAULT '',
  HamaliCode    VARCHAR(20)    NOT NULL DEFAULT '',
  BillRate      DECIMAL(7,2)   NOT NULL DEFAULT 0,
  LabourRate    DECIMAL(7,2)   NOT NULL DEFAULT 0,
  Note          TEXT,
  Active        VARCHAR(2)     NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100)   NOT NULL,
  CrMod         DATETIME       NOT NULL,
  PRIMARY KEY (pkRateChartID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COMPANY: PartyGodownLink  (which godowns a party uses) ----------
CREATE TABLE PartyGodownLink (
  pkLinkID   VARCHAR(100) NOT NULL  COMMENT 'UUID',
  fkCompID   VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  fkPartyID  VARCHAR(100) NOT NULL,
  fkGodownID VARCHAR(100) NOT NULL,
  LinkType   VARCHAR(20)  NOT NULL  COMMENT 'Owner, Rent, Insurance, Lease',
  FromDt     DATE         NOT NULL,
  ToDt       DATE         DEFAULT NULL  COMMENT 'NULL = currently linked',
  Note       TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL,
  CrMod      DATETIME     NOT NULL,
  PRIMARY KEY (pkLinkID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seed: VCComboData for BHW group (gms_ads is the Primary) ─────
INSERT INTO VCComboData (fkGroupID, fkBranchID, VCPurpose, VCCode, VCData, VCSrtOrd, VCActive) VALUES
  -- Packing Types
  ('BHW','HO','PackingType','BAG',       'Bag',          1,'Y'),
  ('BHW','HO','PackingType','LOOSE',     'Loose',        2,'Y'),
  ('BHW','HO','PackingType','TARP',      'Tarpaulin',    3,'Y'),
  ('BHW','HO','PackingType','BUNDLE',    'Bundle',       4,'Y'),
  ('BHW','HO','PackingType','BOX',       'Box',          5,'Y'),
  -- Transaction Types
  ('BHW','HO','TransType','ARV',         'Arrival',      1,'Y'),
  ('BHW','HO','TransType','DEP',         'Departure',    2,'Y'),
  -- Rate Types
  ('BHW','HO','RateType','GR',           'Godown Rent',  1,'Y'),
  ('BHW','HO','RateType','HM',           'Hamali',       2,'Y'),
  -- Item Group
  ('BHW','HO','ItemGroup','AGRI',        'Agricultural', 1,'Y'),
  ('BHW','HO','ItemGroup','INDU',        'Industrial',   2,'Y'),
  ('BHW','HO','ItemGroup','FMCG',        'FMCG',         3,'Y'),
  -- Item Type
  ('BHW','HO','ItemType','AGRI',         'Agricultural', 1,'Y'),
  ('BHW','HO','ItemType','INDU',         'Industrial',   2,'Y'),
  -- Charge Type (hamali billing basis)
  ('BHW','HO','ChargeType','PER_BAG',    'Per Bag',      1,'Y'),
  ('BHW','HO','ChargeType','PER_TON',    'Per Ton',      2,'Y'),
  ('BHW','HO','ChargeType','PER_QTRL',   'Per Quintal',  3,'Y'),
  -- Hamali Code (labour gang)
  ('BHW','HO','HamaliCode','H1',         'Gang 1',       1,'Y'),
  ('BHW','HO','HamaliCode','H2',         'Gang 2',       2,'Y'),
  -- Link Type (PartyGodownLink)
  ('BHW','HO','LinkType','OWNER',        'Owner',        1,'Y'),
  ('BHW','HO','LinkType','RENT',         'Rent',         2,'Y'),
  ('BHW','HO','LinkType','INSURANCE',    'Insurance',    3,'Y'),
  ('BHW','HO','LinkType','LEASE',        'Lease',        4,'Y'),
  -- Employee Type
  ('BHW','HO','EmpType','PERM',          'Permanent',    1,'Y'),
  ('BHW','HO','EmpType','CONT',          'Contractual',  2,'Y'),
  ('BHW','HO','EmpType','DAILY',         'Daily Wage',   3,'Y'),
  -- Designation
  ('BHW','HO','Designation','LOADER',    'Loader',       1,'Y'),
  ('BHW','HO','Designation','SUPVSR',    'Supervisor',   2,'Y'),
  ('BHW','HO','Designation','WATCH',     'Watchman',     3,'Y'),
  ('BHW','HO','Designation','DRIVER',    'Driver',       4,'Y'),
  ('BHW','HO','Designation','CLERK',     'Clerk',        5,'Y'),
  -- Party Bill Type
  ('BHW','HO','BillType','LOT',          'Lot',          1,'Y'),
  ('BHW','HO','BillType','WT',           'Weight',       2,'Y'),
  ('BHW','HO','BillType','UNIT',         'Unit',         3,'Y'),
  -- Party Lot Type
  ('BHW','HO','LotType','OPEN',          'Open Lot',     1,'Y'),
  ('BHW','HO','LotType','SEAL',          'Seal Lot',     2,'Y');


-- ============================================================
-- DATABASE 3 : gms_test   (BHW group - secondary)
-- Identical table structure to gms_ads.
-- VCComboData copied from gms_ads (syncToGroup keeps it in sync at runtime).
-- ============================================================
DROP DATABASE IF EXISTS gms_test;
CREATE DATABASE gms_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gms_test;

CREATE TABLE mState (
  pkStateID  VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, StateID INT NOT NULL,
  sInitial   VARCHAR(4)   NOT NULL, sName VARCHAR(30) NOT NULL,
  sCode      VARCHAR(4)   NOT NULL, sNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkStateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mHoliday (
  pkHldID    VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, HldID INT NOT NULL,
  hDate      DATETIME     NOT NULL, hFaYear VARCHAR(10) NOT NULL,
  hBoard     VARCHAR(2)   NOT NULL DEFAULT 'N',
  hOffice    VARCHAR(2)   NOT NULL DEFAULT 'N',
  hName      VARCHAR(30)  NOT NULL, hNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkHldID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mItem (
  pkItemID   VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, ItemID INT NOT NULL,
  iName      VARCHAR(30)  NOT NULL, iGroup VARCHAR(15) NOT NULL,
  iType      VARCHAR(5)   NOT NULL, iNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkItemID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mGodown (
  pkGodownID VARCHAR(100)  NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)   NOT NULL, GodownID INT NOT NULL,
  gNum       VARCHAR(5)    NOT NULL, gRate DECIMAL(6,2) DEFAULT NULL,
  gSqrft     DECIMAL(8,2)  DEFAULT NULL, gAmt DECIMAL(8,2) DEFAULT NULL,
  gOwner     VARCHAR(30)   DEFAULT NULL, gAdd TEXT,
  gStartDt   DATETIME      DEFAULT NULL, gEndDt DATETIME DEFAULT NULL,
  gNote      TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkGodownID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mEmployee (
  pkEmpID      VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, EmpID INT NOT NULL,
  eName        VARCHAR(50)  NOT NULL, eShortName VARCHAR(20) NOT NULL,
  eAddress     TEXT         NOT NULL, eContect VARCHAR(50) NOT NULL,
  eType        VARCHAR(20)  NOT NULL, eDesignation VARCHAR(20) NOT NULL,
  eBoardRegNum VARCHAR(15)  NOT NULL, eToliNum VARCHAR(10) NOT NULL,
  eBoardName   VARCHAR(50)  NOT NULL, eNote TEXT NOT NULL,
  Active       VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE VCComboData (
  fkGroupID  VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  VCPurpose  VARCHAR(30)  NOT NULL, VCCode VARCHAR(30) NOT NULL,
  VCData     VARCHAR(100) NOT NULL, VCSrtOrd INT NOT NULL DEFAULT 0,
  VCActive   VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (fkGroupID, fkBranchID, VCPurpose, VCCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mTax (
  fkCompID   VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  TaxCode    VARCHAR(30)  NOT NULL, TaxFromDt DATETIME NOT NULL,
  TaxToDt    DATETIME     DEFAULT NULL, TaxType VARCHAR(2) NOT NULL,
  TaxRate    DECIMAL(5,2) NOT NULL, TaxDesc VARCHAR(100) DEFAULT NULL,
  PRIMARY KEY (fkCompID, fkBranchID, TaxCode, TaxFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mBank (
  pkBankID    VARCHAR(100) NOT NULL, bName VARCHAR(50) NOT NULL,
  bAcNo       VARCHAR(50)  NOT NULL, bIFSC VARCHAR(20) NOT NULL DEFAULT '',
  bBranch     VARCHAR(30)  NOT NULL DEFAULT '', bPrimeryFlg VARCHAR(3) NOT NULL DEFAULT 'N',
  fkCompID    VARCHAR(10)  NOT NULL, Active VARCHAR(3) NOT NULL DEFAULT 'Y',
  bNote       TEXT, PRIMARY KEY (pkBankID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mParty (
  pkPartyID     VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)  NOT NULL, PartyID INT NOT NULL,
  pName         VARCHAR(50)  DEFAULT NULL, pAlias VARCHAR(20) NOT NULL,
  pCode         VARCHAR(3)   NOT NULL, pGroup VARCHAR(30) NOT NULL,
  pRef          VARCHAR(30)  DEFAULT NULL, pBillType VARCHAR(5) NOT NULL,
  pEmail        VARCHAR(200) DEFAULT NULL, pBillAdd TEXT,
  pStartDate    DATETIME     NOT NULL, pLotReNumFlg VARCHAR(2) NOT NULL DEFAULT 'N',
  StFlagGodRent VARCHAR(2)   NOT NULL DEFAULT 'Y', StFlagTrans VARCHAR(2) NOT NULL DEFAULT 'Y',
  pLotType      VARCHAR(5)   NOT NULL, GSTNo VARCHAR(30) NOT NULL,
  fkStateID     VARCHAR(100) NOT NULL, pNote TEXT,
  Active        VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE RateChart (
  pkRateChartID VARCHAR(100)  NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)   NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkItemID      VARCHAR(100)  NOT NULL DEFAULT '', RateType VARCHAR(5) NOT NULL,
  TransType     VARCHAR(10)   NOT NULL DEFAULT '', PackingType VARCHAR(20) NOT NULL,
  FromDt        DATE          NOT NULL, ToDt DATE DEFAULT NULL,
  UnitFrom      DECIMAL(10,2) NOT NULL DEFAULT 0, UnitTo DECIMAL(10,2) NOT NULL DEFAULT 99999,
  ChargeType    VARCHAR(20)   NOT NULL DEFAULT '', HamaliCode VARCHAR(20) NOT NULL DEFAULT '',
  BillRate      DECIMAL(7,2)  NOT NULL DEFAULT 0, LabourRate DECIMAL(7,2) NOT NULL DEFAULT 0,
  Note          TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkRateChartID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE PartyGodownLink (
  pkLinkID   VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkGodownID VARCHAR(100) NOT NULL, LinkType VARCHAR(20) NOT NULL,
  FromDt     DATE         NOT NULL, ToDt DATE DEFAULT NULL, Note TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLinkID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mLocation (
  pkLocationID VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, fkGodownID VARCHAR(100) NOT NULL,
  LocationCode VARCHAR(10)  NOT NULL, LocationName VARCHAR(50) NOT NULL,
  lNote        TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLocationID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VCComboData for gms_test: sync from gms_ads (BHW Primary)
-- At runtime syncToGroup() keeps these in sync automatically.
INSERT INTO VCComboData SELECT * FROM gms_ads.VCComboData WHERE fkGroupID = 'BHW';


-- ============================================================
-- DATABASE 4 : gms_vlco   (VLCO group - PRIMARY company)
-- ============================================================
DROP DATABASE IF EXISTS gms_vlco;
CREATE DATABASE gms_vlco
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gms_vlco;

CREATE TABLE mState (
  pkStateID  VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, StateID INT NOT NULL,
  sInitial   VARCHAR(4)   NOT NULL, sName VARCHAR(30) NOT NULL,
  sCode      VARCHAR(4)   NOT NULL, sNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkStateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mHoliday (
  pkHldID    VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, HldID INT NOT NULL,
  hDate      DATETIME     NOT NULL, hFaYear VARCHAR(10) NOT NULL,
  hBoard     VARCHAR(2)   NOT NULL DEFAULT 'N',
  hOffice    VARCHAR(2)   NOT NULL DEFAULT 'N',
  hName      VARCHAR(30)  NOT NULL, hNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkHldID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mItem (
  pkItemID   VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, ItemID INT NOT NULL,
  iName      VARCHAR(30)  NOT NULL, iGroup VARCHAR(15) NOT NULL,
  iType      VARCHAR(5)   NOT NULL, iNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkItemID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mGodown (
  pkGodownID VARCHAR(100)  NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)   NOT NULL, GodownID INT NOT NULL,
  gNum       VARCHAR(5)    NOT NULL, gRate DECIMAL(6,2) DEFAULT NULL,
  gSqrft     DECIMAL(8,2)  DEFAULT NULL, gAmt DECIMAL(8,2) DEFAULT NULL,
  gOwner     VARCHAR(30)   DEFAULT NULL, gAdd TEXT,
  gStartDt   DATETIME      DEFAULT NULL, gEndDt DATETIME DEFAULT NULL,
  gNote      TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkGodownID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mEmployee (
  pkEmpID      VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, EmpID INT NOT NULL,
  eName        VARCHAR(50)  NOT NULL, eShortName VARCHAR(20) NOT NULL,
  eAddress     TEXT         NOT NULL, eContect VARCHAR(50) NOT NULL,
  eType        VARCHAR(20)  NOT NULL, eDesignation VARCHAR(20) NOT NULL,
  eBoardRegNum VARCHAR(15)  NOT NULL, eToliNum VARCHAR(10) NOT NULL,
  eBoardName   VARCHAR(50)  NOT NULL, eNote TEXT NOT NULL,
  Active       VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE VCComboData (
  fkGroupID  VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  VCPurpose  VARCHAR(30)  NOT NULL, VCCode VARCHAR(30) NOT NULL,
  VCData     VARCHAR(100) NOT NULL, VCSrtOrd INT NOT NULL DEFAULT 0,
  VCActive   VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (fkGroupID, fkBranchID, VCPurpose, VCCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mTax (
  fkCompID   VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  TaxCode    VARCHAR(30)  NOT NULL, TaxFromDt DATETIME NOT NULL,
  TaxToDt    DATETIME     DEFAULT NULL, TaxType VARCHAR(2) NOT NULL,
  TaxRate    DECIMAL(5,2) NOT NULL, TaxDesc VARCHAR(100) DEFAULT NULL,
  PRIMARY KEY (fkCompID, fkBranchID, TaxCode, TaxFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mBank (
  pkBankID    VARCHAR(100) NOT NULL, bName VARCHAR(50) NOT NULL,
  bAcNo       VARCHAR(50)  NOT NULL, bIFSC VARCHAR(20) NOT NULL DEFAULT '',
  bBranch     VARCHAR(30)  NOT NULL DEFAULT '', bPrimeryFlg VARCHAR(3) NOT NULL DEFAULT 'N',
  fkCompID    VARCHAR(10)  NOT NULL, Active VARCHAR(3) NOT NULL DEFAULT 'Y',
  bNote       TEXT, PRIMARY KEY (pkBankID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mParty (
  pkPartyID     VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)  NOT NULL, PartyID INT NOT NULL,
  pName         VARCHAR(50)  DEFAULT NULL, pAlias VARCHAR(20) NOT NULL,
  pCode         VARCHAR(3)   NOT NULL, pGroup VARCHAR(30) NOT NULL,
  pRef          VARCHAR(30)  DEFAULT NULL, pBillType VARCHAR(5) NOT NULL,
  pEmail        VARCHAR(200) DEFAULT NULL, pBillAdd TEXT,
  pStartDate    DATETIME     NOT NULL, pLotReNumFlg VARCHAR(2) NOT NULL DEFAULT 'N',
  StFlagGodRent VARCHAR(2)   NOT NULL DEFAULT 'Y', StFlagTrans VARCHAR(2) NOT NULL DEFAULT 'Y',
  pLotType      VARCHAR(5)   NOT NULL, GSTNo VARCHAR(30) NOT NULL,
  fkStateID     VARCHAR(100) NOT NULL, pNote TEXT,
  Active        VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE RateChart (
  pkRateChartID VARCHAR(100)  NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)   NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkItemID      VARCHAR(100)  NOT NULL DEFAULT '', RateType VARCHAR(5) NOT NULL,
  TransType     VARCHAR(10)   NOT NULL DEFAULT '', PackingType VARCHAR(20) NOT NULL,
  FromDt        DATE          NOT NULL, ToDt DATE DEFAULT NULL,
  UnitFrom      DECIMAL(10,2) NOT NULL DEFAULT 0, UnitTo DECIMAL(10,2) NOT NULL DEFAULT 99999,
  ChargeType    VARCHAR(20)   NOT NULL DEFAULT '', HamaliCode VARCHAR(20) NOT NULL DEFAULT '',
  BillRate      DECIMAL(7,2)  NOT NULL DEFAULT 0, LabourRate DECIMAL(7,2) NOT NULL DEFAULT 0,
  Note          TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkRateChartID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE PartyGodownLink (
  pkLinkID   VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkGodownID VARCHAR(100) NOT NULL, LinkType VARCHAR(20) NOT NULL,
  FromDt     DATE         NOT NULL, ToDt DATE DEFAULT NULL, Note TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLinkID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mLocation (
  pkLocationID VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, fkGodownID VARCHAR(100) NOT NULL,
  LocationCode VARCHAR(10)  NOT NULL, LocationName VARCHAR(50) NOT NULL,
  lNote        TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLocationID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: VCComboData for VLCO group
INSERT INTO VCComboData (fkGroupID, fkBranchID, VCPurpose, VCCode, VCData, VCSrtOrd, VCActive) VALUES
  ('VLCO','HO','PackingType','BAG',       'Bag',          1,'Y'),
  ('VLCO','HO','PackingType','LOOSE',     'Loose',        2,'Y'),
  ('VLCO','HO','PackingType','TARP',      'Tarpaulin',    3,'Y'),
  ('VLCO','HO','PackingType','BUNDLE',    'Bundle',       4,'Y'),
  ('VLCO','HO','PackingType','BOX',       'Box',          5,'Y'),
  ('VLCO','HO','TransType','ARV',         'Arrival',      1,'Y'),
  ('VLCO','HO','TransType','DEP',         'Departure',    2,'Y'),
  ('VLCO','HO','RateType','GR',           'Godown Rent',  1,'Y'),
  ('VLCO','HO','RateType','HM',           'Hamali',       2,'Y'),
  ('VLCO','HO','ItemGroup','AGRI',        'Agricultural', 1,'Y'),
  ('VLCO','HO','ItemGroup','INDU',        'Industrial',   2,'Y'),
  ('VLCO','HO','ItemGroup','FMCG',        'FMCG',         3,'Y'),
  ('VLCO','HO','ItemType','AGRI',         'Agricultural', 1,'Y'),
  ('VLCO','HO','ItemType','INDU',         'Industrial',   2,'Y'),
  ('VLCO','HO','ChargeType','PER_BAG',    'Per Bag',      1,'Y'),
  ('VLCO','HO','ChargeType','PER_TON',    'Per Ton',      2,'Y'),
  ('VLCO','HO','ChargeType','PER_QTRL',   'Per Quintal',  3,'Y'),
  ('VLCO','HO','HamaliCode','H1',         'Gang 1',       1,'Y'),
  ('VLCO','HO','HamaliCode','H2',         'Gang 2',       2,'Y'),
  ('VLCO','HO','LinkType','OWNER',        'Owner',        1,'Y'),
  ('VLCO','HO','LinkType','RENT',         'Rent',         2,'Y'),
  ('VLCO','HO','LinkType','INSURANCE',    'Insurance',    3,'Y'),
  ('VLCO','HO','LinkType','LEASE',        'Lease',        4,'Y'),
  ('VLCO','HO','EmpType','PERM',          'Permanent',    1,'Y'),
  ('VLCO','HO','EmpType','CONT',          'Contractual',  2,'Y'),
  ('VLCO','HO','EmpType','DAILY',         'Daily Wage',   3,'Y'),
  ('VLCO','HO','Designation','LOADER',    'Loader',       1,'Y'),
  ('VLCO','HO','Designation','SUPVSR',    'Supervisor',   2,'Y'),
  ('VLCO','HO','Designation','WATCH',     'Watchman',     3,'Y'),
  ('VLCO','HO','Designation','DRIVER',    'Driver',       4,'Y'),
  ('VLCO','HO','Designation','CLERK',     'Clerk',        5,'Y'),
  ('VLCO','HO','BillType','LOT',          'Lot',          1,'Y'),
  ('VLCO','HO','BillType','WT',           'Weight',       2,'Y'),
  ('VLCO','HO','BillType','UNIT',         'Unit',         3,'Y'),
  ('VLCO','HO','LotType','OPEN',          'Open Lot',     1,'Y'),
  ('VLCO','HO','LotType','SEAL',          'Seal Lot',     2,'Y');


-- ============================================================
-- DATABASE 5 : gms_test1   (VLCO group - secondary)
-- ============================================================
DROP DATABASE IF EXISTS gms_test1;
CREATE DATABASE gms_test1
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gms_test1;

CREATE TABLE mState (
  pkStateID  VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, StateID INT NOT NULL,
  sInitial   VARCHAR(4)   NOT NULL, sName VARCHAR(30) NOT NULL,
  sCode      VARCHAR(4)   NOT NULL, sNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkStateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mHoliday (
  pkHldID    VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, HldID INT NOT NULL,
  hDate      DATETIME     NOT NULL, hFaYear VARCHAR(10) NOT NULL,
  hBoard     VARCHAR(2)   NOT NULL DEFAULT 'N',
  hOffice    VARCHAR(2)   NOT NULL DEFAULT 'N',
  hName      VARCHAR(30)  NOT NULL, hNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkHldID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mItem (
  pkItemID   VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, ItemID INT NOT NULL,
  iName      VARCHAR(30)  NOT NULL, iGroup VARCHAR(15) NOT NULL,
  iType      VARCHAR(5)   NOT NULL, iNote TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkItemID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mGodown (
  pkGodownID VARCHAR(100)  NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)   NOT NULL, GodownID INT NOT NULL,
  gNum       VARCHAR(5)    NOT NULL, gRate DECIMAL(6,2) DEFAULT NULL,
  gSqrft     DECIMAL(8,2)  DEFAULT NULL, gAmt DECIMAL(8,2) DEFAULT NULL,
  gOwner     VARCHAR(30)   DEFAULT NULL, gAdd TEXT,
  gStartDt   DATETIME      DEFAULT NULL, gEndDt DATETIME DEFAULT NULL,
  gNote      TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkGodownID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mEmployee (
  pkEmpID      VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, EmpID INT NOT NULL,
  eName        VARCHAR(50)  NOT NULL, eShortName VARCHAR(20) NOT NULL,
  eAddress     TEXT         NOT NULL, eContect VARCHAR(50) NOT NULL,
  eType        VARCHAR(20)  NOT NULL, eDesignation VARCHAR(20) NOT NULL,
  eBoardRegNum VARCHAR(15)  NOT NULL, eToliNum VARCHAR(10) NOT NULL,
  eBoardName   VARCHAR(50)  NOT NULL, eNote TEXT NOT NULL,
  Active       VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE VCComboData (
  fkGroupID  VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  VCPurpose  VARCHAR(30)  NOT NULL, VCCode VARCHAR(30) NOT NULL,
  VCData     VARCHAR(100) NOT NULL, VCSrtOrd INT NOT NULL DEFAULT 0,
  VCActive   VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (fkGroupID, fkBranchID, VCPurpose, VCCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mTax (
  fkCompID   VARCHAR(10)  NOT NULL, fkBranchID VARCHAR(10) NOT NULL,
  TaxCode    VARCHAR(30)  NOT NULL, TaxFromDt DATETIME NOT NULL,
  TaxToDt    DATETIME     DEFAULT NULL, TaxType VARCHAR(2) NOT NULL,
  TaxRate    DECIMAL(5,2) NOT NULL, TaxDesc VARCHAR(100) DEFAULT NULL,
  PRIMARY KEY (fkCompID, fkBranchID, TaxCode, TaxFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mBank (
  pkBankID    VARCHAR(100) NOT NULL, bName VARCHAR(50) NOT NULL,
  bAcNo       VARCHAR(50)  NOT NULL, bIFSC VARCHAR(20) NOT NULL DEFAULT '',
  bBranch     VARCHAR(30)  NOT NULL DEFAULT '', bPrimeryFlg VARCHAR(3) NOT NULL DEFAULT 'N',
  fkCompID    VARCHAR(10)  NOT NULL, Active VARCHAR(3) NOT NULL DEFAULT 'Y',
  bNote       TEXT, PRIMARY KEY (pkBankID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mParty (
  pkPartyID     VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)  NOT NULL, PartyID INT NOT NULL,
  pName         VARCHAR(50)  DEFAULT NULL, pAlias VARCHAR(20) NOT NULL,
  pCode         VARCHAR(3)   NOT NULL, pGroup VARCHAR(30) NOT NULL,
  pRef          VARCHAR(30)  DEFAULT NULL, pBillType VARCHAR(5) NOT NULL,
  pEmail        VARCHAR(200) DEFAULT NULL, pBillAdd TEXT,
  pStartDate    DATETIME     NOT NULL, pLotReNumFlg VARCHAR(2) NOT NULL DEFAULT 'N',
  StFlagGodRent VARCHAR(2)   NOT NULL DEFAULT 'Y', StFlagTrans VARCHAR(2) NOT NULL DEFAULT 'Y',
  pLotType      VARCHAR(5)   NOT NULL, GSTNo VARCHAR(30) NOT NULL,
  fkStateID     VARCHAR(100) NOT NULL, pNote TEXT,
  Active        VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE RateChart (
  pkRateChartID VARCHAR(100)  NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID    VARCHAR(10)   NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkItemID      VARCHAR(100)  NOT NULL DEFAULT '', RateType VARCHAR(5) NOT NULL,
  TransType     VARCHAR(10)   NOT NULL DEFAULT '', PackingType VARCHAR(20) NOT NULL,
  FromDt        DATE          NOT NULL, ToDt DATE DEFAULT NULL,
  UnitFrom      DECIMAL(10,2) NOT NULL DEFAULT 0, UnitTo DECIMAL(10,2) NOT NULL DEFAULT 99999,
  ChargeType    VARCHAR(20)   NOT NULL DEFAULT '', HamaliCode VARCHAR(20) NOT NULL DEFAULT '',
  BillRate      DECIMAL(7,2)  NOT NULL DEFAULT 0, LabourRate DECIMAL(7,2) NOT NULL DEFAULT 0,
  Note          TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(100)  NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkRateChartID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE PartyGodownLink (
  pkLinkID   VARCHAR(100) NOT NULL, fkCompID VARCHAR(10) NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL, fkPartyID VARCHAR(100) NOT NULL,
  fkGodownID VARCHAR(100) NOT NULL, LinkType VARCHAR(20) NOT NULL,
  FromDt     DATE         NOT NULL, ToDt DATE DEFAULT NULL, Note TEXT,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLinkID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mLocation (
  pkLocationID VARCHAR(100) NOT NULL, fkGroupID VARCHAR(10) NOT NULL,
  fkBranchID   VARCHAR(10)  NOT NULL, fkGodownID VARCHAR(100) NOT NULL,
  LocationCode VARCHAR(10)  NOT NULL, LocationName VARCHAR(50) NOT NULL,
  lNote        TEXT, Active VARCHAR(2) NOT NULL DEFAULT 'Y',
  fkUserID     VARCHAR(100) NOT NULL, CrMod DATETIME NOT NULL,
  PRIMARY KEY (pkLocationID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VCComboData for gms_test1: sync from gms_vlco (VLCO Primary)
INSERT INTO VCComboData SELECT * FROM gms_vlco.VCComboData WHERE fkGroupID = 'VLCO';


-- ============================================================
-- FaYearInfo  (Financial Year definition — per company, per type N/A)
-- PK: fkCompID + FaYear + Nor_Alt
-- Seeded manually per company for each fiscal year before transactions begin.
-- ============================================================

CREATE TABLE IF NOT EXISTS gms_ads.FaYearInfo (
  fkCompID   VARCHAR(10)  NOT NULL,
  FaYear     VARCHAR(10)  NOT NULL,
  Nor_Alt    VARCHAR(2)   NOT NULL  COMMENT 'N=Normal, A=Alternate',
  fkBranchID VARCHAR(10)  NULL,
  StartDate  DATETIME     NOT NULL,
  EndDate    DATETIME     NOT NULL,
  NextFaYear VARCHAR(10)  NOT NULL DEFAULT '',
  LockFlg    VARCHAR(2)   NOT NULL DEFAULT 'N',
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID   VARCHAR(100) NOT NULL,
  CrMod      DATETIME     NOT NULL,
  PRIMARY KEY (fkCompID, FaYear, Nor_Alt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gms_test.FaYearInfo LIKE gms_ads.FaYearInfo;
CREATE TABLE IF NOT EXISTS gms_vlco.FaYearInfo LIKE gms_ads.FaYearInfo;
CREATE TABLE IF NOT EXISTS gms_test1.FaYearInfo LIKE gms_ads.FaYearInfo;

-- Seed: FY 2025-26 (01-Apr-2025 to 31-Mar-2026) for all companies, Normal type
INSERT IGNORE INTO gms_ads.FaYearInfo   (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('ADS',   '2526', 'N', 'HO', '2025-04-01', '2026-03-31', '2627', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_test.FaYearInfo  (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('TEST',  '2526', 'N', 'HO', '2025-04-01', '2026-03-31', '2627', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_vlco.FaYearInfo  (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('VLCO',  '2526', 'N', 'HO', '2025-04-01', '2026-03-31', '2627', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_test1.FaYearInfo (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('TEST1', '2526', 'N', 'HO', '2025-04-01', '2026-03-31', '2627', 'N', 'Y', 'SYSTEM', NOW());

-- Seed: FY 2026-27 (01-Apr-2026 to 31-Mar-2027) — covers today (Jun 2026)
INSERT IGNORE INTO gms_ads.FaYearInfo   (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('ADS',   '2627', 'N', 'HO', '2026-04-01', '2027-03-31', '2728', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_test.FaYearInfo  (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('TEST',  '2627', 'N', 'HO', '2026-04-01', '2027-03-31', '2728', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_vlco.FaYearInfo  (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('VLCO',  '2627', 'N', 'HO', '2026-04-01', '2027-03-31', '2728', 'N', 'Y', 'SYSTEM', NOW());
INSERT IGNORE INTO gms_test1.FaYearInfo (fkCompID, FaYear, Nor_Alt, fkBranchID, StartDate, EndDate, NextFaYear, LockFlg, Active, fkUserID, CrMod) VALUES ('TEST1', '2627', 'N', 'HO', '2026-04-01', '2027-03-31', '2728', 'N', 'Y', 'SYSTEM', NOW());


-- ============================================================
-- TRANSACTION TABLES  (run in each company DB: gms_ads, gms_test, gms_vlco, gms_test1)
-- ============================================================

-- SerialID: one row per key, generates pkTransID and pfkLotID counters
-- Key format: 'COMPID!BRANCHID!TSTOCKENT!PKTRANSID'  and  'COMPID!BRANCHID!LOTID!PFKLOTID'
CREATE TABLE IF NOT EXISTS gms_ads.SerialID (
  pkSerialID  VARCHAR(100) NOT NULL,
  LastID      DECIMAL(6,0) NOT NULL DEFAULT 0,
  SerialDesc  VARCHAR(50)  NOT NULL DEFAULT '',
  PRIMARY KEY (pkSerialID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gms_test.SerialID LIKE gms_ads.SerialID;
CREATE TABLE IF NOT EXISTS gms_vlco.SerialID LIKE gms_ads.SerialID;
CREATE TABLE IF NOT EXISTS gms_test1.SerialID LIKE gms_ads.SerialID;

-- SerialIDLot: sequential counter per party/year/type for LotNum generation
CREATE TABLE IF NOT EXISTS gms_ads.SerialIDLot (
  fkCompID   VARCHAR(10)  NOT NULL,
  fkBranchID VARCHAR(10)  NOT NULL,
  fkPartyID  VARCHAR(100) NOT NULL,
  FaYear     VARCHAR(10)  NOT NULL,
  LotBillFlg VARCHAR(2)   NOT NULL,
  ItemType   VARCHAR(5)   NOT NULL,
  LastNum    DECIMAL(6,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gms_test.SerialIDLot LIKE gms_ads.SerialIDLot;
CREATE TABLE IF NOT EXISTS gms_vlco.SerialIDLot LIKE gms_ads.SerialIDLot;
CREATE TABLE IF NOT EXISTS gms_test1.SerialIDLot LIKE gms_ads.SerialIDLot;

-- tStockEntry: main transaction table (Arrival, DespReturn, In, Despatch, Transfer, Out)
CREATE TABLE IF NOT EXISTS gms_ads.tStockEntry (
  pkTransID      VARCHAR(100)   NOT NULL,
  fkCompID       VARCHAR(10)   NOT NULL,
  fkBranchID     VARCHAR(10)   NOT NULL,
  OpFlg          CHAR(1)       NOT NULL DEFAULT 'N',
  TransType      VARCHAR(10)   NOT NULL,
  FaYear         VARCHAR(10)   NOT NULL,
  pfkLotID       VARCHAR(100)   NOT NULL,
  pfkOriLotID    VARCHAR(100)   NOT NULL DEFAULT '',
  LotNum         VARCHAR(20)   NOT NULL DEFAULT '',
  fkPartyID      VARCHAR(100)   NOT NULL,
  fkItemID       VARCHAR(100)   NOT NULL,
  ItemExtDesc    VARCHAR(20)  NOT NULL DEFAULT '',
  Packing        VARCHAR(10)  NOT NULL DEFAULT '',
  PackingType    VARCHAR(10)   NOT NULL DEFAULT '',
  PackingColour  VARCHAR(10)   NOT NULL DEFAULT '',
  PackWght       DECIMAL(9,4) NOT NULL DEFAULT 0,
  GrossWght      DECIMAL(9,4) NOT NULL DEFAULT 0,
  RentRate       DECIMAL(10,2) NOT NULL DEFAULT 0,
  ItemRate       DECIMAL(10,4) NOT NULL DEFAULT 0,
  TransRemark    VARCHAR(100)  NOT NULL DEFAULT '',
  LotBillFlg     CHAR(2)       NOT NULL DEFAULT 'Y',
  OriTransDt     DATE          NULL,
  OriTransQty    DECIMAL(10,4) NOT NULL DEFAULT 0,
  TransDt        DATE          NOT NULL,
  TransTm        DATETIME      NOT NULL,
  TransQty       DECIMAL(10,4) NOT NULL DEFAULT 0,
  DoNum          VARCHAR(10)   NOT NULL DEFAULT '',
  GatePass       VARCHAR(10)   NOT NULL DEFAULT '',
  fkGodownID1    VARCHAR(100)   NOT NULL DEFAULT '',
  GodownQty1     DECIMAL(10,4) NOT NULL DEFAULT 0,
  fkGodownID2    VARCHAR(100)   NOT NULL DEFAULT '',
  GodownQty2     DECIMAL(10,4) NOT NULL DEFAULT 0,
  VehiNum        VARCHAR(20)   NOT NULL DEFAULT '',
  BENum          VARCHAR(20)   NOT NULL DEFAULT '',
  ActualWght     DECIMAL(10,4) NOT NULL DEFAULT 0,
  HamaliCode     VARCHAR(5)   NOT NULL DEFAULT '',
  HamaliRecd     DECIMAL(10,2) NOT NULL DEFAULT 0,
  HamaliAmt      DECIMAL(10,2) NOT NULL DEFAULT 0,
  HmlBillAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  OtherHmlAmt    DECIMAL(10,2) NOT NULL DEFAULT 0,
  OutsideLabr    CHAR(2)       NOT NULL DEFAULT 'N',
  OwnTransFlg    CHAR(2)       NOT NULL DEFAULT 'N',
  BatchNum       TEXT,
  TransNote      TEXT,
  TransExtDetail TEXT,
  DelivOpt       VARCHAR(20)   NOT NULL DEFAULT '',
  UserID         VARCHAR(10)  NOT NULL,
  CrMod          DATETIME      NOT NULL,
  PRIMARY KEY (pkTransID),
  INDEX idx_type_year  (TransType, FaYear),
  INDEX idx_party_year (fkPartyID, FaYear),
  INDEX idx_lotid      (pfkLotID),
  INDEX idx_transdt    (TransDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gms_test.tStockEntry LIKE gms_ads.tStockEntry;
CREATE TABLE IF NOT EXISTS gms_vlco.tStockEntry LIKE gms_ads.tStockEntry;
CREATE TABLE IF NOT EXISTS gms_test1.tStockEntry LIKE gms_ads.tStockEntry;

-- vStkTransQty: balance view — UNION ALL of both godown columns
-- (Mirrors VB6 SQL Server view exactly; GodownQty2=0 rows excluded from second union)
CREATE OR REPLACE VIEW gms_ads.vStkTransQty AS
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID1 AS fkGodownID, GodownQty1 AS GodownQty,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_ads.tStockEntry
  UNION ALL
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID2, GodownQty2,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_ads.tStockEntry
  WHERE GodownQty2 <> 0;

CREATE OR REPLACE VIEW gms_test.vStkTransQty AS
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID1 AS fkGodownID, GodownQty1 AS GodownQty,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_test.tStockEntry
  UNION ALL
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID2, GodownQty2,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_test.tStockEntry
  WHERE GodownQty2 <> 0;

CREATE OR REPLACE VIEW gms_vlco.vStkTransQty AS
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID1 AS fkGodownID, GodownQty1 AS GodownQty,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_vlco.tStockEntry
  UNION ALL
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID2, GodownQty2,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_vlco.tStockEntry
  WHERE GodownQty2 <> 0;

CREATE OR REPLACE VIEW gms_test1.vStkTransQty AS
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID1 AS fkGodownID, GodownQty1 AS GodownQty,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_test1.tStockEntry
  UNION ALL
  SELECT fkCompID, pfkLotID, pkTransID, TransDt, TransType,
         fkGodownID2, GodownQty2,
         fkPartyID, fkItemID, LotNum, ItemExtDesc, OpFlg,
         pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
  FROM gms_test1.tStockEntry
  WHERE GodownQty2 <> 0;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- DONE. Post-setup checklist:
-- ============================================================
-- 1. Generate bcrypt password hash:
--      cd gms-web/backend
--      node -e "require('bcrypt').hash('Admin@123',10).then(h=>console.log(h))"
--
-- 2. Paste the hash into MySQL:
--      UPDATE gms_admin.mUser SET UserPassword='<hash>'
--      WHERE pkUserId IN ('bhw-admin-001', 'vlco-admin-001');
--
-- 3. Create/update gms-web/backend/.env:
--      ADMIN_DB_NAME=gms_admin
--      DB_HOST=localhost
--      DB_PORT=3306
--      DB_USER=root
--      DB_PASSWORD=your_mysql_password
--      JWT_SECRET=your_long_random_secret
--      JWT_EXPIRES_IN=8h
--      FRONTEND_URL=http://localhost:5173
--      PORT=5000
--
-- 4. Start the server:
--      cd gms-web/backend && npm run dev
-- ============================================================
