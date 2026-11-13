-- ─────────────────────────────────────────────────────────
-- GMS — Godown Management System
-- MySQL 8.0 Schema
-- Generated from script.sql (SQL Server source, dated 25-05-2026)
--
-- SINGLE DATABASE: all companies (ADS, KPS, VLCO) share one DB.
-- fkCompID on every table is the company discriminator.
-- ─────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS gms_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gms_db;

-- ─────────────────────────────────────────────────────────
-- SYSTEM / SETUP TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mCompany (
  pkCompID        VARCHAR(10)   NOT NULL,
  CompName        VARCHAR(30)   NOT NULL,
  CompAlias       VARCHAR(15)   NOT NULL,
  CompAdd         TEXT,
  CompTel         VARCHAR(20),
  CompPAN         VARCHAR(20),
  CompST          VARCHAR(20),
  CompRegNum      VARCHAR(20),
  CompTransST     VARCHAR(20),
  CompGST         VARCHAR(30),
  HSNCode         VARCHAR(10),
  NameOfService   VARCHAR(50),
  StateCode       VARCHAR(4),
  StateName       VARCHAR(30),
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mUser (
  pkUserId        VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  UserCode        VARCHAR(10)   NOT NULL,
  UserFullName    VARCHAR(30)   NOT NULL,
  UserPassword    VARCHAR(255)  NOT NULL,
  fkRoleID        VARCHAR(20)   NOT NULL DEFAULT 'ADMIN',
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkUserId),
  UNIQUE KEY uq_user (fkCompID, UserCode),
  KEY fk_user_comp (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCSetup (
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  DefaultBranchID VARCHAR(10)   NOT NULL,
  SetupNotes      TEXT,
  PRIMARY KEY (fkCompID, fkBranchID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCParam (
  fkCompID        VARCHAR(10)   NOT NULL,
  DefaComp        VARCHAR(2)    NOT NULL,
  Notes           TEXT,
  PRIMARY KEY (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCComboData (
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchId      VARCHAR(10)   NOT NULL,
  VCPurpose       VARCHAR(50)   NOT NULL,
  VCCode          VARCHAR(50)   NOT NULL,
  VCData          VARCHAR(50)   NOT NULL,
  VCSrtOrd        DECIMAL(5,3)  NOT NULL,
  VCActive        VARCHAR(2)    NOT NULL DEFAULT 'Y',
  VCDesc          VARCHAR(100)  NOT NULL,
  PRIMARY KEY (fkCompId, fkBranchId, VCPurpose, VCCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SerialID (
  pkSerialID      VARCHAR(100)  NOT NULL,
  LastID          DECIMAL(6,0)  NOT NULL DEFAULT 0,
  SerialDesc      VARCHAR(50)   NOT NULL,
  PRIMARY KEY (pkSerialID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SerialIDLot (
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  FaYear          VARCHAR(10)   NOT NULL,
  LotBillFlg      VARCHAR(2)    NOT NULL,
  ItemType        VARCHAR(5)    NOT NULL,
  LastNum         DECIMAL(6,0)  NOT NULL DEFAULT 0,
  PRIMARY KEY (fkCompID, fkBranchID, fkPartyID, FaYear, LotBillFlg, ItemType)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCSeriesMast (
  pkSeriesID      VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(100)  NOT NULL,
  fkBranchID      VARCHAR(100)  NOT NULL,
  Series          DECIMAL(10,0) NOT NULL,
  SeriesCode      VARCHAR(25)   NOT NULL,
  SeriesName      VARCHAR(50)   NOT NULL,
  SeriesAlias     VARCHAR(20)   NOT NULL,
  SeriesType      VARCHAR(5)    NOT NULL,
  FormatStr       VARCHAR(50)   NOT NULL,
  FA_Nor_Alt      VARCHAR(2)    NOT NULL DEFAULT 'N',
  SeriesNote      TEXT,
  ExportF         VARCHAR(5),
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  UserID          VARCHAR(50)   NOT NULL,
  CreateModify    DATETIME      NOT NULL,
  PRIMARY KEY (pkSeriesID),
  UNIQUE KEY uq_series (fkCompID, fkBranchID, SeriesCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCSeriesSrno (
  fkSeriesID      VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(100)  NOT NULL,
  fkBranchID      VARCHAR(100)  NOT NULL,
  SeriesID        DECIMAL(4,0)  NOT NULL,
  FaYear          VARCHAR(9)    NOT NULL,
  SeriesDate      VARCHAR(8)    NOT NULL,
  LastNo          DECIMAL(10,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (fkSeriesID, fkCompID, fkBranchID, FaYear, SeriesDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS FaYearInfo (
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  FaYear          VARCHAR(10)   NOT NULL,
  Nor_Alt         VARCHAR(2)    NOT NULL DEFAULT 'N',
  StartDate       DATETIME      NOT NULL,
  EndDate         DATETIME      NOT NULL,
  NextFaYear      VARCHAR(10)   NOT NULL,
  LockFlg         VARCHAR(2)    NOT NULL DEFAULT 'N',
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (fkCompID, FaYear, Nor_Alt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VCDateLock (
  pkLockDateID    VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  LockCode        VARCHAR(15)   NOT NULL,
  LockDesc        VARCHAR(50)   NOT NULL,
  LockType        VARCHAR(20)   NOT NULL,
  LockDate        DATETIME,
  LockDays        DECIMAL(5,0),
  PRIMARY KEY (pkLockDateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mCompBillDate (
  fkCompID        VARCHAR(10)   NOT NULL,
  FromYearMonth   VARCHAR(10)   NOT NULL,
  ToYearMonth     VARCHAR(10),
  BillDay         DECIMAL(3,0)  NOT NULL,
  NextYearMonth   VARCHAR(10),
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (fkCompID, FromYearMonth)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mCompRegDetail (
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  RegCode         VARCHAR(10)   NOT NULL,
  RegFromDt       DATETIME      NOT NULL,
  RegToDt         DATETIME,
  RegNum          VARCHAR(25)   NOT NULL,
  RegDesc         VARCHAR(50)   NOT NULL,
  PRIMARY KEY (fkCompID, fkBranchID, RegCode, RegFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- MASTER DATA TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mState (
  pkStateID       VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  StateID         INT           NOT NULL,
  sInitial        VARCHAR(4)    NOT NULL,
  sName           VARCHAR(30)   NOT NULL,
  sCode           VARCHAR(4)    NOT NULL,
  sNote           TEXT,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkStateID),
  KEY idx_state_comp (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mTax (
  fkCompID        VARCHAR(100)  NOT NULL,
  fkBranchID      VARCHAR(100)  NOT NULL,
  TaxCode         VARCHAR(30)   NOT NULL,
  TaxFromDt       DATETIME      NOT NULL,
  TaxToDt         DATETIME,
  TaxType         VARCHAR(2)    NOT NULL,
  TaxRate         DECIMAL(5,2)  NOT NULL,
  TaxDesc         VARCHAR(100),
  PRIMARY KEY (fkCompID, fkBranchID, TaxCode, TaxFromDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mParty (
  pkPartyID       VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  PartyID         INT           NOT NULL,
  pName           VARCHAR(50),
  pAlias          VARCHAR(20)   NOT NULL,
  pCode           VARCHAR(3)    NOT NULL,
  pGroup          VARCHAR(30)   NOT NULL,
  pRef            VARCHAR(30),
  pBillType       VARCHAR(5)    NOT NULL,
  pEmail          VARCHAR(200),
  pBillAdd        TEXT,
  pStartDate      DATETIME      NOT NULL,
  pLotReNumFlg    VARCHAR(2)    NOT NULL DEFAULT 'N',
  StFlagGodRent   VARCHAR(2)    NOT NULL DEFAULT 'N',
  StFlagTrans     VARCHAR(2)    NOT NULL DEFAULT 'N',
  pLotType        VARCHAR(5)    NOT NULL,
  GSTNo           VARCHAR(30)   NOT NULL DEFAULT '',
  fkStateID       VARCHAR(100)  NOT NULL DEFAULT '',
  pNote           TEXT,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkPartyID),
  KEY idx_party_comp (fkCompID, fkBranchID),
  KEY idx_party_group (pGroup)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mItem (
  pkItemID        VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  ItemID          INT           NOT NULL,
  iName           VARCHAR(30)   NOT NULL,
  iGroup          VARCHAR(15)   NOT NULL,
  iType           VARCHAR(5)    NOT NULL,
  iNote           TEXT,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkItemID),
  KEY idx_item_comp (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mGodown (
  pkGodownID      VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  GodownID        INT           NOT NULL,
  gNum            VARCHAR(5)    NOT NULL,
  gRate           DECIMAL(6,2),
  gSqrft          DECIMAL(8,2),
  gAmt            DECIMAL(8,2),
  gOwner          VARCHAR(30),
  gAdd            TEXT,
  gStartDt        DATETIME,
  gEndDt          DATETIME,
  gNote           TEXT,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkGodownID),
  KEY idx_godown_comp (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mEmployee (
  pkEmpID         VARCHAR(100)  NOT NULL,
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  EmpID           INT           NOT NULL,
  eName           VARCHAR(50)   NOT NULL,
  eShortName      VARCHAR(20)   NOT NULL,
  eAddress        TEXT          NOT NULL,
  eContect        VARCHAR(50)   NOT NULL DEFAULT '',
  eType           VARCHAR(20)   NOT NULL,
  eDesignation    VARCHAR(20)   NOT NULL DEFAULT '',
  eBoardRegNum    VARCHAR(15)   NOT NULL DEFAULT '',
  eToliNum        VARCHAR(10)   NOT NULL DEFAULT '',
  eBoardName      VARCHAR(50)   NOT NULL DEFAULT '',
  eNote           TEXT          NOT NULL,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkEmpID),
  KEY idx_emp_comp (fkCompId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mHoliday (
  pkHldID         VARCHAR(100)  NOT NULL,
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  HldID           INT           NOT NULL,
  hDate           DATETIME      NOT NULL,
  hFaYear         VARCHAR(10)   NOT NULL,
  hBoard          VARCHAR(2)    NOT NULL DEFAULT 'N',
  hOffice         VARCHAR(2)    NOT NULL DEFAULT 'N',
  hName           VARCHAR(30)   NOT NULL,
  hNote           TEXT          NOT NULL,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkHldID),
  KEY idx_hld_comp (fkCompId, hFaYear)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mBank (
  pkBankID        VARCHAR(100)  NOT NULL,
  bName           VARCHAR(50)   NOT NULL,
  bAcNo           VARCHAR(50)   NOT NULL,
  bIFSC           VARCHAR(20)   NOT NULL DEFAULT '',
  bBranch         VARCHAR(30)   NOT NULL DEFAULT '',
  bPrimeryFlg     VARCHAR(3)    NOT NULL DEFAULT 'N',
  fkCompID        VARCHAR(100)  NOT NULL,
  Active          VARCHAR(3)    NOT NULL DEFAULT 'Y',
  bNote           TEXT,
  PRIMARY KEY (pkBankID),
  KEY idx_bank_comp (fkCompID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS PartyGodownLink (
  pkLinkID        VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  fkPartyID       VARCHAR(10)   NOT NULL,
  fkGodownID      VARCHAR(10)   NOT NULL,
  LinkType        VARCHAR(5)    NOT NULL,
  FromDt          DATETIME      NOT NULL,
  ToDt            DATETIME,
  Note            TEXT,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkLinkID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS RateChart (
  pkRateChartID   VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  fkItemID        VARCHAR(100)  NOT NULL,
  RateType        VARCHAR(5)    NOT NULL,
  TransType       VARCHAR(5)    NOT NULL,
  PackingType     VARCHAR(20)   NOT NULL DEFAULT '',
  FromDt          DATETIME      NOT NULL,
  ToDt            DATETIME,
  UnitFrom        DECIMAL(10,2) NOT NULL DEFAULT 0,
  UnitTo          DECIMAL(10,2) NOT NULL DEFAULT 0,
  ChargeType      VARCHAR(20)   NOT NULL DEFAULT '',
  HamaliCode      VARCHAR(5)    NOT NULL DEFAULT '',
  BillRate        DECIMAL(7,2)  NOT NULL DEFAULT 0,
  LabourRate      DECIMAL(7,2)  NOT NULL DEFAULT 0,
  Note            TEXT          NOT NULL,
  Active          VARCHAR(2)    NOT NULL DEFAULT 'Y',
  fkUserID        VARCHAR(10)   NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkRateChartID),
  KEY idx_rate_comp (fkCompID, fkBranchID),
  KEY idx_rate_party (fkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- STOCK TRANSACTION TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tStockEntry (
  pkTransID       VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  TransID         INT           NOT NULL,
  TransType       VARCHAR(10)   NOT NULL,
  pfkLotID        VARCHAR(100)  NOT NULL,
  LotNum          VARCHAR(10)   NOT NULL DEFAULT '',
  pfkOriLotID     VARCHAR(100)  NOT NULL DEFAULT '',
  OriTransDt      DATETIME,
  OriTransQty     DECIMAL(10,4),
  fkPartyID       VARCHAR(100)  NOT NULL,
  fkItemID        VARCHAR(100)  NOT NULL,
  ItemExtDesc     VARCHAR(20),
  TransDt         DATETIME      NOT NULL,
  TransTm         DATETIME      NOT NULL,
  TransQty        DECIMAL(10,4) NOT NULL DEFAULT 0,
  DoNum           VARCHAR(10),
  GatePass        VARCHAR(10),
  Packing         VARCHAR(10),
  PackingType     VARCHAR(10),
  PackingColour   VARCHAR(20),
  PackWght        DECIMAL(9,4),
  GrossWght       DECIMAL(9,4),
  RentRate        DECIMAL(10,2),
  fkGodownID1     VARCHAR(100)  NOT NULL,
  GodownQty1      DECIMAL(10,4) NOT NULL DEFAULT 0,
  fkGodownID2     VARCHAR(100),
  GodownQty2      DECIMAL(10,4),
  VehiNum         VARCHAR(20),
  BENum           VARCHAR(20),
  ActualWght      DECIMAL(10,4),
  TransNote       TEXT,
  HamaliRecd      DECIMAL(10,2),
  HamaliAmt       DECIMAL(10,2),
  HmlBillAmt      DECIMAL(10,2),
  HamaliCode      VARCHAR(5),
  ItemRate        DECIMAL(10,4) NOT NULL DEFAULT 0,
  TransExtDetail  VARCHAR(200),
  BatchNum        VARCHAR(500),
  DelivOpt        VARCHAR(20),
  TransRemark     VARCHAR(100),
  LotBillFlg      VARCHAR(2)    NOT NULL DEFAULT 'N',
  OpFlg           VARCHAR(2)    NOT NULL DEFAULT 'N',
  OutsideLabr     VARCHAR(2)    NOT NULL DEFAULT 'N',
  OtherHmlAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  FaYear          VARCHAR(10)   NOT NULL,
  OwnTransFlg     VARCHAR(2),
  PickupBy        VARCHAR(100),
  UserID          VARCHAR(10)   NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkTransID),
  KEY idx_stock_comp   (fkCompID, fkBranchID),
  KEY idx_stock_party  (fkPartyID),
  KEY idx_stock_lot    (pfkLotID),
  KEY idx_stock_dt     (TransDt),
  KEY idx_stock_type   (TransType),
  KEY idx_stock_fayear (FaYear)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tStockEntry_AT (
  UniqueSrNo_AT   VARCHAR(30)   NOT NULL,
  Status_AT       VARCHAR(4)    NOT NULL,
  LogDate_AT      DATETIME      NOT NULL,
  pkTransID       VARCHAR(100)  NOT NULL,
  fkCompID        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10)   NOT NULL,
  TransID         INT           NOT NULL,
  TransType       VARCHAR(10)   NOT NULL,
  pfkLotID        VARCHAR(100)  NOT NULL,
  LotNum          VARCHAR(10)   NOT NULL DEFAULT '',
  fkPartyID       VARCHAR(100)  NOT NULL,
  fkItemID        VARCHAR(100)  NOT NULL,
  ItemExtDesc     VARCHAR(20),
  TransDt         DATETIME      NOT NULL,
  TransTm         DATETIME      NOT NULL,
  TransQty        DECIMAL(10,4) NOT NULL DEFAULT 0,
  DoNum           VARCHAR(10),
  GatePass        VARCHAR(10),
  Packing         VARCHAR(10),
  PackingType     VARCHAR(10),
  PackingColour   VARCHAR(20),
  PackWght        DECIMAL(9,4),
  GrossWght       DECIMAL(9,4),
  RentRate        DECIMAL(10,2),
  fkGodownID1     VARCHAR(100)  NOT NULL,
  GodownQty1      DECIMAL(10,4) NOT NULL DEFAULT 0,
  fkGodownID2     VARCHAR(100),
  GodownQty2      DECIMAL(10,4),
  VehiNum         VARCHAR(20),
  BENum           VARCHAR(20),
  ActualWght      DECIMAL(10,4),
  TransNote       TEXT,
  HamaliRecd      DECIMAL(10,2),
  HamaliAmt       DECIMAL(10,2),
  HmlBillAmt      DECIMAL(10,2),
  HamaliCode      VARCHAR(5),
  ItemRate        DECIMAL(10,4) NOT NULL DEFAULT 0,
  TransExtDetail  VARCHAR(200),
  BatchNum        VARCHAR(500),
  DelivOpt        VARCHAR(20),
  TransRemark     VARCHAR(100),
  LotBillFlg      VARCHAR(2)    NOT NULL DEFAULT 'N',
  OpFlg           VARCHAR(2)    NOT NULL DEFAULT 'N',
  OutsideLabr     VARCHAR(2)    NOT NULL DEFAULT 'N',
  OtherHmlAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  pfkOriLotID     VARCHAR(100)  NOT NULL DEFAULT '',
  OriTransDt      DATETIME,
  OriTransQty     DECIMAL(10,4),
  FaYear          VARCHAR(10)   NOT NULL,
  OwnTransFlg     VARCHAR(2),
  PickupBy        VARCHAR(100),
  UserID          VARCHAR(10)   NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (UniqueSrNo_AT),
  KEY idx_at_trans (pkTransID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- GODOWN RENT BILL TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tBill1 (
  pkBillID        VARCHAR(100)  NOT NULL,
  BillType        VARCHAR(10)   NOT NULL DEFAULT 'GodRent',
  BillNum         VARCHAR(15)   NOT NULL,
  BillDt          DATETIME      NOT NULL,
  BillFrom        DATETIME      NOT NULL,
  BillTo          DATETIME      NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  GrossAmt        DECIMAL(10,2) NOT NULL DEFAULT 0,
  DiscDesc        VARCHAR(20),
  DiscAmt         DECIMAL(10,2),
  Tax1Desc        VARCHAR(20),
  Tax1Rate        DECIMAL(5,2),
  Tax1Amt         DECIMAL(10,2),
  Tax2Desc        VARCHAR(20),
  Tax2Rate        DECIMAL(5,2),
  Tax2Amt         DECIMAL(10,2),
  Tax3Desc        VARCHAR(20),
  Tax3Rate        DECIMAL(5,2),
  Tax3Amt         DECIMAL(10,2),
  NetAmt          DECIMAL(10,2) NOT NULL DEFAULT 0,
  GSTNo           VARCHAR(30)   NOT NULL DEFAULT '',
  fkStateID       VARCHAR(100)  NOT NULL DEFAULT '',
  StFlagGodRent   VARCHAR(2),
  BillNote        TEXT,
  BillDesc1       VARCHAR(50),
  fkCompID        VARCHAR(100)  NOT NULL,
  fkBranchID      VARCHAR(100)  NOT NULL,
  RoundOff        DECIMAL(3,2),
  LtrFlg          VARCHAR(3),
  AcknldgDt       DATETIME,
  BillStatus      VARCHAR(3),
  PRIMARY KEY (pkBillID),
  KEY idx_bill1_party (fkPartyID),
  KEY idx_bill1_comp  (fkCompID, fkBranchID),
  KEY idx_bill1_dt    (BillDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tBill2 (
  cpkBillID       VARCHAR(100)  NOT NULL,
  cpkSrno         DECIMAL(4,0)  NOT NULL,
  fkLotID         VARCHAR(100)  NOT NULL,
  BillRate        DECIMAL(10,2) NOT NULL DEFAULT 0,
  BalQty          DECIMAL(10,4) NOT NULL DEFAULT 0,
  FromDt          DATETIME      NOT NULL,
  ToDt            DATETIME      NOT NULL,
  BillDesc2       VARCHAR(50),
  PRIMARY KEY (cpkBillID, cpkSrno),
  KEY idx_bill2_lot (fkLotID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- TRANSPORT / HAMALI BILL TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tBillTrHmGen1 (
  pkBillID        VARCHAR(100)  NOT NULL,
  BillType        VARCHAR(10)   NOT NULL,
  BillNum         VARCHAR(15)   NOT NULL,
  BillDt          DATETIME      NOT NULL,
  BillFrom        DATETIME      NOT NULL,
  BillTo          DATETIME      NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  GrossAmt        DECIMAL(10,2) NOT NULL DEFAULT 0,
  KgTonFlg        VARCHAR(2)    NOT NULL DEFAULT 'KG',
  DiscDesc        VARCHAR(20),
  DiscAmt         DECIMAL(10,2),
  Tax1Desc        VARCHAR(20),
  Tax1Rate        DECIMAL(5,2),
  Tax1Amt         DECIMAL(10,2),
  Tax2Desc        VARCHAR(20),
  Tax2Rate        DECIMAL(5,2),
  Tax2Amt         DECIMAL(10,2),
  Tax3Desc        VARCHAR(20),
  Tax3Rate        DECIMAL(5,2),
  Tax3Amt         DECIMAL(10,2),
  NetAmt          DECIMAL(10,2),
  GSTNo           VARCHAR(30)   NOT NULL DEFAULT '',
  fkStateID       VARCHAR(100)  NOT NULL DEFAULT '',
  StFlagTrans     VARCHAR(2),
  BillDesc1       VARCHAR(50),
  BillNote        TEXT,
  fkCompID        VARCHAR(100)  NOT NULL,
  fkBranchID      VARCHAR(100)  NOT NULL,
  UserID          VARCHAR(10)   NOT NULL,
  RoundOff        DECIMAL(3,2),
  LtrFlg          VARCHAR(3),
  AcknldgDt       DATETIME,
  BillStatus      VARCHAR(3),
  PRIMARY KEY (pkBillID),
  KEY idx_trhm1_comp  (fkCompID, fkBranchID),
  KEY idx_trhm1_party (fkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tBillTrHmGen2 (
  cpkBillID       VARCHAR(100)  NOT NULL,
  cpkSrno         DECIMAL(4,0)  NOT NULL,
  RecdSrNo        DECIMAL(4,0)  NOT NULL DEFAULT 0,
  RecdType        VARCHAR(10)   NOT NULL,
  VochrNo         DECIMAL(4,0),
  HamaliFlg       VARCHAR(10),
  RecdDt          DATETIME,
  pfkLotID        VARCHAR(100),
  LotNum          VARCHAR(10),
  iName           VARCHAR(50),
  TransQty        DECIMAL(10,4),
  Packing         VARCHAR(50),
  PackWght        DECIMAL(9,4),
  Tons            DECIMAL(10,4),
  BillDesc2       VARCHAR(50),
  FromDest        VARCHAR(50),
  ToDest          VARCHAR(50),
  BillRate        DECIMAL(10,2),
  Amount          DECIMAL(10,0),
  PRIMARY KEY (cpkBillID, cpkSrno)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- RECEIPT (PAYMENT) TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tRecpt1 (
  pkRecptID       VARCHAR(100)  NOT NULL,
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  RecptDt         DATETIME      NOT NULL,
  fkPartyID       VARCHAR(100)  NOT NULL,
  RecptAmt        DECIMAL(10,2) NOT NULL DEFAULT 0,
  RecptType       VARCHAR(5)    NOT NULL,
  RecptMode       VARCHAR(5)    NOT NULL,
  BankName        VARCHAR(50)   NOT NULL DEFAULT '',
  ChqNo           VARCHAR(25)   NOT NULL DEFAULT '',
  ChqDt           DATETIME      NOT NULL,
  fkBankID        VARCHAR(100)  NOT NULL DEFAULT '',
  rNote           TEXT          NOT NULL,
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkRecptID),
  KEY idx_recpt1_party (fkPartyID),
  KEY idx_recpt1_comp  (fkCompId, fkBranchID),
  KEY idx_recpt1_dt    (RecptDt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tRecpt2 (
  cpkRecptID      VARCHAR(100)  NOT NULL,
  cpkSrNo         DECIMAL(4,0)  NOT NULL,
  BillType        VARCHAR(10),
  fkBillID        VARCHAR(100)  NOT NULL,
  RecptAmt        DECIMAL(10,2) NOT NULL DEFAULT 0,
  TDSAmt          DECIMAL(10,2) NOT NULL DEFAULT 0,
  DiscAmt         DECIMAL(10,2) NOT NULL DEFAULT 0,
  rRemark         TEXT          NOT NULL,
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (cpkRecptID, cpkSrNo),
  KEY idx_recpt2_bill (fkBillID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- HAMALI / LABOUR TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tHamaliCalEntry1 (
  pkHmlEntID      VARCHAR(100)  NOT NULL,
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  HmlEntID        INT           NOT NULL,
  tDate           DATETIME      NOT NULL,
  tBrdDate        DATETIME      NOT NULL,
  tMonthYear      VARCHAR(10)   NOT NULL,
  tTotVaraiAmt    DECIMAL(10,2) NOT NULL DEFAULT 0,
  tVaraiAmt       DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBalVaraiAmt    DECIMAL(10,2) NOT NULL DEFAULT 0,
  tCommPerct      DECIMAL(6,2)  NOT NULL DEFAULT 0,
  tCommAmt1       DECIMAL(10,2) NOT NULL DEFAULT 0,
  tCommAmt2       DECIMAL(10,2) NOT NULL DEFAULT 0,
  tDailyHmlAmt    DECIMAL(10,2) NOT NULL DEFAULT 0,
  tOutstndHmlAmt  DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBoardDepoAmt   DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBoardTonRate   DECIMAL(8,2)  NOT NULL DEFAULT 0,
  tBoardLeavyPerct DECIMAL(6,2) NOT NULL DEFAULT 0,
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkHmlEntID),
  KEY idx_hml1_comp (fkCompId, tMonthYear)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tHamaliCalEntry2 (
  pfkHmlEntID     VARCHAR(100)  NOT NULL,
  fkEmpID         VARCHAR(100)  NOT NULL,
  tCashAmt        DECIMAL(10,2) NOT NULL DEFAULT 0,
  tOutstndAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (pfkHmlEntID, fkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS AttendanceEntry (
  pkAttendID      VARCHAR(100)  NOT NULL,
  fkCompId        VARCHAR(10)   NOT NULL,
  fkBranchID      VARCHAR(10),
  AttendID        INT           NOT NULL,
  aDate           DATETIME      NOT NULL,
  fkEmpID         VARCHAR(100)  NOT NULL,
  aPresent        VARCHAR(2)    NOT NULL DEFAULT 'N',
  aFaYear         VARCHAR(10)   NOT NULL,
  aMonthYear      VARCHAR(10)   NOT NULL,
  fkUserID        VARCHAR(100)  NOT NULL,
  CrMod           DATETIME      NOT NULL,
  PRIMARY KEY (pkAttendID),
  KEY idx_attend_date (fkCompId, aDate),
  KEY idx_attend_emp  (fkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- REPORT TEMPLATES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS VCTemplate (
  cpkTemplID    VARCHAR(100)  NOT NULL,
  cpkSrno       INT           NOT NULL,
  fkCompID      VARCHAR(10)   NOT NULL,
  fkBranchID    VARCHAR(10)   NOT NULL,
  Template_Name VARCHAR(30)   NOT NULL,
  Rep_Name      VARCHAR(30)   NOT NULL,
  Field_Name    VARCHAR(20)   NOT NULL,
  Operator      VARCHAR(20)   NOT NULL,
  Field_Value   TEXT          NOT NULL,
  Template_Desc VARCHAR(50)   NOT NULL,
  PRIMARY KEY (cpkTemplID, cpkSrno)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────
-- VIEWS
-- Run views.sql after this file to create all 10 views:
--   vStkTransQty, vStkGodBal, vBillRegister, vInvoice_Recpt_Amt,
--   vLotArv, vLotArv_1, vmLot, vatStockEntry_AT,
--   vamParty (compat alias), vatStockEntry (compat alias)
-- ─────────────────────────────────────────────────────────
