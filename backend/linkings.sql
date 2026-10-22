-- Who competed with whom, for the relations chain: one row per competitor listing everybody
-- they shared a competition with. Multi-location Fewest Moves competitions and the
-- continent-wide and worldwide ones would connect nearly everybody, so they are left out.
--
-- Built into linkings_new and renamed into place in one statement, so a database that
-- already has linkings keeps serving the previous ones until the new ones are complete.
-- update_database.sh runs this in the staging database before the swap; the statements
-- must stay free of semicolons other than the ones ending them, for the tests split on them.

DROP TABLE IF EXISTS wca_id_with_competition, linkings_new, linkings_old;

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

CREATE INDEX idx_wca_comp ON wca_id_with_competition (competition_id, wca_id);

CREATE TABLE linkings_new (
  wca_id VARCHAR(10) PRIMARY KEY,
  wca_ids MEDIUMTEXT
);

SET SESSION group_concat_max_len = 1000000;

INSERT INTO linkings_new (wca_id, wca_ids)
SELECT first.wca_id,
       GROUP_CONCAT(DISTINCT second.wca_id) AS wca_ids
FROM wca_id_with_competition first
JOIN wca_id_with_competition second
  ON first.competition_id = second.competition_id
 AND first.wca_id != second.wca_id
GROUP BY first.wca_id;

DROP TABLE wca_id_with_competition;

-- The empty placeholder only exists on a first run, so the swap below is one statement
-- whether or not there is a previous table to swap out.
CREATE TABLE IF NOT EXISTS linkings LIKE linkings_new;
RENAME TABLE linkings TO linkings_old, linkings_new TO linkings;
DROP TABLE linkings_old;
