import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import sharp from "sharp";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Rescan verification requires a generated disposable local schema.");
if (process.env.PRIVATE_PHOTO_RESCAN_ENABLED === "true") throw new Error("Disable the live rescan runtime for isolated acceptance; provider calls must be simulated.");
const origin = process.env.TEST_BASE_URL; if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local test server is required.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
  let code = (await readFile(new URL(file, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const name of ["zod", "sharp", "@aws-sdk/client-s3"]) code = code.replace(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
  for (const [name, value] of Object.entries(replacements)) code = code.replace(`from "${name}"`, `from ${JSON.stringify(value)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
}
const photos = await source("../src/modules/private-storage/photos.ts"), quarantine = await source("../src/modules/private-storage/quarantine.ts"), processing = await source("../src/modules/private-storage/photo-processing.ts");
const { createPrivatePhotoStore } = await import(photos), { createPhotoQuarantine } = await import(quarantine);
const { createPrivatePhotoLinks } = await import(await source("../src/modules/private-storage/record-links.ts", { "./photos": photos }));
const { createPrivatePhotoRescanner } = await import(await source("../src/modules/private-storage/rescan.ts", { "./photos": photos, "./quarantine": quarantine, "./photo-processing": processing }));
const { createPrivatePhotoScanner } = await import(await source("../src/modules/private-storage/photo-scanner.ts"));
const db = new PrismaClient(), controls = createPhotoQuarantine(db), marker = randomBytes(8).toString("hex"), objects = new Map();
const config = { bucket: "deshdak-rescan-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
let reads = 0, scans = 0, failedRead = false, mode = "clean", beforeScan = null;
const store = createPrivatePhotoStore({ config, keys: { identity: randomBytes(32), inspection: randomBytes(32) }, client: { send: async command => {
  const input = command.input;
  if (command.constructor.name === "PutObjectCommand") { const object = { bytes: Buffer.from(input.Body), checksum: input.ChecksumSHA256, version: `synthetic-${objects.size + 1}` }; objects.set(input.Key, object); return { VersionId: object.version, ChecksumSHA256: object.checksum, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn }; }
  reads++; if (failedRead) throw new Error("PRIVATE_PROVIDER_DETAIL");
  const object = objects.get(input.Key); assert.equal(input.VersionId, object.version);
  return { VersionId: object.version, ContentLength: object.bytes.length, ContentType: "application/octet-stream", ChecksumSHA256: object.checksum, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, Body: Readable.from([object.bytes]) };
} } });
const scanner = createPrivatePhotoScanner({ url: "https://private-scanner.invalid/scan", token: randomBytes(32).toString("hex") }, async (_url, options) => {
  scans++; if (beforeScan) { const action = beforeScan; beforeScan = null; await action(); }
  const digest = createHash("sha256").update(options.body).digest("hex"); assert.equal(options.headers["X-Deshdak-Scan-Sha256"], digest);
  if (mode === "reject") return Response.json({ status: "infected" }, { status: 422 });
  if (mode === "digest") return Response.json({ status: "clean", sha256: "0".repeat(64) });
  return Response.json({ status: "clean", sha256: digest });
});
const rescanner = createPrivatePhotoRescanner(db, store, scanner), links = createPrivatePhotoLinks(db, store.namespace);
const image = await sharp({ create: { width: 9, height: 6, channels: 3, background: "#135f78" } }).png().toBuffer(), sha = createHash("sha256").update(image).digest("hex");
async function actor(label, role, portal, mfa = true) {
  const assigned = await db.role.findUniqueOrThrow({ where: { code: role } });
  const user = await db.user.create({ data: { email: `rescan-${label}-${marker}@example.test`, fullName: "Synthetic rescan employee", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: assigned.id } } } });
  const session = await db.authSession.create({ data: { userId: user.id, portal, mfaVerifiedAt: mfa ? new Date() : null, expiresAt: new Date(Date.now() + 3_600_000), clientType: "WEB", clientName: "Synthetic rescan" } });
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [role] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return { user, session, token, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
async function fixture(owner, admin, decision = "RESCAN_REQUIRED") {
  const prepared = store.prepare("identity", image, "image/png"), reference = await store.write(prepared);
  const row = await db.privatePhotoUpload.create({ data: { actorId: owner.user.id, purpose: "identity", idempotencyKey: `rescan:${randomBytes(12).toString("hex")}`, fingerprint: sha, storageNamespace: store.namespace, status: "STORED", preparedReference: prepared.reference, storedReference: reference } });
  await db.privatePhotoUpload.update({ where: { id: row.id }, data: { originalScanSha256: sha, originalScanVerifiedAt: row.createdAt, scanVerifiedSha256: sha, scanVerifiedAt: new Date(row.createdAt.getTime() + 1) } });
  const identity = await db.identityVerification.create({ data: { userId: owner.user.id, documentType: "PASSPORT", issuingCountryCode: "BD", documentNumberLast4: "A123", documentPhotoMimeType: "image/png", documentPhotoSizeBytes: image.length, documentPhotoSha256: sha, documentPhotoCiphertext: "UNCHANGED_LEGACY", documentPhotoIv: randomBytes(12).toString("base64"), documentPhotoTag: randomBytes(16).toString("base64") } });
  await links.link({ sessionId: owner.session.id, uploadId: row.id, kind: "identity", subjectId: identity.id });
  await controls.block(admin.session.id, row.id, { reason: "PRIVACY_REVIEW", confirmed: true, idempotencyKey: randomUUID() });
  await controls.review(admin.session.id, row.id, { decision, caseReference: "INC-2026-001", expectedSequence: 0, blockedConfirmed: true, idempotencyKey: randomUUID() });
  return { row, identity };
}
const input = () => ({ expectedSequence: 1, blockedConfirmed: true, idempotencyKey: randomUUID() });
try {
  const admin = await actor("admin", "admin", "admin"), pending = await actor("pending", "admin", "admin", false), customer = await actor("customer", "customer_personal", "customer"), compliance = await actor("compliance", "compliance", "compliance");
  const item = await fixture(customer, admin), request = input(), snapshot = JSON.stringify(await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: item.row.id } }));
  const deniedReads = reads; for (const user of [pending, customer]) await assert.rejects(() => rescanner.rescan(user.session.id, item.row.id, request), /PRIVATE_RESCAN_DENIED/); assert.equal(reads, deniedReads);
  let entered; const scanning = new Promise(resolve => { entered = resolve; }); let release; const blocked = new Promise(resolve => { release = resolve; });
  beforeScan = async () => { entered(); await blocked; };
  const first = rescanner.rescan(admin.session.id, item.row.id, request); await scanning;
  const atRead = reads, atScan = scans; const concurrent = await rescanner.rescan(admin.session.id, item.row.id, request); assert.equal(concurrent.state, "PENDING"); assert.equal(reads, atRead); assert.equal(scans, atScan);
  release(); const clean = await first; assert.equal(clean.state, "CLEAN"); assert.equal(clean.quarantined, true); assert.equal(clean.scope, "STORED_PHOTO");
  assert.equal((await rescanner.rescan(admin.session.id, item.row.id, request)).id, clean.id); assert.equal(reads, atRead); assert.equal(scans, atScan);
  const serialized = JSON.stringify(clean); for (const secret of ["private/v1/", "sha256", "storageNamespace", "referenceSnapshot", sha, store.namespace]) assert(!serialized.includes(secret));
  assert.equal(JSON.stringify(await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: item.row.id } })), snapshot);
  assert.equal(await db.auditLog.count({ where: { entityId: clean.id, action: "private_photo.rescan_completed" } }), 1);
  await assert.rejects(() => rescanner.rescan(admin.session.id, item.row.id, input()), /PRIVATE_RESCAN_CONFLICT/);
  await assert.rejects(() => db.privatePhotoRescan.update({ where: { id: clean.id }, data: { deadlineAt: new Date() } }));
  await assert.rejects(() => db.privatePhotoRescan.delete({ where: { id: clean.id } }));
  const result = await db.privatePhotoRescanResult.findUniqueOrThrow({ where: { rescanId: clean.id } });
  await assert.rejects(() => db.privatePhotoRescanResult.update({ where: { id: result.id }, data: { state: "UNCONFIRMED" } })); await assert.rejects(() => db.privatePhotoRescanResult.delete({ where: { id: result.id } }));
  for (const failure of ["reject", "digest", "storage", "corrupt"] ) {
    const test = await fixture(customer, admin), attempt = input(); mode = failure; failedRead = failure === "storage";
    const stored = await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: test.row.id } }); const object = objects.get(stored.storedReference.key);
    if (failure === "corrupt") object.bytes[0] ^= 1;
    const failed = await rescanner.rescan(admin.session.id, test.row.id, attempt); assert.equal(failed.state, "UNCONFIRMED"); assert.equal(failed.quarantined, true);
    assert.equal((await db.privatePhotoRescanResult.findUniqueOrThrow({ where: { rescanId: failed.id } })).sha256, null);
    const previousReads = reads; assert.equal((await rescanner.rescan(admin.session.id, test.row.id, attempt)).id, failed.id); assert.equal(reads, previousReads);
    if (failure === "corrupt") object.bytes[0] ^= 1; failedRead = false; mode = "clean";
  }
  const faultDb = (allCompletions = false) => ({ authSession: db.authSession, auditLog: db.auditLog, $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === "auditLog") return { create: args => { if (args.data.action === "private_photo.rescan_completed" && (allCompletions || args.data.metadata.state === "CLEAN")) throw new Error("Synthetic audit failure"); return tx.auditLog.create(args); } };
    return Reflect.get(target, property);
  } }))) });
  const auditCase = await fixture(customer, admin), auditRescanner = createPrivatePhotoRescanner(faultDb(), store, scanner);
  assert.equal((await auditRescanner.rescan(admin.session.id, auditCase.row.id, input())).state, "UNCONFIRMED");
  const interruptedCase = await fixture(customer, admin), interruptedInput = input();
  await assert.rejects(() => createPrivatePhotoRescanner(faultDb(true), store, scanner).rescan(admin.session.id, interruptedCase.row.id, interruptedInput), /PRIVATE_RESCAN_UNAVAILABLE/);
  const interruptedReads = reads; assert.equal((await rescanner.rescan(admin.session.id, interruptedCase.row.id, interruptedInput)).state, "PENDING"); assert.equal(reads, interruptedReads);
  const expiredCase = await fixture(customer, admin), expiredBlock = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: expiredCase.row.id } });
  const expiredReview = await db.privatePhotoQuarantineReview.findFirstOrThrow({ where: { quarantineId: expiredBlock.id }, orderBy: { sequence: "desc" } }), expiredInput = input();
  const expired = await db.privatePhotoRescan.create({ data: { actorId: admin.user.id, uploadId: expiredCase.row.id, quarantineId: expiredBlock.id, reviewId: expiredReview.id, idempotencyKey: expiredInput.idempotencyKey, storageNamespace: store.namespace, referenceSnapshot: expiredCase.row.storedReference, createdAt: new Date(Date.now() - 120000), deadlineAt: new Date(Date.now() - 60000) } });
  const expiredReads = reads; assert.equal((await rescanner.rescan(admin.session.id, expiredCase.row.id, expiredInput)).state, "EXPIRED"); assert.equal(reads, expiredReads);
  await assert.rejects(() => db.privatePhotoRescanResult.create({ data: { rescanId: expired.id, state: "CLEAN", sha256: sha, verifiedAt: new Date() } }));
  const foreign = await fixture(customer, admin), wrongNamespace = createPrivatePhotoRescanner(db, { namespace: randomBytes(32).toString("hex"), read: store.read }, scanner); const foreignReads = reads;
  await assert.rejects(() => wrongNamespace.rescan(admin.session.id, foreign.row.id, input()), /PRIVATE_RESCAN_DENIED/); assert.equal(reads, foreignReads);
  const wrongDecision = await fixture(customer, admin, "KEEP_BLOCKED"), beforeWrong = reads; await assert.rejects(() => rescanner.rescan(admin.session.id, wrongDecision.row.id, input()), /PRIVATE_RESCAN_CONFLICT/); assert.equal(reads, beforeWrong);
  const revoked = await fixture(customer, admin); beforeScan = () => db.authSession.update({ where: { id: admin.session.id }, data: { revokedAt: new Date() } });
  await assert.rejects(() => rescanner.rescan(admin.session.id, revoked.row.id, input()), /PRIVATE_RESCAN_DENIED/);
  assert.equal((await db.privatePhotoRescanResult.findFirstOrThrow({ where: { rescan: { uploadId: revoked.row.id } } })).state, "UNCONFIRMED"); await db.authSession.update({ where: { id: admin.session.id }, data: { revokedAt: null } });
  const changed = await fixture(customer, admin); beforeScan = () => controls.review(admin.session.id, changed.row.id, { decision: "KEEP_BLOCKED", expectedSequence: 1, caseReference: "INC-2026-002", blockedConfirmed: true, idempotencyKey: randomUUID() });
  assert.equal((await rescanner.rescan(admin.session.id, changed.row.id, input())).state, "UNCONFIRMED");
  const changedStorage = await fixture(customer, admin); beforeScan = () => db.privatePhotoUpload.update({ where: { id: changedStorage.row.id }, data: { status: "REVIEW_REQUIRED" } }); assert.equal((await rescanner.rescan(admin.session.id, changedStorage.row.id, input())).state, "UNCONFIRMED");
  const limited = await fixture(customer, admin); mode = "reject";
  for (let index = 1; index <= 5; index++) { if (index > 1) await controls.review(admin.session.id, limited.row.id, { decision: "RESCAN_REQUIRED", expectedSequence: index - 1, caseReference: "SEC-2026-001", blockedConfirmed: true, idempotencyKey: randomUUID() }); assert.equal((await rescanner.rescan(admin.session.id, limited.row.id, { ...input(), expectedSequence: index })).state, "UNCONFIRMED"); }
  await controls.review(admin.session.id, limited.row.id, { decision: "RESCAN_REQUIRED", expectedSequence: 5, caseReference: "SEC-2026-001", blockedConfirmed: true, idempotencyKey: randomUUID() }); await assert.rejects(() => rescanner.rescan(admin.session.id, limited.row.id, { ...input(), expectedSequence: 6 }), /PRIVATE_RESCAN_CONFLICT/); mode = "clean";
  const limitBlock = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: limited.row.id } }), limitReview = await db.privatePhotoQuarantineReview.findFirstOrThrow({ where: { quarantineId: limitBlock.id }, orderBy: { sequence: "desc" } });
  await assert.rejects(() => db.privatePhotoRescan.create({ data: { actorId: admin.user.id, uploadId: limited.row.id, quarantineId: limitBlock.id, reviewId: limitReview.id, idempotencyKey: randomUUID(), storageNamespace: store.namespace, referenceSnapshot: limited.row.storedReference, deadlineAt: new Date(Date.now() + 60000) } }));
  // The public handler must remain fail-closed without real private provider setup.
  const endpoint = `${origin}/api/v1/admin/private-photos/${item.row.id}/quarantine/rescans`;
  const call = (cookie, trusted = true, body = { expectedSequence: 1, blockedConfirmed: true }) => fetch(endpoint, { method: "POST", headers: { Cookie: cookie, Origin: trusted ? origin : "https://untrusted.invalid", "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
  assert.equal((await call(customer.cookie)).status, 403); assert.equal((await call(admin.cookie, false)).status, 403); assert.equal((await call(admin.cookie, true, { expectedSequence: 0, blockedConfirmed: false })).status, 422);
  const notConfigured = await call(admin.cookie); assert.equal(notConfigured.status, 503); assert.equal((await notConfigured.json()).error.code, "PRIVATE_RESCAN_SETUP_REQUIRED");
  const history = await controls.history(admin.session.id, item.row.id, {}); assert.equal(history.rescans[0].state, "CLEAN"); assert(!JSON.stringify(history.rescans).includes(sha));
  const legacy = await fetch(`${origin}/api/v1/compliance/identity-verifications/${item.identity.id}/document`, { headers: { Cookie: compliance.cookie } }); assert.equal(legacy.status, 410);
  const { chromium } = await import("@playwright/test"); const browser = await chromium.launch({ headless: true });
  try {
    for (const [label, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } }); await context.addCookies([{ name: "crossly_session", value: admin.token, url: origin }]);
      const page = await context.newPage(); await page.goto(`${origin}/admin/private-photos/${item.row.id}`); const panel = page.locator("#admin-main-content"); await panel.waitFor({ state: "visible" });
      await panel.getByText("Private rescan setup is required.", { exact: false }).waitFor(); assert.equal(await panel.getByRole("button", { name: "Scan stored copy", exact: true }).count(), 0);
      await page.waitForLoadState("networkidle", { timeout: 15000 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: `/tmp/deshdak-rescan-${label}-20261107.png` }); await context.close();
    }
  } finally { await browser.close(); }
  const audit = JSON.stringify(await db.auditLog.findMany({ where: { action: { startsWith: "private_photo.rescan_" } } })); for (const secret of ["private/v1/", "PRIVATE_PROVIDER_DETAIL", "referenceSnapshot", sha, store.namespace]) assert(!audit.includes(secret));
  console.log("Private rescans passed: durable requests/results, one provider attempt per review/key, concurrent pending replay, exact-version encrypted read and digest-bound scan, rejected infection/digest/storage/corruption, fresh authority/review fencing, limits and immutable audit history. Quarantine/evidence stayed unchanged. PostgreSQL/encryption were real; S3/scanner responses were simulated. HTTP setup denial and desktop/mobile setup/history UI passed; configured live HTTP/provider acceptance remains staging work.");
} finally { store.close(); await db.$disconnect(); }
