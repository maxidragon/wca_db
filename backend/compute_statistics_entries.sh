#!/bin/bash
set -euo pipefail

# Builds the statistics_entries table for an existing database. update_database.sh runs
# this against the staging database as part of an import, so a fresh import never needs it;
# run it by hand after upgrading a database that was imported before the table existed.
#
# Usage: ./compute_statistics_entries.sh [database]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${1:-${DB_NAME:-wca}}"

echo "Computing statistics entries in $DB_NAME (this takes a few minutes)..."
mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" < "$SCRIPT_DIR/statistics_entries.sql"

COUNT=$(mariadb --user="$DB_USER" --password="$DB_PASS" "$DB_NAME" -Nse "SELECT COUNT(*) FROM statistics_entries")
echo "Done! Computed $COUNT statistics entries."
