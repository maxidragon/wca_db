# Relations

The **Relations** navigation tab (`/relations`) takes two WCA IDs and finds the shortest chain of competitors linking them, where each step is two people with results at the same competition, the way "six degrees of separation" works. For each step it lists the competitions that pair shared.

Competitions held in several places at once do not link anyone, because their competitors never met: competitions under one of the multi-country regions (`XA`, `XE`, `XF`, `XM`, `XN`, `XO`, `XS`, `XW`), and Fewest Moves-only competitions with more than one venue. They still count on the Competitions Together page.

## API

`GET /api/relations?wca_id1=…&wca_id2=…` (authenticated) returns `chain`, the competitors from the first to the second with their names, and `connections`, the competitions shared by each adjacent pair. No chain returns both empty. A missing or malformed WCA ID returns 400, an unknown one 404, and a missing or empty `linkings` table 503.

## How it is computed

`backend/linkings.sql` builds `linkings`: one row per competitor holding the comma-separated WCA IDs of everyone they have shared a competition with. It takes about ten minutes on the full export. The import runs it in the staging database before the swap, so the table always matches the export and is never missing from the live database. `backend/compute_linkings.sh [--if-missing] [database]` runs it by hand, and deploys run it with `--if-missing`. It builds `linkings_new` and renames it into place in one statement, so Relations keeps serving the previous table while it runs.

The search is a breadth-first search run from both competitors at once, taking turns between the two sides and reading each frontier's linkings in one query. It stops at the first competitor both sides have reached, or gives up and reports no chain once either side is eight steps out. The shared competitions are then read pair by pair from `results`.
