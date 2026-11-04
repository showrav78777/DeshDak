import assert from "node:assert/strict";
import { saveSourceSettings } from "../src/lib/source-settings-request.ts";
const path = "/api/v1/admin/source-platforms/test-platform/accounts";
let count = 0;
await saveSourceSettings(path, "POST", { secretReference: "secret://fixture/account", isActive: false }, async (url, init) => {
  count++;
  assert.equal(url, path);
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.equal(JSON.parse(init.body).isActive, false);
  return Response.json({ data: { activationLocked: true } });
});
assert.equal(count, 1);
for (const secretReference of ["actual-secret-key", "https://secret.example/key", null]) {
  let sent = false;
  await assert.rejects(saveSourceSettings(path, "POST", { secretReference }, async () => { sent = true; return Response.json({ data: {} }); }), /not an API key/);
  assert.equal(sent, false, "Raw credentials must not be sent to configuration APIs");
}
for (const status of [401, 403, 409, 422, 500]) {
  let attempts = 0;
  await assert.rejects(saveSourceSettings(path, "POST", {}, async () => {
    attempts++; return Response.json({ error: { message: "private-token" } }, { status });
  }), (error) => !error.message.includes("private-token"));
  assert.equal(attempts, 1, "Mutations must never automatically retry");
}
for (const response of [new Response("<html>sign in</html>"), Response.json({}), Response.json({ data: {}, error: {} }), new Response("{", { headers: { "content-type": "application/json" } })]) {
  await assert.rejects(saveSourceSettings(path, "POST", {}, async () => response), /Refresh this page/);
}
await assert.rejects(saveSourceSettings(path, "POST", {}, async () => { throw new Error("private-token"); }), /Refresh this page/);
for (const destination of ["https://evil.example/", "//evil.example/", "/api/v1/admin/source-platforms/../users", "/api/v1/orders"]) {
  await assert.rejects(saveSourceSettings(destination, "POST", {}, async () => { throw new Error("must not fetch"); }), /Invalid configuration destination/);
}
console.log("Source configuration request checks passed: safe errors, same-origin destinations and no automatic mutation retries.");
