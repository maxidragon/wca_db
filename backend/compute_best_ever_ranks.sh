#!/bin/bash
set -euo pipefail

# Builds the best_ever_ranks table. update_database.sh builds it as part of an import; run
# this by hand to rebuild it for an existing database. Needs `npm run build` first. The new
# table is swapped in only once it is complete, so the page keeps working meanwhile.
#
# --if-missing builds it only when it is absent or empty, which is what a deploy wants.
#
# Usage: ./compute_best_ever_ranks.sh [--if-missing] [database]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

IF_MISSING=0
if [ "${1:-}" = "--if-missing" ]; then
  IF_MISSING=1
  shift
fi

DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${1:-${DB_NAME:-wca}}"

if [ "$IF_MISSING" = "1" ]; then
  # Absent errors, which counts as missing just like an empty table.
  EXISTING="$(mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" \
    -Nse "SELECT EXISTS (SELECT 1 FROM best_ever_ranks)" 2>/dev/null || echo 0)"
  if [ "${EXISTING:-0}" = "1" ]; then
    echo "Best ever ranks already present in $DB_NAME, skipping."
    exit 0
  fi
fi

echo "Computing best ever ranks in $DB_NAME (this takes about fifteen minutes)..."
cd "$SCRIPT_DIR"
node dist/compute_best_ever_ranks.js "$DB_NAME"
