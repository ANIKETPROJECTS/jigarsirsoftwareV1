# Migration Notes

## Bill Number Editor — 2026-10-20

### Overview
Added a new "Bill Number Editor" feature that allows authorized users to view and
bulk-edit or individually edit BillNum across three bill types:

| Module       | Table             | BillType |
|--------------|-------------------|----------|
| Godown Rent  | `tBill1`          | GODRENT  |
| Hamali       | `tBillTrHmGen1`   | HMLI     |
| General      | `tBillTrHmGen1`   | GEN      |

### New Files
- `backend/src/routes/billing/billNumberEdit.js`
  - `GET  /api/billing/bill-numbers` — list bills with filters
  - `PUT  /api/billing/bill-numbers` — batch update BillNum
- `frontend/src/pages/billing/BillNumberEditorPage.jsx`
  - Tabbed UI: Godown Rent | Hamali | General
  - Inline editable BillNum field, client + server validation
  - Success / error toast notifications

### Modified Files
- `backend/src/app.js` — registered new route
- `frontend/src/App.jsx` — added route `billing/bill-numbers`
- `frontend/src/layouts/AppShell.jsx` — added nav item under BILLING group

### Permission
A new module code **`BILL_NUM_EDIT`** must be added to `mModule` and granted in
`mPermission` for the roles that need access:

```sql
-- Run once per company / group DB (or in the shared config DB)
INSERT INTO mModule (pkModuleCode, ModuleName, ModuleGroup)
VALUES ('BILL_NUM_EDIT', 'Bill Number Editor', 'BILLING');

-- Grant CanView + CanEdit to the desired role (replace ? with the role ID)
INSERT INTO mPermission (fkModuleCode, fkRoleID, CanView, CanEdit)
VALUES ('BILL_NUM_EDIT', ?, 'Y', 'Y')
ON DUPLICATE KEY UPDATE CanView = 'Y', CanEdit = 'Y';
```

### Notes
- No schema changes required — `BillNum` already exists in both bill tables.
- All updates are logged to the server console with table, pkBillID, compID, and
  the userID who made the change.
- Blank BillNum values are rejected with HTTP 400 (list of invalid records returned).
- Partial success returns HTTP 207 with per-record status.
