-- Orders results by event and result, so the competitors who meet a qualification
-- requirement are one index range: every result in the event better than the limit. The
-- competition and person ids make the index covering, so a requirement that a hundred
-- thousand competitors meet reads no table rows, which takes seconds instead of a minute.
-- Built after the import like the dump's own indexes; IF NOT EXISTS makes it safe to run
-- against a database that already has them, which is what a deploy does.
CREATE INDEX IF NOT EXISTS index_results_on_event_best_qualification
  ON results (event_id, best, competition_id, person_id);
CREATE INDEX IF NOT EXISTS index_results_on_event_average_qualification
  ON results (event_id, average, competition_id, person_id);
