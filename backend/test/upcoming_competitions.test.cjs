const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const {
  createUpcomingCompetitionsService,
  distanceKm,
  heldOnWeekend,
  filterUpcomingCompetitions,
  loadUpcomingCompetitions,
  parseUpcomingCompetitionsFilters,
  registrationStatus,
  UpcomingCompetitionsInputError,
} = require("../dist/upcoming_competitions");

const OPTIONS = {
  regions: [
    { id: "World", name: "World", kind: "world" },
    { id: "_Europe", name: "Europe", kind: "continent" },
    { id: "_Asia", name: "Asia", kind: "continent" },
    { id: "Poland", name: "Poland", kind: "country" },
    { id: "Spain", name: "Spain", kind: "country" },
    { id: "Japan", name: "Japan", kind: "country" },
  ],
  events: [
    { id: "333", name: "3x3x3 Cube" },
    { id: "444", name: "4x4x4 Cube" },
    { id: "333bf", name: "3x3x3 Blindfolded" },
  ],
};

const NOW = new Date("2026-11-15T12:00:00Z");

const competition = (overrides) => ({
  id: "Comp2026",
  name: "Comp 2026",
  city: "Somewhere",
  country_id: "Poland",
  country_name: "Poland",
  country_iso2: "PL",
  continent_id: "_Europe",
  start_date: "2026-12-05",
  end_date: "2026-12-06",
  latitude: 52,
  longitude: 21,
  competitor_limit: 100,
  accepted_registrations: 10,
  registration_open: "2026-11-01T18:00:00Z",
  registration_close: "2026-12-01T18:00:00Z",
  championships: [],
  events: ["333"],
  ...overrides,
});

const parse = (query) => parseUpcomingCompetitionsFilters(query, OPTIONS);
const filter = (competitions, query, competedCountries = null) => {
  const filters = parse(query);
  const regionKind = OPTIONS.regions.find((r) => r.id === filters.region).kind;
  return filterUpcomingCompetitions(competitions, filters, { now: NOW, regionKind, competedCountries }).map(
    (c) => c.id,
  );
};

test("parses an empty query into no filters", () => {
  assert.deepEqual(parse({}), {
    q: "",
    region: "World",
    from: null,
    to: null,
    events: [],
    championships: "include",
    min_limit: null,
    max_limit: null,
    registration: [],
    new_countries: false,
    near: null,
    radius_km: null,
    sort: "date",
    duration: "any",
    weekend: false,
  });
});

test("rejects malformed filters", () => {
  for (const query of [
    { region: "Atlantis" },
    { from: "2026-13-01" },
    { to: "tomorrow" },
    { from: "2026-12-10", to: "2026-12-01" },
    { events: "333,555" },
    { championships: "some" },
    { min_limit: "-1" },
    { max_limit: "1.5" },
    { min_limit: "200", max_limit: "100" },
    { registration: "open,waiting" },
    { new_countries: "yes" },
    { q: "x".repeat(101) },
    { q: ["a", "b"] },
    { near: "52.2" },
    { near: "91,0" },
    { near: "0,181" },
    { near: "52.2,abc" },
    { near: "1e1,2" },
    { radius_km: "50" },
    { near: "52,21", radius_km: "0" },
    { near: "52,21", radius_km: "25000" },
    { near: "52,21", radius_km: "2.5" },
    { sort: "distance" },
    { near: "52,21", sort: "name" },
    { duration: "two" },
    { weekend: "true" },
  ]) {
    assert.throws(() => parse(query), UpcomingCompetitionsInputError, JSON.stringify(query));
  }
});

