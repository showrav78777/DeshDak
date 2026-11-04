import assert from "node:assert/strict";
import { createOtapiClient, signOtapiParameters } from "../src/modules/sourcing/adapters/otapi-client.ts";

assert.equal(signOtapiParameters("GetCategoryInfo", { categoryId: "0", instanceKey: "INSTANCEKEY", language: "ru", timestamp: "20210212114345" }, "123123"), "305330c8b160062a90c9449cd146f4fb79a458d0fe3f04b55908edab5c65f1a5");
const input = { query: "shoes & <test>", provider: "approved-provider", page: 2, pageSize: 20 };
let calls = 0;
const credentials = async () => ({ instanceKey: "private-key" });
const success = async (url, init) => {
  calls++;
  assert.equal(url, "https://otapi.net/service-json/SearchItemsFrame");
  assert.equal(init.redirect, "error");
  assert.equal(init.method, "POST");
  assert.equal(init.cache, "no-store");
  const fields = new URLSearchParams(init.body);
  assert.equal(fields.get("framePosition"), "20");
  assert.equal(fields.get("instanceKey"), "private-key");
  assert.equal(fields.has("timestamp"), false);
  assert.equal(fields.has("signature"), false);
  assert.ok(fields.get("xmlParameters").includes("shoes &amp; &lt;test&gt;"));
  return Response.json({ ErrorCode: "Ok", Result: { Items: {} } });
};
const disabled = createOtapiClient({ approved: false, resolveCredentials: credentials, fetchImpl: success });
await assert.rejects(disabled.search(input), { code: "DISABLED" });
assert.equal(calls, 0);
const client = createOtapiClient({ approved: true, resolveCredentials: credentials, fetchImpl: success });
assert.deepEqual(await client.search(input), { Items: {} });
assert.throws(() => client.search({ ...input, page: 0 }), { code: "INVALID_INPUT" });
assert.throws(() => client.search({ ...input, pageSize: 51 }), { code: "INVALID_INPUT" });
assert.throws(() => client.getProductDetail({ itemId: "test", language: "../en" }), { code: "INVALID_INPUT" });
for (const response of [Response.json({ ErrorCode: "AccessDenied", Message: "private-key" }), Response.json({}), new Response("invalid", { headers: { "content-type": "application/json" } }), new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }), new Response("redirect", { status: 302 })]) {
  const broken = createOtapiClient({ approved: true, resolveCredentials: credentials, fetchImpl: async () => response });
  await assert.rejects(broken.search(input), (error) => !String(error).includes("private-key") && error.name === "SupplierApiError");
}
const signed = createOtapiClient({ approved: true, resolveCredentials: async () => ({ instanceKey: "key", signatureSecret: "secret" }), fetchImpl: async (url, init) => {
  assert.equal(url, "https://otapi.net/service-json/GetItemFullInfo");
  const fields = Object.fromEntries(new URLSearchParams(init.body));
  assert.match(fields.timestamp, /^\d{14}$/);
  assert.equal(fields.signature, signOtapiParameters("GetItemFullInfo", fields, "secret"));
  return Response.json({ ErrorCode: "Ok", Result: { Id: "item-1" } });
} });
assert.deepEqual(await signed.getProductDetail({ itemId: "item-1" }), { Id: "item-1" });
const failing = createOtapiClient({ approved: true, resolveCredentials: async () => { throw new Error("private-key"); }, fetchImpl: success });
await assert.rejects(failing.search(input), { code: "UNAVAILABLE", message: "Supplier request failed: UNAVAILABLE" });
for (const stage of ["credentials", "fetch", "body"]) {
  let cancelled = false;
  let networkCalls = 0;
  const stalled = createOtapiClient({
    approved: true, timeoutMs: 20,
    resolveCredentials: stage === "credentials" ? () => new Promise(() => {}) : credentials,
    fetchImpl: async () => {
      networkCalls++;
      if (stage === "fetch") return new Promise(() => {});
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
    },
  });
  const started = Date.now();
  await assert.rejects(stalled.search(input), { code: "UNAVAILABLE" });
  assert.ok(Date.now() - started < 2000, `${stage} must have a bounded deadline`);
  if (stage === "credentials") assert.equal(networkCalls, 0);
  if (stage === "body") assert.equal(cancelled, true);
}
assert.throws(() => createOtapiClient({ approved: true, resolveCredentials: credentials, timeoutMs: 60_000 }), { code: "INVALID_INPUT" });
const exactCredentials = createOtapiClient({ approved: true, resolveCredentials: async () => ({ instanceKey: " key ", signatureSecret: " secret " }), fetchImpl: async (_url, init) => {
  const fields = Object.fromEntries(new URLSearchParams(init.body));
  assert.equal(fields.instanceKey, " key ");
  assert.equal(fields.signature, signOtapiParameters("SearchItemsFrame", fields, " secret "));
  return Response.json({ ErrorCode: "Ok", Result: {} });
} });
await exactCredentials.search(input);
const malformed = createOtapiClient({ approved: true, resolveCredentials: credentials, fetchImpl: async () => new Response("{", { headers: { "content-type": "application/json" } }) });
await assert.rejects(malformed.search(input), { code: "INVALID_RESPONSE" });
console.log("OTAPI offline protocol, deadline, cleanup and security checks passed; no live supplier calls made.");
