#!/usr/bin/env bash
# One-time, explicitly requested restore. Never overwrite an initialized database.
set -euo pipefail
cd "$(dirname "$0")/.."
SOCKET="${DB_SOCKET:?DB_SOCKET must point to the local development database}"
existing="$(mariadb --socket="$SOCKET" --user="$(id -un)" --batch --skip-column-names \
  -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('gms_admin','gms_ads','gms_test','gms_test1','gms_vlco')")"
if [[ "$existing" != 0 ]]; then
  echo "Refusing to overwrite existing GMS databases." >&2
  exit 1
fi
databases=(gms_admin gms_ads gms_test gms_test1 gms_vlco)
for database in "${databases[@]}"; do
  backup=(backend/backups/backup-"$database"-20260910-*.sql.gz)
  [[ ${#backup[@]} == 1 && -f "${backup[0]}" ]] || { echo "Expected one September 10 backup for $database" >&2; exit 1; }
  echo "Restoring $database..."
  # MySQL 8's default collation is unavailable in MariaDB 10.11.
  # Keep the original archives intact; only adapt the import stream.
  # Restore every database's tables before creating cross-database views.
  gzip -cd "${backup[0]}" | awk '/^-- Final view structure/{final=1} !final' \
    | sed 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' \
    | mariadb --socket="$SOCKET" --user="$(id -un)"
done
for database in "${databases[@]}"; do
  backup=(backend/backups/backup-"$database"-20260910-*.sql.gz)
  echo "Restoring views for $database..."
  gzip -cd "${backup[0]}" | awk '/^-- Final view structure/{final=1} final && /^\/\*!500(01|13)/' \
    | sed 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' \
    | sed 's/DEFINER=`[^`]*`@`[^`]*`/DEFINER=CURRENT_USER/g' \
    | mariadb --socket="$SOCKET" --user="$(id -un)" "$database"
done
echo "Restored all five databases. Existing users and password hashes were preserved."