test("registration status follows the website's order", () => {
  assert.equal(registrationStatus(competition({ registration_open: "2026-11-20T00:00:00Z" }), NOW), "not_open");
  assert.equal(registrationStatus(competition({ registration_close: "2026-11-10T00:00:00Z" }), NOW), "closed");
  assert.equal(registrationStatus(competition({ accepted_registrations: 100 }), NOW), "full");
  assert.equal(registrationStatus(competition({}), NOW), "open");
  // A closed competition is closed even when it filled up first.
  assert.equal(
    registrationStatus(competition({ accepted_registrations: 100, registration_close: "2026-11-10T00:00:00Z" }), NOW),
    "closed",
  );
  // Without a limit it never fills, and without dates it is open.
  assert.equal(
    registrationStatus(
      competition({ competitor_limit: null, accepted_registrations: 500, registration_open: null, registration_close: null }),
      NOW,
    ),
    "open",
  );
});

test("filters by search term, region, dates and events", () => {
  const competitions = [
    competition({ id: "Warsaw", name: "Warsaw Open 2026", city: "Warsaw", events: ["333", "444"] }),
    competition({ id: "Madrid", name: "Madrid Open 2026", city: "Madrid", country_id: "Spain", start_date: "2027-01-10" }),
    competition({ id: "Tokyo", name: "Tokyo Cube Day", city: "Tokyo", country_id: "Japan", continent_id: "_Asia", events: ["333", "444", "333bf"] }),
  ];
  assert.deepEqual(filter(competitions, { q: "warsaw" }), ["Warsaw"]);
  assert.deepEqual(filter(competitions, { q: "tokyo" }), ["Tokyo"], "matches the city too");
  assert.deepEqual(filter(competitions, { region: "_Europe" }), ["Warsaw", "Madrid"]);
  assert.deepEqual(filter(competitions, { region: "Japan" }), ["Tokyo"]);
  assert.deepEqual(filter(competitions, { from: "2027-01-01" }), ["Madrid"]);
  assert.deepEqual(filter(competitions, { to: "2026-12-31" }), ["Warsaw", "Tokyo"]);
  assert.deepEqual(filter(competitions, { events: "444" }), ["Warsaw", "Tokyo"]);
  assert.deepEqual(filter(competitions, { events: "444,333bf" }), ["Tokyo"], "holds every selected event");
});

test("includes, excludes or keeps only championships", () => {
  const competitions = [
    competition({ id: "Open" }),
    competition({ id: "Nationals", championships: [{ type: "PL", name: "Poland" }] }),
  ];
  assert.deepEqual(filter(competitions, {}), ["Open", "Nationals"]);
  assert.deepEqual(filter(competitions, { championships: "exclude" }), ["Open"]);
  assert.deepEqual(filter(competitions, { championships: "only" }), ["Nationals"]);
});

test("a competitor limit bound leaves out competitions without a limit", () => {
  const competitions = [
    competition({ id: "Small", competitor_limit: 40 }),
    competition({ id: "Big", competitor_limit: 300 }),
    competition({ id: "Unlimited", competitor_limit: null }),
  ];
  assert.deepEqual(filter(competitions, {}), ["Small", "Big", "Unlimited"]);
  assert.deepEqual(filter(competitions, { min_limit: "100" }), ["Big"]);
  assert.deepEqual(filter(competitions, { max_limit: "100" }), ["Small"]);
  assert.deepEqual(filter(competitions, { min_limit: "40", max_limit: "300" }), ["Small", "Big"]);
});

test("filters by registration status", () => {
  const competitions = [
    competition({ id: "Soon", registration_open: "2026-11-20T00:00:00Z" }),
    competition({ id: "Open" }),
    competition({ id: "Full", accepted_registrations: 100 }),
    competition({ id: "Closed", registration_close: "2026-11-10T00:00:00Z" }),
  ];
  assert.deepEqual(filter(competitions, { registration: "open" }), ["Open"]);
  assert.deepEqual(filter(competitions, { registration: "not_open,full" }), ["Soon", "Full"]);
  assert.deepEqual(filter(competitions, { registration: "closed" }), ["Closed"]);
});

test("countries not competed in leave out those countries and multi-country regions", () => {
  const competitions = [
    competition({ id: "Home", country_id: "Poland" }),
    competition({ id: "Abroad", country_id: "Spain" }),
    competition({ id: "Multi", country_id: "XE" }),
  ];
  assert.deepEqual(filter(competitions, { new_countries: "1" }, new Set(["Poland"])), ["Abroad"]);
});

