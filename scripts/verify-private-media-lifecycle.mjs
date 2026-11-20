import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Media lifecycle verification requires a generated disposable local schema.");
const origin = process.env.TEST_BASE_URL; if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local test server is required.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
 let code = (await readFile(new URL(file, import.meta.url), "utf8")).replace('import "server-only";', "").replace('from "zod"', `from ${JSON.stringify(pathToFileURL(require.resolve("zod")).href)}`);
 for (const [name, value] of Object.entries(replacements)) code = code.replace(`from "${name}"`, `from ${JSON.stringify(value)}`);
 return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
}
const quarantine = await source("../src/modules/private-storage/quarantine.ts");
const { createMediaLifecycle, activePrivateMediaHolds, lockPrivateMediaLifecycle } = await import(await source("../src/modules/private-storage/lifecycle.ts", { "./quarantine": quarantine }));
const db = new PrismaClient(), marker = randomBytes(8).toString("hex"), controls = createMediaLifecycle(db);
const contract = JSON.parse(await readFile(new URL("../public/openapi.yaml", import.meta.url), "utf8"));
for (const [method, path] of [["get", "/admin/private-media"], ["post", "/admin/private-media/policy"], ["post", "/admin/private-media/holds"], ["post", "/admin/private-media/holds/{holdId}/release"]]) {
 const operation = contract.paths[path][method]; assert.deepEqual(operation.security, [{ cookieSession: [] }]);
 if (method === "post") assert(operation.parameters.some(p => p.$ref === "#/components/parameters/IdempotencyKey"));
}

