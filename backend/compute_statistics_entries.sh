#!/bin/bash
set -euo pipefail

# Builds the statistics_entries table for an existing database. update_database.sh builds it
# as part of an import, so a database that has been imported since the table existed never
# needs this; run it by hand for one that has not.
#
# --if-missing builds it only when it is absent, which is what a deploy wants: the first
# deploy of the table backfills it, every later one costs a single query.
#
# Usage: ./compute_statistics_entries.sh [--if-missing] [database]

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
  # Counts as missing when the table is absent, which errors, or present but empty.
  EXISTING="$(mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" \
    -Nse "SELECT COUNT(*) FROM statistics_entries" 2>/dev/null || echo 0)"
  if [ "${EXISTING:-0}" -gt 0 ]; then
    echo "Statistics entries already present in $DB_NAME ($EXISTING rows), skipping."
    exit 0
  fi
fi

echo "Computing statistics entries in $DB_NAME (this takes a few minutes)..."
mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" < "$SCRIPT_DIR/statistics_entries.sql"

COUNT=$(mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" -Nse "SELECT COUNT(*) FROM statistics_entries")
echo "Done! Computed $COUNT statistics entries."