test("parses a centre, a radius and a distance sort", () => {
  const filters = parse({ near: "52.229, -21.012", radius_km: "150", sort: "distance" });
  assert.deepEqual(filters.near, { latitude: 52.229, longitude: -21.012 });
  assert.equal(filters.radius_km, 150);
  assert.equal(filters.sort, "distance");
  // A centre alone only adds distances; it filters nothing.
  assert.equal(parse({ near: "0,0" }).radius_km, null);
});

test("measures great-circle distances", () => {
  // One degree of latitude is about 111 km anywhere.
  assert.equal(Math.round(distanceKm({ latitude: 10, longitude: 30 }, { latitude: 11, longitude: 30 })), 111);
  // Across the antimeridian is the short way round.
  assert.equal(Math.round(distanceKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 })), 111);
  assert.equal(distanceKm({ latitude: 5, longitude: 5 }, { latitude: 5, longitude: 5 }), 0);
});

test("a radius keeps nearby venues, and distance sorts nearest first", () => {
  const competitions = [
    competition({ id: "Far", start_date: "2026-12-01", latitude: 13, longitude: 30 }),
    competition({ id: "Nowhere", start_date: "2026-12-02", latitude: null, longitude: null }),
    competition({ id: "Near", start_date: "2026-12-03", latitude: 10.5, longitude: 30 }),
    competition({ id: "Here", start_date: "2026-12-04", latitude: 10, longitude: 30 }),
  ];
  const near = "10,30";
  assert.deepEqual(filter(competitions, { near }), ["Far", "Nowhere", "Near", "Here"], "a centre alone filters nothing");
  assert.deepEqual(filter(competitions, { near, radius_km: "100" }), ["Near", "Here"], "no venue, no distance");
  assert.deepEqual(filter(competitions, { near, sort: "distance" }), ["Here", "Near", "Far", "Nowhere"]);

  const filters = parse({ near });
  const [far] = filterUpcomingCompetitions(competitions, filters, { now: NOW, regionKind: "world", competedCountries: null });
  assert.equal(far.distance_km, 334);
  const plain = filterUpcomingCompetitions(competitions, parse({}), { now: NOW, regionKind: "world", competedCountries: null });
  assert.ok(plain.every((c) => c.distance_km === null), "no centre, no distances");
});

test("a weekend competition is held on Saturdays and Sundays only", () => {
  // 2026-12-05 is a Saturday.
  assert.equal(heldOnWeekend("2026-12-05", "2026-12-05"), true);
  assert.equal(heldOnWeekend("2026-12-06", "2026-12-06"), true);
  assert.equal(heldOnWeekend("2026-12-05", "2026-12-06"), true);
  assert.equal(heldOnWeekend("2026-12-04", "2026-12-06"), false, "Friday to Sunday");
  assert.equal(heldOnWeekend("2026-12-06", "2026-12-07"), false, "Sunday to Monday");
  assert.equal(heldOnWeekend("2026-12-09", "2026-12-09"), false);
});

test("filters by number of days and by weekend", () => {
  const competitions = [
    competition({ id: "Saturday", start_date: "2026-12-05", end_date: "2026-12-05" }),
    competition({ id: "Weekend", start_date: "2026-12-05", end_date: "2026-12-06" }),
    competition({ id: "Long", start_date: "2026-12-04", end_date: "2026-12-06" }),
    competition({ id: "Wednesday", start_date: "2026-12-09", end_date: "2026-12-09" }),
  ];
  assert.deepEqual(filter(competitions, { duration: "single" }), ["Saturday", "Wednesday"]);
  assert.deepEqual(filter(competitions, { duration: "multi" }), ["Weekend", "Long"]);
  assert.deepEqual(filter(competitions, { weekend: "1" }), ["Saturday", "Weekend"]);
  assert.deepEqual(filter(competitions, { weekend: "1", duration: "multi" }), ["Weekend"]);
});

