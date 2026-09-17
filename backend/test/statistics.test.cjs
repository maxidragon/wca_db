const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { STATISTICS } = require("../dist/statistics_catalog");
const {
  parseStatisticsFilters,
  getStatisticsOptions,
  getStatistics,
  createStatisticsService,
} = require("../dist/statistics");
const fixtureOptions = {
  statistics: STATISTICS,
  regions: [
    { id: "World", kind: "world" },
    { id: "China", kind: "country" },
    { id: "Poland", kind: "country" },
    { id: "_Asia", kind: "continent" },
  ],
  events: [
    { id: "222", name: "2x2x2", has_average: true },
    { id: "333", name: "3x3x3", has_average: true },
    { id: "333bf", name: "Blindfolded", has_average: false },
  ],
  years: [2025, 2026],
  export_timestamp: "2026-09-01 00:00:00",
};
test("rejects invalid, repeated and unsupported filters, including SQL injection", () => {
  const parse = (q) => parseStatisticsFilters(q, fixtureOptions);
  assert.deepEqual(
    parse({
      statistic: "most-solves",
      region: "China",
      gender: "f",
      year: "2025",
      events: "222,333,222",
    }).events,
    ["222", "333"],
  );
  for (const q of [
    { statistic: "fake" },
    { region: "China' OR 1=1" },
    { gender: "fake" },
    { year: "2027" },
    { year: "2025abc" },
    { events: "333'); DROP TABLE persons;--" },
    { page: "-1" },
    { page: "1.5" },
    { page_size: "101" },
    { page: ["1", "2"] },
    { region: { id: "China" } },
    { events: "333mbo" },
    { statistic: "sum-of-ranks", year: "2025" },
    { statistic: "most-pos", pos: "3" },
    { statistic: "most-pos", include_dnf: "true" },
    { statistic: "top-100", type: "average", event: "333bf" },
  ])
    assert.throws(() => parse(q));
});
const socket = process.env.TEST_DB_SOCKET;
let admin, pool, options;
const database = `wca_statistics_test_${process.pid}`;
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
    "CREATE TABLE persons (wca_id VARCHAR(10),sub_id INT,name VARCHAR(40),country_id VARCHAR(30),gender CHAR(1),PRIMARY KEY(wca_id,sub_id))",
    "CREATE TABLE competitions (id VARCHAR(40) PRIMARY KEY,name VARCHAR(50),country_id VARCHAR(30),start_date DATE,end_date DATE)",
    "CREATE TABLE results (id INT PRIMARY KEY,person_id VARCHAR(10),country_id VARCHAR(30),competition_id VARCHAR(40),event_id VARCHAR(10),round_type_id VARCHAR(2),pos INT,best INT,average INT,regional_single_record VARCHAR(5),regional_average_record VARCHAR(5))",
    "CREATE TABLE result_attempts (result_id INT,attempt_number INT,value INT,PRIMARY KEY(result_id,attempt_number))",
    "CREATE TABLE ranks_single (person_id VARCHAR(10),event_id VARCHAR(10),best INT,world_rank INT,continent_rank INT,country_rank INT,PRIMARY KEY(person_id,event_id))",
    "CREATE TABLE ranks_average LIKE ranks_single",
    "CREATE TABLE wca_statistics_metadata (field VARCHAR(100),value VARCHAR(100))",
    "INSERT INTO continents VALUES ('_Asia','Asia'),('_Europe','Europe')",
    "INSERT INTO countries VALUES ('China','China','_Asia'),('Poland','Poland','_Europe')",
    "INSERT INTO events VALUES ('222','2x2x2 Cube',10),('333','3x3x3 Cube',20),('333bf','3x3x3 Blindfolded',30),('333fm','Fewest Moves',40),('333mbf','Multi-Blind',50),('333mbo','Old Multi-Blind',999)",
    "INSERT INTO persons VALUES ('2025AAAA01',1,'Alice','China','f'),('2025BBBB01',1,'Bob','Poland','m'),('2025CCCC01',1,'Cara','China','f'),('2025DDDD01',1,'Dan','China','m'),('2025EEEE01',1,'Eve','China','o'),('2025AAAA01',2,'Old Alice','Poland','f')",
    "INSERT INTO competitions VALUES ('China2025','China Open 2025','China','2025-01-01','2025-01-02'),('Poland2026','Poland Open 2026','Poland','2026-02-01','2026-02-02'),('China2026','China Open 2026','China','2026-03-01','2026-03-02')",
    "INSERT INTO wca_statistics_metadata VALUES ('export_timestamp','2026-09-01 00:00:00')",
  ])
    await pool.query(sql);
  let id = 0;
  const add = async (
    person,
    comp,
    event,
    pos,
    values,
    average,
    round = "f",
    sr = "",
    ar = "",
    country,
  ) => {
    const resultId = ++id;
    const [p] = await pool.query(
      "SELECT country_id FROM persons WHERE wca_id=? AND sub_id=1",
      [person],
    );
    const successes = values.filter((v) => v > 0);
    await pool.query("INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
      resultId,
      person,
      country || p[0].country_id,
      comp,
      event,
      round,
      pos,
      successes.length ? Math.min(...successes) : -1,
      average,
      sr,
      ar,
    ]);
    for (let i = 0; i < values.length; i++)
      await pool.query("INSERT INTO result_attempts VALUES (?,?,?)", [
        resultId,
        i + 1,
        values[i],
      ]);
  };
  await add(
    "2025AAAA01",
    "China2025",
    "333",
    1,
    [100, 100, 110, 120, 130],
    110,
    "f",
    "NR",
    "AsR",
  );
  await add(
    "2025BBBB01",
    "China2025",
    "333",
    2,
    [200, 210, 220, -1, -2],
    210,
    "f",
    "WR",
  );
  await add(
    "2025CCCC01",
    "China2025",
    "333",
    3,
    [300, 310, 320, 330, 340],
    320,
  );
  await add("2025DDDD01", "China2025", "333", 4, [-1, -2, 0, 0, 0], -1);
  await add(
    "2025EEEE01",
    "China2025",
    "333",
    2,
    [240, 250, 260, 270, 280],
    260,
    "1",
  );
  await add("2025AAAA01", "China2025", "222", 1, [50, 60, 70, 80, 90], 70);
  await add(
    "2025BBBB01",
    "Poland2026",
    "333",
    1,
    [90, 95, 100, 105, 110],
    100,
    "f",
    "WR",
    "NR",
  );
  await add(
    "2025AAAA01",
    "Poland2026",
    "333",
    2,
    [100, 100, 110, 120, 130],
    110,
  );
  await add("2025AAAA01", "China2026", "333bf", 1, [500, -1, -2], 0);
  await add("2025AAAA01", "China2026", "333fm", 1, [20, 23, 26], 2300);
  await add("2025BBBB01", "China2026", "333fm", 2, [24, -1, 26], -1);
  await add("2025CCCC01", "China2026", "333fm", 3, [26, 27, 28], 2700);
  await add("2025AAAA01", "China2026", "333mbf", 1, [800030001], 0);
  await add("2025BBBB01", "China2026", "333mbf", 2, [810030001], 0);
  await add("2025CCCC01", "China2026", "333mbf", 3, [820030001], 0);
  await add(
    "2025DDDD01",
    "China2026",
    "333",
    4,
    [80, 85, 90, 95, 100],
    90,
    "1",
    "",
    "",
    "Poland",
  );
  await add(
    "2025EEEE01",
    "China2026",
    "333",
    2,
    [75, 85, 95, 105, 115],
    95,
    "1",
  );
  for (const [type, column] of [
    ["single", "best"],
    ["average", "average"],
  ])
    await pool.query(
      `INSERT INTO ranks_${type} SELECT person_id,event_id,best,RANK() OVER(PARTITION BY event_id ORDER BY best),RANK() OVER(PARTITION BY event_id,continent_id ORDER BY best),RANK() OVER(PARTITION BY event_id,country_id ORDER BY best) FROM (SELECT r.person_id,r.event_id,MIN(r.${column}) AS best,p.country_id,c.continent_id FROM results r JOIN persons p ON p.wca_id=r.person_id AND p.sub_id=1 JOIN countries c ON c.id=p.country_id WHERE r.${column}>0 GROUP BY r.person_id,r.event_id,p.country_id,c.continent_id) pb`,
    );
  options = await getStatisticsOptions(pool);
});
after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});
const integration = (name, fn) => test(name, { skip: !socket }, fn);
const run = (q) =>
  getStatistics(pool, parseStatisticsFilters(q, options), options);
