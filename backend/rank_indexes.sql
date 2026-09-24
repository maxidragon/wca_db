-- Orders each rank table by event and world rank, so the nemeses of a competitor are one
-- index range: everyone ranked above them in the event they rank best in. The person id
-- makes the index covering, so that range never reads the table itself. Built after the
-- rank tables are loaded, like the dump's own indexes; IF NOT EXISTS makes it safe to run
-- against a database that already has them, which is what a deploy does.
CREATE INDEX IF NOT EXISTS index_ranks_single_on_event_rank
  ON ranks_single (event_id, world_rank, person_id);
CREATE INDEX IF NOT EXISTS index_ranks_average_on_event_rank
  ON ranks_average (event_id, world_rank, person_id);