const socket = process.env.TEST_DB_SOCKET;
let admin, pool;
const database = `wca_upcoming_test_${process.pid}`;

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({ socketPath: socket, user: "root" });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ socketPath: socket, user: "root", database, connectionLimit: 4 });
  for (const sql of [
    "CREATE TABLE continents (id VARCHAR(50) PRIMARY KEY,name VARCHAR(50))",
    "CREATE TABLE countries (id VARCHAR(50) PRIMARY KEY,name VARCHAR(50),continent_id VARCHAR(50),iso2 VARCHAR(2))",
    "CREATE TABLE events (id VARCHAR(6) PRIMARY KEY,name VARCHAR(54),`rank` INT)",
    `CREATE TABLE competitions (id VARCHAR(32) PRIMARY KEY,name VARCHAR(50),city_name VARCHAR(50),
       country_id VARCHAR(50),start_date DATE,end_date DATE,latitude INT,longitude INT,
       competitor_limit_enabled TINYINT(1),competitor_limit INT,registration_open DATETIME,
       registration_close DATETIME,announced_at DATETIME,cancelled_at DATETIME)`,
    "CREATE TABLE competition_events (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),event_id VARCHAR(6))",
    `CREATE TABLE registrations (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),user_id INT,
       competing_status VARCHAR(190),is_competing TINYINT(1),deleted_at DATETIME)`,
    "CREATE TABLE championships (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),championship_type VARCHAR(50))",
    "CREATE TABLE results (id INT AUTO_INCREMENT PRIMARY KEY,competition_id VARCHAR(32),person_id VARCHAR(10))",
    "CREATE TABLE wca_statistics_metadata (field VARCHAR(255),value VARCHAR(255))",
    "INSERT INTO wca_statistics_metadata VALUES ('export_timestamp','2026-11-14T00:00:00Z')",
    "INSERT INTO continents VALUES ('_Europe','Europe'),('_Asia','Asia')",
    `INSERT INTO countries VALUES ('Poland','Poland','_Europe','PL'),('Spain','Spain','_Europe','ES'),
       ('Japan','Japan','_Asia','JP'),('XE','Multiple Countries (Europe)','_Europe',NULL)`,
    "INSERT INTO events VALUES ('333','3x3x3 Cube',10),('444','4x4x4 Cube',30),('333bf','3x3x3 Blindfolded',70),('magic','Magic',997)",
    // Dates are relative to the server's today so the fixture does not age.
    `INSERT INTO competitions VALUES
       ('Past2025','Past 2025','Krakow','Poland','2025-03-01','2025-03-02',50000000,20000000,0,NULL,NULL,NULL,'2025-01-01',NULL),
       ('Euro','Euro Championship','Madrid','Spain',CURDATE() + INTERVAL 30 DAY,CURDATE() + INTERVAL 32 DAY,40416775,-3703790,1,500,
         UTC_TIMESTAMP() - INTERVAL 5 DAY,UTC_TIMESTAMP() + INTERVAL 20 DAY,'2026-01-01',NULL),
       ('Small','Small Open','Lodz','Poland',CURDATE() + INTERVAL 10 DAY,CURDATE() + INTERVAL 10 DAY,51759445,19457216,1,2,
         UTC_TIMESTAMP() - INTERVAL 5 DAY,UTC_TIMESTAMP() + INTERVAL 5 DAY,'2026-01-01',NULL),
       ('Today','Ends Today','Tokyo','Japan',CURDATE() - INTERVAL 1 DAY,CURDATE(),0,0,0,NULL,
         UTC_TIMESTAMP() - INTERVAL 30 DAY,UTC_TIMESTAMP() - INTERVAL 3 DAY,'2026-01-01',NULL),
       ('Cancelled','Cancelled Open','Lodz','Poland',CURDATE() + INTERVAL 10 DAY,CURDATE() + INTERVAL 10 DAY,0,0,0,NULL,NULL,NULL,'2026-01-01','2026-02-01'),
       ('Draft','Not Announced','Lodz','Poland',CURDATE() + INTERVAL 10 DAY,CURDATE() + INTERVAL 10 DAY,0,0,0,NULL,NULL,NULL,NULL,NULL),
       ('Multi','FMC Europe','Multiple cities','XE',CURDATE() + INTERVAL 40 DAY,CURDATE() + INTERVAL 40 DAY,0,0,0,NULL,NULL,NULL,'2026-01-01',NULL)`,
    `INSERT INTO competition_events (competition_id,event_id) VALUES
       ('Euro','444'),('Euro','333'),('Euro','333bf'),('Small','333'),('Today','333'),('Multi','333')`,
    // Small fills its two places: one registration is pending, one deleted, one a guest.
    `INSERT INTO registrations (competition_id,user_id,competing_status,is_competing,deleted_at) VALUES
       ('Small',1,'accepted',1,NULL),('Small',2,'accepted',1,NULL),('Small',3,'pending',1,NULL),
       ('Small',4,'accepted',1,'2026-02-01'),('Small',5,'accepted',0,NULL),('Euro',1,'accepted',1,NULL)`,
    "INSERT INTO championships (competition_id,championship_type) VALUES ('Euro','_Europe'),('Euro','ES'),('Euro','greater_china')",
    "INSERT INTO results (competition_id,person_id) VALUES ('Past2025','2020ADAA01')",
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

const serverToday = async () => {
  const [[row]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  return row.today;
};

test("loads announced, not cancelled competitions that have not ended", { skip: !socket }, async () => {
  const competitions = await loadUpcomingCompetitions(pool, await serverToday());
  assert.deepEqual(
    competitions.map((c) => c.id),
    ["Today", "Small", "Euro", "Multi"],
  );
  const euro = competitions.find((c) => c.id === "Euro");
  assert.equal(euro.latitude, 40.416775);
  assert.equal(euro.longitude, -3.70379);
  assert.equal(euro.competitor_limit, 500);
  assert.equal(euro.accepted_registrations, 1);
  assert.deepEqual(euro.events, ["333", "444", "333bf"], "in event order");
  assert.deepEqual(euro.championships, [
    { type: "_Europe", name: "Europe" },
    { type: "ES", name: "Spain" },
    { type: "greater_china", name: "Greater China" },
  ]);
  assert.match(euro.registration_open, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

  const small = competitions.find((c) => c.id === "Small");
  assert.equal(small.accepted_registrations, 2, "only accepted, competing, not deleted");
  const today = competitions.find((c) => c.id === "Today");
  assert.equal(today.latitude, null, "0, 0 is no venue");
  assert.equal(today.competitor_limit, null);
});

test("the service filters, and needs a WCA ID for countries not competed in", { skip: !socket }, async () => {
  const service = createUpcomingCompetitionsService(pool);
  const options = await service.options();
  assert.ok(options.regions.some((r) => r.id === "Japan"));
  assert.ok(!options.regions.some((r) => r.id === "XE"), "a multi-country region is not a country to pick");
  assert.deepEqual(options.events.map((e) => e.id), ["333", "444", "333bf"]);

  const all = await service.get({}, null);
  assert.equal(all.total, 4);
  assert.equal(all.competitions.find((c) => c.id === "Small").registration_status, "full");
  assert.equal(all.competitions.find((c) => c.id === "Euro").registration_status, "open");
  assert.equal(all.competitions.find((c) => c.id === "Today").registration_status, "closed");

  const fresh = await service.get({ new_countries: "1" }, "2020ADAA01");
  assert.deepEqual(fresh.competitions.map((c) => c.id), ["Today", "Euro"]);
  assert.equal(fresh.competed_countries, 1);

  await assert.rejects(service.get({ new_countries: "1" }, null), UpcomingCompetitionsInputError);
  await assert.rejects(service.get({ region: "Atlantis" }, null), UpcomingCompetitionsInputError);
});
