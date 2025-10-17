#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/./.env" ]; then
  set -a
  . "$SCRIPT_DIR/./.env"
  set +a
fi

DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-wca}"
NEW_DB_NAME="${DB_NAME}_new"
OLD_DB_NAME="${DB_NAME}_old"
EXPORT_URL="https://assets.worldcubeassociation.org/export/developer/wca-developer-database-dump.zip"

TMP_DIR="$SCRIPT_DIR/../tmp"
ZIP_PATH="$TMP_DIR/wca-dump.zip"

mkdir -p "$TMP_DIR"

curl -sSL -o "$ZIP_PATH" "$EXPORT_URL"
unzip -oq "$ZIP_PATH" -d "$TMP_DIR"

SQL_FILE="$(ls "$TMP_DIR"/*.sql | head -n 1)"
if [ -z "$SQL_FILE" ]; then
  echo "SQL dump not found in extracted files" >&2
  exit 1
fi

mysql --user="$DB_USER" --password="$DB_PASS" -e "DROP DATABASE IF EXISTS $NEW_DB_NAME; CREATE DATABASE $NEW_DB_NAME;"

CLEAN_FILE="$TMP_DIR/clean_dump.sql"
tail -n +2 "$SQL_FILE" > "$CLEAN_FILE"

mariadb --user="$DB_USER" --password="$DB_PASS" "$NEW_DB_NAME" -e "source $CLEAN_FILE"

EXPORT_TIMESTAMP="$(stat -c %y "$SQL_FILE" | cut -d' ' -f1,2)"
mysql --user="$DB_USER" --password="$DB_PASS" "$NEW_DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS wca_statistics_metadata (
  field VARCHAR(255),
  value VARCHAR(255)
);
DELETE FROM wca_statistics_metadata WHERE field = 'export_timestamp';
INSERT INTO wca_statistics_metadata (field, value)
  VALUES ('export_timestamp', '$EXPORT_TIMESTAMP');
EOF

mysql --user="$DB_USER" --password="$DB_PASS" -e "
  DROP DATABASE IF EXISTS $OLD_DB_NAME;
  RENAME DATABASE $DB_NAME TO $OLD_DB_NAME;
  RENAME DATABASE $NEW_DB_NAME TO $DB_NAME;
  DROP DATABASE $OLD_DB_NAME;
"

echo "Database updated successfully and swapped atomically."
