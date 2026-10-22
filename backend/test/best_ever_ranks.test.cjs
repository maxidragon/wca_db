const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2");
const mysqlPromise = require("mysql2/promise");
const {
  computeBestEverRanks,
  targetDatabase,
} = require("../dist/compute_best_ever_ranks");

const socket = process.env.TEST_DB_SOCKET;
let admin, builder;
const database = `wca_best_ever_ranks_test_${process.pid}`;

test("the database named on the command line wins over DB_NAME", () => {
  const argv = ["node", "dist/compute_best_ever_ranks.js"];
  assert.equal(targetDatabase([...argv, "wca_new"], { DB_NAME: "wca" }), "wca_new");
  assert.equal(targetDatabase(argv, { DB_NAME: "wca_live" }), "wca_live");
  assert.equal(targetDatabase(argv, {}), "wca");
});

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysqlPromise.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.changeUser({ database });
  for (const sql of [
    "CREATE TABLE countries (id VARCHAR(50) PRIMARY KEY,continent_id VARCHAR(50))",
    "CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,start_date DATE)",
    "CREATE TABLE results (person_id VARCHAR(10),country_id VARCHAR(50),competition_id VARCHAR(32),event_id VARCHAR(6),best INT,average INT)",
    "INSERT INTO countries VALUES ('Poland','_Europe'),('Germany','_Europe')",
    "INSERT INTO competitions VALUES ('First2020','2020-01-04'),('Second2020','2020-06-06')",
    // Ada is first until Ben beats her at the second competition.
    `INSERT INTO results VALUES
       ('2020ADAA01','Poland','First2020','333',900,1000),
       ('2020BENB01','Germany','First2020','333',1100,1200),
       ('2020BENB01','Germany','Second2020','333',800,0)`,
    // The previous build, standing in for one computed from an older export.
    "CREATE TABLE best_ever_ranks (person_id VARCHAR(10), best_rank INT)",
    "INSERT INTO best_ever_ranks VALUES ('2019OLDO01', 1)",
  ]) {
    await admin.query(sql);
  }
  builder = mysql.createConnection({
    socketPath: socket,
    user: "root",
    database,
    dateStrings: true,
  });
});

after(async () => {
  if (!socket) return;
  builder.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

test(
  "the previous table is served until the finished one replaces it",
  { skip: !socket },
  async () => {
    // Look at what a reader sees right before the swap.
    let beforeSwap;
    const query = builder.query.bind(builder);
    builder.query = (sql, ...rest) => {
      if (typeof sql === "string" && sql.startsWith("RENAME TABLE")) {
        admin
          .query("SELECT person_id FROM best_ever_ranks")
          .then(([rows]) => {
            beforeSwap = rows.map((row) => row.person_id);
            query(sql, ...rest);
          });
        return;
      }
      return query(sql, ...rest);
    };

    await computeBestEverRanks(builder);

    assert.deepEqual(beforeSwap, ["2019OLDO01"]);
    const [rows] = await admin.query(
      `SELECT person_id, result_type, region_type, region_id, best_rank, result
       FROM best_ever_ranks
       WHERE region_type = 'world'
       ORDER BY person_id, result_type, start_date`,
    );
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        { person_id: "2020ADAA01", result_type: "average", region_type: "world", region_id: "world", best_rank: 1, result: 1000 },
        { person_id: "2020ADAA01", result_type: "single", region_type: "world", region_id: "world", best_rank: 1, result: 900 },
        { person_id: "2020BENB01", result_type: "average", region_type: "world", region_id: "world", best_rank: 2, result: 1200 },
        { person_id: "2020BENB01", result_type: "single", region_type: "world", region_id: "world", best_rank: 1, result: 800 },
      ],
    );
    const [leftovers] = await admin.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'best\\_ever\\_ranks\\_%'",
      [database],
    );
    assert.deepEqual(leftovers, []);
  },
);
