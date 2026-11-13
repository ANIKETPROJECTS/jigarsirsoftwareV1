# GMS-Web — Coding Conventions for Claude

This file is loaded automatically by Claude Code at the start of every session.
Follow every rule here without exception when writing any new backend route,
model, or frontend page for this project.

---

## 1. Primary Key Format

Every new record's primary key (pkXxx) must follow this exact format:

```
CompID!BranchID!SerialNumber
```

**Example:** `ADS!HO!1`, `ADS!HO!42`, `KPS!MUM!7`

### How to generate it (backend)

Use `gudfGenSerialID` from `src/utils/serialID.js`. Always pass `insertIfNew = 'Y'`
so the SerialID row is auto-created on first use.

```javascript
const { gudfGenSerialID, buildSerialKey } = require('../../utils/serialID');

// SerialID key format: CompID!BranchID!TABLENAME!PKCOLNAME
const serialKey = `${compID}!${branchID}!TSTOCKENT!PKTRANSID`;
const n = await gudfGenSerialID(db, serialKey, 'Stock Entry ID', 'Y');
if (n === -1) return res.status(500).json({ error: 'Failed to generate ID' });
const pkTransID = buildSerialKey(compID, branchID, n);
// pkTransID → 'ADS!HO!1'
```

### SerialID key naming convention

| Table | PK column | SerialID key |
|---|---|---|
| tStockEntry | pkTransID | `{compID}!{branchID}!TSTOCKENT!PKTRANSID` |
| mParty | pkPartyID | `{compID}!{branchID}!MPARTY!PKPARTYID` |
| mItem | pkItemID | `{compID}!{branchID}!MITEM!PKITEMID` |
| mGodown | pkGodownID | `{compID}!{branchID}!MGODOWN!PKGODOWNID` |
| mEmployee | pkEmpID | `{compID}!{branchID}!MEMP!PKEMPID` |
| mBank | pkBankID | `{compID}!{branchID}!MBANK!PKBANKID` |
| VCTemplate | cpkTemplID | `{compID}!{branchID}!TEMPLATEID!PKTEMPLID` |

For any new table, follow the same pattern:
`{compID}!{branchID}!{TABLENAME_UPPERCASE}!{PKCOLNAME_UPPERCASE}`

---

## 2. Table Scoping — compID vs groupID

Different tables are scoped differently. NEVER use `fkCompID` on group-level tables.

| Table | Filter column | Value |
|---|---|---|
| mParty | `fkCompID` | `req.user.compID` |
| tStockEntry | `fkCompID` | `req.user.compID` |
| tBill1 / tReceipt | `fkCompID` | `req.user.compID` |
| **mItem** | **`fkGroupID`** | **`req.user.groupID`** |
| **mGodown** | **`fkGroupID`** | **`req.user.groupID`** |
| **mEmployee** | **`fkGroupID`** | **`req.user.groupID`** |
| VCTemplate | `fkCompID` | `req.user.compID` |

When JOINing `mItem` or `mGodown`, join on PK only — do NOT add an extra company/group filter:
```sql
JOIN mItem  i ON ts.fkItemID    = i.pkItemID    -- correct
JOIN mGodown g ON ts.fkGodownID1 = g.pkGodownID  -- correct
-- WRONG: AND g.fkCompID = ts.fkCompID (mGodown has no fkCompID)
```

---

## 3. `req.user` Fields

JWT payload decoded by `requireAuth` middleware:

```javascript
req.user = {
  userId,        // login user ID
  compID,        // company ID  e.g. 'ADS'
  groupID,       // company group ID  e.g. 'BHW'
  branchID,      // branch ID  e.g. 'HO'
  userCode,
  userFullName,
  roleID,
  isPrimary,
}
req.db        // Sequelize instance for the company DB
req.adminDB   // Sequelize instance for the admin DB
```

---

## 4. Raw SQL Pattern (Sequelize)

Always use raw queries with positional `?` placeholders:

```javascript
const [rows] = await db.query(
  `SELECT pkPartyID, pName FROM mParty WHERE fkCompID = ? AND Active = 'Y'`,
  { replacements: [compID] }
);
// rows is an array of plain objects
```

`db.query` returns `[rows, metadata]`. Destructure to `[rows]`.

For multi-row INSERT (e.g. template rows), build the VALUES clause explicitly:
```javascript
const sql = `INSERT INTO VCTemplate (cpkTemplID, cpkSrno, ...) VALUES ${rows.map(() => '(?,?,...)').join(',')}`;
await db.query(sql, { replacements: rows.flatMap(r => [r.cpkTemplID, r.cpkSrno, ...]) });
```

Do **not** use `Model.bulkCreate()` for tables with composite PKs — use raw SQL instead.

---

## 5. Permission Middleware

```javascript
const requirePerm = require('../../middleware/permission');
router.get('/', requirePerm('MODULE_CODE', 'CanView'), handler);
```

Permission codes in use:

| Code | Description |
|---|---|
| `MASTERS` | State, Tax, Bank, Godown, Location, Holiday, Employee |
| `ITEM_MASTER` | Item Master |
| `PARTY` | Party Master |
| `ARRIVAL` | Arrival / Stock In |
| `DELIVERY` | Delivery / Dispatch |
| `ATTENDANCE` | Attendance Entry |
| `HAMALI` | Hamali Calculation Entry |
| `HAMALI_REP` | Hamali Calculation Report |
| `BAL_REP` | Balance Report |
| `BILLING` | Billing |
| `ADMIN` | Admin (Groups, Companies, Users, Roles) |

Template routes (`/api/reports/templates`) use `requireAuth` only — no `requirePerm` —
because they are always accessed from within a page that already checked its own permission.

---

## 6. Error Responses

Always expose the actual error message so the frontend can show it:

```javascript
} catch (err) {
  console.error('[RouteName action]', err.message);
  res.status(500).json({ error: `Friendly description: ${err.message}` });
}
```

---

## 7. Stack Summary

- **Backend:** Node.js + Express, Sequelize (raw queries), MySQL 8
- **Frontend:** React 18 + Vite, MUI v5
- **Auth:** JWT stored in localStorage, decoded by `requireAuth` middleware
- **DB:** One MySQL DB per company; admin DB separate
- **VB6 source:** `d:\UserFile\Projects\GMS_WEB_Documents\VB6 Files\`
- **Schema reference:** `gms-web/database/schema.sql`, `gms-web/database/views.sql`
- **VB6 SQL reference:** `VB6 Files\script.sql`
