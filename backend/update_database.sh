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
RESULTS_EXPORT_URL="https://www.worldcubeassociation.org/export/results/v2/tsv"

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
RESULTS_ZIP_PATH="$TMP_DIR/wca-results.tsv.zip"
RANKS_SINGLE_PATH="$TMP_DIR/WCA_export_ranks_single.tsv"
RANKS_AVERAGE_PATH="$TMP_DIR/WCA_export_ranks_average.tsv"
INDEX_PATH="$TMP_DIR/deferred_indexes.sql"

mkdir -p "$TMP_DIR"
# Earlier versions of this script expanded the dump to disk and left it there, ~10 GB.
rm -f "$TMP_DIR"/*.sql

db() { mariadb --user="$DB_USER" --password="$DB_PASS" "$@"; }
step() { echo "[$(date -u '+%H:%M:%S')] $*"; }

step "Downloading developer and results exports"
download_failed=0
curl -fsSL -D "$HEADER_PATH" -o "$ZIP_PATH" "$EXPORT_URL" &
developer_download_pid=$!
curl -fsSL -o "$RESULTS_ZIP_PATH" "$RESULTS_EXPORT_URL" &
results_download_pid=$!
if ! wait "$developer_download_pid"; then
  download_failed=1
fi
if ! wait "$results_download_pid"; then
  download_failed=1
fi
if [ "$download_failed" -ne 0 ]; then
  echo "Failed to download one or more WCA exports" >&2
  exit 1
fi

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

# The results export carries the official rank tables which the developer dump deliberately
# leaves empty. Keep its own timestamp: the two exports are generated independently and may
# be a day or two apart.
RESULTS_METADATA="$(unzip -p "$RESULTS_ZIP_PATH" metadata.json)"
RESULTS_EXPORT_TIMESTAMP="$(printf '%s' "$RESULTS_METADATA" | sed -n 's/.*"export_date"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
RESULTS_EXPORT_VERSION="$(printf '%s' "$RESULTS_METADATA" | sed -n 's/.*"export_format_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
case "$RESULTS_EXPORT_VERSION" in
  v2.* | 2.*) ;;
  *)
    echo "Unsupported or missing results export format version: ${RESULTS_EXPORT_VERSION:-unknown}" >&2
    exit 1
    ;;
esac
if [ -z "$RESULTS_EXPORT_TIMESTAMP" ]; then
  echo "Results export timestamp is missing" >&2
  exit 1
fi
step "Developer export: $EXPORT_TIMESTAMP; ranks export: $RESULTS_EXPORT_TIMESTAMP ($RESULTS_EXPORT_VERSION)"

step "Extracting official rank tables"
unzip -jo "$RESULTS_ZIP_PATH" \
  WCA_export_ranks_single.tsv WCA_export_ranks_average.tsv \
  -d "$TMP_DIR"

EXPECTED_RANKS_HEADER=$'best\tperson_id\tevent_id\tworld_rank\tcontinent_rank\tcountry_rank'
for ranks_path in "$RANKS_SINGLE_PATH" "$RANKS_AVERAGE_PATH"; do
  ranks_header="$(head -n 1 "$ranks_path" | tr -d '\r')"
  if [ "$ranks_header" != "$EXPECTED_RANKS_HEADER" ]; then
    echo "Unexpected header in $ranks_path: $ranks_header" >&2
    exit 1
  fi
done

EXPECTED_SINGLE_ROWS="$(($(wc -l < "$RANKS_SINGLE_PATH") - 1))"
EXPECTED_AVERAGE_ROWS="$(($(wc -l < "$RANKS_AVERAGE_PATH") - 1))"
if [ "$EXPECTED_SINGLE_ROWS" -le 0 ] || [ "$EXPECTED_AVERAGE_ROWS" -le 0 ]; then
  echo "One or more official rank tables are empty" >&2
  exit 1
fi

# Which of these can be changed at runtime depends on the server build — innodb_doublewrite
# and innodb_log_file_size are read only on older MariaDB. Anything we cannot set is simply
# skipped: the bulk of the speed-up comes from deferring the index builds, not from these.
RESTORE_SQL=""

tune() {
  local name="$1" value="$2" original
  original="$(db -Nse "SELECT @@GLOBAL.$name" 2>/dev/null)" || return 0
  if ! db -e "SET GLOBAL $name = $value;" 2>/dev/null; then
    echo "  $name cannot be set at runtime on this server, leaving it alone"
    return 0
  fi
  case "$original" in
    '' | *[!0-9]*) original="'$original'" ;;
  esac
  RESTORE_SQL="${RESTORE_SQL}SET GLOBAL $name = $original;
"
}

restore_settings() {
  local statement
  while IFS= read -r statement; do
    [ -n "$statement" ] && db -e "$statement" 2>/dev/null || true
  done <<< "$RESTORE_SQL"
}
trap restore_settings EXIT

step "Tuning InnoDB for the import"
tune innodb_doublewrite 0
tune innodb_flush_log_at_trx_commit 2
tune innodb_log_file_size "$IMPORT_LOG_FILE_SIZE"
if [ -n "$IMPORT_BUFFER_POOL_SIZE" ]; then
  tune innodb_buffer_pool_size "$IMPORT_BUFFER_POOL_SIZE"
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

# The TSV column order is explicit so a harmless column-order difference in the developer
# schema cannot corrupt the import. Load before secondary indexes are built, just like the
# tables from the SQL dump.
step "Importing official rank tables"
db --local-infile=1 "$NEW_DB_NAME" <<EOF
TRUNCATE TABLE ranks_single;
TRUNCATE TABLE ranks_average;
LOAD DATA LOCAL INFILE '$RANKS_SINGLE_PATH'
  INTO TABLE ranks_single
  CHARACTER SET utf8mb4
  FIELDS TERMINATED BY '\t'
  LINES TERMINATED BY '\n'
  IGNORE 1 LINES
  (best, person_id, event_id, world_rank, continent_rank, country_rank);
LOAD DATA LOCAL INFILE '$RANKS_AVERAGE_PATH'
  INTO TABLE ranks_average
  CHARACTER SET utf8mb4
  FIELDS TERMINATED BY '\t'
  LINES TERMINATED BY '\n'
  IGNORE 1 LINES
  (best, person_id, event_id, world_rank, continent_rank, country_rank);
EOF

read -r IMPORTED_SINGLE_ROWS IMPORTED_AVERAGE_ROWS < <(
  db -Nse "SELECT (SELECT COUNT(*) FROM ranks_single),
                  (SELECT COUNT(*) FROM ranks_average)" "$NEW_DB_NAME"
)
if [ "$IMPORTED_SINGLE_ROWS" -ne "$EXPECTED_SINGLE_ROWS" ] || \
   [ "$IMPORTED_AVERAGE_ROWS" -ne "$EXPECTED_AVERAGE_ROWS" ]; then
  echo "Rank import count mismatch: single $IMPORTED_SINGLE_ROWS/$EXPECTED_SINGLE_ROWS, average $IMPORTED_AVERAGE_ROWS/$EXPECTED_AVERAGE_ROWS" >&2
  exit 1
fi

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
DELETE FROM wca_statistics_metadata WHERE field IN ('ranks_export_timestamp', 'ranks_export_format_version');
INSERT INTO wca_statistics_metadata (field, value) VALUES
  ('ranks_export_timestamp', '$RESULTS_EXPORT_TIMESTAMP'),
  ('ranks_export_format_version', '$RESULTS_EXPORT_VERSION');
EOF

# Into the staging database, so it is swapped in with the export it was built from and the
# statistics are never left pointing at entries computed from a previous one.
step "Computing statistics entries"
db "$NEW_DB_NAME" < "$SCRIPT_DIR/statistics_entries.sql"

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

rm -f "$ZIP_PATH" "$HEADER_PATH" "$RESULTS_ZIP_PATH" \
  "$RANKS_SINGLE_PATH" "$RANKS_AVERAGE_PATH" "$INDEX_PATH"

step "Database updated successfully and swapped safely."
