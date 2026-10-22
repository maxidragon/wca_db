import * as dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import mysql, { RowDataPacket } from "mysql2/promise";
import session from "express-session";
import { loginWithWca, ensureAuthenticated } from "./wca_oauth";
import { getChain, competitionsTogether, podiumsTogether } from "./relations";
import { getCompetitionAchievements, searchCompetitions } from "./achievements";
import { bestEverRanksReady, getBestEverRanks } from "./best_ever_ranks";
import { getPersonProfile } from "./person";
import { getNemeses, NEMESIS_REGIONS, type NemesisRegion } from "./nemeses";
import {
  getSchema,
  isQueryTimeout,
  QUERY_TIMEOUT_SECONDS,
  queryPoolConfig,
  runUserQuery,
} from "./query_tool";
import {
  createQualificationsService,
  QualificationInputError,
  qualificationIndexesReady,
  UNIQUE_LIST,
  WORLD,
} from "./qualifications";
import {
  createStatisticsService,
  StatisticsInputError,
  statisticsEntriesReady,
} from "./statistics";

const PORT = process.env.PORT || 3001;

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
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
// The Query Tool runs SQL its users write, so it gets a pool of its own that connects as a
// read-only user. Unconfigured, the tool is off: it never falls back to the pool above.
const queryPoolSettings = queryPoolConfig();
const queryPool = queryPoolSettings.ok ? mysql.createPool(queryPoolSettings.options) : null;
if (!queryPoolSettings.ok) {
  console.warn(
    `Query Tool disabled: ${queryPoolSettings.reason}. Create its user with backend/create_query_user.sh.`
  );
}
const QUERY_TOOL_UNAVAILABLE = "The Query Tool is temporarily unavailable.";

