const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const socket = process.env.TEST_DB_SOCKET;
let admin, builder, reader;
const database = `wca_linkings_test_${process.pid}`;

// The fixture runs the file the import and compute_linkings.sh run, one statement at a time,
// on one connection so the session's GROUP_CONCAT limit applies to the build.
const STATEMENTS = readFileSync(path.join(__dirname, "..", "linkings.sql"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((part) => part.trim())
  .filter(Boolean);

const EXPECTED = {
  "2020AAAA01": ["2020BBBB01", "2020CCCC01"],
  "2020BBBB01": ["2020AAAA01", "2020CCCC01"],
  "2020CCCC01": ["2020AAAA01", "2020BBBB01", "2020DDDD01"],
  "2020DDDD01": ["2020CCCC01"],
  "2020EEEE01": ["2020FFFF01"],
  "2020FFFF01": ["2020EEEE01"],
};

const readLinkings = async () => {
  const [rows] = await reader.query("SELECT wca_id, wca_ids FROM linkings ORDER BY wca_id");
  return Object.fromEntries(rows.map((row) => [row.wca_id, row.wca_ids.split(",").sort()]));
};

const tables = async () => {
  const [rows] = await reader.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?",
    [database],
  );
  return rows.map((row) => row.name).sort();
};

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  builder = await mysql.createConnection({ socketPath: socket, user: "root", database });
  reader = await mysql.createConnection({ socketPath: socket, user: "root", database });
  for (const sql of [
    "CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,country_id VARCHAR(50))",
    "CREATE TABLE competition_venues (competition_id VARCHAR(32),name VARCHAR(50))",
    "CREATE TABLE competition_events (competition_id VARCHAR(32),event_id VARCHAR(6))",
    "CREATE TABLE results (competition_id VARCHAR(32),event_id VARCHAR(6),round_type_id CHAR(1),person_id VARCHAR(10))",
    `INSERT INTO competitions VALUES
       ('Local2020','Poland'),('Other2021','Germany'),
       ('FmcMulti2021','Poland'),('FmcSingle2021','Poland'),('Euro2022','XE')`,
    `INSERT INTO competition_events VALUES
       ('Local2020','333'),('Local2020','222'),('Other2021','333'),
       ('FmcMulti2021','333fm'),('FmcSingle2021','333fm'),('Euro2022','333')`,
    `INSERT INTO competition_venues VALUES
       ('Local2020','Hall'),('Other2021','Hall'),
       ('FmcMulti2021','North'),('FmcMulti2021','South'),
       ('FmcSingle2021','Hall'),('Euro2022','Hall')`,
    `INSERT INTO results VALUES
       -- Several rounds and events of one competition link the competitors once.
       ('Local2020','333','1','2020AAAA01'),('Local2020','333','f','2020AAAA01'),
       ('Local2020','222','f','2020BBBB01'),('Local2020','333','1','2020CCCC01'),
       ('Other2021','333','f','2020CCCC01'),('Other2021','333','f','2020DDDD01'),
       -- A Fewest Moves only competition held in one venue links its competitors.
       ('FmcSingle2021','333fm','f','2020EEEE01'),('FmcSingle2021','333fm','f','2020FFFF01'),
       -- Neither a multi-location Fewest Moves one nor a continental championship does.
       ('FmcMulti2021','333fm','f','2020AAAA01'),('FmcMulti2021','333fm','f','2020EEEE01'),
       ('Euro2022','333','f','2020DDDD01'),('Euro2022','333','f','2020FFFF01')`,
  ]) {
    await builder.query(sql);
  }
});

after(async () => {
  if (!socket) return;
  await builder.end();
  await reader.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

test(
  "a first build creates the table and leaves no work tables behind",
  { skip: !socket },
  async () => {
    for (const statement of STATEMENTS) await builder.query(statement);
    assert.deepEqual(await readLinkings(), EXPECTED);
    assert.deepEqual(await tables(), [
      "competition_events",
      "competition_venues",
      "competitions",
      "linkings",
      "results",
    ]);
  },
);

test(
  "a rebuild never leaves the table missing, empty or half written",
  { skip: !socket },
  async () => {
    // The previous build, standing in for one computed from an older export.
    await builder.query("DELETE FROM linkings");
    await builder.query("INSERT INTO linkings VALUES ('2019ZZZZ01','2019YYYY01')");
    const previous = await readLinkings();

    for (const statement of STATEMENTS) {
      await builder.query(statement);
      const seen = await readLinkings();
      assert.ok(
        JSON.stringify(seen) === JSON.stringify(previous) ||
          JSON.stringify(seen) === JSON.stringify(EXPECTED),
        `after "${statement.slice(0, 40)}…" readers saw ${JSON.stringify(seen)}`,
      );
    }
    assert.deepEqual(await readLinkings(), EXPECTED);
    assert.ok(!(await tables()).some((name) => /^linkings_|wca_id_with/.test(name)));
  },
);
