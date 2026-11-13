-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_transid.sql
-- Run ONCE on EACH company database (e.g. gms_ads, gms_vlco, gms_test, ...).
-- Adds TransID column — the numeric serial extracted from pkTransID.
--
-- pkTransID format: CompID!BranchID!N  (e.g. ADS!HO!7)
-- TransID          = N                 (e.g. 7)
--
-- This makes it easy to display a clean sequential reference number
-- without parsing the compound key on the frontend.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace with actual company DB name before running.
-- Example: gms_ads, gms_vlco, gms_test, gms_test1
USE `your_company_db`;

-- Add column after pkTransID (skip if already exists)
ALTER TABLE tStockEntry
  ADD COLUMN IF NOT EXISTS TransID INT NOT NULL DEFAULT 0 AFTER pkTransID;

-- Backfill existing rows: extract the number after the last '!'
UPDATE tStockEntry
SET TransID = CAST(SUBSTRING_INDEX(pkTransID, '!', -1) AS UNSIGNED)
WHERE TransID = 0;

-- Verify
SELECT pkTransID, TransID FROM tStockEntry ORDER BY TransID LIMIT 10;
