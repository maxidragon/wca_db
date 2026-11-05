const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

// Read once when the module loads, so it has to be set before the require.
process.env.JWT_SECRET = "test-jwt-secret";
const { ensureAuthenticated, SERVICE_USER } = require("../dist/wca_oauth");

const SERVICE_TOKEN = "test-service-token-0123456789";

afterEach(() => {
  delete process.env.SERVICE_TOKEN;
});

function authenticate(method, authorization) {
  const req = { method, headers: authorization === undefined ? {} : { authorization } };
  const outcome = { status: null, body: null, nextCalled: false };
  const res = {
    status(code) {
      outcome.status = code;
      return this;
    },
    json(body) {
      outcome.body = body;
      return this;
    },
  };
  ensureAuthenticated(req, res, () => {
    outcome.nextCalled = true;
  });
  return { ...outcome, user: req.user };
}

test("the service token passes a GET request as the service user", () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  const result = authenticate("GET", `Bearer ${SERVICE_TOKEN}`);
  assert.equal(result.nextCalled, true);
  assert.equal(result.status, null);
  assert.equal(result.user, SERVICE_USER);
  assert.equal(result.user.wcaUserId, undefined);
});

test("a wrong service token is rejected with 401", () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  for (const token of [`${SERVICE_TOKEN}x`, SERVICE_TOKEN.slice(0, -1), "x".repeat(SERVICE_TOKEN.length)]) {
    const result = authenticate("GET", `Bearer ${token}`);
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 401);
  }
});

test("the service token is refused with 403 for every method but GET", () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const result = authenticate(method, `Bearer ${SERVICE_TOKEN}`);
    assert.equal(result.nextCalled, false, method);
    assert.equal(result.status, 403, method);
    assert.equal(result.user, undefined, method);
  }
});

test("without SERVICE_TOKEN no bearer token is accepted as one", () => {
  for (const configured of [undefined, ""]) {
    if (configured === undefined) delete process.env.SERVICE_TOKEN;
    else process.env.SERVICE_TOKEN = configured;
    for (const header of [`Bearer ${SERVICE_TOKEN}`, "Bearer ", "Bearer"]) {
      const result = authenticate("GET", header);
      assert.equal(result.nextCalled, false, header);
      assert.equal(result.status, 401, header);
    }
  }
});

test("a WCA login JWT still authenticates every method, with or without SERVICE_TOKEN", () => {
  const payload = { wcaUserId: 1, wcaId: "2020TEST01", username: "Test User", roles: [] };
  const token = jwt.sign(payload, "test-jwt-secret", { expiresIn: "7d" });
  for (const configured of [undefined, SERVICE_TOKEN]) {
    if (configured === undefined) delete process.env.SERVICE_TOKEN;
    else process.env.SERVICE_TOKEN = configured;
    for (const method of ["GET", "POST"]) {
      const result = authenticate(method, `Bearer ${token}`);
      assert.equal(result.nextCalled, true);
      assert.equal(result.user.wcaUserId, 1);
      assert.equal(result.user.username, "Test User");
    }
  }
});

test("a missing header, or a JWT signed with another secret, is rejected with 401", () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  assert.equal(authenticate("GET", undefined).status, 401);
  const forged = jwt.sign({ wcaUserId: 1 }, "another-secret");
  assert.equal(authenticate("GET", `Bearer ${forged}`).status, 401);
});
