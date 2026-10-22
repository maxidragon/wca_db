#!/bin/bash
set -euo pipefail

# Creates the read-only user the Query Tool connects as, QUERY_DB_USER / QUERY_DB_PASS in
# .env, with SELECT on DB_NAME and nothing else (see query_user.sql). Until it exists and
# those are set, /api/query and /api/schema answer 503.
#
# A one-off step per server, not part of the deploy: creating users needs an account that
# can grant, which the app's own DB_USER should not have to be. Re-run it after changing
# QUERY_DB_PASS; it also strips anything granted to the user by hand since.
#
# Connects as DB_USER unless ADMIN_DB_USER / ADMIN_DB_PASS name another account. The user
# is created for QUERY_DB_USER_HOST (default localhost), which must match the host the
# backend connects from as the database server sees it.
#
# Usage: ./create_query_user.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-wca}"
ADMIN_DB_USER="${ADMIN_DB_USER:-$DB_USER}"
ADMIN_DB_PASS="${ADMIN_DB_PASS:-${DB_PASS:-}}"
QUERY_DB_USER="${QUERY_DB_USER:-}"
QUERY_DB_PASS="${QUERY_DB_PASS:-}"
QUERY_DB_USER_HOST="${QUERY_DB_USER_HOST:-localhost}"

if [ -z "$QUERY_DB_USER" ] || [ -z "$QUERY_DB_PASS" ]; then
  echo "Set QUERY_DB_USER and QUERY_DB_PASS in .env first." >&2
  exit 1
fi
if [ "$QUERY_DB_USER" = "$DB_USER" ] || [ "$QUERY_DB_USER" = "$ADMIN_DB_USER" ] || [ "$QUERY_DB_USER" = "root" ]; then
  echo "QUERY_DB_USER must be a user of its own, not $QUERY_DB_USER." >&2
  exit 1
fi

# A MariaDB string literal for any value: spelled in hex, so nothing in it needs escaping.
sql_string() {
  printf "CONVERT(X'%s' USING utf8mb4)" "$(printf '%s' "$1" | od -An -tx1 | tr -d ' \n')"
}

echo "Creating read-only query user $QUERY_DB_USER@$QUERY_DB_USER_HOST on $DB_NAME..."
# Through stdin rather than -e, so the query user's password stays out of the process list.
{
  echo "SET @query_user = $(sql_string "$QUERY_DB_USER");"
  echo "SET @query_host = $(sql_string "$QUERY_DB_USER_HOST");"
  echo "SET @query_password = $(sql_string "$QUERY_DB_PASS");"
  echo "SET @query_database = $(sql_string "$DB_NAME");"
  cat "$SCRIPT_DIR/query_user.sql"
  echo "SET @statement = CONCAT('SHOW GRANTS FOR ', @query_account);"
  echo "PREPARE statement FROM @statement; EXECUTE statement; DEALLOCATE PREPARE statement;"
} | mariadb --user="$ADMIN_DB_USER" --password="$ADMIN_DB_PASS"
echo "Done. Restart the backend so it connects as the new user."
