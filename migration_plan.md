# GMS Web Migration Plan

Complete record of all database changes required for the VB6 → Web migration.
Run each script **once only** in MySQL Workbench, in the order listed.

---

## Summary of Migration Scripts

| File | Target DB | When to Run |
|------|-----------|-------------|
| `migrate_group.sql`      | `gms_db` (shared)      | Phase 1 — Company Group setup |
| `migrate_admin.sql`      | `gms_db` (shared)      | Phase 4 — Roles & Permissions |
| `migrate_newmasters.sql` | `gms_db` (shared)      | Phase 5 — Rate Chart & Party-Godown Link |
| `migrate_dispatch.sql`   | Each company DB (e.g. `ADS_HO`, `JNB_HO`) | Phase 6 — Dispatch module |
| SQL in this file         | `gms_db` (shared)      | Phase 6 — DISPATCH permission rows |

---

## Phase 1 — Company Group Architecture (`migrate_group.sql`)

**File:** `backend/migrate_group.sql`
**Target:** `gms_db` (the shared/main database)

### What it does
- Creates `mCompanyGroup` table — parent entity for all companies in the same business group.
- Adds `fkGroupID` column to `mCompany`.
- Renames `fkCompID → fkGroupID` on group-level master tables:
  `mUser`, `mState`, `mHoliday`, `mBank`, `mItem`, `mGodown`, `mEmployee`, `mTax`, `VCComboData`
- Seeds initial group `BHW = 'Bhagwati Warehousing'` (update to match actual group).

### Why
VB6 data was stored per-company. The web system supports multiple companies under one login (group-level masters shared, company-level data separate).

### After running
Update `BHW` to your actual group code/name throughout before running.

---

## Phase 4 — Roles & Permissions (`migrate_admin.sql`)

**File:** `backend/migrate_admin.sql`
**Target:** `gms_db`

### What it does
- Creates `mRole` table — named permission sets (ADMIN, BILLING, VIEW).
- Seeds three initial roles for group `BHW`.
- Creates `mPermission` table (if not already in original schema).
- Seeds full permissions for ADMIN role across: `MASTERS`, `PARTY`, `ARRIVAL`, `DELIVERY`, `BILLING`, `REPORTS`, `ADMIN`.
- Seeds view-only permissions for VIEW role.

### After running
1. Go to **Admin → Permission** in the web app and verify/adjust permissions.
2. Run the commented `UPDATE mUser SET fkRoleID = 'ADMIN'` line for your admin user.

---

## Phase 5 — New Master Tables (`migrate_newmasters.sql`)

**File:** `backend/migrate_newmasters.sql`
**Target:** `gms_db`

### What it does
- Creates `PartyGodownLink` — assigns godowns to parties (Own, Rent, Insurance, Shared).
- Creates `RateChart` — Hamali/Godown rent rate chart per party + item + packing + date range.

### Why
These tables did not exist in VB6. They support the web app's rate auto-fill on Arrival and Dispatch forms.

---

## Phase 6 — Dispatch Entry Module

### 6a. PickupBy Column (`migrate_dispatch.sql`)

**File:** `backend/migrate_dispatch.sql`
**Target:** Each company database (e.g. `ADS_HO`, `JNB_HO`) — run once per company

```sql
USE `your_company_db`;   -- replace with actual company DB name

ALTER TABLE tStockEntry
  ADD COLUMN IF NOT EXISTS PickupBy VARCHAR(100) NOT NULL DEFAULT '' AFTER DelivOpt;
```

**Why:** `PickupBy` is a new field (not in original VB6 schema). It stores the name of the person who picks up dispatched goods, captured at dispatch time.

**Verify:**
```sql
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'tStockEntry'
  AND COLUMN_NAME = 'PickupBy';
```

---

### 6b. DISPATCH Permission Rows

**Target:** `gms_db`

The Dispatch Entry module uses `ModuleCode = 'DISPATCH'`. This row must exist in `mPermission` for every role that needs access.

**Status: DONE — inserted directly via MySQL on 2026-07-07.**

Rows inserted into `gms_admin.mPermission`:

| Role | CanView | CanAdd | CanEdit | CanDelete | CanPrint | CanExport |
|------|---------|--------|---------|-----------|----------|-----------|
| BHW_ADMIN  | Y | Y | Y | Y | Y | Y |
| BHW_USER   | Y | Y | Y | N | Y | N |
| VLCO_ADMIN | Y | Y | Y | Y | Y | Y |
| VLCO_USER  | Y | Y | Y | N | Y | N |

To add for any new role in future:
```sql
INSERT IGNORE INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES
  ('{NEW_ROLE}', 'DISPATCH', 'Y','Y','Y','N','Y','N');
```

---

## Folder / File Structure Changes

These are created automatically by the backend on first use — no SQL needed.

| Folder | Created by | Purpose |
|--------|-----------|---------|
| `uploads/Documents/ArrivalDocuments/` | Arrival upload endpoint | Arrival lot documents & PDFs |
| `uploads/Documents/StockPhotos/{lotNum}/` | Stock photo upload endpoint | Arrival stock photos (mobile/desktop) |
| `uploads/Documents/PickupPhotos/{faYear}/` | Pickup photo upload endpoint | Dispatch pickup person photos |

---

## vStkTransQty View (pre-existing)

The `vStkTransQty` MySQL view was confirmed to already exist in the company databases from the VB6 system. The Dispatch lot-list query depends on it to compute per-godown balances.

**If missing on any company DB, recreate:**
```sql
CREATE OR REPLACE VIEW vStkTransQty AS
SELECT
  pfkOriLotID,
  pfkLotID,
  fkItemID,
  fkGodownID1 AS fkGodownID,
  fkCompID,
  SUM(GodownQty1) AS GodownQty
FROM tStockEntry
WHERE fkGodownID1 != ''
GROUP BY pfkOriLotID, pfkLotID, fkItemID, fkGodownID1, fkCompID
UNION ALL
SELECT
  pfkOriLotID,
  pfkLotID,
  fkItemID,
  fkGodownID2 AS fkGodownID,
  fkCompID,
  SUM(GodownQty2) AS GodownQty
FROM tStockEntry
WHERE fkGodownID2 != ''
GROUP BY pfkOriLotID, pfkLotID, fkItemID, fkGodownID2, fkCompID;
```
> **Note:** The above is a reconstruction — verify the actual view definition against the live VB6 database before using.

---

## GatePass Serial Tracking

GatePass numbers are **plain integers** (1, 2, 3 …) tracked in `mSerialID` under the key:

```
{CompID}!{BranchID}!TSTOCKENT!GATEPASS!{FaYearStart}
```

Example key: `ADS!HO!TSTOCKENT!GATEPASS!2026`

- The counter resets per financial year (new key each year).
- `gudfGenSerialID` manages the counter — no manual migration needed.
- Old VB6 entries may have `GP26001`-style values in the `GatePass` column; new web entries store plain numbers. Both coexist safely since `GatePass` is a VARCHAR.

