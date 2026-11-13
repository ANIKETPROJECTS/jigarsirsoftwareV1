-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_hamali.sql  —  Hamali Calculation Entry tables
-- Target: Each company database (gms_ads, gms_test, gms_vlco, gms_test1 …)
-- Run once per company DB.
-- VB6 origin: frmHamaliCalEntry.frm
-- ─────────────────────────────────────────────────────────────────────────────

-- ── tHamaliCalEntry1 ─────────────────────────────────────────────────────────
-- One row per working day. Stores header params + daily hamali totals.
-- pkHmlEntID format: '{groupID}!{branchID}!{serialNum}'  (gudfGenSerialID)
CREATE TABLE IF NOT EXISTS tHamaliCalEntry1 (
  pkHmlEntID        VARCHAR(100)    NOT NULL,
  fkCompID          VARCHAR(10)     NOT NULL,
  fkBranchID        VARCHAR(10)     NOT NULL,
  HmlEntID          INT             NOT NULL,
  tDate             DATE            NOT NULL,
  tBrdDate          DATE            NOT NULL,
  tMonthYear        VARCHAR(10)     NOT NULL DEFAULT '',    -- YYYYMM
  tTotVaraiAmt      DECIMAL(10,2)   NOT NULL DEFAULT 0,
  tVaraiAmt         DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Cash Varai
  tBalVaraiAmt      DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Outstanding Varai
  tCommPerct        DECIMAL(6,2)    NOT NULL DEFAULT 0,
  tCommAmt1         DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Cash Commission
  tCommAmt2         DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Outstanding Commission
  tDailyHmlAmt      DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Cash Daily Hamali
  tOutstndHmlAmt    DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Outstanding Daily Hamali
  tBoardDepoAmt     DECIMAL(10,2)   NOT NULL DEFAULT 0,    -- Total Deposit Board
  tBoardTonRate     DECIMAL(8,2)    NOT NULL DEFAULT 0,
  tBoardLeavyPerct  DECIMAL(6,2)    NOT NULL DEFAULT 0,
  fkUserID          VARCHAR(100)    NOT NULL DEFAULT '',
  CrMod             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pkHmlEntID),
  UNIQUE KEY uq_hamali1_date (fkCompID, fkBranchID, tDate),
  INDEX idx_hamali1_comp (fkCompID, fkBranchID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── tHamaliCalEntry2 ─────────────────────────────────────────────────────────
-- One row per employee per working day — individual pay split.
-- Deleted and re-inserted on every Save (mirrors VB6 udfUpdtHmlEnt2).
CREATE TABLE IF NOT EXISTS tHamaliCalEntry2 (
  pfkHmlEntID   VARCHAR(100)    NOT NULL,
  fkEmpID       VARCHAR(100)    NOT NULL,
  tCashAmt      DECIMAL(10,2)   NOT NULL DEFAULT 0,
  tOutstndAmt   DECIMAL(10,2)   NOT NULL DEFAULT 0,
  PRIMARY KEY (pfkHmlEntID, fkEmpID),
  INDEX idx_hamali2_emp (fkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── VCComboData: Labour Employee Types ───────────────────────────────────────
-- LABRB = Board Labour   (present on Board-designated days)
-- LABRO = Other Labour   (non-board labour)
-- Adjust GroupID/BranchID as needed.
INSERT IGNORE INTO VCComboData
  (fkGroupID, fkBranchID, VCPurpose, VCCode, VCData, VCSrtOrd, VCActive)
VALUES
  ('BHW', 'HO', 'EmpType', 'LABRB', 'Board Labour',  4, 'Y'),
  ('BHW', 'HO', 'EmpType', 'LABRO', 'Other Labour',  5, 'Y');

-- ── HAMALI Permission ─────────────────────────────────────────────────────────
-- Run on gms_admin. Replace role IDs with actual role IDs.
-- INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
-- VALUES ('BHW_ADMIN', 'HAMALI', 'Y','Y','Y','Y','Y','Y')
-- ON DUPLICATE KEY UPDATE CanView='Y',CanAdd='Y',CanEdit='Y',CanDelete='Y',CanPrint='Y',CanExport='Y';
