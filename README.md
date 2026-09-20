# WCA DB

Tools for querying and exploring the WCA developer database. The React frontend lives in `frontend/`; the Express backend lives in `backend/` and uses MariaDB.

## Statistics

The **Statistics** navigation tab (`/statistics`) provides 19 views for exploring this project’s imported WCA database. WCA login is required, as with the other tools.

| Statistics | Filters |
| --- | --- |
| Sum of ranks | Region, gender, events, single/average |
| Sum of country ranks | Gender, events, single/average |
| Medal collection | Region, gender, year, events |
| Top 100 results and appearances | Region, gender, year, event, single/average |
| Best podiums | Competition region, year, event |
| Records by competitor and competition | Region, gender, year, events |
| Oldest standing records | Region, gender, events, single/average |
| Most competitions and most persons | Region, gender, year, events |
| Personal solves, personal solves in one competition, competition solves | Region, gender, year, events |
| Uncrowned kings and podium missers | Region, gender, event |
| Record missers | Region, gender, event, single/average |
| All events achiever | Region, gender |
| Most nth place | Region, gender, year, events, 2nd/4th, include DNF/DNS |

Selecting one event provides the per-event medal and placement variants; selecting a year provides yearly personal-solve standings. The **2×2 to 5×5** preset provides the corresponding rank-sum variants. Selected filters and pagination are stored in the URL. Opening the page, including a filtered URL, restores the filters without querying statistics. Click **Show statistics** to load results. After submission, pagination and browser history load the selected results; **Reset filters** clears results and returns to the idle state.

Region supports the world, all continents, and all countries in the export. Competition statistics use the competition location. Competitor statistics use current nationality for rank sums, medals, solves, and all-events completion, and nationality at the time of the result for attendance, placements, top-100 results, records set, and missers. Year filters use competition start dates. Gender selects competitors while retaining official placements and regional event ranks.

Top-100 singles count individual attempts rather than round bests and include all ties at the cutoff. Average results show their individual attempts. Solve statistics distinguish successful attempts from DNF/DNS attempts and unused zero slots. Medal counts use successful finals; nth-place counts include all rounds. Missing events in rank sums receive the last regional/world rank plus one. All-events completion requires successful singles and every available average in current events, and measures days from the first competition to completion.

Best podiums use official WCA finals, including successful-attempt means for Fewest Moves and points for Multi-Blind. Combined dual Fewest Moves results require competition metadata outside the WCA export and are not reconstructed. Standing-record age is measured at the developer export date.

The API exposes authenticated `GET /api/statistics/options` and `GET /api/statistics`. The latter accepts a `statistic` ID, its supported filters, `page` (default 1), and `page_size` (default 50, maximum 100). Multiple events use a comma-separated `events` value. Unsupported or invalid filters return 400. Queries use MariaDB’s database-enforced statement timeout (`QUERY_TIMEOUT_SECONDS`, default 60 seconds, capped at 300 for statistics), and raise the temporary-table ceiling for the statement only (`STATISTICS_MEMORY_MB`, default 64, clamped to 16–1024). A statistic groups the whole export into a temporary table, which spills to disk at MariaDB’s 16 MB default and costs three to four times the runtime; 32 MB already recovers nearly all of it. The ceiling is charged per statement against a pool of ten, so budget for ten times the value. Sort and join buffers stay at 2 MB and 4 MB whatever it is set to, because Linux allocates a sort buffer per sort and a larger one measures slower rather than faster. Raising the ceiling to 256 MB is worth roughly four times on “most personal solves in one competition”, whose intermediate is the one large enough to need it; every other statistic is at full speed by 64 MB. Results are cached in chunks of ten adjacent pages, so pagination reuses the same computation. Chunk storage is limited to 100 entries and 10,000 rows, with at most 100 individual page responses retained. Cache keys use the export timestamp and canonical event selections; results stay valid for that export until evicted. The export timestamp is checked once per minute, and unchanged exports reuse the existing filter metadata. An updated export clears cached chunks and pages; without an export timestamp, chunks expire after five minutes. Concurrent requests for pages in the same chunk share a computation.