> **Changed from prior VB6 format:** VB6 stored `GP26001`; web app now stores `1`. The `next-gatepass` API reads `mSerialID.LastNum` directly to avoid format-matching issues with legacy data.

---

## Module Codes Reference

| ModuleCode   | Used for | Nav Group |
|--------------|----------|-----------|
| `MASTERS`    | All master pages (State, Tax, Holiday, Bank, Party, Item, Godown, Employee, Location) | MASTERS |
| `ARRIVAL`    | Arrival / Return / In entry | TRANSACTIONS |
| `DISPATCH`   | Dispatch / Transfer / Out entry | TRANSACTIONS |
| `ATTENDANCE` | Attendance Entry — daily employee present/absent grid | TRANSACTIONS |
| `HAMALI`     | Hamali Calculation Entry — daily labour pay splits (VB6: frmHamaliCalEntry) | TRANSACTIONS |
| `REPORTS`    | Balance Statement and future reports | REPORTS |
| `ADMIN`      | Company Group, Company, Role, Permission, User | ADMIN |

---

## Phase 7 — tStockEntry Collation Fix

**Status: DONE — applied 2026-07-09**

`tStockEntry` in `gms_ads` had been set to `utf8mb4_unicode_ci` (different from all other tables which use `utf8mb4_0900_ai_ci`). This caused `ERROR 1267` on JOINs and `ERROR 1271` on UNION ALL across company DBs.

**Fix applied on each company DB:**
```sql
ALTER TABLE gms_ads.tStockEntry   CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE gms_test.tStockEntry  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE gms_test1.tStockEntry CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE gms_vlco.tStockEntry  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

All `COLLATE utf8mb4_unicode_ci` workarounds were removed from `arrival.js` and `dispatch.js` JOIN conditions after this fix.

**For any new company DB:** Run the ALTER TABLE above before adding the company to the system.

---

## Checklist — Before Going Live

- [ ] Run `migrate_group.sql` on `gms_db`
- [ ] Run `migrate_admin.sql` on `gms_db`
- [ ] Run `migrate_newmasters.sql` on `gms_db`
- [ ] Run `migrate_dispatch.sql` on **each** company database
- [ ] Insert DISPATCH rows into `mPermission` (see 6b above)
- [ ] Assign `fkRoleID = 'ADMIN'` to admin user in `mUser`
- [ ] Verify `vStkTransQty` view exists on each company database
- [ ] Confirm `PickupBy` column added on each company database
- [ ] Test Dispatch Entry → Save → Gate Pass PDF → Email flow end-to-end
- [ ] Confirm email SMTP settings in backend `.env` (`MAIL_HOST`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`)

---

## Phase 8 — Reports Module (Balance Statement)

**Date:** 2026-07-14

### Files Created

| File | Purpose |
|------|---------|
| `backend/src/models/company/VCTemplate.js` | Sequelize factory model for saved templates |
| `backend/src/utils/balanceStatementPDF.js` | PDFKit A4 generator; columns controlled by printSettings JSON |
| `backend/src/routes/reports/balanceStatement.js` | GET /filters, POST /arrivals, GET /lot-details/:id, POST /email |
| `backend/src/routes/reports/templates.js` | CRUD for VCTemplate (GET list, GET /:id, POST save, DELETE /:id) |
| `frontend/src/pages/reports/BalanceStatementPage.jsx` | Page 1 — date + filter config + template loader |
| `frontend/src/pages/reports/BalanceStatementResultPage.jsx` | Page 2 — expandable table, settings sidebar/FAB+drawer, CSV export, email |

### RBAC Design
- All report routes protected by `requirePermission('REPORTS', 'CanView')` (existing middleware — no new code).
- Template save: `REPORTS / CanAdd`. Template delete: `REPORTS / CanDelete`. Email: `REPORTS / CanPrint`.
- Frontend hides Save Template and Send Email buttons via `can('REPORTS', 'CanXxx')` from AuthContext.

### VCTemplate JSON Strategy
- One logical template = multiple rows with the same `cpkTemplID`.
- `Field_Value` is always `JSON.stringify(value)` — arrays for filter IDs, objects for Print_Settings.
- Print_Settings includes all Control B + C checkbox states so loading a template auto-resets the sidebar.

### DB Migration Required — Run on Every Company Schema
```sql
CREATE TABLE IF NOT EXISTS VCTemplate (
  cpkTemplID    VARCHAR(60)  NOT NULL,
  cpkSrno       INT          NOT NULL,
  fkCompID      VARCHAR(10)  NOT NULL,
  fkBranchID    VARCHAR(10)  NOT NULL,
  Template_Name VARCHAR(100),
  Rep_Name      VARCHAR(50),
  Field_Name    VARCHAR(50),
  Operator      VARCHAR(20),
  Field_Value   TEXT,
  Template_Desc TEXT,
  UserID        VARCHAR(50),
  CrMod         DATETIME,
  PRIMARY KEY (cpkTemplID, cpkSrno),
  INDEX idx_vctempl_comp_rep (fkCompID, Rep_Name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### REPORTS Permission Rows — Run on gms_admin
```sql
-- Manager / Admin role (replace role ID with actual):
INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'REPORTS', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE CanView='Y',CanAdd='Y',CanEdit='Y',CanDelete='Y',CanPrint='Y',CanExport='Y';

-- Operator role (view only):
INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'REPORTS', 'Y','N','N','N','N','N')
ON DUPLICATE KEY UPDATE CanView='Y',CanAdd='N',CanEdit='N',CanDelete='N',CanPrint='N',CanExport='N';
```

### Known Limitations
- `frmReport.frm` not provided — SQL reconstructed from session knowledge. Verify opening balance logic.
- Party Group filter omitted (schema unknown — add when `mPartyGroup` / `mParty.pGroupID` is confirmed).
- CSV export only; upgrade to `xlsx` (`npm install xlsx`) for proper Excel.
- Report is single-company; extend via `groupQuery.groupUnionRaw()` for group-wide view.

### Checklist
- [ ] Run `VCTemplate` CREATE TABLE on each company schema
- [ ] Insert REPORTS rows into `gms_admin.mPermission` for each role
- [ ] Add `reports/balance-statement` link to AppShell navigation sidebar
- [ ] Verify `vStkTransQty` view is accessible and `GodownQty` column exists
- [ ] Test: generate report → expand row → export CSV → save template → load template → email PDF

---

## Phase 9 — Attendance Entry Module

**Date:** 2026-07-25
**VB6 origin:** `frmAttendanceEntry.frm`

### Overview

Daily attendance grid — rows = dates (From→To), columns = employees grouped by type.  
Default state is Present (matches VB6 `flexChecked`). Holidays and Sundays are colour-coded.  
Batch upsert: INSERT new records, UPDATE existing ones — mirrors VB6 `cmdSave_Click` loop.

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/migrate_attendance.sql` | AttendanceEntry DDL + VCComboData EmpType seeds |
| `backend/src/models/company/AttendanceEntry.js` | Sequelize model (`DATEONLY` for aDate) |
| `backend/src/routes/transactions/attendance.js` | 3 endpoints: GET /meta, POST /load, POST /save |
| `backend/src/app.js` | Registered `/api/transactions/attendance` route |
| `frontend/src/pages/transactions/AttendancePage.jsx` | Full React grid with holiday colours + bulk actions |
| `frontend/src/App.jsx` | Import + `<Route path="transactions/attendance" …>` |
| `frontend/src/layouts/AppShell.jsx` | Nav item in TRANSACTIONS group, moduleCode `ATTENDANCE` |

