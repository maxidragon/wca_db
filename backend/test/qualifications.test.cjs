const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  createQualificationsService,
  parseRequirement,
  qualificationIndexesReady,
  QualificationInputError,
} = require("../dist/qualifications");

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_qualifications_test_${process.pid}`;

const requirement = (type, resultType, level, whenDate = "2026-06-01") =>
  JSON.stringify({ type, resultType, whenDate, level });

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
    "CREATE TABLE events (id VARCHAR(6) PRIMARY KEY,name VARCHAR(54),`rank` INT)",
    "CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,name VARCHAR(50),start_date DATE,end_date DATE,country_id VARCHAR(30))",
    "CREATE TABLE competition_events (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),event_id VARCHAR(6),qualification TEXT)",
    "CREATE TABLE results (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),event_id VARCHAR(6),person_id VARCHAR(10),best INT,average INT)",
    "CREATE TABLE wca_statistics_metadata (field VARCHAR(255),value VARCHAR(255))",
    "INSERT INTO wca_statistics_metadata VALUES ('export_timestamp','2026-07-01T00:00:00Z')",
    "INSERT INTO continents VALUES ('_Europe','Europe'),('_Asia','Asia')",
    "INSERT INTO countries VALUES ('Poland','Poland','_Europe'),('Spain','Spain','_Europe'),('Japan','Japan','_Asia')",
    `INSERT INTO persons VALUES
       ('2020ADAA01',1,'Ada','Poland'),
       ('2020BENB01',1,'Ben','Spain'),
       ('2020CAOC01',1,'Cao','Spain'),
       ('2020DANI01',1,'Dan','Poland'),('2020DANI01',2,'Daniel','Spain'),
       ('2020FUMI01',1,'Fumi','Japan'),
       ('2020EVAE01',1,'Eva','Poland')`,
    "INSERT INTO events VALUES ('333','3x3x3 Cube',10),('444','4x4x4 Cube',30),('333bf','3x3x3 Blindfolded',70),('333mbf','3x3x3 Multi-Blind',110)",
    // The deadline is 2026-06-01: Late ends after it, Edge on it, and Early well before.
    `INSERT INTO competitions VALUES
       ('Early2025','Early 2025','2025-03-01','2025-03-02','Poland'),
       ('Again2025','Again 2025','2025-09-06','2025-09-07','Spain'),
       ('Edge2026','Edge 2026','2026-05-30','2026-06-01','Spain'),
       ('Late2026','Late 2026','2026-06-01','2026-06-02','Poland'),
       ('Champs2026','Champs 2026','2026-08-01','2026-08-02','Spain'),
       ('Open2026','Open 2026','2026-09-01','2026-09-01','Spain')`,
    `INSERT INTO competition_events (competition_id,event_id,qualification) VALUES
       ('Champs2026','333','${requirement("attemptResult", "average", 1000)}'),
       ('Champs2026','444','${requirement("anyResult", "single", null)}'),
       ('Champs2026','333bf','${requirement("ranking", "single", 2)}'),
       ('Champs2026','333mbf','not json'),
       ('Open2026','333',NULL)`,
    // 3x3 average under 10.00 by the deadline:
    //   Ada 9.00 at Early and again at Again: listed once, achieved at Early.
    //   Ben 9.99 at Edge, which ends on the deadline, so it counts.
    //   Cao exactly 10.00: not strictly better. Dan 8.00 only at Late, after the deadline,
    //   but 9.50 before it, which is the result shown. Eva DNF average.
    //   2026GONE01 qualifies but has no persons row yet.
    `INSERT INTO results (competition_id,event_id,person_id,best,average) VALUES
       ('Early2025','333','2020ADAA01',800,900),
       ('Again2025','333','2020ADAA01',820,900),
       ('Edge2026','333','2020BENB01',900,999),
       ('Early2025','333','2020CAOC01',900,1000),
       ('Again2025','333','2020DANI01',900,950),
       ('Late2026','333','2020DANI01',700,800),
       ('Early2025','333','2020EVAE01',700,-1),
       ('Edge2026','333','2026GONE01',990,995),
       ('Early2025','444','2020CAOC01',4000,4200),
       ('Early2025','444','2020EVAE01',-1,0),
       ('Late2026','444','2020BENB01',3900,0),
       ('Again2025','444','2020ADAA01',3500,3700),
       ('Early2025','333bf','2020ADAA01',3000,0),
       ('Again2025','444','2020FUMI01',5000,5200)`,
  ])
    await pool.query(sql);
  // The indexes the import builds, from the file it builds them with.
  await pool.query(
    readFileSync(path.join(__dirname, "..", "qualification_indexes.sql"), "utf8"),
  );
});

after(async () => {
  if (!socket) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

test("a requirement is read the way the WCA stores it", () => {
  assert.deepEqual(parseRequirement(requirement("attemptResult", "single", 6000)), {
    type: "attemptResult",
    result_type: "single",
    when_date: "2026-06-01",
    level: 6000,
  });
  assert.equal(parseRequirement(requirement("ranking", "both", 10)), null);
  assert.equal(parseRequirement(JSON.stringify({ type: "anyResult", resultType: "single" })), null);
  assert.equal(parseRequirement("not json"), null);
  assert.equal(parseRequirement(null), null);
});

test("the import's indexes are what the lists need", { skip: !socket }, async () => {
  assert.equal(await qualificationIndexesReady(pool), true);
});

test(
  "a time limit lists results strictly better than it from competitions ending by the deadline",
  { skip: !socket },
  async () => {
    const result = await createQualificationsService(pool).get("Champs2026", "333", 1);
    assert.deepEqual(result.qualifiers, [
      {
        wca_id: "2020ADAA01",
        name: "Ada",
        country_id: "Poland",
        country_name: "Poland",
        result: 900,
        competition_id: "Early2025",
        competition_name: "Early 2025",
      },
      {
        wca_id: "2020DANI01",
        name: "Dan",
        country_id: "Poland",
        country_name: "Poland",
        result: 950,
        competition_id: "Again2025",
        competition_name: "Again 2025",
      },
      {
        wca_id: "2026GONE01",
        name: "2026GONE01",
        country_id: null,
        country_name: null,
        result: 995,
        competition_id: "Edge2026",
        competition_name: "Edge 2026",
      },
      {
        wca_id: "2020BENB01",
        name: "Ben",
        country_id: "Spain",
        country_name: "Spain",
        result: 999,
        competition_id: "Edge2026",
        competition_name: "Edge 2026",
      },
    ]);
  },
);

test(
  "any result lists every successful one by the deadline, best first",
  { skip: !socket },
  async () => {
    const result = await createQualificationsService(pool).get("Champs2026", "444", 1);
    // Eva only DNFed, and Ben's single came after the deadline.
    assert.deepEqual(
      result.qualifiers.map(({ wca_id, result }) => [wca_id, result]),
      [
        ["2020ADAA01", 3500],
        ["2020CAOC01", 4000],
        ["2020FUMI01", 5000],
      ],
    );
  },
);

test(
  "a top N requirement is shown but not checked, and a malformed requirement is left out",
  { skip: !socket },
  async () => {
    const service = createQualificationsService(pool);
    const result = await service.get("Champs2026", "unique", 1);
    assert.deepEqual(
      result.events.map(({ event_id, requirement, count }) => [event_id, requirement.type, count]),
      [
        ["333", "attemptResult", 4],
        ["444", "anyResult", 3],
        ["333bf", "ranking", null],
      ],
    );
    await assert.rejects(service.get("Champs2026", "333bf", 1), QualificationInputError);
    await assert.rejects(service.get("Champs2026", "333mbf", 1), QualificationInputError);
  },
);

test(
  "the unique list counts each competitor once, by events met and then name",
  { skip: !socket },
  async () => {
    const result = await createQualificationsService(pool).get("Champs2026", "unique", 1);
    // Ada has a 3x3 Blindfolded single, but a top N requirement is not counted.
    assert.equal(result.unique_count, 6);
    assert.deepEqual(
      result.qualifiers.map(({ wca_id, events }) => [wca_id, events]),
      [
        ["2020ADAA01", ["333", "444"]],
        ["2026GONE01", ["333"]],
        ["2020BENB01", ["333"]],
        ["2020CAOC01", ["444"]],
        ["2020DANI01", ["333"]],
        ["2020FUMI01", ["444"]],
      ],
    );
    assert.equal(result.qualifiers[2].country_name, "Spain");
  },
);

test(
  "a region keeps competitors by their current nationality, in the lists and the counts",
  { skip: !socket },
  async () => {
    const service = createQualificationsService(pool);
    // Dan competed for Spain once but is Polish now; 2026GONE01 has no nationality yet.
    const spain = await service.get("Champs2026", "unique", 1, "Spain");
    assert.equal(spain.region, "Spain");
    assert.deepEqual(
      spain.qualifiers.map(({ wca_id, events }) => [wca_id, events]),
      [
        ["2020BENB01", ["333"]],
        ["2020CAOC01", ["444"]],
      ],
    );
    assert.equal(spain.unique_count, 2);
    assert.deepEqual(
      spain.events.map(({ event_id, count }) => [event_id, count]),
      [
        ["333", 1],
        ["444", 1],
        ["333bf", null],
      ],
    );

    const europe = await service.get("Champs2026", "333", 1, "_Europe");
    assert.deepEqual(
      europe.qualifiers.map(({ wca_id }) => wca_id),
      ["2020ADAA01", "2020DANI01", "2020BENB01"],
    );
    assert.equal(europe.unique_count, 4);

    const asia = await service.get("Champs2026", "444", 1, "_Asia");
    assert.deepEqual(
      asia.qualifiers.map(({ wca_id, result }) => [wca_id, result]),
      [["2020FUMI01", 5000]],
    );
  },
);

test("an unknown region is rejected", { skip: !socket }, async () => {
  await assert.rejects(
    createQualificationsService(pool).get("Champs2026", "unique", 1, "Atlantis"),
    QualificationInputError,
  );
});

test("a page past the last qualifier is empty", { skip: !socket }, async () => {
  const result = await createQualificationsService(pool).get("Champs2026", "333", 2);
  assert.deepEqual(result.qualifiers, []);
  assert.equal(result.events[0].count, 4);
});

test("a competition without requirements has nothing to list", { skip: !socket }, async () => {
  const result = await createQualificationsService(pool).get("Open2026", "unique", 1);
  assert.deepEqual(result.events, []);
  assert.equal(result.unique_count, 0);
  assert.deepEqual(result.qualifiers, []);
});

test("an unknown competition is not found", { skip: !socket }, async () => {
  assert.equal(await createQualificationsService(pool).get("Nowhere2026", "unique", 1), null);
});
