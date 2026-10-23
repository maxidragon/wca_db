# AGENTS.md

Notes for working on this repository. The user-facing overview is in [README.md](README.md); each page has its rules, API and performance notes in `docs/`:

- [docs/query-tool.md](docs/query-tool.md)
- [docs/statistics.md](docs/statistics.md)
- [docs/person.md](docs/person.md)
- [docs/nemeses.md](docs/nemeses.md)
- [docs/relations.md](docs/relations.md)
- [docs/competitions-together.md](docs/competitions-together.md)
- [docs/best-ever-ranks.md](docs/best-ever-ranks.md)
- [docs/achievements.md](docs/achievements.md)
- [docs/qualifications.md](docs/qualifications.md)

Read the relevant doc before changing a feature, and update it in the same change when behaviour, an endpoint or a performance trade-off changes. A new page gets its own doc and a short paragraph in the README; the README stays an overview.

## Layout

- `backend/`: Express + TypeScript on MariaDB. `src/index.ts` holds the routes; each feature has its own module (`query_tool.ts`, `statistics.ts`, `person.ts`, `nemeses.ts`, `qualifications.ts`, `relations.ts`, `achievements.ts`, `best_ever_ranks.ts`). Tests are in `backend/test/*.test.cjs` and run against the compiled `dist/`.
- `frontend/`: React + Vite + Tailwind, with one directory per page in `src/pages/`. `frontend/README.md` is the unmodified Vite template.
- `backend/*.sh` and `backend/*.sql`: import and derived-table scripts, and `create_query_user.sh` / `query_user.sql` for the Query Tool's user. See below.

## Commands

| What | Where | Command |
| --- | --- | --- |
| Install | `backend/`, `frontend/` | `npm ci` |
| Dev server | `backend/`, `frontend/` | `npm run dev` |
| Build | `backend/`, `frontend/` | `npm run build` |
| Lint | `frontend/` | `npm run lint` (the backend has no linter) |
| Tests | `backend/` | `npm test`, or `npm run test:statistics` for the statistics tests alone |
| Integration tests | `backend/` | `TEST_DB_SOCKET=/path/to/test-mariadb.sock npm test` |

`npm test` builds first. Without `TEST_DB_SOCKET`, only the filter-validation and cache-behaviour tests run; the database integration tests are skipped, and the person tests are integration tests throughout. With it, each test file creates a uniquely named fixture database on that socket as the local root user and drops only that database afterwards. The statistics tests exercise every statistic and filter combination, and check calculations and pagination. The tests never load `.env` or use its connection settings. Keep it that way: never point them at a server holding real data.

CI (`.github/workflows/ci.yml`) runs the backend tests against a MariaDB installed on a GitHub-hosted runner, plus the frontend lint and build, on every pull request and every push to `main`. The deploy and nightly import workflows run on a self-hosted runner, the one that holds the imported export. CI deliberately does not use that runner.

## Data and derived tables

`backend/update_database.sh` downloads the developer dump and the results TSV export (for the official `ranks_single` and `ranks_average`), imports them into a staging database, builds the derived tables and indexes, and swaps it in. The two exports are generated independently, so each timestamp is stored as metadata. The ranks export can be newer than the dump.

Derived data the features depend on:

| Data | Built by | Used by | Missing → |
| --- | --- | --- | --- |
| `statistics_entries` | the import, or `compute_statistics_entries.sh [--if-missing] [database]` | Statistics, Person | 503 naming the script |
| `rank_indexes.sql` | the import; deploy reruns it (idempotent) | Nemeses | slow queries |
| `qualification_indexes.sql` | the import; deploy reruns it | Qualifications | 503 naming the file |
| `linkings` | the import, or `compute_linkings.sh [--if-missing] [database]`; deploy runs `--if-missing` | Relations | 503 |
| `best_ever_ranks` | the import (needs `npm run build` first), or `compute_best_ever_ranks.sh [--if-missing] [database]`; deploy runs `--if-missing` | Best Ever Ranks | 503 |

Every derived table is built in the staging database before the swap, so it matches the export it was computed from and is never missing from the live database. The swap is a single `RENAME` of every table, and the rebuild scripts build a `_new` table and rename it into place, so a manual rerun never empties a live table either. Keep new derived tables to the same pattern. Deploys do not import. A new derived table or index therefore needs an idempotent step in `.github/workflows/deploy.yml`, so a database imported before it existed still works. Follow the existing `--if-missing` pattern.

## Query Tool security

User-written SQL runs only as the read-only `QUERY_DB_USER` (SELECT on the app database, no FILE), on its own pool, and the endpoints fail closed with 503 without it. Never route user SQL through the main pool, never fall back to it, and never treat `validateQuery()` as a security check. `backend/test/query_tool.test.cjs` proves the user cannot write, read files or reach other databases; keep it passing. See [docs/query-tool.md](docs/query-tool.md).

## Performance constraints

The export is around 15 GB against MariaDB's default 128 MB buffer pool, so most queries read from disk. Before "simplifying" a query or a setting, read the Performance section of the feature's doc. Settings that look arbitrary are measured:

- `QUERY_TIMEOUT_SECONDS` is enforced by the database per statement, not by Node. Statistics cap it at 300.
- `STATISTICS_MEMORY_MB` raises only the temporary-table ceiling, per statement, against a pool of ten connections. Sort and join buffers are fixed at 2 MB and 4 MB on purpose: larger ones measured slower.
- Caches are keyed on the export timestamp, so a new import invalidates them. Keep new caches keyed the same way and bounded.
- Join `persons`, `countries` and `competitions` only where a filter or an output reads them, and attach names after grouping.

## Conventions

- Commits follow Conventional Commits: `type(scope): description`, with an optional scope such as `person` or `statistics`.
- Branches are named `type/short-description`, e.g. `feat/person-page` or `fix/statistics-memory-budget`.
- Endpoints are authenticated (`ensureAuthenticated`), validate their input, and answer 400 for malformed input, 404 for an unknown ID and 503 when a derived table is missing. Validation happens before any query runs.
- Use invented WCA IDs and values in tests and fixtures, never rows copied from the real export.
