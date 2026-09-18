-- One row per competitor, competition and event: the grain every statistic that has to
-- read the whole export aggregates over. Attendance and solve counts come from here
-- instead of from seven million results joined to thirty-two million attempts.
--
-- Nationality at the time belongs in the key rather than beside it: it is all but constant
-- for a competitor at a competition, but the export does contain a case where it is not,
-- and the historical-region statistics have to keep counting that separately.
--
-- Built into `statistics_entries_new` and swapped in with a single RENAME, so readers
-- never see a half-built table.

SET SESSION tmp_table_size = 536870912;
SET SESSION max_heap_table_size = 536870912;
SET SESSION sort_buffer_size = 134217728;

DROP TABLE IF EXISTS statistics_entries_new;
DROP TABLE IF EXISTS statistics_entries_old;

-- The key columns are taken from `results` rather than spelled out, so they keep its exact
-- types and collation. Declared independently they follow the database default instead, and
-- every join back to results, persons or competitions fails on mixed collations.
CREATE TABLE statistics_entries_new ENGINE=InnoDB AS
SELECT r.competition_id, r.person_id, r.event_id, r.country_id,
       CAST(0 AS UNSIGNED) AS solves, CAST(0 AS UNSIGNED) AS attempts
FROM results r WHERE 1 = 0;

ALTER TABLE statistics_entries_new
  MODIFY solves SMALLINT UNSIGNED NOT NULL,
  MODIFY attempts SMALLINT UNSIGNED NOT NULL,
  ADD PRIMARY KEY (competition_id, person_id, event_id, country_id);

-- LEFT JOIN so a result that carries no attempt rows still counts as attendance, which is
-- what the competition and competitor counts are asking about.
INSERT INTO statistics_entries_new
  (competition_id, person_id, event_id, country_id, solves, attempts)
SELECT r.competition_id, r.person_id, r.event_id, r.country_id,
       SUM(CASE WHEN a.value > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN a.value <> 0 THEN 1 ELSE 0 END)
FROM results r
LEFT JOIN result_attempts a ON a.result_id = r.id
GROUP BY r.competition_id, r.person_id, r.event_id, r.country_id;

-- Added after the rows, which is faster than maintaining it during the insert. The primary
-- key already orders competition-first; this is the same table read competitor-first, and
-- it covers the attendance count outright.
ALTER TABLE statistics_entries_new ADD INDEX by_person (person_id, competition_id);

CREATE TABLE IF NOT EXISTS statistics_entries LIKE statistics_entries_new;
RENAME TABLE statistics_entries TO statistics_entries_old,
             statistics_entries_new TO statistics_entries;
DROP TABLE statistics_entries_old;
