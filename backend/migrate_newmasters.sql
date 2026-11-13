-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_newmasters.sql
-- Run ONCE in MySQL Workbench to create the RateChart and PartyGodownLink tables.
-- These were added in the web migration — they did not exist in the original DB.
-- ─────────────────────────────────────────────────────────────────────────────

USE gms_db;

-- ─────────────────────────────────────────────────────────────────────────────
-- PartyGodownLink — assigns godowns to parties (company-level)
-- fkPartyID and fkGodownID are UUIDs (VARCHAR 100) in the new system.
-- LinkType VARCHAR(20) — values like 'Insurance', 'Own', 'Rent', 'Shared'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS PartyGodownLink (
  pkLinkID    VARCHAR(100) NOT NULL,
  fkCompID    VARCHAR(10)  NOT NULL,
  fkBranchID  VARCHAR(10)  NOT NULL,
  fkPartyID   VARCHAR(100) NOT NULL COMMENT 'UUID from mParty.pkPartyID',
  fkGodownID  VARCHAR(100) NOT NULL COMMENT 'UUID from mGodown.pkGodownID',
  LinkType    VARCHAR(20)  NOT NULL COMMENT 'e.g. Insurance, Own, Rent',
  FromDt      DATE         NOT NULL,
  ToDt        DATE,
  Note        TEXT,
  Active      VARCHAR(2)   NOT NULL DEFAULT 'Y',
  fkUserID    VARCHAR(100) NOT NULL,
  CrMod       DATETIME     NOT NULL,
  PRIMARY KEY (pkLinkID),
  KEY idx_pgl_comp  (fkCompID),
  KEY idx_pgl_party (fkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- RateChart — Hamali/Godown Rent rate chart per party+item+packing (company-level)
-- TransType VARCHAR(10) — fits 'DESPRET' (7 chars).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS RateChart (
  pkRateChartID VARCHAR(100)   NOT NULL,
  fkCompID      VARCHAR(10)    NOT NULL,
  fkBranchID    VARCHAR(10)    NOT NULL,
  fkPartyID     VARCHAR(100)   NOT NULL COMMENT 'UUID from mParty.pkPartyID',
  fkItemID      VARCHAR(100)   NOT NULL COMMENT 'UUID from mItem.pkItemID',
  RateType      VARCHAR(5)     NOT NULL COMMENT 'GR=Godown Rent, HM=Hamali',
  TransType     VARCHAR(10)    NOT NULL COMMENT 'ARV|DESP|DESPRET|TRF|IN|OUT',
  PackingType   VARCHAR(20)    NOT NULL COMMENT 'Bags|Drums|Cartons|J.Bags etc.',
  FromDt        DATE           NOT NULL,
  ToDt          DATE,
  UnitFrom      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  UnitTo        DECIMAL(10,2)  NOT NULL DEFAULT 99999,
  ChargeType    VARCHAR(20)    NOT NULL DEFAULT '',
  HamaliCode    VARCHAR(20)    NOT NULL DEFAULT '',
  BillRate      DECIMAL(7,2)   NOT NULL DEFAULT 0,
  LabourRate    DECIMAL(7,2)   NOT NULL DEFAULT 0,
  Note          TEXT,
  Active        VARCHAR(2)     NOT NULL DEFAULT 'Y',
  fkUserID      VARCHAR(10)    NOT NULL,
  CrMod         DATETIME       NOT NULL,
  PRIMARY KEY (pkRateChartID),
  KEY idx_rc_comp  (fkCompID),
  KEY idx_rc_party (fkPartyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify:
--   SHOW TABLES LIKE 'PartyGodownLink';
--   SHOW TABLES LIKE 'RateChart';
-- ─────────────────────────────────────────────────────────────────────────────
