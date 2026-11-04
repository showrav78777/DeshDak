import { randomBytes } from "node:crypto";

const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const knownRequestId = `qa_trace_${randomBytes(10).toString("hex")}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(path, requestId) {
  const response = await fetch(`${baseUrl}${path}`, { headers: requestId ? { "x-request-id": requestId } : undefined });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path} did not return JSON.`); }
  return { response, body, text };
}

const live = await get("/api/v1/health/live", knownRequestId);
assert(live.response.status === 200 && live.body.data?.status === "alive", "Liveness did not report an alive service.");
assert(live.response.headers.get("x-request-id") === knownRequestId, "A valid request ID was not propagated end to end.");
assert(live.response.headers.get("cache-control")?.includes("no-store"), "Liveness can be cached unexpectedly.");

const ready = await get("/api/v1/health/ready", knownRequestId);
assert(ready.response.status === 200 && ready.body.data?.dependencies?.database === "ready", "Readiness did not verify the database dependency.");
assert(ready.response.headers.get("x-request-id") === knownRequestId, "Readiness lost the request correlation ID.");

const compatibility = await get("/api/v1/health");
assert(compatibility.response.status === 200 && compatibility.body.data?.checks?.readiness, "Compatibility health response is incomplete.");
const generatedRequestId = compatibility.response.headers.get("x-request-id");
assert(/^[A-Za-z0-9_-]{8,128}$/.test(generatedRequestId ?? ""), "The server did not generate a safe request ID.");

const rejected = await get("/api/v1/health/live", "../../untrusted request id");
const replacementRequestId = rejected.response.headers.get("x-request-id");
assert(replacementRequestId !== "../../untrusted request id" && /^[A-Za-z0-9_-]{8,128}$/.test(replacementRequestId ?? ""), "An unsafe client request ID was trusted.");

const contract = await fetch(`${baseUrl}/openapi.yaml`);
const contractBody = await contract.json();
assert(contract.status === 200 && contractBody.openapi === "3.0.3", "The published OpenAPI contract is unavailable.");
assert(contractBody.paths?.["/health/ready"]?.get && contractBody.paths?.["/payments/checkout"]?.post, "The published OpenAPI contract is missing critical operations.");

for (const result of [live, ready, compatibility, rejected]) {
  const normalized = result.text.toLowerCase();
  assert(!normalized.includes("database_url") && !normalized.includes("postgresql://") && !normalized.includes("prismaclient") && !normalized.includes("stack"), "A health response exposed an internal secret or error detail.");
}

console.log("Observability verification passed: liveness, database readiness, published OpenAPI, no-store responses, safe correlation IDs, and non-disclosure.");
