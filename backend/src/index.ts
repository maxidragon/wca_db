import * as dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import mysql, { RowDataPacket } from "mysql2/promise";
import session from "express-session";
import { loginWithWca, ensureAuthenticated } from "./wca_oauth";
import { getChain, competitionsTogether } from "./relations";
import { getCompetitionAchievements, searchCompetitions } from "./achievements";
import { bestEverRanksReady, getBestEverRanks } from "./best_ever_ranks";
import { getPersonProfile } from "./person";
import {
  createStatisticsService,
  StatisticsInputError,
  statisticsEntriesReady,
} from "./statistics";

const PORT = process.env.PORT || 3001;

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(morgan("combined"));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: true,
  })
);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "wca",
  waitForConnections: true,
  connectionLimit: 10,
});
const statisticsService = createStatisticsService(pool);

app.get("/api/statistics/options", ensureAuthenticated, async (_req: Request, res: Response) => {
  try {
    res.json(await statisticsService.options());
  } catch {
    res.status(503).json({ error: "Statistics data is unavailable. Please try again later." });
  }
});

app.get("/api/statistics", ensureAuthenticated, async (req: Request, res: Response) => {
  if (!(await statisticsEntriesReady(pool))) {
    return res.status(503).json({
      error: "Statistics entries not yet computed. Run backend/compute_statistics_entries.sh.",
    });
  }
  try {
    res.json(await statisticsService.get(req.query));
  } catch (err: unknown) {
    if (err instanceof StatisticsInputError) return res.status(400).json({ error: err.message });
    if (isQueryTimeout(err)) return res.status(408).json({ error: "Statistics took too long to compute. Narrow the filters and try again." });
    console.error("Statistics query failed", err);
    res.status(503).json({ error: "Statistics data is unavailable. Please try again later." });
  }
});

