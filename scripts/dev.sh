#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHROME_PATH="${CHROME_PATH:-$(command -v chromium)}"
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
if [[ -n "${DB_SOCKET:-}" ]]; then
  bash scripts/local-db.sh &
  pids+=("$!")
  ready=0
  for attempt in {1..60}; do
    if mariadb-admin --socket="$DB_SOCKET" --user="$(id -un)" ping --silent >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "Local database failed to start. See .local/mysql/server.log." >&2
    exit 1
  fi
fi
(cd backend && PORT=3001 node src/server.js) &
pids+=("$!")
(cd frontend && npm run dev) &
pids+=("$!")
wait -n "${pids[@]}"
