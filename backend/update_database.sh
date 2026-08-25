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
EXPORT_URL="https://exports.worldcubeassociation.org/developer/wca-developer-database-dump.zip"

# Applied for the import only, then put back to whatever they were. These trade crash
# safety and disk for speed, which is the right trade here: the import is the only writer,
# and if it dies half way we throw the staging database away and start again anyway.
IMPORT_LOG_FILE_SIZE="${IMPORT_LOG_FILE_SIZE:-1073741824}"
# The one knob that costs memory, and measurably the least useful of the three: once the
# indexes are built after the load rather than during it, a 1 GB pool only bought about 5%.
# Left alone by default; set it (e.g. 1073741824) if the box has memory going spare.
IMPORT_BUFFER_POOL_SIZE="${IMPORT_BUFFER_POOL_SIZE:-}"

TMP_DIR="$SCRIPT_DIR/../tmp"
ZIP_PATH="$TMP_DIR/wca-dump.zip"
HEADER_PATH="$TMP_DIR/wca-dump.headers"
INDEX_PATH="$TMP_DIR/deferred_indexes.sql"

mkdir -p "$TMP_DIR"
# Earlier versions of this script expanded the dump to disk and left it there, ~10 GB.
rm -f "$TMP_DIR"/*.sql

db() { mariadb --user="$DB_USER" --password="$DB_PASS" "$@"; }
step() { echo "[$(date -u '+%H:%M:%S')] $*"; }

step "Downloading export"
curl -sSL -D "$HEADER_PATH" -o "$ZIP_PATH" "$EXPORT_URL"

SQL_ENTRY="$(unzip -Z1 "$ZIP_PATH" '*.sql' | head -n 1)"
if [ -z "$SQL_ENTRY" ]; then
  echo "SQL dump not found in the archive" >&2
  exit 1
fi

# The export's own timestamp, from the response headers, so we never have to touch the
# 5 GB of SQL on disk just to read a date off it.
EXPORT_TIMESTAMP="$(awk '
  BEGIN {
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", names, " ")
    for (i = 1; i <= 12; i++) month[names[i]] = sprintf("%02d", i)
  }
  # Last-Modified: Tue, 25 Aug 2026 00:44:22 GMT
  tolower($1) == "last-modified:" { value = sprintf("%s-%s-%02d %s", $5, month[$4], $3, $6) }
  END { print value }
' "$HEADER_PATH")"
if [ -z "$EXPORT_TIMESTAMP" ]; then
  EXPORT_TIMESTAMP="$(date -u '+%Y-%m-%d %H:%M:%S')"
fi

ORIG_DOUBLEWRITE="$(db -Nse 'SELECT @@GLOBAL.innodb_doublewrite')"
ORIG_FLUSH="$(db -Nse 'SELECT @@GLOBAL.innodb_flush_log_at_trx_commit')"
ORIG_LOG_FILE_SIZE="$(db -Nse 'SELECT @@GLOBAL.innodb_log_file_size')"
ORIG_BUFFER_POOL_SIZE="$(db -Nse 'SELECT @@GLOBAL.innodb_buffer_pool_size')"

restore_settings() {
  db -e "SET GLOBAL innodb_doublewrite = $ORIG_DOUBLEWRITE;
         SET GLOBAL innodb_flush_log_at_trx_commit = $ORIG_FLUSH;
         SET GLOBAL innodb_log_file_size = $ORIG_LOG_FILE_SIZE;
         SET GLOBAL innodb_buffer_pool_size = $ORIG_BUFFER_POOL_SIZE;" || true
}
trap restore_settings EXIT

step "Tuning InnoDB for the import"
db -e "SET GLOBAL innodb_doublewrite = 0;
       SET GLOBAL innodb_flush_log_at_trx_commit = 2;
       SET GLOBAL innodb_log_file_size = $IMPORT_LOG_FILE_SIZE;"
if [ -n "$IMPORT_BUFFER_POOL_SIZE" ]; then
  db -e "SET GLOBAL innodb_buffer_pool_size = $IMPORT_BUFFER_POOL_SIZE;"
fi

db -e "DROP DATABASE IF EXISTS $NEW_DB_NAME; CREATE DATABASE $NEW_DB_NAME;"

# Straight from the archive into the client: no 5 GB of SQL on disk, no second 5 GB copy
# of it, and decompression runs alongside the import instead of before it. Line 1 is
# MariaDB's sandbox marker, which the client refuses to read.
step "Importing dump"
unzip -p "$ZIP_PATH" "$SQL_ENTRY" \
  | tail -n +2 \
  | awk -v ALTER_FILE="$INDEX_PATH" -f "$SCRIPT_DIR/defer_indexes.awk" \
  | db "$NEW_DB_NAME"

step "Building indexes"
{ echo "SET FOREIGN_KEY_CHECKS = 0;"; cat "$INDEX_PATH"; } | db "$NEW_DB_NAME"

db "$NEW_DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS wca_statistics_metadata (
  field VARCHAR(255),
  value VARCHAR(255)
);
DELETE FROM wca_statistics_metadata WHERE field = 'export_timestamp';
INSERT INTO wca_statistics_metadata (field, value)
  VALUES ('export_timestamp', '$EXPORT_TIMESTAMP');
EOF

step "Swapping the new database in"
# CREATE IF NOT EXISTS so a first ever run, with no live database to swap out, works too.
db -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;
       DROP DATABASE IF EXISTS $OLD_DB_NAME;
       CREATE DATABASE $OLD_DB_NAME;"

# One RENAME per database, so neither is ever seen half swapped.
rename_all() {
  local from="$1" to="$2" pairs
  pairs="$(db -Nse "SET SESSION group_concat_max_len = 1048576;
    SELECT GROUP_CONCAT(CONCAT('\`$from\`.\`', table_name, '\` TO \`$to\`.\`', table_name, '\`'))
    FROM information_schema.tables WHERE table_schema = '$from'")"
  if [ -n "$pairs" ] && [ "$pairs" != "NULL" ]; then
    db -e "RENAME TABLE $pairs;"
  fi
}

rename_all "$DB_NAME" "$OLD_DB_NAME"
rename_all "$NEW_DB_NAME" "$DB_NAME"

# The previous copy is only useful until the swap succeeds, and it is another ~15 GB.
db -e "DROP DATABASE $NEW_DB_NAME; DROP DATABASE $OLD_DB_NAME;"

rm -f "$ZIP_PATH" "$HEADER_PATH" "$INDEX_PATH"

step "Database updated successfully and swapped safely."
