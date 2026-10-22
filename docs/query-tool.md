# Query Tool

The **Query Tool** (`/`, the home page) runs your own SQL against the imported WCA database. Every table of the export and of this project's derived tables can be read.

## Using the page

Write a query in the editor and click **Execute**. The editor completes table names, and column names once a table is named in the query or written as `table.`; the **Autocomplete** switch replaces the editor with a plain text box and is remembered in the browser. Results show 20 rows a page with **Previous** and **Next**, and the page counts the query's total rows. **Clear** empties the editor and the results.

A word starting with a colon, such as `:wca_id`, is a parameter: the page shows an input for each one and replaces every occurrence with its value, as typed, before sending the query. The value is pasted in unquoted, so a string needs its quotes in the query (`WHERE wca_id = ':wca_id'`).

The **Sandbox** tab is a scratch query. **+** adds a saved query, kept in the browser's local storage, which saves every edit as you type; saved queries can be renamed and removed. **Share** copies a link with the query in its `query` parameter. Opening the link puts that SQL in the Sandbox without running it and leaves saved queries alone. Parameter values are left out of the link on purpose, since they can be personal; when a query has parameters, the Share message says so. A logged-out visitor keeps the link through the WCA login: the page they started from is kept in `sessionStorage` and restored once the login completes, which also holds for links to the other pages.

## What a query may do

A query must start with `SELECT`, `WITH` (followed somewhere by `SELECT`), `DESC` or `DESCRIBE`. Checking the first word is a convenience, not the security boundary; the database is.

`POST /api/query` and `GET /api/schema` use a pool of their own that connects as a dedicated read-only user, `QUERY_DB_USER` / `QUERY_DB_PASS`, which holds `SELECT` on `DB_NAME` and nothing else: no `FILE`, so a query can neither read nor write files on the database host, no write or schema rights, and no other database. `SELECT` alone covers `DESC` on tables and views and their `INFORMATION_SCHEMA` rows, so the user needs no `SHOW VIEW`.

- A query without a `LIMIT` is paginated by the server, which appends `LIMIT … OFFSET …` and counts the total by wrapping the query in `SELECT COUNT(*)`.
- A query with its own `LIMIT` is run as written and returned as one page. The limit may be at most 100.
- Two result columns with the same name are rejected, because the rows are returned as objects keyed by column name; alias one of them with `AS`.

## The read-only user

Create the user once per server with `backend/create_query_user.sh`, which reads `.env`, connects as `DB_USER` (or `ADMIN_DB_USER` / `ADMIN_DB_PASS`), and runs `backend/query_user.sql`. Re-running it updates the password and strips any privilege granted to the user by hand. `QUERY_DB_USER_HOST` sets the host part of the account when the database server does not see the backend as `localhost`. Deploys do not run it, because creating users takes an account that can grant.

The tool fails closed: until `QUERY_DB_USER` is set, or if it names `DB_USER` or `root`, both endpoints return 503 and the backend logs why at startup. It never falls back to the app's own connection.

## API

`POST /api/query` (authenticated) takes a JSON body `{ "query": "…", "page": 1, "pageSize": 50 }` and returns `{ rows, page, pageSize, total }`. Without a configured read-only user both endpoints return 503. A query that fails the first-word check, has a `LIMIT` above 100, has duplicate column names or fails in the database returns 400 with the database's error message. A query cancelled for running too long returns 400 with `code: "QUERY_TIMEOUT"`. Every query is logged with the WCA user who ran it.

`GET /api/schema` (authenticated) returns every table of the database with its columns and their types, for autocompletion.

`GET /api/metadata` (not authenticated) returns the developer export's `export_timestamp`, or 404 before the first import.

## Performance

Every statement, `DESC` included, runs under `SET STATEMENT max_statement_time=…`, so MariaDB itself kills it after `QUERY_TIMEOUT_SECONDS` (default 60) and the pool connection is freed, rather than leaving the query running after the browser gave up. The user also carries a 60 second `MAX_STATEMENT_TIME` of its own as a backstop; the per-statement limit wins, so `QUERY_TIMEOUT_SECONDS` still applies. A paginated query runs its page and its count side by side, each under the same limit: a slow query costs one limit rather than two, but both must finish, so a query whose total cannot be counted in time is cancelled even if its first page was cheap.