### DB Migration — Run on Every Company Schema

**File:** `backend/migrate_attendance.sql`

```sql
-- 1. Create AttendanceEntry table
CREATE TABLE IF NOT EXISTS AttendanceEntry (
  pkAttendID  VARCHAR(100) NOT NULL,
  fkCompID    VARCHAR(10)  NOT NULL,
  fkBranchID  VARCHAR(10)  NOT NULL,
  AttendID    INT          NOT NULL,
  aDate       DATE         NOT NULL,
  fkEmpID     VARCHAR(100) NOT NULL,
  aPresent    VARCHAR(2)   NOT NULL DEFAULT 'Y',   -- Y=Present, N=Absent
  aFaYear     VARCHAR(10)  NOT NULL DEFAULT '',
  aMonthYear  VARCHAR(10)  NOT NULL DEFAULT '',    -- YYYYMM format
  fkUserID    VARCHAR(100) NOT NULL DEFAULT '',
  CrMod       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pkAttendID),
  UNIQUE KEY uq_attend (fkCompID, fkBranchID, fkEmpID, aDate),
  KEY idx_attend_date (fkCompID, fkBranchID, aDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Seed Employee Type combos (adjust GroupID/BranchID as needed)
INSERT IGNORE INTO VCComboData
  (fkGroupID, fkBranchID, VCPurpose, VCCode, VCData, VCSrtOrd, VCActive)
VALUES
  ('BHW', 'HO', 'EmpType', 'Lab', 'Labour',      1, 'Y'),
  ('BHW', 'HO', 'EmpType', 'Off', 'Office Staff', 2, 'Y'),
  ('BHW', 'HO', 'EmpType', 'Sup', 'Supervisor',   3, 'Y');
```

### ATTENDANCE Permission Rows — Run on gms_admin

```sql
-- Admin role: full access
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'ATTENDANCE', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='Y', CanPrint='Y', CanExport='Y';

-- Operator role: view + add (no delete)
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'ATTENDANCE', 'Y','Y','Y','N','Y','N')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='N', CanPrint='Y', CanExport='N';
```

### Holiday Colour Logic (from VB6 `udfMarkHoliday` + Sunday check)

| Condition | Colour | Applies to |
|-----------|--------|------------|
| Sunday | Green `#b7f5b7` | All employees — highest priority |
| hBoard='Y' + hOffice='Y' | Red `#ffaaaa` | All employees |
| hBoard='Y' only | Blue `#aaaaff` | Non-office employees (eType ≠ 'Off') |
| hOffice='Y' only | Yellow `#fffaaa` | Office employees (eType = 'Off') |

Sunday overrides all holiday colours (VB6 applies Sunday check after `udfMarkHoliday`).

### Key Design Decisions

- `aDate` uses Sequelize `DATEONLY` type → maps to MySQL `DATE` (not `DATETIME`).
- Holidays stored as `DATETIME` in `mHoliday.hDate` — queried with `DATE_FORMAT()` to get clean `YYYY-MM-DD` strings.
- Save uses sequential loop (not `Promise.all`) to preserve data integrity — mirrors VB6 per-cell save.
- `aMonthYear = YYYYMM` derived from aDate on the server; used for monthly roll-ups.
- `pkAttendID` format: `{groupID}!{serialNum}` — same pattern as all other PKs in the system.
- `VCPurpose = 'EmpType'` (web) vs `'Type'` (VB6) — seeded separately via VCComboData.

### Checklist

- [ ] Run `AttendanceEntry` CREATE TABLE on **each** company schema
- [ ] Seed `VCComboData` with `VCPurpose='EmpType'` rows for each group/branch
- [ ] Insert `ATTENDANCE` rows into `gms_admin.mPermission` for each role
- [ ] Verify `mHoliday` table has `hBoard` and `hOffice` columns with `Active` column
- [ ] Verify `mEmployee` has `eType` and `eShortName` columns
- [ ] Test: select date range → Go → grid renders with holiday colours → toggle cells → Save → reload and verify persistence

---

## Phase 10 — Hamali Calculation Entry Module

**Date:** 2026-07-25
**VB6 origin:** `frmHamaliCalEntry.frm`

### Overview