async function actor(label, codes, mfa = true) {
 const roles = await db.role.findMany({ where: { code: { in: codes } } }); assert.equal(roles.length, codes.length);
 const user = await db.user.create({ data: { email: `lifecycle-${label}-${marker}@example.test`, fullName: "Synthetic lifecycle actor", status: "ACTIVE", passwordHash: "unused", roles: { create: roles.map(role => ({ roleId: role.id })) } } });
 const session = await db.authSession.create({ data: { userId: user.id, portal: codes.includes("admin") ? "admin" : "customer", mfaVerifiedAt: mfa ? new Date() : null, expiresAt: new Date(Date.now() + 3_600_000), clientType: "WEB", clientName: "Synthetic lifecycle" } });
 const token = await new SignJWT({ email: user.email, name: user.fullName, roles: codes }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
 return { user, session, token, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
const root = `${origin}/api/v1/admin/private-media`;
async function post(actor, path, body, key = randomUUID(), extra = {}) { return fetch(`${root}/${path}`, { method: "POST", headers: { Cookie: actor.cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) }); }
try {
 const admin = await actor("operator", ["admin"]), author = await actor("author", ["admin", "compliance"]), reviewer = await actor("reviewer", ["admin", "compliance"]), noMfa = await actor("no-mfa", ["admin"], false), customer = await actor("customer", ["customer_personal"]);
 for (const who of [noMfa, customer]) assert.equal((await fetch(root, { headers: { Cookie: who.cookie } })).status, 403);
 assert.equal((await fetch(root)).status, 403);
 await assert.rejects(() => controls.overview(noMfa.session.id, {}), /MEDIA_LIFECYCLE_DENIED/);
 const policy = { expectedSequence: 0, identityDays: 90, inspectionDays: 180, abandonedHours: 24, caseReference: "KYC-2026-001", confirmed: true }, policyKey = randomUUID();
 assert.equal((await post(admin, "policy", policy)).status, 403);
 assert.equal((await post(author, "policy", policy, randomUUID(), { Origin: "https://untrusted.invalid" })).status, 403);
 assert.equal((await post(author, "policy", policy, "")).status, 422);
 assert.equal((await post(author, "policy", { ...policy, idempotencyKey: randomUUID() })).status, 422);
 assert.equal((await post(author, "policy", { ...policy, identityDays: 0 })).status, 422);
 assert.equal((await post(author, "policy", " ".repeat(4097))).status, 422);
 const pair = await Promise.all([post(author, "policy", policy, policyKey), post(author, "policy", policy, policyKey)]); assert.deepEqual(pair.map(r => r.status), [200, 200]);
 assert.equal(await db.privateMediaPolicy.count(), 1); assert.equal(await db.auditLog.count({ where: { actorId: author.user.id, action: "private_media.policy_recorded" } }), 1);
 assert.equal((await post(author, "policy", { ...policy, identityDays: 91 }, policyKey)).status, 409);
 assert.equal((await post(reviewer, "policy", policy)).status, 409);
 const race = await Promise.all([post(author, "policy", { ...policy, expectedSequence: 1 }), post(reviewer, "policy", { ...policy, expectedSequence: 1 })]); assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
 const firstPolicy = await db.privateMediaPolicy.findFirstOrThrow({ orderBy: { sequence: "asc" } });
 await assert.rejects(() => db.privateMediaPolicy.update({ where: { id: firstPolicy.id }, data: { identityDays: 1 } }));
 await assert.rejects(() => db.privateMediaPolicy.create({ data: { ...policy, expectedSequence: undefined, confirmed: undefined, sequence: 99, actorId: author.user.id, idempotencyKey: randomUUID() } }));
 const holdInput = { scope: "ACCOUNT", targetId: customer.user.id, caseReference: "SEC-2026-001", confirmed: true }, holdKey = randomUUID();
 const held = await post(author, "holds", holdInput, holdKey); assert.equal(held.status, 200); const holdId = (await held.json()).data.id;
 assert.equal((await post(author, "holds", holdInput, holdKey)).status, 200);
 assert.equal((await post(author, "holds", { ...holdInput, caseReference: "SEC-2026-002" }, holdKey)).status, 409);
 assert.equal((await post(admin, "holds", { ...holdInput, targetId: randomUUID() })).status, 403);
 const release = { caseReference: "SEC-2026-003", confirmed: true }, releaseKey = randomUUID();
 assert.equal((await post(author, `holds/${holdId}/release`, release)).status, 403);
 assert.equal((await post(admin, `holds/${holdId}/release`, release)).status, 403);
 await assert.rejects(() => db.privateMediaHoldRelease.create({ data: { holdId, actorId: author.user.id, caseReference: release.caseReference, idempotencyKey: randomUUID() } }));
 await assert.rejects(() => db.privateMediaHoldRelease.create({ data: { holdId, actorId: admin.user.id, caseReference: release.caseReference, idempotencyKey: randomUUID() } }));
 const upload = async (purpose, actorId) => db.privatePhotoUpload.create({ data: { purpose, actorId, idempotencyKey: randomUUID(), fingerprint: "a".repeat(64), storageNamespace: "b".repeat(64), preparedReference: {}, status: "STORED", storedReference: { plaintextSha256: "a".repeat(64), mimeType: "image/png", sizeBytes: 20 }, originalScanSha256: "a".repeat(64), originalScanVerifiedAt: new Date(), scanVerifiedSha256: "a".repeat(64), scanVerifiedAt: new Date(), createdAt: new Date(Date.now() - 1000) } });
 const photo = await upload("identity", customer.user.id);
 const blockers = id => db.$transaction(async tx => { await lockPrivateMediaLifecycle(tx); return activePrivateMediaHolds(tx, id); });
 assert((await blockers(photo.id)).some(h => h.id === holdId), "Account hold must cover a photo added later");
 const order = await db.order.create({ data: { orderNumber: `ORD-${randomBytes(12).toString("hex").toUpperCase()}`, customerId: customer.user.id, grandTotal: 0 } });
 const parcel = await db.package.create({ data: { orderId: order.id, packageCode: `PKG-${marker.toUpperCase()}`, status: "RECEIVED" } });
 const inspection = await upload("inspection", admin.user.id);
 const evidence = await db.inspectionEvidence.create({ data: { packageId: parcel.id, uploadedById: admin.user.id, mediaKind: "PHOTO", mimeType: "image/png", sizeBytes: 20, sha256: "a".repeat(64) } });
 await db.privatePhotoLink.create({ data: { uploadId: inspection.id, inspectionEvidenceId: evidence.id, linkedById: admin.user.id } });
 const scoped = [];
 for (const [scope, targetId] of [["ORDER", order.id], ["PACKAGE", parcel.id], ["UPLOAD", inspection.id]]) { const r = await post(admin, "holds", { ...holdInput, scope, targetId }); assert.equal(r.status, 200); scoped.push((await r.json()).data.id); }
 const matched = await blockers(inspection.id); assert(scoped.every(id => matched.some(h => h.id === id))); assert(matched.some(h => h.id === holdId));
 const released = await Promise.all([post(reviewer, `holds/${holdId}/release`, release, releaseKey), post(reviewer, `holds/${holdId}/release`, release, releaseKey)]); assert.deepEqual(released.map(r => r.status), [200, 200]);
 assert.equal((await blockers(photo.id)).length, 0); assert.equal((await blockers(inspection.id)).length, 3);
 assert.equal((await post(reviewer, `holds/${holdId}/release`, release)).status, 409);
 await assert.rejects(() => db.privateMediaHold.delete({ where: { id: holdId } }));
 const releasedRow = await db.privateMediaHoldRelease.findUniqueOrThrow({ where: { holdId } });
 await assert.rejects(() => db.privateMediaHoldRelease.update({ where: { id: releasedRow.id }, data: { caseReference: "SEC-CHANGED-001" } }));
 await assert.rejects(() => db.privateMediaHold.create({ data: { actorId: admin.user.id, uploadId: photo.id, accountId: customer.user.id, caseReference: "SEC-INVALID-001", idempotencyKey: randomUUID() } }));
 // A success-audit failure must roll back the hold and report an unconfirmed result.
 await db.$executeRawUnsafe(`CREATE FUNCTION lifecycle_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" IN ('private_media.hold_placed','private_media.policy_recorded','private_media.hold_released') THEN RAISE EXCEPTION 'Synthetic media audit failure'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER lifecycle_test_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION lifecycle_test_audit_failure()`);
 const before = await db.privateMediaHold.count();
 try {
  assert.equal((await post(admin, "holds", holdInput)).status, 503); assert.equal(await db.privateMediaHold.count(), before);
  assert.equal((await post(author, "policy", { ...policy, expectedSequence: 2 })).status, 503); assert.equal(await db.privateMediaPolicy.count(), 2);
  assert.equal((await post(author, `holds/${scoped[0]}/release`, release)).status, 503); assert.equal(await db.privateMediaHoldRelease.count({ where: { holdId: scoped[0] } }), 0);
 }
 finally { await db.$executeRawUnsafe('DROP TRIGGER lifecycle_test_audit_failure ON "AuditLog"'); await db.$executeRawUnsafe('DROP FUNCTION lifecycle_test_audit_failure()'); }
 const complianceRole = await db.role.findUniqueOrThrow({ where: { code: "compliance" } });
 let unlock, entered; const wait = new Promise(r => { unlock = r; }), locked = new Promise(r => { entered = r; });
 const revoke = db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${reviewer.user.id} FOR UPDATE`; entered(); await wait; await tx.userRole.delete({ where: { userId_roleId: { userId: reviewer.user.id, roleId: complianceRole.id } } }); });
 await locked; const changing = controls.savePolicy(reviewer.session.id, { ...policy, expectedSequence: 2, idempotencyKey: randomUUID() }); unlock(); await revoke; await assert.rejects(() => changing, /MEDIA_LIFECYCLE_DENIED/); assert.equal(await db.privateMediaPolicy.count(), 2);
 await db.userRole.create({ data: { userId: reviewer.user.id, roleId: complianceRole.id } });
 for (let i = 3; i <= 22; i++) await controls.savePolicy(author.session.id, { ...policy, expectedSequence: i - 1, idempotencyKey: randomUUID() });
 for (let i = 0; i < 51; i++) await controls.placeHold(admin.session.id, { ...holdInput, idempotencyKey: randomUUID() });
 const page1 = await controls.overview(author.session.id, {}), page2 = await controls.overview(author.session.id, { page: 2, policyPage: 2 });
 assert.equal(page1.deletionEnabled, false); assert(page1.hasMore && page1.policyHasMore); assert.equal(page1.holds.length, 50); assert.equal(page1.policies.length, 20); assert(page2.holds.length > 0 && page2.policies.length === 2); assert(!page1.holds.some(h => page2.holds.some(k => k.id === h.id)));
 const redacted = JSON.stringify(page1); for (const forbidden of ["idempotencyKey", "storageNamespace", "storedReference", customer.user.email, "passwordHash", "ciphertext"]) assert(!redacted.includes(forbidden));
 const response = await fetch(root, { headers: { Cookie: author.cookie } }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
 const { chromium } = await import("@playwright/test"); const browser = await chromium.launch({ headless: true });
 try { for (const [label, width] of [["desktop", 1440], ["mobile", 390]]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } }); await context.addCookies([{ name: "crossly_session", value: admin.token, url: origin }]);
  const page = await context.newPage(); await page.goto(`${origin}/admin/private-media`); const panel = page.locator('#admin-main-content'); await panel.getByRole('heading', { name: 'Retention policy and legal holds' }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflow`);
  const form = panel.locator('form').filter({ has: page.getByRole('button', { name: 'Place hold', exact: true }) });
  await form.getByLabel('Preserve media for').selectOption('ACCOUNT'); await form.getByLabel('Record reference', { exact: true }).fill(customer.user.id); await form.getByLabel('Controlled case reference').fill('SEC-UI-2026'); await form.getByRole('checkbox').check();
  let interrupted = false; if (label === 'desktop') await page.route('**/api/v1/admin/private-media/holds', async route => { if (!interrupted) { interrupted = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  const count = await db.privateMediaHold.count(); await form.getByRole('button', { name: 'Place hold', exact: true }).click();
  if (label === 'desktop') { await form.getByRole('alert').waitFor(); await form.getByRole('button', { name: 'Place hold', exact: true }).click(); }
  await panel.getByRole('status').filter({ hasText: 'Recorded.' }).waitFor(); assert.equal(await db.privateMediaHold.count(), count + 1);
  await page.waitForLoadState('networkidle'); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `/tmp/deshdak-media-lifecycle-${label}-20261120.png`, fullPage: false });
  await context.close();
  const reviewerContext = await browser.newContext({ viewport: { width, height: 1000 } }); await reviewerContext.addCookies([{ name: "crossly_session", value: author.token, url: origin }]);
  const reviewPage = await reviewerContext.newPage(); const errors = []; reviewPage.on('pageerror', error => errors.push(error.message));
  await reviewPage.goto(`${origin}/admin/private-media`); const reviewPanel = reviewPage.locator('#admin-main-content');
  await reviewPage.screenshot({ path: `/tmp/deshdak-media-lifecycle-review-${label}-20261120.png`, fullPage: false });
  const latest = await db.privateMediaPolicy.findFirstOrThrow({ orderBy: { sequence: 'desc' } });
  const policyForm = reviewPanel.locator('form').filter({ has: reviewPage.getByRole('button', { name: 'Record policy version', exact: true }) });
  await policyForm.getByLabel('Identity photos: days after final review').fill('91'); await policyForm.getByLabel('Controlled case reference').fill('KYC-UI-2026'); await policyForm.getByRole('checkbox').check(); await policyForm.getByRole('button', { name: 'Record policy version', exact: true }).click();
  await reviewPanel.getByText(`Latest recorded version: ${latest.sequence + 1}`, { exact: true }).waitFor();
  const uiHold = await db.privateMediaHold.findFirstOrThrow({ where: { actorId: admin.user.id, caseReference: 'SEC-UI-2026', release: null }, orderBy: { createdAt: 'desc' } });
  const card = reviewPanel.locator('article').filter({ hasText: uiHold.id }); await card.locator('summary').click(); const releaseForm = card.locator('form');
  await releaseForm.getByLabel('Controlled case reference').fill('SEC-UI-RELEASE'); await releaseForm.getByRole('checkbox').check(); await releaseForm.getByRole('button', { name: 'Release this hold', exact: true }).click();
  await card.waitFor({ state: 'detached' }); await reviewPage.waitForLoadState('networkidle');
  assert(await db.privateMediaHoldRelease.findUnique({ where: { holdId: uiHold.id } })); assert.deepEqual(errors, []);
  assert(await reviewPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} review overflow`);
  await reviewerContext.close();
 } } finally { await browser.close(); }
 console.log("Private media lifecycle passed: fresh Admin/MFA/Compliance authority, immutable/versioned policies, scoped holds including future linked media, independent release, concurrency/replay/conflict, database constraints, role loss, audit rollback, pagination/redaction, desktop/mobile policy, hold and release forms, lost-response retry and authenticated/idempotent API contracts. Deletion stayed disabled; no storage/provider was contacted.");
} finally { await db.$disconnect(); }
