-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_dispatch.sql
-- Run ONCE in MySQL Workbench on EACH company database to add PickupBy column.
-- This column stores the name of the person picking up dispatched goods.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace `your_company_db` with each company's actual database name.
-- Example: ADS_HO, JNB_HO, etc.

USE `your_company_db`;

-- Add PickupBy column after DelivOpt (if it does not already exist)
ALTER TABLE tStockEntry
  ADD COLUMN IF NOT EXISTS PickupBy VARCHAR(100) NOT NULL DEFAULT '' AFTER DelivOpt;

-- Verify
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'tStockEntry'
  AND COLUMN_NAME = 'PickupBy';
