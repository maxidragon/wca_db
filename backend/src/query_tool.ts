import mysql, { RowDataPacket } from "mysql2/promise";

// User-written SQL gets a hard execution budget enforced by the database itself: MariaDB kills
// the statement once it has run this long, which frees the pool connection instead of leaving
// a stale query behind after the HTTP request has already timed out on the client side.
export const QUERY_TIMEOUT_SECONDS = Number(process.env.QUERY_TIMEOUT_SECONDS) || 60;

// MariaDB: max_statement_time exceeded. Not in mysql2's error table, so match on errno.
const ER_STATEMENT_TIMEOUT = 1969;
// Raised when the statement was cancelled some other way, e.g. KILL QUERY by an admin.
const ER_QUERY_INTERRUPTED = 1317;

export function isQueryTimeout(err: any): boolean {
  return err?.errno === ER_STATEMENT_TIMEOUT || err?.errno === ER_QUERY_INTERRUPTED;
}

/** A query the Query Tool refuses to run, with a message meant for its author. */
export class QueryInputError extends Error {}

export type QueryPoolConfig =
  | { ok: true; options: mysql.PoolOptions }
  | { ok: false; reason: string };

/**
 * Connection settings for the pool user-written SQL runs on. The first word of a query is no
 * security boundary, so that pool connects as its own user, which create_query_user.sh grants
 * SELECT on the app database and nothing else. Without that user the Query Tool stays off
 * rather than falling back to the app's own account, which may hold FILE or write rights.
 */
export function queryPoolConfig(env: NodeJS.ProcessEnv = process.env): QueryPoolConfig {
  const user = (env.QUERY_DB_USER || "").trim();
  const appUser = env.DB_USER || "root";
  if (!user) return { ok: false, reason: "QUERY_DB_USER is not set" };
  if (user === appUser || user === "root") {
    return {
      ok: false,
      reason: `QUERY_DB_USER must be a read-only user of its own, not ${user}`,
    };
  }
  return {
    ok: true,
    options: {
      host: env.DB_HOST || "localhost",
      user,
      password: env.QUERY_DB_PASS || "",
      database: env.DB_NAME || "wca",
      waitForConnections: true,
      connectionLimit: 10,
    },
  };
}

export function validateQuery(q: string): boolean {
  if (!q || typeof q !== "string") return false;
  const cleaned = q.trim().toUpperCase();

  const firstWord = cleaned.split(/\s+/)[0];
  if (["DESC", "DESCRIBE"].includes(firstWord)) return true;
  if (firstWord === "SELECT") return true;

  if (firstWord === "WITH") {
    return /^\s*WITH[\s\S]+SELECT/i.test(cleaned);
  }

  return false;
}

function queryWithTimeLimit(pool: mysql.Pool, sql: string) {
  return pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=${QUERY_TIMEOUT_SECONDS} FOR ${sql}`
  );
}

function hasDuplicateColumnNames(fields: mysql.FieldPacket[] | undefined): boolean {
  if (!fields) return false;
  const names = fields.map((f) => f.name);
  return new Set(names).size !== names.length;
}

const DUPLICATE_COLUMNS_ERROR =
  "Query cannot have two identical column names. Please use AS to alias them.";

export interface UserQueryResult {
  rows: RowDataPacket[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Runs one Query Tool query on `pool`, which must be the read-only query pool. A query without
 * its own LIMIT is paginated; every statement it sends runs under the same time limit.
 */
export async function runUserQuery(
  pool: mysql.Pool,
  q: string,
  page: number,
  pageSize: number,
  log: (sql: string) => void = () => {}
): Promise<UserQueryResult> {
  if (!validateQuery(q)) {
    throw new QueryInputError(
      "Only SELECT (with optional WITH) and DESC/DESCRIBE statements allowed"
    );
  }

  const baseQuery = q.trim().replace(/;$/, "");
  const upper = baseQuery.toUpperCase();

  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    log(baseQuery);
    const [rows, fields] = await queryWithTimeLimit(pool, baseQuery);
    if (hasDuplicateColumnNames(fields)) throw new QueryInputError(DUPLICATE_COLUMNS_ERROR);
    return { rows, page: 1, pageSize: rows.length, total: rows.length };
  }

  const limitMatch = baseQuery.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    if (parseInt(limitMatch[1], 10) > 100) {
      throw new QueryInputError("LIMIT cannot exceed 100");
    }
    log(baseQuery);
    const [rows, fields] = await queryWithTimeLimit(pool, baseQuery);
    if (hasDuplicateColumnNames(fields)) throw new QueryInputError(DUPLICATE_COLUMNS_ERROR);
    return { rows, page: 1, pageSize: rows.length, total: rows.length };
  }

  const offset = (page - 1) * pageSize;
  const paginatedQuery = `${baseQuery} LIMIT ${pageSize} OFFSET ${offset}`;
  log(paginatedQuery);
  // The page and its total run side by side, each under the same time limit, so a slow query
  // costs one limit rather than two. Both must finish: a query whose rows are cheap but whose
  // total cannot be counted in time is still too heavy to serve.
  const [[rows, fields], [[countRow]]] = await Promise.all([
    queryWithTimeLimit(pool, paginatedQuery),
    queryWithTimeLimit(pool, `SELECT COUNT(*) as count FROM (${baseQuery}) as sub`),
  ]);
  if (hasDuplicateColumnNames(fields)) throw new QueryInputError(DUPLICATE_COLUMNS_ERROR);
  return { rows, page, pageSize, total: Number(countRow.count) };
}

/** Tables and columns of the database `pool` connects to, as far as its user can see them. */
export async function getSchema(
  pool: mysql.Pool
): Promise<Record<string, { columns: { name: string; type: string }[] }>> {
  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  );
  const [columns] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );

  const schema: Record<string, { columns: { name: string; type: string }[] }> = {};
  for (const t of tables) schema[t.TABLE_NAME] = { columns: [] };
  for (const c of columns) {
    schema[c.TABLE_NAME]?.columns.push({ name: c.COLUMN_NAME, type: c.DATA_TYPE });
  }
  return schema;
}
