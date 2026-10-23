# WCA DB

Tools for querying and exploring the WCA developer database export: a SQL console, statistics, and pages about competitors and competitions. Every tool requires logging in with a WCA account. The database is reimported every night, so results follow the latest export.

## Features

**Query Tool** (`/`): run read-only SQL against the whole export. `SELECT`, `WITH` and `DESCRIBE` are allowed. Table and column names are autocompleted from the schema. Results are paginated, an explicit `LIMIT` can be at most 100, and a query that runs longer than the time limit is cancelled. Queries can use `:parameters`, be saved in the browser, and be shared as a link. [Details](docs/query-tool.md)

**Statistics** (`/statistics`): 19 rankings across the whole export, including sum of ranks, medal collections, top 100 results, best podiums, records, oldest standing records, most competitions, personal solves, uncrowned kings, record missers and all-events achievers. Each can be filtered by region, gender, year and events. Filters are stored in the URL, so a view can be shared. [Details](docs/statistics.md)

### Competitors

**Person** (`/person`): one competitor at a glance. It shows personal bests with world, continental and national ranks, every competition they have results from, who they compete with most, where they compete, and counts of competitions, solves, medals, records and their longest PR streak. [Details](docs/person.md)

**Nemeses** (`/nemeses`): everyone who ranks better than a competitor in every event they hold a rank in. This is the definition [Nemesizer](https://www.nemesizer.com/) uses. The list can be narrowed to the competitor's continent or country. [Details](docs/nemeses.md)

**Relations** (`/relations`): the shortest chain of competitors linking two people, where each step is two people who competed at the same competition. Each link lists the competitions the pair shared. Competitions held across several locations at once do not link people, because their competitors never met. This covers multi-location Fewest Moves competitions and those under a multi-country region. [Details](docs/relations.md)

**Competitions Together** (`/competitions-together`): every competition two competitors both have results from, and every final podium they stood on together. [Details](docs/competitions-together.md)

**Best Ever Ranks** (`/best-ever-ranks`): the best world, continental and national rank a competitor ever held in each event, single and average, with the result and the competition that set it. These are not their current ranks: a rank held years ago and since lost still counts. The table is computed after each import. [Details](docs/best-ever-ranks.md)

### Competitions

**Achievements** (`/achievements`): milestones reached at a competition. These are competitors reaching their 100th, 150th, … competition, Delegates reaching their 100th, … delegated competition, competitors crossing successful-attempt milestones, and pairs reaching 100, 150 or 200 competitions together. For a competition that has not finished yet, it uses accepted registrations to show who is likely to reach a milestone. [Details](docs/achievements.md)

**Qualifications** (`/qualifications`): for a competition with qualification requirements, everyone who meets them, checked the way the WCA checks them at registration. There is one list per event and one list of unique competitors. Custom mode takes requirements you set yourself. Lists can be filtered by region and by who has competed recently, and saved as views. [Details](docs/qualifications.md)

## Getting started

The frontend (`frontend/`) is React with Vite; the backend (`backend/`) is Express on MariaDB.

```sh
cd backend
npm ci
cp .env.example .env        # database credentials and a WCA OAuth application
./update_database.sh        # downloads and imports the WCA exports; takes a while
./create_query_user.sh      # the read-only user the Query Tool runs SQL as
npm run dev

cd ../frontend
npm ci
npm run dev
```

## Tests

```sh
cd backend
npm test                                          # unit tests; integration tests are skipped
TEST_DB_SOCKET=/path/to/test-mariadb.sock npm test  # also runs the MariaDB integration tests
```

The integration tests create and drop their own fixture database on the server you name, and never read `.env`. Lint and build the frontend with `npm run lint` and `npm run build`. CI runs all of these on every pull request.

Notes for contributors, human or agent, are in [AGENTS.md](AGENTS.md).
