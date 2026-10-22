const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Read once when the module loads, so it has to be set before the require.
process.env.QUERY_TIMEOUT_SECONDS = "1";
const {
  getSchema,
  isQueryTimeout,
  queryPoolConfig,
  runUserQuery,
} = require("../dist/query_tool");

const socket = process.env.TEST_DB_SOCKET;
let admin, queryPool;
const database = `wca_query_test_${process.pid}`;
const queryUser = `wca_query_test_${process.pid}`;
const queryPassword = randomBytes(12).toString("hex");
const outsideFile = path.join(os.tmpdir(), `wca_query_test_${process.pid}.txt`);

// MariaDB error numbers the read-only user's attempts end in.
const ER_DBACCESS_DENIED = 1044;
const ER_TABLEACCESS_DENIED = 1142;
// A missing FILE privilege. MariaDB 12 reports it by name; 10.11, which the CI runner
// installs, reports the same errno as a failed login, so withQueryConnection rules that out.
const ER_ACCESS_DENIED = 1045;
const ER_SPECIFIC_ACCESS_DENIED = 1227;

before(async () => {
  if (!socket) return;
  // Require an explicit disposable test socket; never read production DB settings.
  admin = await mysql.createConnection({
    socketPath: socket,
    user: "root",
    multipleStatements: true,
  });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(`
    USE \`${database}\`;
    CREATE TABLE persons (wca_id VARCHAR(10) PRIMARY KEY, name VARCHAR(40), country_id VARCHAR(30));
    CREATE VIEW person_names AS SELECT wca_id, name FROM persons;
    INSERT INTO persons VALUES
      ('2020ADAA01','Ada','Poland'),('2020BENB01','Ben','Germany'),('2020CAOC01','Cao','China');
  `);
  // The user is created by the same file production runs, so these tests check its grant.
  await admin.query(
    `SET @query_user = ?, @query_host = 'localhost', @query_password = ?, @query_database = ?;\n` +
      readFileSync(path.join(__dirname, "..", "query_user.sql"), "utf8"),
    [queryUser, queryPassword, database],
  );
  queryPool = mysql.createPool({
    socketPath: socket,
    user: queryUser,
    password: queryPassword,
    database,
    connectionLimit: 4,
  });
  // A file the server process can read, standing in for a secret on the database host.
  writeFileSync(outsideFile, "not for query users\n", { mode: 0o644 });
});

after(async () => {
  rmSync(outsideFile, { force: true });
  if (!socket) return;
  await queryPool?.end();
  await admin.query(`DROP USER IF EXISTS ?@'localhost'`, [queryUser]);
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
});

/**
 * Runs `use` on one pool connection after a plain SELECT on it has succeeded as the query
 * user, so an access-denied error inside is about the statement, never the login.
 */
async function withQueryConnection(use) {
  const connection = await queryPool.getConnection();
  try {
    const [[{ account, persons }]] = await connection.query(
      "SELECT CURRENT_USER() AS account, COUNT(*) AS persons FROM persons",
    );
    assert.equal(account, `${queryUser}@localhost`);
    assert.equal(persons, 3);
    await use(connection);
  } finally {
    connection.release();
  }
}

async function rejectsWith(promise, errnos) {
  await assert.rejects(promise, (err) => {
    assert.ok(errnos.includes(err.errno), `expected errno ${errnos}, got ${err.errno}: ${err.message}`);
    return true;
  });
}

test("the Query Tool stays off without a query user of its own", () => {
  const app = { DB_USER: "wca_app", DB_PASS: "app-secret", DB_NAME: "wca" };
  assert.equal(queryPoolConfig({ ...app }).ok, false);
  assert.equal(queryPoolConfig({ ...app, QUERY_DB_USER: "  " }).ok, false);
  // Pointing it at the app's own account, or at root, is no read-only user either.
  assert.equal(queryPoolConfig({ ...app, QUERY_DB_USER: "wca_app" }).ok, false);
  assert.equal(queryPoolConfig({ ...app, QUERY_DB_USER: "root" }).ok, false);
  assert.equal(queryPoolConfig({ QUERY_DB_USER: "root" }).ok, false);

  const config = queryPoolConfig({ ...app, QUERY_DB_USER: "wca_query", QUERY_DB_PASS: "query-secret" });
  assert.equal(config.ok, true);
  assert.equal(config.options.user, "wca_query");
  assert.equal(config.options.password, "query-secret");
  assert.equal(config.options.database, "wca");
});

test("every statement a user query sends runs under the time limit, DESC included", async () => {
  const sent = [];
  const fakePool = {
    query: async (sql) => {
      sent.push(sql);
      return sql.includes("COUNT(*)") ? [[{ count: 3 }], []] : [[{ id: 1 }], [{ name: "id" }]];
    },
  };
  await runUserQuery(fakePool, "DESC persons", 1, 50);
  await runUserQuery(fakePool, "DESCRIBE persons;", 1, 50);
  await runUserQuery(fakePool, "SELECT id FROM persons LIMIT 5", 1, 50);
  await runUserQuery(fakePool, "WITH p AS (SELECT id FROM persons) SELECT id FROM p", 2, 10);
  assert.equal(sent.length, 5);
  for (const sql of sent) assert.match(sql, /^SET STATEMENT max_statement_time=1 FOR /);
});