integration(
  "all 19 statistics execute with supported filters, continents, gender, empty results and pagination",
  async () => {
    for (const stat of STATISTICS)
      for (const variant of [
        {},
        {
          region: "China",
          gender: "f",
          year: "2026",
          events: "222,333",
          event: "333",
          type: "average",
          pos: "4",
          include_dnf: "1",
        },
        {
          region: "_Europe",
          gender: "o",
          year: "2025",
          events: "333",
          event: "333",
          type: "single",
          pos: "2",
          include_dnf: "0",
        },
      ]) {
        const filters = Object.fromEntries(
          Object.entries(variant).filter(([key]) => stat.filters.includes(key)),
        );
        const result = await run({
          statistic: stat.id,
          ...filters,
          page_size: "1",
        });
        assert.ok(Array.isArray(result.rows), stat.id);
        assert.ok(result.total >= result.rows.length, stat.id);
        const empty = await run({
          statistic: stat.id,
          ...filters,
          page: "999",
        });
        assert.equal(empty.rows.length, 0, stat.id);
        assert.equal(empty.total, result.total, stat.id);
      }
  },
);
integration(
  "region uses historical nationality for attendance and location for competition counts",
  async () => {
    const attendance = await run({
      statistic: "most-competitions",
      region: "China",
    });
    assert.equal(
      Number(attendance.rows.find((r) => r.person_id === "2025AAAA01").count),
      3,
    );
    assert.equal(
      Number(attendance.rows.find((r) => r.person_id === "2025DDDD01").count),
      1,
    );
    const persons = await run({
      statistic: "most-persons",
      region: "China",
      gender: "f",
    });
    assert.deepEqual(
      persons.rows.map((r) => [r.competition_id, Number(r.count)]),
      [
        ["China2025", 2],
        ["China2026", 2],
      ],
    );
  },
);
integration(
  "solves count positive attempts; DNF/DNS count as attempts and zero slots do not",
  async () => {
    const r = await run({
      statistic: "most-solves",
      events: "333",
      year: "2025",
    });
    const bob = r.rows.find((r) => r.person_id === "2025BBBB01"),
      dan = r.rows.find((r) => r.person_id === "2025DDDD01");
    assert.equal(Number(bob.solves), 3);
    assert.equal(Number(bob.attempts), 5);
    assert.equal(Number(dan.solves), 0);
    assert.equal(Number(dan.attempts), 2);
    const best = await run({ statistic: "most-solves-person-competition" });
    assert.equal(
      best.rows.filter((r) => r.person_id === "2025AAAA01").length,
      1,
    );
  },
);
integration(
  "medals use successful finals and actual placements; ties survive page boundaries",
  async () => {
    const r = await run({
      statistic: "medal-collection",
      events: "333",
      year: "2025",
      gender: "f",
    });
    assert.equal(
      Number(r.rows.find((r) => r.person_id === "2025AAAA01").gold),
      1,
    );
    assert.equal(
      Number(r.rows.find((r) => r.person_id === "2025CCCC01").bronze),
      1,
    );
    assert.ok(!r.rows.some((r) => r.person_id === "2025EEEE01"));
    const a = await run({
        statistic: "most-solves",
        events: "333",
        year: "2025",
        page_size: "1",
      }),
      b = await run({
        statistic: "most-solves",
        events: "333",
        year: "2025",
        page_size: "1",
        page: "2",
      });
    assert.equal(a.rows[0].rank, 1);
    assert.equal(b.rows[0].rank, 1);
  },
);
integration(
  "rank sums preserve regional ranks after gender filtering and penalize missing events",
  async () => {
    const r = await run({
      statistic: "sum-of-ranks",
      region: "China",
      events: "222,333",
      gender: "f",
    });
    const alice = r.rows.find((r) => r.person_id === "2025AAAA01"),
      cara = r.rows.find((r) => r.person_id === "2025CCCC01");
    assert.equal(Number(alice["222"]), 1);
    assert.equal(Number(alice["333"]), 3);
    assert.equal(Number(alice.sum), 4);
    assert.equal(Number(cara["222"]), 2);
    assert.equal(Number(cara.sum), Number(cara["222"]) + Number(cara["333"]));
    const countries = await run({
      statistic: "sum-of-country-ranks",
      events: "222,333",
    });
    assert.equal(
      Number(countries.rows.find((r) => r.country_id === "Poland")["222"]),
      2,
    );
  },
);
integration(
  "top 100 counts individual attempts and includes all ties at the cutoff",
  async () => {
    for (let i = 6; i <= 106; i++)
      await pool.query("INSERT INTO result_attempts VALUES (1,?,100)", [i]);
    try {
      const r = await run({
        statistic: "top-100",
        event: "333",
        year: "2025",
        page_size: "100",
      });
      assert.equal(r.total, 103);
      assert.equal(r.rows.length, 100);
      const next = await run({
        statistic: "top-100",
        event: "333",
        year: "2025",
        page_size: "100",
        page: "2",
      });
      assert.equal(next.rows.length, 3);
      assert.ok(next.rows.every((r) => r.rank === 1));
      const appearances = await run({
        statistic: "top-100-appearances",
        event: "333",
        year: "2025",
      });
      assert.equal(Number(appearances.rows[0].count), 103);
    } finally {
      await pool.query(
        "DELETE FROM result_attempts WHERE result_id=1 AND attempt_number>5",
      );
    }
  },
);
integration(
  "missers exclude lifetime regional achievements and use the event preferred format",
  async () => {
    const kings = await run({
      statistic: "uncrowned-kings",
      event: "333",
      region: "China",
    });
    assert.equal(kings.result_type, "average");
    assert.equal(kings.rows[0].person_id, "2025EEEE01");
    assert.ok(!kings.rows.some((r) => r.person_id === "2025AAAA01"));
    const podium = await run({
      statistic: "podium-missers",
      event: "333",
      region: "China",
    });
    assert.ok(!podium.rows.some((r) => r.person_id === "2025CCCC01"));
    const records = await run({
      statistic: "record-missers",
      event: "333",
      type: "single",
    });
    assert.ok(!records.rows.some((r) => r.person_id === "2025BBBB01"));
  },
);
integration("record flags use WR/CR/NR weighted scores", async () => {
  const r = await run({ statistic: "records-person", year: "2025" });
  assert.equal(
    Number(r.rows.find((r) => r.person_id === "2025AAAA01").score),
    6,
  );
  assert.equal(
    Number(r.rows.find((r) => r.person_id === "2025BBBB01").score),
    10,
  );
});
integration(
  "completion requires every current single and available average, then measures elapsed days",
  async () => {
    const r = await run({ statistic: "all-events-achiever" });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].person_id, "2025AAAA01");
    assert.equal(r.rows[0].finish_date, "2026-03-02");
    assert.equal(Number(r.rows[0].competitions), 3);
    assert.equal(Number(r.rows[0].days), 426);
  },
);
integration(
  "podiums include competitors, FMC successful-attempt means and Multi-Blind points",
  async () => {
    const standard = await run({
      statistic: "best-podiums",
      event: "333",
      region: "China",
    });
    assert.equal(standard.rows.length, 1);
    assert.equal(Number(standard.rows[0].value), 640);
    assert.equal(standard.rows[0].podium.length, 3);
    const fm = await run({ statistic: "best-podiums", event: "333fm" });
    assert.equal(Math.round(Number(fm.rows[0].value)), 7500);
    const multi = await run({ statistic: "best-podiums", event: "333mbf" });
    assert.equal(Number(multi.rows[0].value), 54);
    assert.equal(multi.rows[0].mean, 18);
  },
);
integration(
  "nth place counts every round and optionally includes unsuccessful results",
  async () => {
    const a = await run({ statistic: "most-pos", pos: "4" }),
      b = await run({ statistic: "most-pos", pos: "4", include_dnf: "1" });
    assert.equal(
      Number(a.rows.find((r) => r.person_id === "2025DDDD01").count),
      1,
    );
    assert.equal(
      Number(b.rows.find((r) => r.person_id === "2025DDDD01").count),
      2,
    );
  },
);
integration(
  "service deduplicates simultaneous expensive requests and caches completed results",
  async () => {
    const service = createStatisticsService(pool),
      [a, b] = await Promise.all([
        service.get({ statistic: "most-persons" }),
        service.get({ statistic: "most-persons" }),
      ]);
    assert.strictEqual(a, b);
    assert.strictEqual(a, await service.get({ statistic: "most-persons" }));
  },
);

integration(
  "standing records use the first matching result and age at the export date",
  async () => {
    const result = await run({
      statistic: "oldest-standing-records",
      region: "World",
      events: "222",
      type: "single",
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].person_id, "2025AAAA01");
    assert.equal(result.rows[0].date, "2025-01-01");
    assert.equal(Number(result.rows[0].days), 608);
    const averages = await run({
      statistic: "oldest-standing-records",
      events: "222",
      type: "average",
    });
    assert.equal(Number(averages.rows[0].value), 70);
  },
);

integration(
  "top-100 averages include ordered individual attempts, including DNF and DNS",
  async () => {
    const result = await run({
      statistic: "top-100",
      event: "333",
      type: "average",
      year: "2025",
    });
    assert.equal(result.rows.length, 4);
    assert.equal(result.rows[0].value, 110);
    assert.deepEqual(
      result.rows.find((row) => row.person_id === "2025BBBB01").attempts_detail,
      [200, 210, 220, -1, -2],
    );
  },
);
