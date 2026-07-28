#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-wca}"

MYSQL_CMD="mysql --user=$DB_USER --password=$DB_PASS $DB_NAME"

echo "Creating linkings table if not exists..."
$MYSQL_CMD <<'EOF'
CREATE TABLE IF NOT EXISTS linkings (
  wca_id VARCHAR(10) PRIMARY KEY,
  wca_ids MEDIUMTEXT
);
EOF

echo "Building temp table from results..."
$MYSQL_CMD <<'EOF'
DROP TABLE IF EXISTS wca_id_with_competition;
CREATE TABLE wca_id_with_competition AS
SELECT DISTINCT r.person_id AS wca_id, r.competition_id
FROM results r
JOIN competitions c ON r.competition_id = c.id
WHERE c.country_id NOT IN ('XA', 'XE', 'XF', 'XM', 'XN', 'XO', 'XS', 'XW')
  AND c.id NOT IN (
    SELECT competition_id
    FROM competition_venues
    WHERE competition_id IN (
      SELECT competition_id
      FROM competition_events
      GROUP BY competition_id
      HAVING COUNT(*) = 1 AND MAX(event_id) = '333fm'
    )
    GROUP BY competition_id
    HAVING COUNT(*) > 1
  );
EOF

echo "Indexing temp table..."
$MYSQL_CMD <<'EOF'
CREATE INDEX idx_wca_comp ON wca_id_with_competition (competition_id, wca_id);
EOF

echo "Computing linkings (this may take 10-30 minutes)..."
$MYSQL_CMD <<'EOF'
SET SESSION group_concat_max_len = 1000000;

DELETE FROM linkings;

INSERT INTO linkings (wca_id, wca_ids)
SELECT first.wca_id,
       GROUP_CONCAT(DISTINCT second.wca_id) AS wca_ids
FROM wca_id_with_competition first
JOIN wca_id_with_competition second
  ON first.competition_id = second.competition_id
 AND first.wca_id != second.wca_id
GROUP BY first.wca_id;

DROP TABLE IF EXISTS wca_id_with_competition;
EOF

COUNT=$($MYSQL_CMD -Nse "SELECT COUNT(*) FROM linkings")
echo "Done! Computed linkings for $COUNT competitors."
