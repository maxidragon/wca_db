const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getNemeses } = require("../dist/nemeses");

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_nemeses_test_${process.pid}`;

const TARGET = "2020TARG01";

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({
    socketPath: socket,
    user: "root",
    database,
    connectionLimit: 4,
    multipleStatements: true,
  });
  for (const sql of [
    "CREATE TABLE continents (id VARCHAR(30) PRIMARY KEY,name VARCHAR(40))",
    "CREATE TABLE countries (id VARCHAR(30) PRIMARY KEY,name VARCHAR(40),continent_id VARCHAR(30))",
    "CREATE TABLE persons (wca_id VARCHAR(10),sub_id INT,name VARCHAR(40),country_id VARCHAR(30),PRIMARY KEY(wca_id,sub_id))",
    "CREATE TABLE ranks_single (person_id VARCHAR(10),event_id VARCHAR(10),best INT,world_rank INT,continent_rank INT,country_rank INT,KEY(person_id))",
    "CREATE TABLE ranks_average LIKE ranks_single",
    "INSERT INTO continents VALUES ('_Asia','Asia'),('_Europe','Europe')",
    "INSERT INTO countries VALUES ('China','China','_Asia'),('Germany','Germany','_Europe'),('Poland','Poland','_Europe')",
    // The target competed under another country before: regions follow the current one.
    `INSERT INTO persons VALUES
       ('${TARGET}',1,'Tess','Poland'),('${TARGET}',2,'Tess','China'),
       ('2020ADAA01',1,'Ada','Poland'),
       ('2020BENB01',1,'Ben','Germany'),
       ('2020CAOC01',1,'Cao','China'),
       ('2020DANI01',1,'Dan','Poland'),
       ('2020EVAE01',1,'Eva','Poland'),
       ('2020FRED01',1,'Fred','Poland'),
       ('2020HUGO01',1,'Hugo','Poland'),
       ('2020ZOEZ01',1,'Zoe','Poland')`,
    // The target holds a 3x3 single and average and a 2x2 single, but no 2x2 average.
    // 2026GONE01 ranks but is missing from persons: the ranks export is newer than the dump.
    `INSERT INTO ranks_single (person_id,event_id,world_rank) VALUES
       ('${TARGET}','333',10),('${TARGET}','222',5),
       ('2020ADAA01','333',5),('2020ADAA01','222',1),
       ('2020BENB01','333',1),('2020BENB01','222',2),
       ('2020CAOC01','333',2),('2020CAOC01','222',3),
       ('2020DANI01','333',10),('2020DANI01','222',1),
       ('2020EVAE01','333',3),
       ('2020FRED01','333',4),('2020FRED01','222',4),
       ('2020HUGO01','333',20),('2020HUGO01','222',20),
       ('2026GONE01','333',6),('2026GONE01','222',4)`,
    `INSERT INTO ranks_average (person_id,event_id,world_rank) VALUES
       ('${TARGET}','333',10),
       ('2020ADAA01','333',5),
       ('2020BENB01','333',1),
       ('2020CAOC01','333',2),('2020CAOC01','222',1),
       ('2020DANI01','333',1),
       ('2020EVAE01','333',3),
       ('2020FRED01','333',11),
       ('2020HUGO01','333',20),
       ('2026GONE01','333',9)`,
  ])
    await pool.query(sql);
  // The indexes the import builds, from the file it builds them with.
  await pool.query(
    readFileSync(path.join(__dirname, "..", "rank_indexes.sql"), "utf8"),
  );
});

after(async () => {
  if (!socket) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

const ids = (result) => result.nemeses.map((nemesis) => nemesis.wca_id);

test(
  "a nemesis is strictly better in every single and average the competitor holds",
  { skip: !socket },
  async () => {
    const result = await getNemeses(pool, TARGET, "world", 1);
    // Ada, Ben and Cao beat every rank. Ben has no 2x2 average, which the target does not
    // hold either. Dan ties the 3x3 single, Eva has no 2x2, Fred's average is worse, and
    // Hugo is worse at everything. The newer competitor sorts after every named one.
    assert.deepEqual(ids(result), ["2020ADAA01", "2020BENB01", "2020CAOC01", "2026GONE01"]);
    assert.deepEqual(result.nemeses[3], {
      wca_id: "2026GONE01",
      name: "2026GONE01",
      country_id: null,
      country_name: null,
    });
    assert.equal(result.ranks, 3);
    assert.deepEqual(result.counts, { world: 4, continent: 2, country: 1 });
    assert.deepEqual(result.person, {
      wca_id: TARGET,
      name: "Tess",
      country_id: "Poland",
      country_name: "Poland",
      continent_id: "_Europe",
      continent_name: "Europe",
    });
  },
);

test(
  "the region limits nemeses to the competitor's current continent or country",
  { skip: !socket },
  async () => {
    const continent = await getNemeses(pool, TARGET, "continent", 1);
    assert.deepEqual(ids(continent), ["2020ADAA01", "2020BENB01"]);
    const country = await getNemeses(pool, TARGET, "country", 1);
    assert.deepEqual(ids(country), ["2020ADAA01"]);
    assert.deepEqual(country.counts, { world: 4, continent: 2, country: 1 });
  },
);

test("a page past the last nemesis is empty", { skip: !socket }, async () => {
  const result = await getNemeses(pool, TARGET, "world", 2);
  assert.deepEqual(result.nemeses, []);
  assert.equal(result.counts.world, 4);
});

test("a competitor without ranks has no nemeses", { skip: !socket }, async () => {
  const result = await getNemeses(pool, "2020ZOEZ01", "world", 1);
  assert.equal(result.ranks, 0);
  assert.deepEqual(result.counts, { world: 0, continent: 0, country: 0 });
  assert.deepEqual(result.nemeses, []);
});

test("an unknown competitor is not found", { skip: !socket }, async () => {
  assert.equal(await getNemeses(pool, "2099NONE01", "world", 1), null);
});
