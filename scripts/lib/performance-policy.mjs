const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const value = environment[name] === undefined ? fallback : Number(environment[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function boundedNumber(environment, name, fallback, minimum, maximum) {
  const value = environment[name] === undefined ? fallback : Number(environment[name]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be from ${minimum} to ${maximum}.`);
  return value;
}

export function validatePerformanceConfiguration(environment) {
  const rawBaseUrl = environment.PERF_BASE_URL?.trim();
  if (!rawBaseUrl) throw new Error("PERF_BASE_URL is required.");
  let baseUrl;
  try { baseUrl = new URL(rawBaseUrl); } catch { throw new Error("PERF_BASE_URL must be an absolute URL."); }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error("PERF_BASE_URL must use HTTP or HTTPS.");
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") throw new Error("PERF_BASE_URL must be a clean origin.");
  const confirmedOrigin = environment.PERF_CONFIRM_TARGET_ORIGIN?.trim();
  if (!confirmedOrigin || confirmedOrigin !== baseUrl.origin) throw new Error("PERF_CONFIRM_TARGET_ORIGIN must exactly match PERF_BASE_URL.");
  const targetClass = environment.PERF_TARGET_CLASS?.trim().toLowerCase();
  if (!new Set(["local", "staging", "production"]).has(targetClass)) throw new Error("PERF_TARGET_CLASS must be local, staging, or production.");
  if (targetClass === "local" && !LOCAL_HOSTS.has(baseUrl.hostname)) throw new Error("A local performance target must use a local hostname.");
  if (baseUrl.protocol !== "https:" && !(targetClass === "local" && environment.PERF_ALLOW_HTTP === "true")) throw new Error("Performance targets must use HTTPS except explicitly allowed local tests.");
  if (targetClass === "production" && environment.PERF_ALLOW_PRODUCTION !== "true") throw new Error("Production load testing requires PERF_ALLOW_PRODUCTION=true and an approved maintenance window.");

  const rawPaths = environment.PERF_PATHS?.trim() || "/,/products,/api/v1/health/live";
  const paths = [...new Set(rawPaths.split(",").map((value) => value.trim()).filter(Boolean))];
  if (paths.length < 1 || paths.length > 20 || paths.some((value) => !value.startsWith("/") || value.startsWith("//") || value.includes("#"))) throw new Error("PERF_PATHS must contain 1 to 20 same-origin absolute paths.");

  return {
    baseUrl,
    targetClass,
    paths,
    requestCount: boundedInteger(environment, "PERF_REQUESTS", 100, 1, 2_000),
    concurrency: boundedInteger(environment, "PERF_CONCURRENCY", 5, 1, 50),
    timeoutMs: boundedInteger(environment, "PERF_TIMEOUT_MS", 10_000, 250, 60_000),
    warmupRequestsPerPath: boundedInteger(environment, "PERF_WARMUP_REQUESTS_PER_PATH", 1, 0, 10),
    maximumP95Ms: boundedNumber(environment, "PERF_MAX_P95_MS", 1_500, 1, 60_000),
    maximumErrorRate: boundedNumber(environment, "PERF_MAX_ERROR_RATE", 0.01, 0, 0.2),
  };
}

export function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}
