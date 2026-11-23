import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Review verification requires a generated disposable local schema.");
const origin = process.env.TEST_BASE_URL; if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local test server is required.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
  let code = (await readFile(new URL(file, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const name of ["zod", "@aws-sdk/client-s3"]) code = code.replace(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
  for (const [name, value] of Object.entries(replacements)) code = code.replace(`from "${name}"`, `from ${JSON.stringify(value)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
}
const photos = await source("../src/modules/private-storage/photos.ts");
const { createPhotoQuarantine, isPrivateRecordQuarantined } = await import(await source("../src/modules/private-storage/quarantine.ts"));
const { createPrivatePhotoLinks } = await import(await source("../src/modules/private-storage/record-links.ts", { "./photos": photos }));
const { createPrivatePhotoDelivery } = await import(await source("../src/modules/private-storage/photo-delivery.ts", { "./photos": photos }));
const db = new PrismaClient(), controls = createPhotoQuarantine(db), marker = randomBytes(8).toString("hex"), namespace = randomBytes(32).toString("hex");
const sha = createHash("sha256").update("SYNTHETIC_REVIEW_PHOTO").digest("hex");
async function actor(label, role, portal, mfa = true) {
  const assigned = await db.role.findUniqueOrThrow({ where: { code: role } });
  const user = await db.user.create({ data: { email: `photo-review-${label}-${marker}@example.test`, fullName: "Synthetic review employee", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: assigned.id } } } });
  const session = await db.authSession.create({ data: { userId: user.id, portal, mfaVerifiedAt: mfa ? new Date() : null, expiresAt: new Date(Date.now() + 3_600_000), clientType: "WEB", clientName: "Synthetic photo review" } });
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [role] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return { user, session, token, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
async function fixture(owner, admin, quarantine = true) {
  const reference = { format: 1, purpose: "identity", key: `private/v1/identity/${randomBytes(32).toString("hex")}`, versionId: `synthetic-${randomBytes(8).toString("hex")}`, iv: randomBytes(12).toString("base64"), plaintextSha256: sha, ciphertextSha256: randomBytes(32).toString("base64"), sizeBytes: 22, mimeType: "image/png" };
  const upload = await db.privatePhotoUpload.create({ data: { actorId: owner.user.id, purpose: "identity", idempotencyKey: `review:${randomBytes(12).toString("hex")}`, fingerprint: sha, storageNamespace: namespace, status: "STORED", preparedReference: reference, storedReference: reference } });
  await db.privatePhotoUpload.update({ where: { id: upload.id }, data: { originalScanSha256: sha, originalScanVerifiedAt: upload.createdAt, scanVerifiedSha256: sha, scanVerifiedAt: new Date(upload.createdAt.getTime() + 1) } });
  const identity = await db.identityVerification.create({ data: { userId: owner.user.id, documentType: "PASSPORT", issuingCountryCode: "BD", documentNumberLast4: "A123", documentPhotoSha256: sha, documentPhotoMimeType: "image/png", documentPhotoSizeBytes: 22, documentPhotoCiphertext: "UNCHANGED_SYNTHETIC_LEGACY", documentPhotoIv: randomBytes(12).toString("base64"), documentPhotoTag: randomBytes(16).toString("base64") } });
  await createPrivatePhotoLinks(db, namespace).link({ sessionId: owner.session.id, uploadId: upload.id, kind: "identity", subjectId: identity.id });
  if (quarantine) await controls.block(admin.session.id, upload.id, { reason: "PRIVACY_REVIEW", confirmed: true, idempotencyKey: randomUUID() });
  return { upload, identity };
}
try {
  const admin = await actor("admin", "admin", "admin"), secondAdmin = await actor("second", "admin", "admin"), pendingAdmin = await actor("pending", "admin", "admin", false), customer = await actor("customer", "customer_personal", "customer"), compliance = await actor("compliance", "compliance", "compliance");
  const item = await fixture(customer, admin), url = `${origin}/api/v1/admin/private-photos/${item.upload.id}/quarantine/reviews`;
  const before = JSON.stringify(await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: item.upload.id } }));
  const input = { decision: "RESCAN_REQUIRED", caseReference: "INC-2026-001", expectedSequence: 0, blockedConfirmed: true }, retry = randomUUID();
  async function post(body = input, key = retry, cookie = admin.cookie, trusted = true) { return fetch(url, { method: "POST", headers: { Cookie: cookie, Origin: trusted ? origin : "https://untrusted.invalid", "Content-Type": "application/json", "Idempotency-Key": key }, body: typeof body === "string" ? body : JSON.stringify(body) }); }
  assert.equal((await post(input, retry, pendingAdmin.cookie)).status, 403); assert.equal((await post(input, retry, customer.cookie)).status, 403); assert.equal((await post(input, retry, admin.cookie, false)).status, 403);
  for (const body of [{ ...input, blockedConfirmed: false }, { ...input, decision: "RELEASE" }, { ...input, caseReference: "https://private.example.test/SECRET" }, { ...input, expectedSequence: -1 }, { ...input, extra: "unexpected" }, " ".repeat(4097)]) assert.equal((await post(body)).status, 422);
  assert.equal((await post(input, "invalid")).status, 422);
  await assert.rejects(() => controls.review(pendingAdmin.session.id, item.upload.id, { ...input, idempotencyKey: retry }), /PHOTO_QUARANTINE_DENIED/);
  const [first, replay] = await Promise.all([post(), post()]); assert.equal(first.status, 200); assert.equal(replay.status, 200);
  const result = (await first.json()).data; assert.equal(result.quarantined, true); assert.equal(result.review.sequence, 1);
  const quarantine = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: item.upload.id } });
  assert.equal(await db.privatePhotoQuarantineReview.count({ where: { quarantineId: quarantine.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { action: "private_photo.quarantine_reviewed", entityId: result.review.id } }), 1);
  assert.equal((await post({ ...input, decision: "KEEP_BLOCKED" })).status, 409); assert.equal((await post(input, randomUUID())).status, 409);
  const parallel = await Promise.all([post({ ...input, expectedSequence: 1, decision: "KEEP_BLOCKED" }, randomUUID()), post({ ...input, expectedSequence: 1, decision: "REPLACEMENT_REQUIRED" }, randomUUID(), secondAdmin.cookie)]);
  assert.deepEqual(parallel.map(response => response.status).sort(), [200, 409]);
  const history = await fetch(url, { headers: { Cookie: admin.cookie } }); assert.equal(history.status, 200); assert.match(history.headers.get("cache-control"), /no-store/);
  const historyBody = await history.json(); assert.deepEqual(historyBody.data.items.map(review => review.sequence), [2, 1]); assert.equal(historyBody.data.quarantined, true);
  const text = JSON.stringify(historyBody); for (const forbidden of ["private/v1/", "storedReference", "idempotencyKey", "actorId", "quarantineId", customer.user.email, namespace, sha]) assert(!text.includes(forbidden));
  assert.equal((await fetch(url, { headers: { Cookie: customer.cookie } })).status, 403); assert.equal((await fetch(`${url}?page=0`, { headers: { Cookie: admin.cookie } })).status, 422);
  await assert.rejects(() => db.privatePhotoQuarantineReview.update({ where: { id: result.review.id }, data: { decision: "KEEP_BLOCKED" } }));
  await assert.rejects(() => db.privatePhotoQuarantineReview.delete({ where: { id: result.review.id } }));
  await assert.rejects(() => db.privatePhotoQuarantineReview.create({ data: { quarantineId: quarantine.id, actorId: admin.user.id, idempotencyKey: randomUUID(), sequence: 4, decision: "KEEP_BLOCKED", caseReference: "SEC-2026-001" } }));
  const faultyDb = { authSession: db.authSession, auditLog: db.auditLog, $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, { get(target, property) { if (property === "auditLog") return { create: async () => { throw new Error("Synthetic audit failure"); } }; return Reflect.get(target, property); } }))) };
  await assert.rejects(() => createPhotoQuarantine(faultyDb).review(admin.session.id, item.upload.id, { ...input, expectedSequence: 2, idempotencyKey: randomUUID() }), /PHOTO_QUARANTINE_UNAVAILABLE/);
  assert.equal(await db.privatePhotoQuarantineReview.count({ where: { quarantineId: quarantine.id } }), 2);
  assert(await isPrivateRecordQuarantined(db, "identity", item.identity.id));
  let reads = 0; const reader = createPrivatePhotoDelivery(db, { namespace, read: async () => { reads++; throw new Error("Storage must not be contacted"); } });
  await assert.rejects(() => reader.read({ sessionId: compliance.session.id, kind: "identity", subjectId: item.identity.id }), /PRIVATE_PHOTO_ACCESS_DENIED/); assert.equal(reads, 0);
  const legacyUrl = `${origin}/api/v1/compliance/identity-verifications/${item.identity.id}/document`; assert.equal((await fetch(legacyUrl, { headers: { Cookie: compliance.cookie } })).status, 410);
  assert.equal(JSON.stringify(await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: item.upload.id } })), before);
  assert.equal((await db.identityVerification.findUniqueOrThrow({ where: { id: item.identity.id } })).documentPhotoCiphertext, "UNCHANGED_SYNTHETIC_LEGACY");
  const unblocked = await fixture(customer, admin, false); await assert.rejects(() => controls.review(admin.session.id, unblocked.upload.id, { ...input, idempotencyKey: randomUUID() }), /PHOTO_QUARANTINE_DENIED/);
  // Synthetic immutable history fixture verifies actual pagination, not a mocked response.
  const paged = await fixture(customer, admin), pageQuarantine = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: paged.upload.id } });
  for (let sequence = 1; sequence <= 51; sequence++) await db.privatePhotoQuarantineReview.create({ data: { quarantineId: pageQuarantine.id, actorId: admin.user.id, idempotencyKey: randomUUID(), sequence, decision: "KEEP_BLOCKED", caseReference: `OPS-FIXTURE-${sequence}` } });
  const page1 = await controls.history(admin.session.id, paged.upload.id, {}), page2 = await controls.history(admin.session.id, paged.upload.id, { page: 2 }); assert.equal(page1.items.length, 50); assert(page1.hasMore); assert.equal(page2.items.length, 1); assert(!page2.hasMore); assert.equal(page2.items[0].sequence, 1);
  const { chromium, expect } = await import("@playwright/test"); const browser = await chromium.launch({ headless: true });
  try {
    for (const [label, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      const ui = await fixture(customer, admin), context = await browser.newContext({ viewport: { width, height } });
      await context.addCookies([{ name: "crossly_session", value: admin.token, url: origin }]);
      const page = await context.newPage(); await page.goto(`${origin}/admin/private-photos?state=quarantined`); const panel = page.locator("#admin-main-content"); await panel.waitFor({ state: "visible" });
      const card = panel.locator("article").filter({ hasText: ui.upload.id }); await card.getByText("Record quarantine review", { exact: true }).click();
      await card.getByLabel("Review decision", { exact: true }).selectOption("REPLACEMENT_REQUIRED"); await card.getByLabel("Incident reference", { exact: true }).fill("OPS-2026-001"); await card.getByRole("checkbox").check();
      let interrupted = false;
      if (label === "desktop") await page.route("**/api/v1/admin/private-photos/*/quarantine/reviews", async route => { if (!interrupted) { interrupted = true; await route.fetch(); await route.abort(); } else await route.continue(); });
      await page.screenshot({ path: `/tmp/deshdak-photo-review-${label}-form-20261107.png` });
      await card.getByRole("button", { name: "Record review", exact: true }).click();
      if (label === "desktop") { await card.getByRole("alert").waitFor(); assert(await card.getByLabel("Review decision", { exact: true }).isDisabled()); await card.getByRole("button", { name: "Record review", exact: true }).click(); }
      await expect(card.locator("p").filter({ hasText: "Latest review:" })).toContainText("#1"); await page.waitForLoadState("networkidle", { timeout: 15000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} queue overflowed`);
      await card.getByRole("link", { name: "View review history" }).click(); await page.locator("#admin-main-content").getByRole("heading", { name: "Quarantine review history" }).waitFor();
      await expect(page.locator("#admin-main-content")).toContainText("OPS-2026-001"); await page.waitForLoadState("networkidle", { timeout: 15000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} history overflowed`);
      // The Admin pane scrolls smoothly; network idle does not mean its scroll has settled.
      // Keep the unobscured-heading assertion, polling the real layout instead of sleeping.
      await expect.poll(() => page.evaluate(() => {
        const heading = document.querySelector("#admin-main-content h1"), toolbar = document.querySelector(".admin-workspace-toolbar");
        return Boolean(heading && toolbar && heading.getBoundingClientRect().top >= toolbar.getBoundingClientRect().bottom - 1);
      }), { message: `${label} history heading was covered by the Admin toolbar` }).toBe(true);
      await page.screenshot({ path: `/tmp/deshdak-photo-review-${label}-history-20261107.png` });
      const uiBlock = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: ui.upload.id } }); assert.equal(await db.privatePhotoQuarantineReview.count({ where: { quarantineId: uiBlock.id } }), 1);
      await context.close();
    }
  } finally { await browser.close(); }
  await db.authSession.update({ where: { id: admin.session.id }, data: { revokedAt: new Date() } }); await assert.rejects(() => controls.review(admin.session.id, item.upload.id, { ...input, expectedSequence: 2, idempotencyKey: randomUUID() }), /PHOTO_QUARANTINE_DENIED/);
  console.log("Private photo reviews passed: protected API/history, MFA/CSRF/strict bounds, optimistic review sequencing, concurrent conflict and idempotent replay, immutable database history, audit rollback, real pagination, desktop/mobile forms and lost-response retry. Review decisions preserved quarantine and evidence; storage was never contacted. Permanent synthetic fixtures are removed by dropping the generated disposable schema.");
} finally { await db.$disconnect(); }
