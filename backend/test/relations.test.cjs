const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { podiumsTogether, staffedTogether } = require("../dist/relations");

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_relations_test_${process.pid}`;

const ANNA = "2020ANNA01";
const BART = "2020BART01";
const CARA = "2020CARA01";

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ socketPath: socket, user: "root", database, connectionLimit: 4 });
  for (const sql of [
    "CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,name VARCHAR(50),start_date DATE,cancelled_at DATETIME)",
    "CREATE TABLE events (id VARCHAR(6) PRIMARY KEY,name VARCHAR(54),`rank` INT)",
    "CREATE TABLE results (competition_id VARCHAR(32),event_id VARCHAR(6),round_type_id CHAR(1),pos INT,best INT,person_id VARCHAR(10))",
    "CREATE TABLE users (id INT PRIMARY KEY,wca_id VARCHAR(10))",
    "CREATE TABLE competition_delegates (competition_id VARCHAR(32),delegate_id INT)",
    "CREATE TABLE competition_organizers (competition_id VARCHAR(32),organizer_id INT)",
    "INSERT INTO events VALUES ('333','3x3x3 Cube',10),('222','2x2x2 Cube',20)",
    `INSERT INTO competitions VALUES
       ('Early2021','Early 2021','2021-03-01',NULL),
       ('Late2022','Late 2022','2022-09-01',NULL),
       ('SameDayA','Same Day A','2022-09-01',NULL),
       ('Cancelled2022','Cancelled 2022','2022-05-01','2022-04-01 12:00:00'),
       ('Upcoming2999','Upcoming 2999','2999-01-01',NULL)`,
    `INSERT INTO users VALUES (1,'${ANNA}'),(2,'${BART}'),(3,'${CARA}'),(4,NULL)`,
    `INSERT INTO competition_delegates VALUES
       ('Early2021',1),('Early2021',2),
       ('Late2022',1),('Late2022',2),
       ('SameDayA',1),('SameDayA',2),
       ('Cancelled2022',1),('Cancelled2022',2),
       ('Upcoming2999',1),('Upcoming2999',2)`,
    // Anna organized Late2022 and Bart delegated it: different roles are not "together".
    `INSERT INTO competition_organizers VALUES
       ('Early2021',1),('Early2021',3),('Early2021',4),
       ('Late2022',1),('Late2022',3)`,
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

test("the start date is the calendar day the competition names", { skip: !socket }, async () => {
  const [podium] = await podiumsTogether(pool, ANNA, BART);
  assert.equal(podium.start_date, "2022-09-01");
});

test("positions follow the order the competitors are given in", { skip: !socket }, async () => {
  const podiums = await podiumsTogether(pool, BART, ANNA);
  assert.deepEqual(
    podiums.map(({ pos1, pos2 }) => [pos1, pos2]),
    [[3, 1], [2, 2]],
  );
});

test(
  "delegated together lists shared competitions newest first, without cancelled or upcoming ones",
  { skip: !socket },
  async () => {
    assert.deepEqual(await staffedTogether(pool, "delegated", ANNA, BART), [
      { id: "Late2022", name: "Late 2022", start_date: "2022-09-01" },
      { id: "SameDayA", name: "Same Day A", start_date: "2022-09-01" },
      { id: "Early2021", name: "Early 2021", start_date: "2021-03-01" },
    ]);
  },
);

test("organized together lists competitions both organized", { skip: !socket }, async () => {
  const competitions = await staffedTogether(pool, "organized", ANNA, CARA);
  assert.deepEqual(competitions.map(({ id }) => id), ["Late2022", "Early2021"]);
});

test("different roles at one competition are not together", { skip: !socket }, async () => {
  assert.deepEqual(await staffedTogether(pool, "organized", ANNA, BART), []);
  assert.deepEqual(await staffedTogether(pool, "delegated", ANNA, CARA), []);
});
