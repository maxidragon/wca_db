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

  if (!["SELECT", "DESC", "DESCRIBE"].includes(firstWord)) return false;

  return true;
}

app.post("/auth/wca/login", loginWithWca);

app.post(
  "/api/query",
  ensureAuthenticated,
  async (req: Request, res: Response) => {
    const q = (req.body && req.body.query) as string;
    const page = parseInt(req.body.page) || 1;
    const pageSize = parseInt(req.body.pageSize) || 50;

    if (!validateQuery(q)) {
      return res
        .status(400)
        .json({ error: "Only SELECT and DESC/DESCRIBE statements allowed" });
    }

    try {
      let paginatedQuery = q.trim().replace(/;$/, "");
      let rows: RowDataPacket[] = [];
      let total = 0;

      if (paginatedQuery.toUpperCase().startsWith("SELECT")) {
        const offset = (page - 1) * pageSize;
        paginatedQuery = `${paginatedQuery} LIMIT ${pageSize} OFFSET ${offset}`;
        console.log(`Executing paginated query: ${paginatedQuery}, requested by user ${req.user}`);
        const [data] = await pool.query<RowDataPacket[]>(paginatedQuery);
        rows = data;

        const [[countRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) as count FROM (${q.trim().replace(/;$/, "")}) as sub`
        );
        total = Number(countRow.count);
      } else {
        const [data] = await pool.query<RowDataPacket[]>(paginatedQuery);
        rows = data;
        total = rows.length;
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
