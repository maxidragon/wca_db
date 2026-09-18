const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getPersonProfile } = require("../dist/person");

// The entry table is built from the statements that ship, so the profile is read from the
// same table an import produces rather than from a restatement of it.
const buildStatisticsEntries = async (target) => {
  const file = readFileSync(
    path.join(__dirname, "..", "statistics_entries.sql"),
    "utf8",
  );
  for (const statement of file
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean))
    await target.query(statement);
};

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_person_test_${process.pid}`;

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
    dateStrings: true,
  });
  for (const sql of [
    "CREATE TABLE continents (id VARCHAR(30) PRIMARY KEY,name VARCHAR(40))",
    "CREATE TABLE countries (id VARCHAR(30) PRIMARY KEY,name VARCHAR(40),continent_id VARCHAR(30))",
    "CREATE TABLE events (id VARCHAR(10) PRIMARY KEY,name VARCHAR(50),`rank` INT)",
    "CREATE TABLE persons (wca_id VARCHAR(10),sub_id INT,name VARCHAR(40),country_id VARCHAR(30),PRIMARY KEY(wca_id,sub_id))",
    "CREATE TABLE competitions (id VARCHAR(40) PRIMARY KEY,name VARCHAR(50),country_id VARCHAR(30),city_name VARCHAR(50),venue VARCHAR(240),start_date DATE,end_date DATE)",
    "CREATE TABLE results (id INT PRIMARY KEY,person_id VARCHAR(10),country_id VARCHAR(30),competition_id VARCHAR(40),event_id VARCHAR(10),round_type_id VARCHAR(2),pos INT,best INT,average INT,regional_single_record VARCHAR(5),regional_average_record VARCHAR(5))",
    "CREATE TABLE result_attempts (result_id INT,attempt_number INT,value INT,PRIMARY KEY(result_id,attempt_number))",
    "CREATE TABLE ranks_single (person_id VARCHAR(10),event_id VARCHAR(10),best INT,world_rank INT,continent_rank INT,country_rank INT,PRIMARY KEY(person_id,event_id))",
    "CREATE TABLE ranks_average LIKE ranks_single",
    "INSERT INTO continents VALUES ('_Asia','Asia'),('_Europe','Europe')",
    "INSERT INTO countries VALUES ('China','China','_Asia'),('Poland','Poland','_Europe')",
    "INSERT INTO events VALUES ('222','2x2x2 Cube',10),('333','3x3x3 Cube',20),('333bf','3x3x3 Blindfolded',30)",
    // Alice's second sub id carries the name and country she competed under before: the
    // profile must report the current ones.
    "INSERT INTO persons VALUES ('2025AAAA01',1,'Alice','Poland'),('2025AAAA01',2,'Old Alice','China'),('2025BBBB01',1,'Bob','Poland'),('2025CCCC01',1,'Cara','Poland'),('2025DDDD01',1,'Dan','China')",
    `INSERT INTO competitions VALUES
       ('Warsaw2025','Warsaw Open 2025','Poland','Warsaw','[Cube Hall](https://example.test/hall)','2025-01-10','2025-01-10'),
       ('Warsaw2026','Warsaw Open 2026','Poland','Warsaw','[Cube Hall](https://example.test/hall)','2026-02-10','2026-02-10'),
       ('Krakow2026','Krakow Open 2026','Poland','Krakow','Sports Hall','2026-03-10','2026-03-10'),
       ('Beijing2026','Beijing Open 2026','China','Beijing','Beijing Gym','2026-04-10','2026-04-10')`,
    "INSERT INTO ranks_single VALUES ('2025AAAA01','333',500,10,5,1),('2025AAAA01','333bf',3000,20,9,2)",
    "INSERT INTO ranks_average VALUES ('2025AAAA01','333',700,12,6,2)",
  ])
    await pool.query(sql);

  let id = 0;
  const add = async (person, competition, event, options = {}) => {
    const {
      round = "f",
      pos = 1,
      values = [500, 600, 700, 800, -1],
      average = 700,
      single_record = "",
      average_record = "",
      country = "Poland",
    } = options;
    const resultId = ++id;
    const successes = values.filter((value) => value > 0);
    await pool.query("INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
      resultId,
      person,
      country,
      competition,
      event,
      round,
      pos,
      successes.length ? Math.min(...successes) : -1,
      average,
      single_record,
      average_record,
    ]);
    for (let i = 0; i < values.length; i++)
      await pool.query("INSERT INTO result_attempts VALUES (?,?,?)", [
        resultId,
        i + 1,
        values[i],
      ]);
  };

  // Alice: four competitions, two of them in the same venue, one abroad.
  await add("2025AAAA01", "Warsaw2025", "333", {
    pos: 1,
    single_record: "WR",
    average_record: "NR",
  });
  await add("2025AAAA01", "Warsaw2025", "333bf", { pos: 4 });
  // A first round she also won: only finals carry medals.
  await add("2025AAAA01", "Warsaw2026", "333", { round: "1", pos: 1 });
  await add("2025AAAA01", "Warsaw2026", "333", { pos: 2, single_record: "ER" });
  await add("2025AAAA01", "Krakow2026", "333", { pos: 3 });
  // A final nobody solved: a win on paper only, so it is not a medal.
  await add("2025AAAA01", "Beijing2026", "333", {
    pos: 1,
    values: [-1, -1, -1, -1, -1],
    average: -1,
    country: "China",
  });

  // Bob shares three competitions with Alice, Cara and Dan one each.
  for (const competition of ["Warsaw2025", "Warsaw2026", "Krakow2026"])
    await add("2025BBBB01", competition, "333", { pos: 5 });
  await add("2025CCCC01", "Warsaw2025", "333", { pos: 6 });
  await add("2025DDDD01", "Beijing2026", "222", { pos: 7, country: "China" });

  await buildStatisticsEntries(pool);
});

after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});

const integration = (name, fn) => test(name, { skip: !socket }, fn);

integration("an unknown WCA ID has no profile", async () => {
  assert.equal(await getPersonProfile(pool, "2025ZZZZ99"), null);
});

integration("the profile reports the competitor's current name and region", async () => {
  const { person } = await getPersonProfile(pool, "2025AAAA01");
  assert.deepEqual(person, {
    wca_id: "2025AAAA01",
    name: "Alice",
    country_id: "Poland",
    country_name: "Poland",
    continent_name: "Europe",
  });
});

integration("personal bests carry every rank, and absent ones are null", async () => {
  const { personal_bests } = await getPersonProfile(pool, "2025AAAA01");
  assert.deepEqual(
    personal_bests.map((best) => best.event_id),
    ["333", "333bf"],
    "events without a rank are left out, and the rest keep the official order",
  );
  assert.deepEqual(personal_bests[0], {
    event_id: "333",
    event_name: "3x3x3 Cube",
    single: { result: 500, world_rank: 10, continent_rank: 5, country_rank: 1 },
    average: { result: 700, world_rank: 12, continent_rank: 6, country_rank: 2 },
  });
  assert.equal(personal_bests[1].average, null);
});

integration(
  "competitions are listed newest first, with their venue name and solves",
  async () => {
    const { competitions } = await getPersonProfile(pool, "2025AAAA01");
    assert.deepEqual(
      competitions.map((competition) => competition.id),
      ["Beijing2026", "Krakow2026", "Warsaw2026", "Warsaw2025"],
    );
    const [, , warsaw2026, warsaw2025] = competitions;
    assert.equal(warsaw2025.venue, "Cube Hall", "the markdown link is not the name");
    assert.equal(warsaw2025.city_name, "Warsaw");
    assert.equal(warsaw2025.country_name, "Poland");
    assert.equal(warsaw2025.events, 2);
    assert.equal(warsaw2025.solves, 8);
    assert.equal(warsaw2025.attempts, 10);
    // Two rounds of one event are one event attended, not two.
    assert.equal(warsaw2026.events, 1);
    assert.equal(warsaw2026.solves, 8);
  },
);

integration("totals count attendance, solves, medals and records", async () => {
  const { totals } = await getPersonProfile(pool, "2025AAAA01");
  assert.deepEqual(totals, {
    competitions: 4,
    countries: 2,
    events: 2,
    solves: 20,
    attempts: 30,
    first_competition_date: "2025-01-10",
    last_competition_date: "2026-04-10",
    // The first round she won and the final nobody solved are not medals.
    gold: 1,
    silver: 1,
    bronze: 1,
    world_records: 1,
    continental_records: 1,
    national_records: 1,
  });
});

integration(
  "the competitors are those met most often, counted by competition",
  async () => {
    const { competitors } = await getPersonProfile(pool, "2025AAAA01");
    assert.deepEqual(competitors, [
      { wca_id: "2025BBBB01", name: "Bob", competitions: 3 },
      { wca_id: "2025CCCC01", name: "Cara", competitions: 1 },
      { wca_id: "2025DDDD01", name: "Dan", competitions: 1 },
    ]);
  },
);

integration("venues, cities, countries and years are ranked by attendance", async () => {
  const profile = await getPersonProfile(pool, "2025AAAA01");
  assert.deepEqual(profile.venues[0], {
    venue: "Cube Hall",
    city_name: "Warsaw",
    country_name: "Poland",
    competitions: 2,
  });
  assert.deepEqual(profile.cities[0], {
    city_name: "Warsaw",
    country_name: "Poland",
    competitions: 2,
  });
  assert.deepEqual(profile.countries, [
    { country_id: "Poland", country_name: "Poland", competitions: 3 },
    { country_id: "China", country_name: "China", competitions: 1 },
  ]);
  assert.deepEqual(profile.years, [
    { year: 2026, competitions: 3 },
    { year: 2025, competitions: 1 },
  ]);
});

integration("a competitor without results has an empty profile", async () => {
  await pool.query(
    "INSERT INTO persons VALUES ('2026EEEE01',1,'Eve','Poland')",
  );
  const profile = await getPersonProfile(pool, "2026EEEE01");
  assert.deepEqual(profile.competitions, []);
  assert.deepEqual(profile.competitors, []);
  assert.equal(profile.totals.competitions, 0);
  assert.equal(profile.totals.solves, 0);
  assert.equal(profile.totals.first_competition_date, null);
});