function validateQuery(q: string): boolean {
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

// User-written SQL gets a hard execution budget enforced by the database itself: MariaDB kills
// the statement once it has run this long, which frees the pool connection instead of leaving
// a stale query behind after the HTTP request has already timed out on the client side.
const QUERY_TIMEOUT_SECONDS = Number(process.env.QUERY_TIMEOUT_SECONDS) || 60;

// MariaDB: max_statement_time exceeded. Not in mysql2's error table, so match on errno.
const ER_STATEMENT_TIMEOUT = 1969;
// Raised when the statement was cancelled some other way, e.g. KILL QUERY by an admin.
const ER_QUERY_INTERRUPTED = 1317;

function isQueryTimeout(err: any): boolean {
  return err?.errno === ER_STATEMENT_TIMEOUT || err?.errno === ER_QUERY_INTERRUPTED;
}

function queryWithTimeLimit(sql: string) {
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

app.get("/api/metadata", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT field, value FROM wca_statistics_metadata WHERE field = 'export_timestamp' LIMIT 1"
    );
    if (Array.isArray(rows) && rows.length > 0) {
      res.json({ export_timestamp: (rows[0] as any).value });
    } else {
      res.status(404).json({ error: "No export metadata found" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(
  "/api/schema",
  ensureAuthenticated,
  async (req: Request, res: Response) => {
    try {
      const [tables] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ?`,
        [process.env.DB_NAME]
      );

      const [columns] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ?`,
        [process.env.DB_NAME]
      );

      const schema: Record<
        string,
        { columns: { name: string; type: string }[] }
      > = {};

      (tables as RowDataPacket[]).forEach((t) => {
        schema[t.TABLE_NAME] = { columns: [] };
      });

      (columns as RowDataPacket[]).forEach((c) => {
        schema[c.TABLE_NAME]?.columns.push({
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE,
        });
      });

      res.json(schema);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/;

app.get("/api/relations", ensureAuthenticated, async (req: Request, res: Response) => {
  const wca_id1 = ((req.query.wca_id1 as string) || "").trim().toUpperCase();
  const wca_id2 = ((req.query.wca_id2 as string) || "").trim().toUpperCase();

  if (!wca_id1 || !wca_id2) {
    return res.status(400).json({ error: "Both wca_id1 and wca_id2 are required" });
  }
  if (!WCA_ID_RE.test(wca_id1) || !WCA_ID_RE.test(wca_id2)) {
    return res.status(400).json({ error: "Invalid WCA ID format (expected e.g. 2009ZEMD01)" });
  }

  try {
    const [[{ count }]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM linkings"
    );
    if (Number(count) === 0) {
      return res.status(503).json({
        error: "Linkings not yet computed. Please try again later.",
      });
    }
  } catch {
    return res.status(503).json({
      error: "Linkings table missing. Please try again later.",
    });
  }

  try {
    const [persons] = await pool.query<RowDataPacket[]>(
      "SELECT wca_id, name FROM persons WHERE wca_id IN (?, ?) AND sub_id = 1",
      [wca_id1, wca_id2]
    );
    if ((persons as RowDataPacket[]).length !== 2) {
      return res.status(404).json({ error: "One or both WCA IDs not found" });
    }

    const chain = await getChain(pool, wca_id1, wca_id2);

    if (chain.length === 0) {
      return res.json({ chain: [], connections: [] });
    }

    const placeholders = chain.map(() => "?").join(",");
    const [chainPersons] = await pool.query<RowDataPacket[]>(
      `SELECT wca_id, name FROM persons WHERE wca_id IN (${placeholders}) AND sub_id = 1`,
      chain
    );
    const nameMap: Record<string, string> = {};
    for (const p of chainPersons as RowDataPacket[]) {
      nameMap[p.wca_id] = p.name;
    }

    const chainData = chain.map((wca_id) => ({
      wca_id,
      name: nameMap[wca_id] || wca_id,
    }));

    const connections: { id: string; name: string }[][] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      connections.push(await competitionsTogether(pool, chain[i], chain[i + 1]));
    }

    res.json({ chain: chainData, connections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/competitions-together", ensureAuthenticated, async (req: Request, res: Response) => {
  const wca_id1 = ((req.query.wca_id1 as string) || "").trim().toUpperCase();
  const wca_id2 = ((req.query.wca_id2 as string) || "").trim().toUpperCase();

  if (!wca_id1 || !wca_id2) {
    return res.status(400).json({ error: "Both wca_id1 and wca_id2 are required" });
  }
  if (!WCA_ID_RE.test(wca_id1) || !WCA_ID_RE.test(wca_id2)) {
    return res.status(400).json({ error: "Invalid WCA ID format (expected e.g. 2009ZEMD01)" });
  }

  try {
    const [persons] = await pool.query<RowDataPacket[]>(
      "SELECT wca_id, name FROM persons WHERE wca_id IN (?, ?) AND sub_id = 1",
      [wca_id1, wca_id2]
    );
    if ((persons as RowDataPacket[]).length < 2) {
      return res.status(404).json({ error: "One or both WCA IDs not found" });
    }

    const [competitions] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT r1.competition_id AS id, c.name, c.start_date
       FROM results r1
       JOIN results r2 ON r1.competition_id = r2.competition_id
       JOIN competitions c ON r1.competition_id = c.id
       WHERE r1.person_id = ? AND r2.person_id = ?
       ORDER BY c.start_date DESC`,
      [wca_id1, wca_id2]
    );

    const personMap: Record<string, string> = {};
    for (const p of persons as RowDataPacket[]) {
      personMap[p.wca_id] = p.name;
    }

    res.json({
      person1: { wca_id: wca_id1, name: personMap[wca_id1] },
      person2: { wca_id: wca_id2, name: personMap[wca_id2] },
      competitions,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/best-ever-ranks", ensureAuthenticated, async (req: Request, res: Response) => {
  const wca_id = ((req.query.wca_id as string) || "").trim().toUpperCase();

  if (!wca_id) {
    return res.status(400).json({ error: "wca_id is required" });
  }
  if (!WCA_ID_RE.test(wca_id)) {
    return res.status(400).json({ error: "Invalid WCA ID format (expected e.g. 2009ZEMD01)" });
  }

  if (!(await bestEverRanksReady(pool))) {
    return res.status(503).json({
      error: "Best ever ranks not yet computed. Please try again later.",
    });
  }

  try {
    const ranks = await getBestEverRanks(pool, wca_id);
    if (!ranks) {
      return res.status(404).json({ error: "WCA ID not found" });
    }
    res.json(ranks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/person", ensureAuthenticated, async (req: Request, res: Response) => {
  const wca_id = ((req.query.wca_id as string) || "").trim().toUpperCase();

  if (!wca_id) {
    return res.status(400).json({ error: "wca_id is required" });
  }
  if (!WCA_ID_RE.test(wca_id)) {
    return res.status(400).json({ error: "Invalid WCA ID format (expected e.g. 2009ZEMD01)" });
  }

  if (!(await statisticsEntriesReady(pool))) {
    return res.status(503).json({
      error: "Statistics entries not yet computed. Run backend/compute_statistics_entries.sh.",
    });
  }

  try {
    const profile = await getPersonProfile(pool, wca_id);
    if (!profile) {
      return res.status(404).json({ error: "WCA ID not found" });
    }
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/competitions/search", ensureAuthenticated, async (req: Request, res: Response) => {
  const query = ((req.query.q as string) || "").trim();
  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({ error: "Search must be between 2 and 100 characters" });
  }
  try {
    res.json({ competitions: await searchCompetitions(pool, query) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/achievements", ensureAuthenticated, async (req: Request, res: Response) => {
  const competitionId = ((req.query.competition_id as string) || "").trim();
  if (!competitionId || competitionId.length > 32) {
    return res.status(400).json({ error: "A valid competition_id is required" });
  }
  try {
    const achievements = await getCompetitionAchievements(pool, competitionId);
    if (!achievements) {
      return res.status(404).json({ error: "Competition not found" });
    }
    res.json(achievements);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/wca/login", loginWithWca);
app.post(
  "/api/query",
  ensureAuthenticated,
  async (req: Request, res: Response) => {
    const q = (req.body && req.body.query) as string;
    let page = parseInt(req.body.page) || 1;
    let pageSize = parseInt(req.body.pageSize) || 50;

    if (!validateQuery(q)) {
      return res.status(400).json({
        error:
          "Only SELECT (with optional WITH) and DESC/DESCRIBE statements allowed",
      });
    }

    const userData = req.user as { wcaUserId: number; username: string };
    const requestedBy = `user ${userData.wcaUserId} (${userData.username})`;

    try {
      const baseQuery = q.trim().replace(/;$/, "");
      let rows: RowDataPacket[] = [];
      let total = 0;

      if (
        baseQuery.toUpperCase().startsWith("SELECT") ||
        baseQuery.toUpperCase().startsWith("WITH")
      ) {
        const limitMatch = baseQuery.match(/LIMIT\s+(\d+)/i);
        if (limitMatch) {
          const limitValue = parseInt(limitMatch[1], 10);
          if (limitValue > 100) {
            return res.status(400).json({ error: "LIMIT cannot exceed 100" });
          }
          console.log(
            `Executing user-provided query with LIMIT: ${baseQuery}, requested by ${requestedBy}`
          );
          const [data, fields] = await queryWithTimeLimit(baseQuery);
          if (hasDuplicateColumnNames(fields)) {
            return res.status(400).json({ error: DUPLICATE_COLUMNS_ERROR });
          }
          rows = data;
          total = rows.length;
          page = 1;
          pageSize = total;
        } else {
          const offset = (page - 1) * pageSize;
          const paginatedQuery = `${baseQuery} LIMIT ${pageSize} OFFSET ${offset}`;
          console.log(
            `Executing paginated query: ${paginatedQuery}, requested by ${requestedBy}`
          );
          // The page and its total run side by side, each under the same time limit, so a
          // slow query costs one limit rather than two. Both must finish: a query whose rows
          // are cheap but whose total cannot be counted in time is still too heavy to serve.
          const [[data, fields], [[countRow]]] = await Promise.all([
            queryWithTimeLimit(paginatedQuery),
            queryWithTimeLimit(
              `SELECT COUNT(*) as count FROM (${baseQuery}) as sub`
            ),
          ]);
          if (hasDuplicateColumnNames(fields)) {
            return res.status(400).json({ error: DUPLICATE_COLUMNS_ERROR });
          }
          rows = data;
          total = Number(countRow.count);
        }
      } else {
        const [data, fields] = await pool.query<RowDataPacket[]>(baseQuery);
        if (hasDuplicateColumnNames(fields)) {
          return res.status(400).json({ error: DUPLICATE_COLUMNS_ERROR });
        }
        rows = data;
        total = rows.length;
        page = 1;
        pageSize = total;
      }

      res.json({ rows, page, pageSize, total });
    } catch (err: any) {
      if (isQueryTimeout(err)) {
        console.log(`Query cancelled after ${QUERY_TIMEOUT_SECONDS}s, requested by ${requestedBy}`);
        return res.status(400).json({
          code: "QUERY_TIMEOUT",
          error: `Query cancelled: running it (including counting its total rows) took longer than the ${QUERY_TIMEOUT_SECONDS} second limit. Narrow it down (a WHERE clause, fewer joins, a LIMIT) and try again.`,
        });
      }
      res.status(400).json({ error: err.message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
