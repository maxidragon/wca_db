import * as dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import mysql, { RowDataPacket } from "mysql2/promise";
import session from "express-session";
import { loginWithWca, ensureAuthenticated } from "./wca_oauth";

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

let pool: mysql.Pool;

async function initDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "wca",
    waitForConnections: true,
    connectionLimit: 10,
  });
}
initDb();

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

    try {
      let baseQuery = q.trim().replace(/;$/, "");
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
          const userData = req.user as { wcaUserId: number; username: string };
          console.log(
            `Executing user-provided query with LIMIT: ${baseQuery}, requested by user ${userData.wcaUserId} (${userData.username})`
          );
          const [data, fields] = await pool.query<RowDataPacket[]>(baseQuery);
          rows = data;
          if (fields) {
            const fieldNames = fields.map((f) => f.name);
            const uniqueFieldNames = new Set(fieldNames);
            if (uniqueFieldNames.size !== fieldNames.length) {
              return res.status(400).json({
                error:
                  "Query cannot have two identical column names. Please use AS to alias them.",
              });
            }
          }

          total = rows.length;
          page = 1;
          pageSize = total;
        } else {
          const offset = (page - 1) * pageSize;
          const paginatedQuery = `${baseQuery} LIMIT ${pageSize} OFFSET ${offset}`;
          const userData = req.user as { wcaUserId: number; username: string };
          console.log(
            `Executing paginated query: ${paginatedQuery}, requested by user ${userData.wcaUserId} (${userData.username})`
          );
          const [data, fields] = await pool.query<RowDataPacket[]>(
            paginatedQuery
          );
          rows = data;
          if (fields) {
            const fieldNames = fields.map((f) => f.name);
            const uniqueFieldNames = new Set(fieldNames);
            if (uniqueFieldNames.size !== fieldNames.length) {
              return res.status(400).json({
                error:
                  "Query cannot have two identical column names. Please use AS to alias them.",
              });
            }
          }

          const [[countRow]] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) as count FROM (${baseQuery}) as sub`
          );
          total = Number(countRow.count);
        }
      } else {
        const [data, fields] = await pool.query<RowDataPacket[]>(baseQuery);
        rows = data;
        if (fields) {
          const fieldNames = fields.map((f) => f.name);
          const uniqueFieldNames = new Set(fieldNames);
          if (uniqueFieldNames.size !== fieldNames.length) {
            return res.status(400).json({
              error:
                "Query cannot have two identical column names. Please use AS to alias them.",
            });
          }
        }
        total = rows.length;
        page = 1;
        pageSize = total;
      }

      res.json({ rows, page, pageSize, total });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
