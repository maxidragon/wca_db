#!/bin/bash
set -euo pipefail

# Builds the linkings table the relations page reads. update_database.sh builds it as part
# of an import; run this by hand to rebuild it for an existing database. The new table is
# swapped in only once it is complete, so the relations page keeps working meanwhile.
#
# --if-missing builds it only when it is absent or empty, which is what a deploy wants.
#
# Usage: ./compute_linkings.sh [--if-missing] [database]

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

db() { mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" "$@"; }

if [ "$IF_MISSING" = "1" ]; then
  # Absent errors, which counts as missing just like an empty table.
  EXISTING="$(db -Nse "SELECT EXISTS (SELECT 1 FROM linkings)" 2>/dev/null || echo 0)"
  if [ "${EXISTING:-0}" = "1" ]; then
    echo "Linkings already present in $DB_NAME, skipping."
    exit 0
  fi
fi

echo "Computing linkings in $DB_NAME (this takes about ten minutes)..."
db < "$SCRIPT_DIR/linkings.sql"

COUNT=$(db -Nse "SELECT COUNT(*) FROM linkings")
echo "Done! Computed linkings for $COUNT competitors."