const statisticsService = createStatisticsService(pool);
const qualificationsService = createQualificationsService(pool);

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
    if (!queryPool) return res.status(503).json({ error: QUERY_TOOL_UNAVAILABLE });
    try {
      res.json(await getSchema(queryPool));
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
      `SELECT DISTINCT r1.competition_id AS id, c.name,
              DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date
       FROM results r1
       JOIN results r2 ON r1.competition_id = r2.competition_id
       JOIN competitions c ON r1.competition_id = c.id
       WHERE r1.person_id = ? AND r2.person_id = ?
       ORDER BY c.start_date DESC`,
      [wca_id1, wca_id2]
    );
    const podiums = await podiumsTogether(pool, wca_id1, wca_id2);

    const personMap: Record<string, string> = {};
    for (const p of persons as RowDataPacket[]) {
      personMap[p.wca_id] = p.name;
    }

    res.json({
      person1: { wca_id: wca_id1, name: personMap[wca_id1] },
      person2: { wca_id: wca_id2, name: personMap[wca_id2] },
      competitions,
      podiums,
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

app.get("/api/nemeses", ensureAuthenticated, async (req: Request, res: Response) => {
  const wca_id = ((req.query.wca_id as string) || "").trim().toUpperCase();
  const region = (req.query.region as string) || "world";
  const page = req.query.page === undefined ? 1 : Number(req.query.page);

  if (!wca_id) {
    return res.status(400).json({ error: "wca_id is required" });
  }
  if (!WCA_ID_RE.test(wca_id)) {
    return res.status(400).json({ error: "Invalid WCA ID format (expected e.g. 2009ZEMD01)" });
  }
  if (!NEMESIS_REGIONS.includes(region as NemesisRegion)) {
    return res.status(400).json({ error: "region must be one of world, continent, country" });
  }
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }

  try {
    const nemeses = await getNemeses(pool, wca_id, region as NemesisRegion, page);
    if (!nemeses) {
      return res.status(404).json({ error: "WCA ID not found" });
    }
    res.json(nemeses);
  } catch (err: unknown) {
    if (isQueryTimeout(err)) {
      return res.status(408).json({ error: "Nemeses took too long to compute. Please try again later." });
    }
    console.error("Nemeses query failed", err);
    res.status(500).json({ error: "Could not load the nemeses" });
  }
});

app.get("/api/competitions/search", ensureAuthenticated, async (req: Request, res: Response) => {
  const query = ((req.query.q as string) || "").trim();
  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({ error: "Search must be between 2 and 100 characters" });
  }
  try {
    const withQualifications = req.query.with_qualifications === "1";
    res.json({ competitions: await searchCompetitions(pool, query, withQualifications) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * The logged-in competitor's WCA ID. Tokens from a login carry it; older tokens only carry the
 * WCA account, which the dump's users table maps to it. Null for an account without one.
 */
async function viewerWcaId(req: Request): Promise<string | null> {
  const user = (req as any).user ?? {};
  if ("wcaId" in user) return user.wcaId || null;
  if (!user.wcaUserId) return null;
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT wca_id FROM users WHERE id = ? LIMIT 1",
    [user.wcaUserId]
  );
  return row?.wca_id || null;
}

function qualificationQuery(req: Request) {
  return {
    list: ((req.query.list as string) || UNIQUE_LIST).trim(),
    filters: {
      region: ((req.query.region as string) || WORLD).trim(),
      competed_since: ((req.query.competed_since as string) || "").trim() || null,
    },
    page: req.query.page === undefined ? 1 : Number(req.query.page),
  };
}

async function sendQualifications(res: Response, load: () => Promise<unknown | null>) {
  try {
    if (!(await qualificationIndexesReady(pool))) {
      return res.status(503).json({
        error: "Qualification indexes not yet built. Run backend/qualification_indexes.sql.",
      });
    }
    const qualifications = await load();
    if (!qualifications) {
      return res.status(404).json({ error: "Competition not found" });
    }
    res.json(qualifications);
  } catch (err: unknown) {
    if (err instanceof QualificationInputError) return res.status(400).json({ error: err.message });
    if (isQueryTimeout(err)) {
      return res.status(408).json({ error: "Qualifications took too long to compute. Please try again later." });
    }
    console.error("Qualifications query failed", err);
    res.status(500).json({ error: "Could not load the qualifications" });
  }
}

app.get("/api/qualifications", ensureAuthenticated, async (req: Request, res: Response) => {
  const competitionId = ((req.query.competition_id as string) || "").trim();
  const { list, filters, page } = qualificationQuery(req);

  if (!competitionId || competitionId.length > 32) {
    return res.status(400).json({ error: "A valid competition_id is required" });
  }
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }
  await sendQualifications(res, async () =>
    qualificationsService.get(competitionId, list, page, {
      ...filters,
      viewer: await viewerWcaId(req),
    })
  );
});

app.get("/api/qualifications/custom", ensureAuthenticated, async (req: Request, res: Response) => {
  const requirements = ((req.query.requirements as string) || "").trim();
  const deadline = ((req.query.deadline as string) || "").trim() || null;
  const { list, filters, page } = qualificationQuery(req);

  if (!requirements || requirements.length > 1000) {
    return res.status(400).json({ error: "requirements are required" });
  }
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }
  await sendQualifications(res, async () =>
    qualificationsService.getCustom(requirements, deadline, list, page, {
      ...filters,
      viewer: await viewerWcaId(req),
    })
  );
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
    if (!queryPool) return res.status(503).json({ error: QUERY_TOOL_UNAVAILABLE });

    const q = (req.body && req.body.query) as string;
    const page = parseInt(req.body.page) || 1;
    const pageSize = parseInt(req.body.pageSize) || 50;

    const userData = req.user as { wcaUserId: number; username: string };
    const requestedBy = `user ${userData.wcaUserId} (${userData.username})`;

    try {
      res.json(
        await runUserQuery(queryPool, q, page, pageSize, (sql) =>
          console.log(`Executing user-provided query: ${sql}, requested by ${requestedBy}`)
        )
      );
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
