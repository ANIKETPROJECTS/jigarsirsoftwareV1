#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DB_DIR="$PWD/.local/mysql"
mkdir -p "$DB_DIR"
if [[ ! -f "$DB_DIR/data/mysql/user.frm" ]]; then
  mariadb-install-db --datadir="$DB_DIR/data" \
    --innodb-use-native-aio=0 \
    --auth-root-authentication-method=socket \
    --auth-root-socket-user="$(id -un)" > "$DB_DIR/install.log" 2>&1
fi
exec mariadbd --datadir="$DB_DIR/data" --socket="$DB_DIR/mysql.sock" \
  --pid-file="$DB_DIR/mysql.pid" --skip-networking \
  --lower-case-table-names=1 \
  --innodb-use-native-aio=0 \
  --log-error="$DB_DIR/server.log" --innodb-buffer-pool-size=128M
