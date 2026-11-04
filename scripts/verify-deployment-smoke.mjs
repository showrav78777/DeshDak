const rawBaseUrl = process.env.SMOKE_BASE_URL?.trim();
if (!rawBaseUrl) throw new Error("SMOKE_BASE_URL is required.");
const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:" && process.env.SMOKE_ALLOW_HTTP !== "true") throw new Error("SMOKE_BASE_URL must use HTTPS unless SMOKE_ALLOW_HTTP=true is explicitly set for local testing.");

async function check(pathname, validate) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "DeshDak-Deployment-Smoke/1.0" } });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}.`);
  const body = await response.text();
  validate(response, body);
  console.log(`PASS ${pathname}`);
}

await check("/api/v1/health/live", (response, body) => {
  if (!response.headers.get("cache-control")?.includes("no-store") || !body.includes('"status":"alive"')) throw new Error("Liveness response is incomplete or cacheable.");
});
await check("/api/v1/health/ready", (response, body) => {
  if (!response.headers.get("cache-control")?.includes("no-store") || !body.includes('"status":"ready"')) throw new Error("Readiness response is incomplete or cacheable.");
});
await check("/", (_response, body) => {
  if (!body.includes("DeshDak") || !body.includes("Search")) throw new Error("Homepage smoke markers are missing.");
});
await check("/openapi.yaml", (response, body) => {
  const contract = JSON.parse(body);
  if (!response.headers.get("content-type")?.includes("yaml") || !String(contract.openapi).startsWith("3.") || contract.info?.title !== "DeshDak API") throw new Error("OpenAPI contract is missing or has the wrong content type.");
});
await check("/manifest.webmanifest", (response, body) => {
  const manifest = JSON.parse(body);
  if (!response.headers.get("content-type")?.includes("json") || manifest.name !== "DeshDak" || manifest.display !== "standalone") throw new Error("PWA manifest is missing or invalid.");
});

console.log(`Deployment smoke verification passed for ${baseUrl.origin}.`);