test("the Query Tool refuses statements other than SELECT and DESC", async () => {
  const fakePool = { query: async () => assert.fail("nothing should reach the database") };
  for (const sql of ["UPDATE persons SET name = 'x'", "SHOW GRANTS", "", "WITH x AS (DELETE)"]) {
    await assert.rejects(runUserQuery(fakePool, sql, 1, 50), /Only SELECT/);
  }
  await assert.rejects(runUserQuery(fakePool, "SELECT 1 LIMIT 101", 1, 50), /LIMIT cannot exceed 100/);
});

test("the query user reads the app database, paginated", { skip: !socket }, async () => {
  const page = await runUserQuery(queryPool, "SELECT wca_id FROM persons ORDER BY wca_id", 2, 2);
  assert.deepEqual(
    { ...page, rows: page.rows.map((r) => r.wca_id) },
    { rows: ["2020CAOC01"], page: 2, pageSize: 2, total: 3 },
  );
  const limited = await runUserQuery(queryPool, "SELECT name FROM persons ORDER BY name LIMIT 1", 3, 50);
  assert.deepEqual(limited.rows.map((r) => r.name), ["Ada"]);
  // SELECT alone describes tables and views, so the user needs no SHOW VIEW.
  for (const sql of ["DESC persons", "DESCRIBE person_names"]) {
    const described = await runUserQuery(queryPool, sql, 1, 50);
    assert.ok(described.rows.some((r) => r.Field === "name"), sql);
  }
  assert.deepEqual(Object.keys(await getSchema(queryPool)).sort(), ["person_names", "persons"]);
  assert.deepEqual(
    (await getSchema(queryPool)).persons.columns.map((c) => c.name),
    ["wca_id", "name", "country_id"],
  );
});

test("the query user holds SELECT on the app database and nothing else", { skip: !socket }, async () => {
  const [grants] = await queryPool.query("SHOW GRANTS FOR CURRENT_USER()");
  const lines = grants.map((row) => Object.values(row)[0]);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /^GRANT USAGE ON \*\.\* TO /);
  assert.match(lines[1], new RegExp(`^GRANT SELECT ON \`${database.replace(/_/g, "\\\\_")}\`\\.\\* TO `));
});

test("the query user cannot write or read files on the database host", { skip: !socket }, async (t) => {
  const target = path.join(os.tmpdir(), `wca_query_test_${process.pid}_out.txt`);
  // With their own LIMIT, these reach the database exactly as written.
  for (const into of ["OUTFILE", "DUMPFILE"]) {
    await withQueryConnection(async (connection) => {
      await rejectsWith(
        runUserQuery(connection, `SELECT name FROM persons LIMIT 1 INTO ${into} '${target}'`, 1, 50),
        [ER_ACCESS_DENIED, ER_SPECIFIC_ACCESS_DENIED],
      );
    });
    assert.equal(existsSync(target), false);
  }

  const read = `SELECT LOAD_FILE('${outsideFile}') AS content LIMIT 1`;
  const [{ content }] = (await runUserQuery(queryPool, read, 1, 50)).rows;
  assert.equal(content, null);
  // The same read as root shows the server could read the file, so the NULL above is the
  // missing privilege rather than the file being out of the server's reach.
  const [[{ content: asRoot }]] = await admin.query(read);
  if (asRoot === null) return t.skip("this server cannot read files outside secure_file_priv");
  assert.equal(String(asRoot), "not for query users\n");
});

test("the query user cannot change data, schema or other databases", { skip: !socket }, async () => {
  for (const sql of [
    "INSERT INTO persons VALUES ('2020DANI01','Dan','Poland')",
    "UPDATE persons SET name = 'x'",
    "DELETE FROM persons",
    "CREATE TABLE stolen (id INT)",
    "DROP TABLE persons",
    "ALTER TABLE persons ADD COLUMN x INT",
    "CREATE DATABASE wca_query_test_other",
    "SELECT * FROM mysql.user",
  ]) {
    await withQueryConnection((connection) =>
      rejectsWith(connection.query(sql), [ER_TABLEACCESS_DENIED, ER_DBACCESS_DENIED]),
    );
  }
  const [[{ count }]] = await admin.query(`SELECT COUNT(*) AS count FROM \`${database}\`.persons`);
  assert.equal(count, 3);
});

test("a query over the time limit is cancelled by the database", { skip: !socket }, async () => {
  await assert.rejects(runUserQuery(queryPool, "SELECT SLEEP(3) AS slept LIMIT 1", 1, 50), (err) =>
    isQueryTimeout(err),
  );
});
