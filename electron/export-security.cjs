const EXPORT_BROWSER_PARTITION = "persist:aaa-platform-browser";
const EXPORT_AUTOMATION_TIMEOUT_MS = 15 * 60 * 1000;

function clampedInteger(value, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
  return Math.min(maximum, Math.max(minimum, number));
}

function exportRequestLimits(input = {}) {
  const uploadCount = clampedInteger(input.uploadCount, 0, 500);
  const operationCount = clampedInteger(input.operationCount, 0, 1000);
  return {
    total: clampedInteger(200 + uploadCount * 12 + operationCount * 8, 200, 3000),
    perSecond: clampedInteger(50 + uploadCount * 2 + operationCount, 50, 300)
  };
}

function createRequestBudget(input = {}, now = Date.now()) {
  const limits = exportRequestLimits(input);
  return { ...limits, totalUsed: 0, recent: [], startedAt: now };
}

function consumeRequestBudget(budget, now = Date.now()) {
  budget.recent = budget.recent.filter((timestamp) => now - timestamp < 1000);
  budget.totalUsed += 1;
  budget.recent.push(now);
  if (budget.totalUsed > budget.total) return { allowed: false, reason: "total" };
  if (budget.recent.length > budget.perSecond) return { allowed: false, reason: "rate" };
  return { allowed: true, reason: "" };
}

module.exports = {
  EXPORT_AUTOMATION_TIMEOUT_MS,
  EXPORT_BROWSER_PARTITION,
  consumeRequestBudget,
  createRequestBudget,
  exportRequestLimits
};
