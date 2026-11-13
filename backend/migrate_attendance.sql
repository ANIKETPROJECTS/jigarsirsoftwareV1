-- Migration: Add AttendanceEntry table to each company database
-- Run this against: gms_ads, gms_test, gms_vlco, gms_test1 (and any other company databases)
-- Also seeds VCComboData with EmpType values if not already present

-- ─── AttendanceEntry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS AttendanceEntry (
  pkAttendID  VARCHAR(100) NOT NULL,
  fkCompID    VARCHAR(10)  NOT NULL,
  fkBranchID  VARCHAR(10)  NOT NULL,
  AttendID    INT          NOT NULL,
  aDate       DATE         NOT NULL,
  fkEmpID     VARCHAR(100) NOT NULL,
  aPresent    VARCHAR(2)   NOT NULL DEFAULT 'Y'   COMMENT 'Y=Present, N=Absent',
  aFaYear     VARCHAR(10)  NOT NULL DEFAULT '',
  aMonthYear  VARCHAR(10)  NOT NULL DEFAULT ''     COMMENT 'YYYYMM',
  fkUserID    VARCHAR(100) NOT NULL DEFAULT '',
  CrMod       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pkAttendID),
  UNIQUE KEY uq_attend (fkCompID, fkBranchID, fkEmpID, aDate),
  KEY idx_attend_date (fkCompID, fkBranchID, aDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── VCComboData: Employee Type entries (EmpType) ────────────────────────────
-- Add for each group/branch as needed. Example for BHW group:
INSERT IGNORE INTO VCComboData (fkGroupID, fkBranchID, VCPurpose, VCCode, VCData, VCSrtOrd, VCActive) VALUES
  ('BHW', 'HO', 'EmpType', 'Lab', 'Labour',       1, 'Y'),
  ('BHW', 'HO', 'EmpType', 'Off', 'Office Staff',  2, 'Y'),
  ('BHW', 'HO', 'EmpType', 'Sup', 'Supervisor',    3, 'Y');

-- Add the ATTENDANCE module to mPermission for each role that needs access.
-- Via admin UI: Admin → Permissions → select role → add ATTENDANCE module.
