-- ============================================================
-- GMS Web Migration: Company Group Architecture
-- Run this script ONCE in MySQL Workbench against gms_db.
-- All these tables are currently empty so there is no data loss.
-- ============================================================

USE gms_db;

-- ── 1. Create the new Company Group table ───────────────────
CREATE TABLE IF NOT EXISTS mCompanyGroup (
  pkGroupID  VARCHAR(10)  NOT NULL,
  GroupName  VARCHAR(50)  NOT NULL,
  Active     VARCHAR(2)   NOT NULL DEFAULT 'Y',
  PRIMARY KEY (pkGroupID)
);

-- ── 2. Seed your first group ─────────────────────────────────
-- Change 'BHW' and 'Bhagwati Warehousing' to match your actual group.
INSERT INTO mCompanyGroup (pkGroupID, GroupName, Active)
VALUES ('BHW', 'Bhagwati Warehousing', 'Y')
ON DUPLICATE KEY UPDATE GroupName = VALUES(GroupName);

-- ── 3. Add fkGroupID to mCompany ────────────────────────────
ALTER TABLE mCompany
  ADD COLUMN IF NOT EXISTS fkGroupID VARCHAR(10) NOT NULL DEFAULT 'BHW'
  AFTER pkCompID;

-- Set all existing companies to the BHW group (update if needed)
UPDATE mCompany SET fkGroupID = 'BHW';

-- ── 4. Rename fkCompID → fkGroupID on all group-level masters ─
-- (MySQL 8.0 RENAME COLUMN syntax)

ALTER TABLE mUser     RENAME COLUMN fkCompID  TO fkGroupID;
ALTER TABLE mState    RENAME COLUMN fkCompID  TO fkGroupID;
ALTER TABLE mHoliday  RENAME COLUMN fkCompId  TO fkGroupID;
ALTER TABLE mBank     RENAME COLUMN fkCompID  TO fkGroupID;
ALTER TABLE mItem     RENAME COLUMN fkCompID  TO fkGroupID;
ALTER TABLE mGodown   RENAME COLUMN fkCompID  TO fkGroupID;
ALTER TABLE mEmployee RENAME COLUMN fkGroupID TO fkGroupID;  -- already renamed if you ran previous step

-- mTax has a composite primary key that includes fkCompID
ALTER TABLE mTax RENAME COLUMN fkCompID TO fkGroupID;

-- VCComboData (note: actual column in DB is lowercase fkcompid)
ALTER TABLE VCComboData RENAME COLUMN fkcompid TO fkGroupID;

-- ── 5. Update existing data: set fkGroupID = 'BHW' everywhere ─
-- (Only needed if you had existing rows — safe to run even on empty tables)
UPDATE mUser     SET fkGroupID = 'BHW';
UPDATE mState    SET fkGroupID = 'BHW';
UPDATE mHoliday  SET fkGroupID = 'BHW';
UPDATE mBank     SET fkGroupID = 'BHW';
UPDATE mItem     SET fkGroupID = 'BHW';
UPDATE mGodown   SET fkGroupID = 'BHW';
UPDATE mEmployee SET fkGroupID = 'BHW';
UPDATE mTax      SET fkGroupID = 'BHW';
UPDATE VCComboData SET fkGroupID = 'BHW';

-- ── 6. mParty stays company-level — NO changes needed ────────
-- mParty.fkCompID is intentionally kept as-is.

-- ── Done ─────────────────────────────────────────────────────
SELECT 'Migration complete. Restart the backend server.' AS status;
