const { test } = require("node:test");
const assert = require("node:assert/strict");
const { attemptMilestonesCrossed } = require("../dist/achievements");

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
