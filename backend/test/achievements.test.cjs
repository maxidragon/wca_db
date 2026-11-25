const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { attemptMilestonesCrossed, getCompetitionAchievements } = require("../dist/achievements");

test("crosses the fixed successful-attempt milestones", () => {
  assert.deepEqual(attemptMilestonesCrossed(990, 1010), [1000]);
  assert.deepEqual(attemptMilestonesCrossed(2100, 2137), [2137]);
  assert.deepEqual(attemptMilestonesCrossed(19990, 20000), [20000]);
});

test("counts every thousand above 20,000 as a milestone", () => {
  assert.deepEqual(attemptMilestonesCrossed(20990, 21000), [21000]);
  assert.deepEqual(attemptMilestonesCrossed(21300, 21400), [21370]);
  assert.deepEqual(attemptMilestonesCrossed(24990, 25010), [25000]);
  assert.deepEqual(attemptMilestonesCrossed(37950, 38020), [38000]);
});

test("lists every milestone passed in one competition, in order", () => {
  assert.deepEqual(attemptMilestonesCrossed(19990, 22010), [20000, 21000, 21370, 22000]);
});

test("does not count a milestone already reached before the competition", () => {
  assert.deepEqual(attemptMilestonesCrossed(21000, 21100), []);
  assert.deepEqual(attemptMilestonesCrossed(15500, 16000), []);
  assert.deepEqual(attemptMilestonesCrossed(500, 500), []);
});

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_achievements_test_${process.pid}`;
const NOW = new Date(2026, 10, 15, 12);

// 2001AAAA01 has 98 competitions with results before Posted; 2001BBBB01 has 97.
// Posted has results, Awaiting has ended without any, Upcoming has not started.
before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ socketPath: socket, user: "root", database, connectionLimit: 4 });
  const past = Array.from({ length: 98 }, (_, i) => `Past${String(i + 1).padStart(3, "0")}`);
  for (const sql of [
    `CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,name VARCHAR(50),start_date DATE,end_date DATE,
       country_id VARCHAR(50),announced_at DATETIME,cancelled_at DATETIME)`,
    "CREATE TABLE persons (wca_id VARCHAR(10),sub_id INT,name VARCHAR(80))",
    "CREATE TABLE users (id INT PRIMARY KEY,wca_id VARCHAR(10))",
    `CREATE TABLE registrations (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),user_id INT,
       competing_status VARCHAR(190),is_competing TINYINT(1),deleted_at DATETIME)`,
    "CREATE TABLE registration_competition_events (registration_id INT,competition_event_id INT)",
    "CREATE TABLE rounds (competition_event_id INT,number INT,format_id VARCHAR(1))",
    "CREATE TABLE formats (id VARCHAR(1),expected_solve_count INT)",
    "CREATE TABLE results (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),person_id VARCHAR(10))",
    "CREATE TABLE result_attempts (result_id INT,value INT)",
    "CREATE TABLE competition_delegates (competition_id VARCHAR(32),delegate_id INT)",
    "INSERT INTO persons VALUES ('2001AAAA01',1,'Alpha Tester'),('2001BBBB01',1,'Beta Tester')",
    "INSERT INTO users VALUES (1,'2001AAAA01'),(2,'2001BBBB01')",
    `INSERT INTO competitions VALUES
       ${past.map((id, i) => `('${id}','${id}','2020-01-01' + INTERVAL ${i} DAY,'2020-01-01' + INTERVAL ${i} DAY,'Poland','2019-01-01',NULL)`).join(",")},
       ('Posted','Posted','2026-10-01','2026-10-02','Poland','2026-01-01',NULL),
       ('Awaiting','Awaiting','2026-11-07','2026-11-08','Poland','2026-01-01',NULL),
       ('Upcoming','Upcoming','2026-12-05','2026-12-06','Poland','2026-01-01',NULL)`,
    `INSERT INTO results (competition_id,person_id) VALUES
       ${past.map((id) => `('${id}','2001AAAA01')`).join(",")},
       ${past.slice(1).map((id) => `('${id}','2001BBBB01')`).join(",")},
       ('Posted','2001AAAA01'),('Posted','2001BBBB01')`,
    `INSERT INTO registrations (competition_id,user_id,competing_status,is_competing,deleted_at) VALUES
       ('Awaiting',1,'accepted',1,NULL),('Awaiting',2,'accepted',1,NULL),('Upcoming',2,'accepted',1,NULL)`,
  ]) {
    await pool.query(sql);
  }
});

after(async () => {
  if (!socket) return;
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin?.end();
});

const milestones = (result) =>
  result.competition_milestones.map((m) => [m.wca_id, m.milestone]);

test("a finished competition with results uses them", { skip: !socket }, async () => {
  const result = await getCompetitionAchievements(pool, "Posted", NOW);
  assert.equal(result.projected, false);
  assert.equal(result.roster_size, 2);
  assert.deepEqual(milestones(result), []);
});

test("a finished competition without results is projected from registrations", { skip: !socket }, async () => {
  const result = await getCompetitionAchievements(pool, "Awaiting", NOW);
  assert.equal(result.projected, true);
  assert.equal(result.accepted_registrations, 2);
  assert.deepEqual(milestones(result), [["2001AAAA01", 100]]);
});

test("a competition awaiting results counts towards later ones", { skip: !socket }, async () => {
  const result = await getCompetitionAchievements(pool, "Upcoming", NOW);
  assert.equal(result.projected, true);
  assert.deepEqual(milestones(result), [["2001BBBB01", 100]]);
});