Daily Hamali (labour) calculation page.  
Workflow: Go → View → edit yellow cells → Calc Balance Varai → Calc Board Depo Amt → Save → Export Excel.  
26-column grid mirrors VB6 VSFlexGrid layout.  
Batch queries: 4 DB queries for full date range instead of VB6's N×4 per-row queries.

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/migrate_hamali.sql` | tHamaliCalEntry1 + tHamaliCalEntry2 DDL + EmpType seeds + permission note |
| `backend/src/models/company/HamaliCalEntry1.js` | Sequelize model (DATEONLY for tDate, tBrdDate) |
| `backend/src/models/company/HamaliCalEntry2.js` | Sequelize model (composite PK: pfkHmlEntID + fkEmpID) |
| `backend/src/routes/transactions/hamali.js` | 3 endpoints: POST /go, POST /view, POST /save |
| `backend/src/app.js` | Registered `/api/transactions/hamali` route |
| `frontend/src/pages/transactions/HamaliCalPage.jsx` | Full React page with 24-column visible grid, inline editing, xlsx export |
| `frontend/src/App.jsx` | Import + `<Route path="transactions/hamali" …>` |
| `frontend/src/layouts/AppShell.jsx` | Nav item in TRANSACTIONS group, moduleCode `HAMALI` |
| `frontend/src/pages/admin/PermissionPage.jsx` | Added `HAMALI` to MODULES array |
| `frontend/package.json` | Added `xlsx` package for Excel export |

### DB Migration — Run on Every Company Schema

**File:** `backend/migrate_hamali.sql`

```sql
CREATE TABLE IF NOT EXISTS tHamaliCalEntry1 (
  pkHmlEntID        VARCHAR(100) NOT NULL,
  fkCompID          VARCHAR(10)  NOT NULL,
  fkBranchID        VARCHAR(10)  NOT NULL,
  HmlEntID          INT          NOT NULL,
  tDate             DATE         NOT NULL,
  tBrdDate          DATE         NOT NULL,
  tMonthYear        VARCHAR(10)  NOT NULL DEFAULT '',
  tTotVaraiAmt      DECIMAL(10,2) NOT NULL DEFAULT 0,
  tVaraiAmt         DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBalVaraiAmt      DECIMAL(10,2) NOT NULL DEFAULT 0,
  tCommPerct        DECIMAL(6,2)  NOT NULL DEFAULT 0,
  tCommAmt1         DECIMAL(10,2) NOT NULL DEFAULT 0,
  tCommAmt2         DECIMAL(10,2) NOT NULL DEFAULT 0,
  tDailyHmlAmt      DECIMAL(10,2) NOT NULL DEFAULT 0,
  tOutstndHmlAmt    DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBoardDepoAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  tBoardTonRate     DECIMAL(8,2)  NOT NULL DEFAULT 0,
  tBoardLeavyPerct  DECIMAL(6,2)  NOT NULL DEFAULT 0,
  fkUserID          VARCHAR(100) NOT NULL DEFAULT '',
  CrMod             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pkHmlEntID),
  UNIQUE KEY uq_hamali1_date (fkCompID, fkBranchID, tDate),
  INDEX idx_hamali1_comp (fkCompID, fkBranchID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tHamaliCalEntry2 (
  pfkHmlEntID  VARCHAR(100) NOT NULL,
  fkEmpID      VARCHAR(100) NOT NULL,
  tCashAmt     DECIMAL(10,2) NOT NULL DEFAULT 0,
  tOutstndAmt  DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (pfkHmlEntID, fkEmpID),
  INDEX idx_hamali2_emp (fkEmpID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### HAMALI Permission Rows — Run on gms_admin

```sql
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'HAMALI', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='Y', CanPrint='Y', CanExport='Y';

INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'HAMALI', 'Y','Y','Y','N','Y','N')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='N', CanPrint='Y', CanExport='N';
```

### Calculation Logic (mirrors VB6 exactly)

| Formula | Expression |
|---------|-----------|
| Cash Commission | `(cDaily - cVarai) × commPerct / 100` |
| Cash Per Labour | `(cDaily - cVarai - cComm) / (boardAttd + otherAttnd)` |
| Cash Board Labour | `round(cPerLbr × boardAttd)` — integer (VB6 Long cast) |
| Cash Other Labour | `round(cPerLbr × otherAttnd)` — integer |
| O/S Commission | `(oDaily - oVarai - outsdLbrAmt) × commPerct / 100` |
| O/S Per Labour | `(oDaily - oVarai - oComm - outsdLbrAmt) / totLbr` |
| O/S Board Labour Amt | `round(oPerLbr × boardAttd)` |
| O/S Board Labour (net) | `oBrdLabAmt - depoBrd` |
| O/S Per Board Amt | `oBrdLbr / boardAttd` (0 if no board labour) |
| O/S Other Labour | `round(oPerLbr × otherAttnd)` — integer |
| TotDepoBrd | `cBrdLbr + depoBrd` (via Calc Board Depo Amt button) |
| For MODIFY rows | `depoBrd = totDepoBrdFromDB - cBrdLbr` before O/S recalc |

**Balance Varai two-pass** (VB6 `cmdCalBalVarai_Click`):
1. Pass 1: count rows where `oDaily > totVaraiAmt / workingDays`
2. Pass 2: `oVarai = totVaraiAmt / qualifyingCount` for each qualifying row (0 for others)

### Key Design Decisions

- `tDate` and `tBrdDate` use Sequelize `DATEONLY` → MySQL `DATE`.
- All 4 data sources (attendance, cash hamali, outstanding hamali, existing entries) fetched in parallel for full date range — O(4) queries instead of VB6's O(N×4).
- Calculations run in JS (not DB) after batch fetch — easier to debug and matches VB6 loop.
- Yellow editable cells: CVarai, DepoBrd, BrdDate — trigger downstream recalc on blur (mirrors VB6 `AfterEdit`).
- Holiday/Sunday rows shown in green (background) and inputs disabled.
- tHamaliCalEntry2 delete+re-insert on every Save (mirrors VB6 `udfUpdtHmlEnt2`).
- `mHoliday.hBoard = 'Y'` marks board holidays (not all holidays affect hamali working days).

### Checklist

- [ ] Run `migrate_hamali.sql` on **each** company schema
- [ ] Seed `VCComboData` with `EmpType = LABRB` (Board Labour) and `LABRO` (Other Labour)
- [ ] Insert `HAMALI` rows into `gms_admin.mPermission` for each role
- [ ] Verify `mEmployee.eType` has `LABRB` and `LABRO` values for relevant employees
- [ ] Verify `mHoliday.hBoard` column exists
- [ ] Verify `tStockEntry` has columns: `HamaliRecd`, `HamaliAmt`, `OtherHmlAmt`, `OpFlg`, `TransDt`
- [ ] Test: Go → header loads, dates built, working days counted
- [ ] Test: View → attendance + stock hamali → all 24 columns correct
- [ ] Test: Edit CVarai → downstream recalculates (cComm, cBrdLbr, cOthrLbr)
- [ ] Test: Edit DepoBrd → oBrdLbr recalculates
- [ ] Test: Calc Balance Varai → oVarai distributed evenly across qualifying rows
- [ ] Test: Calc Board Depo Amt → totDepoBrd = cBrdLbr + depoBrd
- [ ] Test: Save → tHamaliCalEntry1 upserted, tHamaliCalEntry2 rebuilt per employee
- [ ] Test: Re-View after Save → rows show MODIFY state, depoBrd derived correctly
- [ ] Test: Export Excel → correct headers, data, totals row

---

## Phase 11 — Hamali Calculation Report

**Date:** 2026-07-25
**VB6 origin:** `frmHamaliCalEntryReport.frm`
**Status:** Migrated ✅ | Crystal Reports: Pending Layout Conversion

### Overview

Report viewer for Hamali Calculation data. Three report types (matching VB6 Crystal Reports):
1. **Labour wise hamali calculation** — `drsLbrCalList` — per-employee per-date cash + O/S amounts
2. **Board Deposite Hamali Calculation** — `drsBrdDepoDetail` — board date / depo amount / ton rate / levy %
3. **Board Deposite Form** — `drsGroceryBoardForm` — summary form with UTR No + Payment Date

Workflow: Set dates → Go (loads employees, validates month) → select report type → View → Export/Print.

Crystal Report formula fields migrated as response data passed to the React report header:
`{@CompName}`, `{@StartDt}`, `{@EndDt}`, `{@UTRNo}`, `{@PaymentDt}`

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/src/routes/reports/hamaliReport.js` | 2 endpoints: GET /employees (Q1), POST /report (Q2/Q3/Q4) |
| `backend/src/app.js` | Registered `/api/reports/hamali-report` route |
| `frontend/src/pages/reports/HamaliCalReportPage.jsx` | Full React page + 3 inline report components |
| `frontend/src/App.jsx` | Import + `<Route path="reports/hamali-report" …>` |
| `frontend/src/layouts/AppShell.jsx` | Added `SummarizeIcon` import + nav item in REPORTS group (`moduleCode: 'HAMALI_REP'`) |
| `frontend/src/pages/admin/PermissionPage.jsx` | Added `HAMALI_REP` to MODULES array |

### Crystal Reports — Pending Layout Conversion

The following VB6 Crystal Report files exist in the VB6 Files folder and need their exact print
layout recreated when a PDF/print output is required (currently the web shows an HTML table):

| Crystal Report | VB6 File | Web Status |
|----------------|----------|------------|
| `drsLbrCalList` | `drsLbrCalList.rpt` | Pending Layout Conversion |
| `drsBrdDepoDetail` | `drsBrdDepoDetail.rpt` | Pending Layout Conversion |
| `drsGroceryBoardForm` | `drsGroceryBoardForm.rpt` | Pending Layout Conversion |

To convert: provide the `.rpt` layout and the web PDF can be generated via PDFKit (same pattern
as `balanceStatementPDF.js`) or a reporting library such as `@react-pdf/renderer`.

### SQL Queries Used (exact VB6 port)

| Report | Query | Key tables |
|--------|-------|------------|
| Labour wise | Q2 — JOIN t1 → t2 → mEmployee | tHamaliCalEntry1, tHamaliCalEntry2, mEmployee |
| Board Depo  | Q3 — GROUP BY tBrdDate, tBoardTonRate, tBoardLeavyPerct | tHamaliCalEntry1 |
| Board Form  | Q4 — SUM(tBoardDepoAmt) | tHamaliCalEntry1 |

**COLLATE note (Q2):** mEmployee uses `utf8mb4_unicode_ci` (VB6 legacy). The JOIN condition adds
`COLLATE utf8mb4_unicode_ci` on both sides to prevent ERROR 1267 without altering the table schema.

### Date Validation (VB6 udfValDate — exact port)

| Rule | Message |
|------|---------|
| From Date > To Date | "From Date cannot be greater than To Date." |
| Different month/year | "From Date and To Date must be within the same month and year." |

### HAMALI_REP Permission Rows — Run on gms_admin

```sql
-- Admin role: full access to Hamali Calculation Report
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'HAMALI_REP', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='Y', CanPrint='Y', CanExport='Y';

-- Operator role: view + export only
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'HAMALI_REP', 'Y','N','N','N','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='N', CanEdit='N', CanDelete='N', CanPrint='Y', CanExport='Y';

-- Repeat for other roles (VLCO_ADMIN, VLCO_USER, etc.) replacing the role ID:
-- INSERT INTO mPermission (fkRoleID, ModuleCode, ...) VALUES ('{ROLE_ID}', 'HAMALI_REP', ...);
```

### Module Codes Reference — Updated

| ModuleCode    | Used for | Nav Group |
|---------------|----------|-----------|
| `HAMALI_REP`  | Hamali Calculation Report (VB6: frmHamaliCalEntryReport) | REPORTS |

### Checklist

- [ ] Insert `HAMALI_REP` rows into `gms_admin.mPermission` for each role (SQL above)
- [ ] Go to Admin → Permissions UI and confirm HAMALI_REP row appears per role
- [ ] Verify `tHamaliCalEntry1` and `tHamaliCalEntry2` tables exist on each company schema (Phase 10)
- [ ] Test: Go → employee dropdown loads (eType = LabB or LabO employees only)
- [ ] Test: same-month validation → dates from different months show warning
- [ ] Test: View (Labour wise) → rows grouped by employee, subtotals correct, grand total correct
- [ ] Test: View (Board Depo) → board date rows, total amount at bottom
- [ ] Test: View (Board Form) → total depo amount + UTR No + Payment Date shown
- [ ] Test: Employee dropdown filter → Report 1 filtered to selected employee rows only
- [ ] Test: Export Excel → headers + data correct for all 3 report types
- [ ] Test: Print button → window.print() opens browser print dialog
- [ ] Test: Cancel → form resets to defaults (current month, Labour radio, empty fields)

---

## Phase 12 — Balance Report (frmBalReport)

**VB6 source**: `frmReport.frm` (class `frmBalReport`)
**Module code**: `BAL_REP`
**Route prefix**: `/api/reports/balance-report`
**Frontend page**: `frontend/src/pages/reports/BalanceReportPage.jsx`
**Backend route**: `backend/src/routes/reports/balanceReport.js`

### Files modified
- `backend/src/app.js` — added `app.use('/api/reports/balance-report', ...)`
- `frontend/src/App.jsx` — added import + Route `reports/balance-report`
- `frontend/src/layouts/AppShell.jsx` — added Balance Report nav item under REPORTS group with `moduleCode: 'BAL_REP'`
- `frontend/src/pages/admin/PermissionPage.jsx` — added `{ code: 'BAL_REP', label: 'Balance Report' }` to MODULES array

### API Endpoints

#### GET /filters
Returns filter panel data for the 4 General tab panels.
- `partyGroups`: distinct `pGroup` values from `mParty`
- `parties`: all active parties (`Active = 'Y'`)
- `items`: all active items
- `godowns`: all active godowns ordered by numeric `gNum`

#### POST /balances
Main balance grid (VB6: `udfOpDetailResultset` + `udfPopupBalRep`).

Body params:
```json
{
  "startDate": "yyyy-mm-dd",  // optional
  "endDate":   "yyyy-mm-dd",  // required
  "partyIds":    [],           // empty = all
  "partyGroups": [],           // only if partyIds empty
  "itemIds":     [],
  "godownIds":   [],
  "sortBy": "LotNum | pName | iName"
}
```

SQL approach (two queries):
1. Main query on `tStockEntry` (ARV, OpFlg='N') + correlated `SUM(vStkTransQty.GodownQty)` for balance
2. Batch godown query: `GROUP_CONCAT`-style aggregation in Node.js from a single JOIN query → `godQty` string `"G1 ~ 10.0000, G2 ~ 5.0000"`

`HAVING balance > 0` — excludes fully dispatched lots.

#### GET /lot-detail/:lotId?startDate=&endDate=
Lot ledger (VB6: `udfOpDetailResultset1` + `udfPopupBalRep1`).

- If `startDate` provided: prepends an opening balance row (`sortOrd=1`) with `SUM(TransQty)` for all movements before `startDate`
- Then returns all `tStockEntry` rows for the period (`sortOrd=2`), joined to `mGodown` for `gNum`
- Running balance computed in frontend (not in SQL)

#### POST /report
Crystal Report placeholder — 4 report types. Each runs a different SQL aggregate and returns JSON for the frontend print window.

| reportType          | VB6 Crystal      | SQL summary |
|---------------------|------------------|-------------|
| `party-bal-detail`  | drsPartyBalDetail | All transactions grouped by party+lot |
| `party-bal`         | drsPartyBal       | Balance per party+lot; HAVING <> 0 |
| `lot-wise`          | drsLotDetail      | Balance per lot; HAVING <> 0 |
| `godown-bal`        | drsGodownBal      | Balance per godown+lot; HAVING <> 0 |

### Permission SQL
```sql
INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'BAL_REP', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE CanView='Y',CanAdd='Y',CanEdit='Y',CanDelete='Y',CanPrint='Y',CanExport='Y';

INSERT INTO mPermission (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'BAL_REP', 'Y','N','N','N','N','Y')
ON DUPLICATE KEY UPDATE CanView='Y',CanAdd='N',CanEdit='N',CanDelete='N',CanPrint='N',CanExport='Y';
```

### Crystal Reports pending conversion
The following `.dsr` Crystal Report files have not yet been converted. The `/report` endpoint returns JSON that the frontend renders in a print window as a placeholder.

| DSR file               | reportType          | Status |
|------------------------|---------------------|--------|
| `drsLotDetail.dsr`     | `lot-wise`          | Placeholder |
| `drsPartyBal.dsr`      | `party-bal`         | Placeholder |
| `drsPartyBalDetail.dsr`| `party-bal-detail`  | Placeholder |
| `drsGodownBal.dsr`     | `godown-bal`        | Placeholder |

### Known caveats
- `vLotArv_1` exists in MySQL (views.sql) — not used in `/balances` endpoint (uses `tStockEntry` directly for simpler `fkCompID` scoping)
- Godown sort (`sSortRep = 'gNum'` in VB6) is not implemented — use LotNum sort instead; godown-sorted reports come via `godown-bal` report format
- Template save uses existing `/api/reports/templates` route with `repName = 'BAL_REP'`

### Checklist
- [ ] Run Permission SQL above on `gms_admin` database
- [ ] Verify `BAL_REP` row appears in Admin → Permissions UI for each role
- [ ] Verify `vStkTransQty` view is accessible on each company database (Phase 6 prerequisite)
- [ ] Test: General tab loads filter panels (party groups, parties, items, godowns)
- [ ] Test: Go with no filters → all lots with balance > 0 appear in main grid
- [ ] Test: Party filter → only selected parties' lots shown
- [ ] Test: Item filter → only selected items' lots shown
- [ ] Test: Godown filter → only lots with balance in selected godowns shown
- [ ] Test: Hide Zero Balance checkbox → lots with balance = 0 hidden
- [ ] Test: Item search box → client-side filter on iName
- [ ] Test: Row click → lot ledger loads with correct opening balance row (blue background)
- [ ] Test: Running balance column increments correctly in detail grid
- [ ] Test: View Report → print window opens with correct report format layout
- [ ] Test: Popup blocked warning appears if browser blocks popup
- [ ] Test: Export Excel → all 21 columns exported correctly
- [ ] Test: Save Template → template stored in VCTemplate with repName='BAL_REP'
- [ ] Test: Load Template → filters, sort, dates, format options restored correctly

---

## Phase 13 — Audit Report (frmAuditReport)

**Date:** 2026-08-01
**VB6 source:** `frmAuditReport.frm`, "Transaction Log" tab
**Module code:** `AUDIT_REP`
**Route prefix:** `/api/reports/audit-report`
**Frontend page:** `frontend/src/pages/reports/AuditReportPage.jsx`
**Backend route:** `backend/src/routes/reports/auditReport.js`

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/src/routes/reports/auditReport.js` | 2 endpoints: GET /init (Q1–Q3), POST /data (Q4–Q6) |
| `backend/src/app.js` | Registered `/api/reports/audit-report` route |
| `frontend/src/pages/reports/AuditReportPage.jsx` | Full React page with grid, highlighting, bold, Excel export |
| `frontend/src/App.jsx` | Import + `<Route path="reports/audit-report" …>` |
| `frontend/src/layouts/AppShell.jsx` | Nav item in REPORTS group, `moduleCode: 'AUDIT_REP'` |

### API Endpoints

#### GET /init
Runs Queries 1–3. Returns data to seed the filter UI on page load.

| Query | VB6 origin | SQL |
|-------|------------|-----|
| Q1 | `udfTLInitDate` | `SELECT StartDate, EndDate FROM FaYearInfo WHERE fkCompID=? AND fkBranchID=? AND StartDate<=today AND today<=EndDate AND Nor_Alt='N' AND Active='Y'` |
| Q2 | `udfTLFillReportNameCombo` (report list) | `SELECT pkAudRepID, RepName FROM AuditReport WHERE Active='Y'` |
| Q3 | `udfTLFillReportNameCombo` (date field list) | `SELECT ColName, ColDisplayName FROM AuditReportColumns WHERE ComposeFlg='Y' ORDER BY SortOrder` |

Response: `{ startDate, endDate, reports: [{pkAudRepID, RepName}], dateFields: [{ColName, ColDisplayName}] }`

#### POST /data
Runs Queries 4–6 on demand when the VIEW button is clicked.

| Query | VB6 origin | SQL |
|-------|------------|-----|
| Q4 | `udfTLGenQury` — table lookup | `SELECT TableName FROM AuditReport WHERE pkAudRepID=? AND Active='Y'` |
| Q5 | `udfTLQuryStringGen` — column list | `SELECT ColName, ColDisplayName FROM AuditReportColumns WHERE cpkAudRepID=? AND ComposeFlg='Y' ORDER BY SortOrder` |
| Q6 | Dynamic query built from Q4+Q5 | `SELECT [cols] FROM [table] [WHERE dateField >= ? AND dateField <= ?] ORDER BY UniqueSrNo_AT, Status_AT` |

Body: `{ audRepID, fromDate, toDate, dateField }`
Response: `{ columns: [{ColName, ColDisplayName}], rows: [{...colValues}] }`

All queries run against the company DB (`req.db`), matching VB6 `gDb.ConSele`.

### VB6 Bug Fixed

**Original VB6 `udfTLGenQury` condition:**
```vb
If mFv.sTLDateField <> "Select Field" Or mFv.sTLDateField <> "" Then
```
This is a tautology — the `Or` makes it always `True` for any string, so the WHERE clause was unconditionally appended even when no date field was selected, producing invalid SQL.

**Migration fix:** WHERE clause only added when `dateField` is a non-empty, validated column name.

### Client-Side Grid Processing (mirrors VB6 `udfTLModifiedEntryCheck`)

Column convention (enforced by SortOrder in `AuditReportColumns`):
- Col 0 = `UniqueSrNo_AT` — hidden (VB6: `vfgTL.ColHidden(0) = True`)
- Col 1 = `Status_AT` — values: DEL, UPD1, UPD2, INS
- Col 2+ = data columns

DEL row highlight: `#FFC0C0` (VB6 `&HC0C0FF` in BGR = RGB 255,192,192)

UPD2/UPD1 pair logic (bottom-to-top scan):
1. If `row[i].Status_AT === 'UPD2'` AND `row[i-1].Status_AT === 'UPD1'`
2. Compare cols 2+ — **bold** differing cells in both rows
3. If `nDiffCount === 0` (rows are identical) — **remove both rows** entirely

The `ORDER BY UniqueSrNo_AT, Status_AT` in Q6 guarantees UPD2 always appears directly above its paired UPD1.

### Excel Export (mirrors VB6 `cmdTLExcel_Click`)

| VB6 action | Web implementation |
|------------|--------------------|
| Sheet name = "Hamali Calculation" | `XLSX.utils.book_append_sheet(wb, ws, 'Hamali Calculation')` |
| Col 0 hidden | `ws['!cols'][0] = { wpx: 0 }` |
| Freeze at B2 | `ws['!views'] = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]` |
| Bold differing UPD cells | `ws[addr].s = { font: { bold: true } }` |
| DEL row background | `ws[addr].s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFC0C0' } } }` |

> **Note:** The `xlsx` CE package (v0.18.x) does not write cell styles to output files.
> Bold and background color require replacing `xlsx` with `xlsx-js-style` (drop-in fork).
> Install: `npm install xlsx-js-style` then update the import in `AuditReportPage.jsx`.

### DB Prerequisites

The following tables must exist in the company DB (`req.db`):

| Table | Purpose |
|-------|---------|
| `AuditReport` | One row per audit report (`pkAudRepID`, `RepName`, `TableName`, `Active`) |
| `AuditReportColumns` | Column definitions (`cpkAudRepID`, `ColName`, `ColDisplayName`, `ComposeFlg`, `SortOrder`) |

Column SortOrder **must** place `UniqueSrNo_AT` first (SortOrder=1) and `Status_AT` second (SortOrder=2) for the UPD1/UPD2 detection to work correctly.

### AUDIT_REP Permission SQL — Run on gms_admin

```sql
-- Admin role: full access
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'AUDIT_REP', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='Y', CanPrint='Y', CanExport='Y';

-- Operator role: view + export only
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'AUDIT_REP', 'Y','N','N','N','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='N', CanEdit='N', CanDelete='N', CanPrint='Y', CanExport='Y';
```

### Checklist

- [ ] Verify `AuditReport` table exists in each company schema with correct rows
- [ ] Verify `AuditReportColumns` table exists with `UniqueSrNo_AT` at SortOrder=1 and `Status_AT` at SortOrder=2
- [ ] Insert `AUDIT_REP` rows into `gms_admin.mPermission` for each role (SQL above)
- [ ] Go to Admin → Permissions UI and confirm AUDIT_REP row appears per role
- [ ] Test: page loads → Report Name and Date Field dropdowns populated
- [ ] Test: View with no date field → all records returned, no WHERE clause in SQL
- [ ] Test: View with date field + range → only records within range returned
- [ ] Test: DEL rows shown with pink (#FFC0C0) background
- [ ] Test: UPD2/UPD1 pairs with differences → differing cells bold in both rows
- [ ] Test: UPD2/UPD1 pairs with no differences → both rows removed from display
- [ ] Test: Excel export → sheet named "Hamali Calculation", col A hidden, frozen at B2
- [ ] Test: Excel bold/colors visible if xlsx-js-style installed (optional upgrade)

---

## Phase 14 — Transfer Opening Balance (frmTrfOpnBal)

**Date:** 2026-08-02
**VB6 source:** `frmTrfOpnBal.frm`
**Module code:** `TRF_OPN_BAL`
**Route prefix:** `/api/transactions/transfer-opn-bal`
**Frontend page:** `frontend/src/pages/transactions/TransferOpnBalPage.jsx`
**Backend route:** `backend/src/routes/transactions/transferOpnBal.js`
**Nav group:** TRANSFER (new)

### Purpose

Transfers the closing stock balance of the current financial year as opening balance
entries (OpFlg = 'Y') in the next financial year. Mirrors VB6 `cmdGo_Click` logic.

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/src/routes/transactions/transferOpnBal.js` | GET /init + POST /execute |
| `frontend/src/pages/transactions/TransferOpnBalPage.jsx` | React page with party selection grid + results |
| `backend/src/app.js` | Added `app.use('/api/transactions/transfer-opn-bal', ...)` |
| `frontend/src/App.jsx` | Import + `<Route path="transactions/transfer-opn-bal" …>` |
| `frontend/src/layouts/AppShell.jsx` | New TRANSFER nav group with SwapHorizIcon |
| `frontend/src/pages/admin/PermissionPage.jsx` | Added `{ code: 'TRF_OPN_BAL', label: 'Transfer Opening Balance' }` |

### Business Logic (mirrors VB6 cmdGo_Click)

1. **GET /init** — returns parties + FaYear info (Q1, Q2)
2. **POST /execute** — runs the transfer:
   - Q3: Godown-wise closing balance for selected parties in `currentFaYear` (from `vStkTransQty`)
   - Q5: Already-transferred opening entries in `targetFaYear` (OpFlg = 'Y')
   - For each lot:
     - Q4: Fetch original ARV details
     - If already transferred: Q6 (negative balance check) → if fails: error; if passes: Q7 (delete old) → Q8 (insert new)
     - If not yet transferred: Q8 (insert)
   - Q8 inserts: first godown → TransType='ARV', subsequent godowns → TransType='IN', all with OpFlg='Y'
   - `pfkOriLotID` in new entries = original lot's pfkOriLotID (preserves lot chain across years)
   - Inserts wrapped in MySQL transaction per lot (rollback on any INSERT failure)

### Opening Balance Entry Pattern

| Field | Value |
|-------|-------|
| TransType | 'ARV' (first godown) or 'IN' (subsequent) |
| OpFlg | 'Y' |
| FaYear | targetFaYear |
| TransDt / TransTm | StartDate of targetFaYear |
| pfkLotID | Newly generated serial key |
| pfkOriLotID | Carried from original ARV's pfkOriLotID |
| GodownQty1 | Closing balance for this godown |
| TransQty | Same as GodownQty1 |
| CrMod | NOW() |

### Permission SQL — Run on gms_admin

```sql
-- Admin role: full access
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_ADMIN', 'TRF_OPN_BAL', 'Y','Y','Y','Y','Y','Y')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='Y', CanDelete='Y', CanPrint='Y', CanExport='Y';

-- Operator role: view + execute (CanAdd = Go button)
INSERT INTO mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES ('BHW_USER', 'TRF_OPN_BAL', 'Y','Y','N','N','N','N')
ON DUPLICATE KEY UPDATE
  CanView='Y', CanAdd='Y', CanEdit='N', CanDelete='N', CanPrint='N', CanExport='N';
```

### Checklist

- [ ] Insert `TRF_OPN_BAL` rows into `gms_admin.mPermission` for each role (SQL above)
- [ ] Go to Admin → Permissions UI and confirm TRF_OPN_BAL row appears per role
- [ ] Verify `FaYearInfo` table has rows for `fkCompID` + `fkBranchID` with `NextFaYear` set
- [ ] Verify `vStkTransQty` view includes `OpFlg`, `pfkOriLotID`, `fkPartyID`, `FaYear` columns
- [ ] Test: page loads → parties listed, Last Date and FaYear fields populated
- [ ] Test: Select All / Deselect All buttons work
- [ ] Test: Go with no party selected → disabled (button grayed out)
- [ ] Test: Go with parties → result shows transferred lots + errors (if any)
- [ ] Test: Re-run on already-transferred parties → lots show 're-transferred' status
- [ ] Test: Lot with existing movements in new year + new qty too low → error row shown
- [ ] Test: New year's tStockEntry has OpFlg='Y', FaYear=targetFaYear, TransType='ARV'/'IN'

---

## Phase 15 — Transfer Between DataBase (frmTrfDB)

**Module code:** `TRF_DB`
**Backend:** `backend/src/routes/transactions/transferBetweenDb.js`
**Frontend:** `frontend/src/pages/transactions/TransferBetweenDbPage.jsx`

### What it does

Moves open stock lots from a party in the logged-in company's database to a party
in any other company database within the same group. All company databases share the
same MySQL server, so cross-schema writes use `dbName`.`table` syntax via
`connectionManager.getDB(newCompID)`.

### Database changes required

No new tables. The existing `tStockEntry`, `SerialIDLot`, and `SerialID` tables are
used. Ensure the following permission row exists in `gms_admin.mPermission`:

```sql
-- Insert TRF_DB permission row for each role.
-- TRF_DB / CanAdd defaults to OFF for all non-admin roles (high-risk operation).
-- Example for ADMIN role:
INSERT INTO gms_admin.mPermission
  (fkRoleID, ModuleCode, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport)
VALUES
  ('ADMIN', 'TRF_DB', 'Y', 'Y', 'N', 'N', 'N', 'N')
ON DUPLICATE KEY UPDATE CanView='Y', CanAdd='Y';

-- For non-admin roles: CanView='N', CanAdd='N' (transfer disabled by default)
```

### Endpoints

| Method | Path                                    | Permission          | Mirrors VB6       |
|--------|-----------------------------------------|---------------------|-------------------|
| GET    | /api/transactions/transfer-db/init      | TRF_DB / CanView    | Form_Load + udfGetCompID |
| GET    | /api/transactions/transfer-db/old-parties | TRF_DB / CanView  | udfFillOldPartyGrid |
| GET    | /api/transactions/transfer-db/new-parties | TRF_DB / CanView  | udfFillNewPartyGrid |
| GET    | /api/transactions/transfer-db/lots      | TRF_DB / CanView    | udfPopLotSel + udfValFromDt |
| POST   | /api/transactions/transfer-db/execute   | TRF_DB / CanAdd     | cmdCreat_Click → udfGenNewDB |

### VB6 Anomalies Documented (not silently fixed)

**A1 — mFv.bResetLot dead variable** (VB6 `vfgTrfDB_AfterEdit` / `udfGenNewDB`):
`mFv.bResetLot` is set in `vfgTrfDB_AfterEdit` when the same party is selected for both
old and new, but is never read in the code path that handles this case. The `mFv.bCondFlg`
check already covers the same-party scenario. `mFv.bResetLot` is a dead variable.
Migration behaviour: ignored; `sameCompBranch` replaces the entire bCondFlg/bResetLot logic.

**A2 — MsgBox return value never read** (VB6 `vfgTrfDB_AfterEdit` line ~405):
When new party = old party, a `MsgBox` is shown but `nAns` is never checked before
proceeding. The dialog is cosmetic only — execution continues regardless of user choice.
Migration behaviour: replaced with a non-blocking Alert banner in the React UI; user
can still proceed.

**A3 — `udfResetOldLotNum` reads wrong recordset** (VB6 line ~2020):
Inside the `BOF And EOF` branch (no rows found), the code reads `mRs.rsTranfDB("LastNum")`
but `rsTranfDB` is not open at that point. `nLastNo` stays 0 (its initialised value).
Migration behaviour: replicated exactly — when no rows found, `nLastNo = 0`.

**A4 — Old DB writes are outside the transaction** (VB6 `udfGenNewDB` / `udfOldPartyZeroBal`):
VB6 calls `conNewDbupdt.BeginTrans` / `CommitTrans` on the NEW DB connection only.
DESP inserts and the post-cutoff DELETE on the OLD DB are not covered by any transaction.
If the new-DB commit succeeds but the old-DB DESP insert fails, the old DB is left in
an inconsistent state (balance not zeroed). Since all company databases are on the same
MySQL server, a unified cross-schema transaction is technically feasible.
**RECOMMENDATION**: wrap both old and new DB writes in a single transaction before
production use. Requires business owner confirmation.
Migration behaviour: VB6 behaviour preserved — only new-DB writes use `newTxn`.

**A5 — Hard DELETE / INSERT with no audit trail** (VB6 `udfOldPartyDeleteData` / `udfOldPartyZeroBal`):
Post-cutoff rows are deleted from the old DB (hard DELETE, no shadow copy).
DESP rows inserted in old DB carry no reference back to the new DB lot ID.
**RECOMMENDATION**: add a shadow/archive table or a `TrfDbLog` table that records
the old pfkLotID → new pfkLotID mapping before deletion.
Migration behaviour: hard DELETE preserved from VB6.

### Frontend defaults (from VB6 `udfInitialiseControls` lines 1168-1169)

- **Generate New Lot Numbers** checkbox: **UNCHECKED** by default
  (VB6 design-time value is `Checked=1` but `udfInitialiseControls` overrides it to `vbUnchecked`)
- **Reset Lot Serial** checkbox: **CHECKED** by default (`vbChecked`)

### Key business rules preserved

1. **Branch 2 of lots query has no FaYear filter** (udfPopLotSel lines 978-983):
   Lots arrived AFTER fromDt are included regardless of FaYear.
2. **TransDt rule** (APN comment "09-08-2012"): ARV row in new DB uses `fromDt` as
   TransDt when original lot has `OpFlg='Y'` (opening balance); otherwise uses `OriTransDt`.
3. **OpFlg = 'N' hardcoded** for all new ARV rows in new DB (VB6 line 1684).
4. **DESP fromDt filter is INCLUSIVE** (`TransDt <= fromDt`) while GodBal query is
   EXCLUSIVE (`TransDt < fromDt`).
5. **3rd+ godown rule**: only the first two godowns go into the ARV row's GodownID1/GodownID2;
   each additional godown gets its own IN row with a new TransID.
6. **SerialIDLot seeding** (`uptNewLotSerialID`): only INSERT if row not found — existing
   row is never updated (VB6 ADO close-without-Update behaviour preserved).

### Testing checklist

- [ ] GET /init returns old company + full group company list with branch IDs
- [ ] GET /old-parties lists active parties from logged-in company
- [ ] GET /new-parties lists active parties from selected destination company
- [ ] GET /lots returns all open lots for given party + fromDt + faYear
- [ ] Lots grid: all rows selected by default; right-click menu works
- [ ] genLotNum=false (default): new lots keep original LotNum
- [ ] genLotNum=true: new lots get new lot number in `pCode+YY+NNN` format
- [ ] resetLotNum=true (default): old party SerialIDLot updated after each lot
- [ ] sameCompBranch=true: SerialIDLot reset to 0 (resetLotSrNo path)
- [ ] sameCompBranch=false: SerialIDLot seeded from max suffix (uptNewLotSerialID path)
- [ ] 3-godown lot: ARV row has godown1+godown2; third godown becomes IN row
- [ ] Post-cutoff transactions are copied to new DB with newPfkLotID
- [ ] Post-cutoff transactions are deleted from old DB after copy
- [ ] DESP rows appear in old DB with negative GodownQty1, DoNum='TRF', GatePass='0'
- [ ] New-DB rollback on error: all new-DB changes rolled back; old-DB writes NOT rolled back (A4)
- [ ] Lot with OpFlg='Y': new ARV row gets TransDt = fromDt
- [ ] Lot with OpFlg='N': new ARV row gets TransDt = OriTransDt
