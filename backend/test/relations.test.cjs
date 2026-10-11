const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { podiumsTogether } = require("../dist/relations");

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_relations_test_${process.pid}`;

const ANNA = "2020ANNA01";
const BART = "2020BART01";

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ socketPath: socket, user: "root", database, connectionLimit: 4 });
  for (const sql of [
    "CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,name VARCHAR(50),start_date DATE)",
    "CREATE TABLE events (id VARCHAR(6) PRIMARY KEY,name VARCHAR(54),`rank` INT)",
    "CREATE TABLE results (competition_id VARCHAR(32),event_id VARCHAR(6),round_type_id CHAR(1),pos INT,best INT,person_id VARCHAR(10))",
    "INSERT INTO events VALUES ('333','3x3x3 Cube',10),('222','2x2x2 Cube',20)",
    `INSERT INTO competitions VALUES
       ('Early2021','Early 2021','2021-03-01'),
       ('Late2022','Late 2022','2022-09-01')`,
    `INSERT INTO results VALUES
       -- Both on the 3x3 and 2x2 final podiums.
       ('Late2022','333','f',1,900,'${ANNA}'),('Late2022','333','f',3,1100,'${BART}'),
       ('Late2022','222','c',2,300,'${ANNA}'),('Late2022','222','c',2,300,'${BART}'),
       -- Both in the top three of a first round only.
       ('Early2021','333','1',1,950,'${ANNA}'),('Early2021','333','1',2,990,'${BART}'),
       -- A 3x3 final where Bart is fourth.
       ('Early2021','333','f',1,940,'${ANNA}'),('Early2021','333','f',4,1200,'${BART}'),
       -- A 2x2 final where Bart's third place has no successful result.
       ('Early2021','222','f',1,280,'${ANNA}'),('Early2021','222','f',3,-1,'${BART}')`,
  ]) {
    await pool.query(sql);
  }
});

after(async () => {
  if (!socket) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

test(
  "only successful final-round podiums both competitors share are counted",
  { skip: !socket },
  async () => {
    const podiums = await podiumsTogether(pool, ANNA, BART);
    assert.deepEqual(
      podiums.map(({ competition_id, event_id, event_name, pos1, pos2 }) => ({
        competition_id,
        event_id,
        event_name,
        pos1,
        pos2,
      })),
      [
        { competition_id: "Late2022", event_id: "333", event_name: "3x3x3 Cube", pos1: 1, pos2: 3 },
        { competition_id: "Late2022", event_id: "222", event_name: "2x2x2 Cube", pos1: 2, pos2: 2 },
      ],
    );
  },
);

test("positions follow the order the competitors are given in", { skip: !socket }, async () => {
  const podiums = await podiumsTogether(pool, BART, ANNA);
  assert.deepEqual(
    podiums.map(({ pos1, pos2 }) => [pos1, pos2]),
    [[3, 1], [2, 2]],
  );
});
