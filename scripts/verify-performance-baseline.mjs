import { percentile, validatePerformanceConfiguration } from "./lib/performance-policy.mjs";

const configuration = validatePerformanceConfiguration(process.env);
const results = new Array(configuration.requestCount);
let nextIndex = 0;

async function request(pathname) {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(pathname, configuration.baseUrl), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(configuration.timeoutMs),
      headers: { "User-Agent": "DeshDak-Bounded-Performance-Probe/1.0", Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
    });
    await response.arrayBuffer();
    return { pathname, durationMs: performance.now() - startedAt, status: response.status, ok: response.ok };
  } catch (error) {
    return { pathname, durationMs: performance.now() - startedAt, status: 0, ok: false, errorType: error instanceof Error ? error.name : "UnknownError" };
  }
}

for (const pathname of configuration.paths) {
  for (let warmup = 0; warmup < configuration.warmupRequestsPerPath; warmup += 1) {
    const result = await request(pathname);
    if (!result.ok) throw new Error(`Warm-up failed for ${pathname} with status ${result.status}.`);
  }
}

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= configuration.requestCount) return;
    const pathname = configuration.paths[index % configuration.paths.length];
    results[index] = await request(pathname);
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(configuration.concurrency, configuration.requestCount) }, () => worker()));
const wallDurationMs = performance.now() - startedAt;
const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const failures = results.filter((result) => !result.ok);
const errorRate = failures.length / results.length;
const summary = {
  target: configuration.baseUrl.origin,
  targetClass: configuration.targetClass,
  requests: results.length,
  concurrency: configuration.concurrency,
  warmupRequestsPerPath: configuration.warmupRequestsPerPath,
  wallDurationMs: Math.round(wallDurationMs),
  requestsPerSecond: Number((results.length / (wallDurationMs / 1000)).toFixed(2)),
  latencyMs: { p50: Math.round(percentile(durations, 50)), p95: Math.round(percentile(durations, 95)), p99: Math.round(percentile(durations, 99)), maximum: Math.round(durations.at(-1) ?? 0) },
  failures: failures.length,
  errorRate: Number(errorRate.toFixed(4)),
  statuses: Object.fromEntries([...new Set(results.map((result) => result.status))].sort((a, b) => a - b).map((status) => [status, results.filter((result) => result.status === status).length])),
  errorTypes: Object.fromEntries([...new Set(failures.map((result) => result.errorType).filter(Boolean))].sort().map((errorType) => [errorType, failures.filter((result) => result.errorType === errorType).length])),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.latencyMs.p95 > configuration.maximumP95Ms) throw new Error(`Performance gate failed: p95 ${summary.latencyMs.p95}ms exceeds ${configuration.maximumP95Ms}ms.`);
if (errorRate > configuration.maximumErrorRate) throw new Error(`Performance gate failed: error rate ${summary.errorRate} exceeds ${configuration.maximumErrorRate}.`);
console.log("Bounded performance baseline passed.");