Attendance and solve statistics read `statistics_entries`, one row per competitor, competition and event carrying that entry's successful and attempted solves, with nationality at the time in the key. Aggregating five million entries replaces joining seven million results to thirty-two million attempts, and the key orders competition-first so a year or competition-region filter becomes a prefix range; a second index orders it competitor-first and covers the attendance count outright. `update_database.sh` builds the table into the staging database before the swap, so it always matches the export it was computed from. Deploys do not import, so they run `compute_statistics_entries.sh --if-missing`, which builds the table for a database last imported before it existed and costs one query once it does. Run `backend/compute_statistics_entries.sh [database]` by hand to rebuild it outright. Until the table exists `GET /api/statistics` returns 503 saying which script to run.

Queries join `persons`, `countries` and `competitions` only where a filter or an output value reads them, and attach names after grouping rather than carrying them through it, so an unfiltered statistic aggregates rows from one table alone. Server memory is the remaining limit: the export is around 15 GB against MariaDB’s default 128 MB `innodb_buffer_pool_size`, so every statistic reads from disk. Raising the buffer pool to a few GB is the largest single improvement available and needs no change here.

## Person

The **Person** navigation tab (`/person`) takes a WCA ID and shows what one competitor’s results say about them: their personal bests with world, continental and national ranks; every competition they have results from; the competitors they have shared the most competitions with; their most visited venues and cities; every country they have competed in; and their competitions per year. Alongside those it counts competitions, countries, events, successful and attempted solves, finals medals, and records by scope.

Medals count official finals whose single was successful, so a final nobody solved is not a podium; a round won before the final is not a medal either. Records count the world, continental and national markers on both the single and the average of a result. Venue names are the labels of the links the export stores, so the same hall groups together whatever the link says. Competitions are those with results — an upcoming registration is not one. Attendance shared with another competitor counts competitions, not results.

The API exposes an authenticated `GET /api/person?wca_id=…`, which answers the whole page in one response: an unknown ID returns 404, a malformed one 400. It reads `statistics_entries` for attendance and solves, so it returns 503 naming the script to run until that table exists. The heaviest competitor in the export, with more than four hundred competitions, costs a few hundred milliseconds: every query is keyed by the competitor, and the shared-competition count reads the entry table competition-first, which its primary key orders.

## Development and validation

Install dependencies in both directories with `npm ci`. Configure `backend/.env` using `backend/.env.example`, import WCA data with `backend/update_database.sh`, and run `npm run dev` in each directory. The import combines the developer dump with the official `ranks_single` and `ranks_average` files from the results TSV export, then builds `statistics_entries`. The exports are generated independently, so their separate timestamps are stored as metadata. An existing database needs `backend/compute_statistics_entries.sh` once, which takes a few minutes.

Build both packages with `npm run build` from their respective directories. Frontend lint runs with `npm run lint`.

Run the tests from `backend/`:

```sh
npm test               # every test file; npm run test:statistics runs the statistics ones alone
# Run the MariaDB integration tests using an explicitly selected test server:
TEST_DB_SOCKET=/path/to/test-mariadb.sock npm test
```

Without `TEST_DB_SOCKET`, filter-validation and cache-behavior tests run and database integration tests are skipped; the person tests are integration tests throughout. Integration tests create a uniquely named fixture database on the supplied socket using its local root account, exercise every statistic and filter combination, check calculations and pagination, and drop only that fixture database afterward. They never load the project’s `.env` or use its production connection settings.

Every pull request, and every push to `main`, runs these same checks: the backend tests against a MariaDB installed on the runner, and the frontend lint and build. The workflow uses GitHub-hosted runners rather than the self-hosted one the deploy and import workflows use, so a test run never touches the server holding the imported export.
