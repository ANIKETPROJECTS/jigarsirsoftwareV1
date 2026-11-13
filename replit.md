# GMS on Replit

## Existing project
- React 19 + Vite frontend in `frontend/`; Express + Sequelize/MySQL backend in `backend/`.
- Keep the existing structure and MySQL-compatible multi-database design.
- Read `CLAUDE.md` before changing business logic, models, or routes.

## Run
Click **Run** to start the `Start application` workflow (`bash scripts/dev.sh`).
This starts the local MariaDB server, Express on port 3001, and Vite on port 5000.
The preview uses Vite; `/api` and `/uploads` are proxied to Express.
`VITE_API_BASE_URL=/api` is set in Replit's shared environment to override the imported localhost setting.

Dependencies are installed separately using the existing `frontend/package-lock.json`
and `backend/package-lock.json`. Use Node 22. Production frontend build:
`npm run build --prefix frontend`.

## Local development database
- The user chose to restore the included September 10, 2026 backups.
- Five databases were restored: `gms_admin`, `gms_ads`, `gms_test`, `gms_test1`, `gms_vlco`.
- Existing users, password hashes, company records, and business records were preserved.
- Sign in with existing credentials from the backed-up system; no new login was created.
- MariaDB is socket-only, using the workspace OS account; it does not expose a database TCP port.
- Shared configuration: `DB_USER=runner`, `DB_SOCKET=/home/runner/workspace/.local/mysql/mysql.sock`,
  `DB_HOST=localhost`, `ADMIN_DB_NAME=gms_admin`, `PORT=3001`.
- Backend connections use `DB_SOCKET` when present; normal MySQL host/password connections remain supported.
- JWT signing uses `JWT_SECRET`, or the existing `SESSION_SECRET` from Replit Secrets.
  Never print or commit either value.
- MariaDB's data, logs, and new backups live under `.local/mysql/`, excluded from Git and publishing.
  These are workspace-local files, not an external managed production database.
- `scripts/local-db.sh` initializes only the MariaDB system tables on an empty data directory.
- `scripts/restore-imported-backups.sh` is a one-time restore helper and refuses to overwrite existing GMS databases.
  Do not rerun it to reset data. Original backup archives are unchanged.
- The restore helper adapts MySQL 8 collations and view definers, and imports tables before cross-database views.
- Chromium is installed for existing PDF features; its executable is resolved at startup.
  The backup routes support the local database socket.

## Verification
- `GET /api/health`: HTTP 200 with `status: "ok"`.
- `GET /api/auth/companies`: HTTP 200 with four company entries.
- `GET /api/auth/me` without login: HTTP 401.
- The login screen was visually verified and the frontend production build passed.
- All restored database views passed `CHECK TABLE`.
- Signed-in screens were not visually verified: no existing account password was supplied.

### Admin-panel checks using an existing admin login
1. In Preview, select the company and sign in with the original user code and password.
   Expected: dashboard opens rather than a connection error.
2. Open **Admin → Companies** (`/admin/companies`).
   Expected: company entries for the signed-in group load from the restored data.
3. Open **Admin → Users** (`/admin/users`) and **Admin → Permissions** (`/admin/permissions`).
   Expected: restored group users and role permissions load; no passwords were reset.
4. Open **Admin → Database Backup** (`/admin/database-backup`).
   Expected: database selection and backup history load. New backups use the local
   backup directory, so the imported archives are not listed in this history.
   Optionally select the admin database and click **Run Backup**; expected: a new
   downloadable archive appears without changing the imported archives.

## Publishing
This setup runs in the development workspace. Do not publish it as-is.
Publishing requires a separately hosted MySQL-compatible server, securely configured
credentials, a production run command, and durable upload/backup storage.
Do not migrate this project's database to PostgreSQL without the user's explicit request.
