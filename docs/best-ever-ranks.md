# Best Ever Ranks

The **Best Ever Ranks** navigation tab (`/best-ever-ranks`) takes a WCA ID and shows, for each event, single and average, the best world, continental and national rank the competitor has ever held, with the result they held it with and the period they held it: from the competition that set it until the day somebody pushed them down, or "still held". A rank held years ago and lost since still counts; this is not the current ranking.

Every event with results is included, deprecated ones too. The region is the competitor's nationality at the time of the result, so somebody who changed country has national ranks in each country they competed for, as the official statistic does. Reaching the same best rank again later with a better result does not replace the earlier period: each result the rank was held with is listed with its own period.

## API

`GET /api/best-ever-ranks?wca_id=…` (authenticated) returns `person` and `ranks`, one row per event, result type, region and period, ordered by event, single before average, world before continent before country. A missing or malformed WCA ID returns 400, an unknown one 404, and a missing or empty `best_ever_ranks` table 503.

## How it is computed

The table is precomputed by `backend/compute_best_ever_ranks.sh [--if-missing] [database]`, which runs `dist/compute_best_ever_ranks.js` (so the backend must be built first) and takes about fifteen minutes on the full export. The import runs it in the staging database before the swap, so the table always matches the export and is never missing from the live database; `update_database.sh` checks for the build before it downloads anything. Deploys run it with `--if-missing`. It builds `best_ever_ranks_new` and renames it into place, so a manual rerun keeps the previous table in service until the new one is ready.

A competitor's rank can only get worse between their own personal bests, because everybody else only ever improves. So the best rank they ever held is always reached right after one of their own PBs, and ranks only need evaluating at those moments rather than on every day of WCA history. One chronological pass per event keeps every competitor's current PB in a Fenwick tree per region, which answers "how many are faster than this" in logarithmic time; a second tree per region tracks who is currently holding their best ever rank, to find the day they lose it. Days are the finest unit the export has (competition start dates), so all results of a day are applied before anybody is ranked. The method is described in full at the top of `backend/src/compute_best_ever_ranks.ts`.
