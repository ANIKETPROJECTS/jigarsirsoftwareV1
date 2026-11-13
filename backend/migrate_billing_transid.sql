-- Migration: add pfkTransID to tBillTrHmGen2
-- Stores the original tStockEntry.pkTransID for TRAN rows so that the
-- "already billed" check is transaction-specific, not lot-wide.
-- Run this against every company database.

ALTER TABLE tBillTrHmGen2
  ADD COLUMN pfkTransID VARCHAR(100) NULL DEFAULT NULL
  AFTER pfkLotID;
