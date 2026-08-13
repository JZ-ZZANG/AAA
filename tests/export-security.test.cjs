const test = require("node:test");
const assert = require("node:assert/strict");
const {
  consumeRequestBudget,
  createRequestBudget,
  exportRequestLimits
} = require("../electron/export-security.cjs");

test("자동 입력 작업량에 맞춰 제한된 요청 예산을 만든다", () => {
  assert.deepEqual(exportRequestLimits({ uploadCount: 10, operationCount: 5 }), { total: 360, perSecond: 75 });
  assert.deepEqual(exportRequestLimits({ uploadCount: 10000, operationCount: 10000 }), { total: 3000, perSecond: 300 });
});

test("초당 및 전체 요청 한도를 넘으면 요청을 거부한다", () => {
  const rateBudget = { total: 10, perSecond: 2, totalUsed: 0, recent: [], startedAt: 0 };
  assert.equal(consumeRequestBudget(rateBudget, 1000).allowed, true);
  assert.equal(consumeRequestBudget(rateBudget, 1200).allowed, true);
  assert.deepEqual(consumeRequestBudget(rateBudget, 1300), { allowed: false, reason: "rate" });

  const totalBudget = createRequestBudget({}, 0);
  totalBudget.total = 1;
  totalBudget.perSecond = 10;
  assert.equal(consumeRequestBudget(totalBudget, 2000).allowed, true);
  assert.deepEqual(consumeRequestBudget(totalBudget, 4000), { allowed: false, reason: "total" });
});
