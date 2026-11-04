import assert from "node:assert/strict";
import { percentile, validatePerformanceConfiguration } from "./lib/performance-policy.mjs";

const valid = {
  PERF_BASE_URL: "https://staging.crossly.example",
  PERF_CONFIRM_TARGET_ORIGIN: "https://staging.crossly.example",
  PERF_TARGET_CLASS: "staging",
};
const parsed = validatePerformanceConfiguration(valid);
assert.equal(parsed.requestCount, 100);
assert.equal(parsed.concurrency, 5);
assert.equal(parsed.warmupRequestsPerPath, 1);
assert.deepEqual(parsed.paths, ["/", "/products", "/api/v1/health/live"]);
assert.equal(percentile([10, 20, 30, 40], 95), 40);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_CONFIRM_TARGET_ORIGIN: "https://wrong.example" }), /exactly match/);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_REQUESTS: "2001" }), /1 to 2000|1 to 2,000/);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_CONCURRENCY: "51" }), /1 to 50/);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_PATHS: "https://another.example/private" }), /same-origin/);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_TARGET_CLASS: "production" }), /PERF_ALLOW_PRODUCTION/);
assert.throws(() => validatePerformanceConfiguration({ ...valid, PERF_BASE_URL: "http://staging.crossly.example", PERF_CONFIRM_TARGET_ORIGIN: "http://staging.crossly.example" }), /HTTPS/);
assert.equal(validatePerformanceConfiguration({ PERF_BASE_URL: "http://localhost:3000", PERF_CONFIRM_TARGET_ORIGIN: "http://localhost:3000", PERF_TARGET_CLASS: "local", PERF_ALLOW_HTTP: "true" }).targetClass, "local");

console.log("Performance policy safety regression checks passed.");
