import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash, createCipheriv } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import sharp from "sharp";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Quarantine tests require a generated disposable local schema.");
const origin = process.env.TEST_BASE_URL; if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local test server is required.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
  let code = (await readFile(new URL(file, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const name of ["zod", "@aws-sdk/client-s3"]) code = code.replace(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
  for (const [name, value] of Object.entries(replacements)) code = code.replace(`from "${name}"`, `from ${JSON.stringify(value)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
}
const photos = await source("../src/modules/private-storage/photos.ts");
const { createPrivatePhotoStore } = await import(photos);
const { createPrivatePhotoLinks } = await import(await source("../src/modules/private-storage/record-links.ts", { "./photos": photos }));
const { createPrivatePhotoDelivery } = await import(await source("../src/modules/private-storage/photo-delivery.ts", { "./photos": photos }));
const { createPrivateUploadLedger } = await import(await source("../src/modules/private-storage/upload-ledger.ts"));
const { createPhotoQuarantine, isPrivateRecordQuarantined } = await import(await source("../src/modules/private-storage/quarantine.ts"));
const db = new PrismaClient(), marker = randomBytes(8).toString("hex"), objects = new Map();
let puts = 0, gets = 0, onPut = null, onRead = null;
const config = { bucket: "private-quarantine-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
const store = createPrivatePhotoStore({ config, keys: { identity: randomBytes(32), inspection: randomBytes(32) }, client: { send: async command => {
  const data = command.input;
  if (command.constructor.name === "PutObjectCommand") {
    puts++; if (onPut) { const action = onPut; onPut = null; await action(); }
    const item = { bytes: Buffer.from(data.Body), version: `synthetic-${objects.size + 1}`, checksum: data.ChecksumSHA256 }; objects.set(data.Key, item);
    return { VersionId: item.version, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: item.checksum };
  }
  gets++; if (onRead) { const action = onRead; onRead = null; await action(); }
  const item = objects.get(data.Key);
  return { VersionId: item.version, ContentLength: item.bytes.length, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: item.checksum, Body: Readable.from([item.bytes]) };
} } });
const controls = createPhotoQuarantine(db), links = createPrivatePhotoLinks(db, store.namespace), delivery = createPrivatePhotoDelivery(db, store), ledger = createPrivateUploadLedger(db, store);
const image = await sharp({ create: { width: 6, height: 4, channels: 3, background: "#135f78" } }).png().toBuffer();
const sha = createHash("sha256").update(image).digest("hex");
async function actor(label, role, portal, mfa = false) {
  const assigned = await db.role.findUniqueOrThrow({ where: { code: role } });
  const user = await db.user.create({ data: { email: `quarantine-${label}-${marker}@example.test`, fullName: "Synthetic quarantine actor", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: assigned.id } } } });
  const session = await db.authSession.create({ data: { userId: user.id, portal, mfaVerifiedAt: mfa ? new Date() : null, expiresAt: new Date(Date.now() + 3_600_000), clientType: "WEB", clientName: "Synthetic quarantine" } });
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [role] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return { user, session, cookie: `crossly_session=${token}` };
}
function legacy(key) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv); return { ciphertext: Buffer.concat([cipher.update(image), cipher.final()]).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") }; }
async function reserve(actor, purpose) {
  const key = `quarantine:${randomBytes(12).toString("hex")}`;
  const result = await ledger.storePhoto({ actorId: actor.user.id, purpose, idempotencyKey: key, mimeType: "image/png", bytes: image }); assert.equal(result.state, "STORED");
  const row = await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: result.uploadId } });
  await db.privatePhotoUpload.update({ where: { id: row.id }, data: { originalScanSha256: sha, originalScanVerifiedAt: row.createdAt, scanVerifiedSha256: sha, scanVerifiedAt: new Date(row.createdAt.getTime() + 1) } });
  return { ...row, key };
}
async function document(actor) {
  const encrypted = legacy(process.env.KYC_DOCUMENT_ENCRYPTION_KEY);
  return db.identityVerification.create({ data: { userId: actor.user.id, documentType: "PASSPORT", issuingCountryCode: "BD", documentNumberLast4: "A123", documentPhotoSha256: sha, documentPhotoMimeType: "image/png", documentPhotoSizeBytes: image.length, documentPhotoCiphertext: encrypted.ciphertext, documentPhotoIv: encrypted.iv, documentPhotoTag: encrypted.tag } });
}
try {
  const admin = await actor("admin", "admin", "admin"), owner = await actor("owner", "customer_personal", "customer"), compliance = await actor("reviewer", "compliance", "compliance", true), inspector = await actor("inspector", "inspector", "inspector");
  const item = await reserve(owner, "identity"), identity = await document(owner);
  await links.link({ sessionId: owner.session.id, uploadId: item.id, kind: "identity", subjectId: identity.id });
  const queueUrl = `${origin}/api/v1/admin/private-photos`;
  assert.equal((await fetch(queueUrl, { headers: { Cookie: admin.cookie } })).status, 403);
  await assert.rejects(() => controls.block(admin.session.id, item.id, { reason: "PRIVACY_REVIEW", confirmed: true, idempotencyKey: randomUUID() }), /PHOTO_QUARANTINE_DENIED/);
  await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: new Date() } });
  assert.equal((await fetch(queueUrl, { headers: { Cookie: owner.cookie } })).status, 403);
  assert.equal((await fetch(`${queueUrl}?state=invalid`, { headers: { Cookie: admin.cookie } })).status, 422);
  const listed = await fetch(queueUrl, { headers: { Cookie: admin.cookie } }); assert.equal(listed.status, 200); assert.match(listed.headers.get("cache-control"), /no-store/);
  const listText = JSON.stringify(await listed.json()); for (const secret of ["private/v1/", "storedReference", "ciphertext", "actorId", "idempotencyKey", store.namespace, owner.user.email, sha]) assert(!listText.includes(secret));
  const page = await fetch(`${origin}/admin/private-photos`, { headers: { Cookie: admin.cookie } }); assert.equal(page.status, 200); const html = await page.text(); assert(html.includes("Review private photo uploads")); assert(html.includes(item.id)); assert(!html.includes("private/v1/"));
  const input = { reason: "PRIVACY_REVIEW", confirmed: true }, retry = randomUUID();
  async function block(headers = {}, body = JSON.stringify(input), cookie = admin.cookie) { return fetch(`${queueUrl}/${item.id}/quarantine`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": retry, ...headers }, body }); }
  assert.equal((await block({ Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await block({}, JSON.stringify({ ...input, confirmed: false }))).status, 422);
  assert.equal((await block({ "Idempotency-Key": "" })).status, 422);
  assert.equal((await block({}, " ".repeat(4097))).status, 422);
  const url = `${origin}/api/v1/compliance/identity-verifications/${identity.id}/document`;
  assert.equal((await fetch(url, { headers: { Cookie: compliance.cookie } })).status, 200);
  const [first, second] = await Promise.all([block(), block()]); assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal((await first.json()).data.quarantined, true); assert.equal(await db.privatePhotoQuarantine.count({ where: { uploadId: item.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { actorId: admin.user.id, action: "private_photo.quarantined" } }), 1);
  assert.equal((await block({ "Idempotency-Key": randomUUID() })).status, 409);
  assert.equal((await fetch(url, { headers: { Cookie: compliance.cookie } })).status, 410);
  assert(await isPrivateRecordQuarantined(db, "identity", identity.id));
  const beforeRead = gets; await assert.rejects(() => delivery.read({ sessionId: compliance.session.id, kind: "identity", subjectId: identity.id }), /PRIVATE_PHOTO_ACCESS_DENIED/); assert.equal(gets, beforeRead);
  const beforePut = puts; assert.equal((await ledger.storePhoto({ actorId: owner.user.id, purpose: "identity", idempotencyKey: item.key, mimeType: "image/png", bytes: image })).state, "REVIEW_REQUIRED"); assert.equal(puts, beforePut);
  await assert.rejects(() => db.privatePhotoLink.deleteMany({ where: { uploadId: item.id } }));
  const quarantine = await db.privatePhotoQuarantine.findUniqueOrThrow({ where: { uploadId: item.id } });
  await assert.rejects(() => db.privatePhotoQuarantine.update({ where: { id: quarantine.id }, data: { reason: "INTEGRITY_FAILURE" } }));
  await assert.rejects(() => db.privatePhotoQuarantine.delete({ where: { id: quarantine.id } }));
  const unlinked = await reserve(owner, "identity"), another = await document(owner);
  await controls.block(admin.session.id, unlinked.id, { reason: "SUSPECTED_MALWARE", confirmed: true, idempotencyKey: randomUUID() });
  await assert.rejects(() => links.link({ sessionId: owner.session.id, uploadId: unlinked.id, kind: "identity", subjectId: another.id }), /PRIVATE_PHOTO_BINDING_DENIED/);
  await assert.rejects(() => db.privatePhotoLink.create({ data: { uploadId: unlinked.id, identityVerificationId: another.id, linkedById: owner.user.id } }));
  // Quarantine committed while a PUT is in flight cannot be undone by its completion.
  const inFlightKey = `quarantine:inflight:${marker}`;
  onPut = async () => { const pending = await db.privatePhotoUpload.findUniqueOrThrow({ where: { actorId_idempotencyKey: { actorId: owner.user.id, idempotencyKey: inFlightKey } } }); await controls.block(admin.session.id, pending.id, { reason: "INTEGRITY_FAILURE", confirmed: true, idempotencyKey: randomUUID() }); };
  const inFlight = await ledger.storePhoto({ actorId: owner.user.id, purpose: "identity", idempotencyKey: inFlightKey, mimeType: "image/png", bytes: image }); assert.equal(inFlight.state, "REVIEW_REQUIRED");
  assert.notEqual((await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: inFlight.uploadId } })).status, "STORED");
  const writes = puts; assert.equal((await ledger.storePhoto({ actorId: owner.user.id, purpose: "identity", idempotencyKey: inFlightKey, mimeType: "image/png", bytes: image })).state, "REVIEW_REQUIRED"); assert.equal(puts, writes);
  const warehouse = await db.warehouse.create({ data: { name: `Quarantine warehouse ${marker}`, country: "CN", type: "ORIGIN" } });
  await db.warehouseStaffAssignment.create({ data: { userId: inspector.user.id, warehouseId: warehouse.id, assignedById: admin.user.id } });
  const order = await db.order.create({ data: { customerId: owner.user.id, orderNumber: `ORD-${randomBytes(12).toString("hex").toUpperCase()}`, status: "WAREHOUSE_RECEIVED", grandTotal: 0 } });
  const parcel = await db.package.create({ data: { orderId: order.id, warehouseId: warehouse.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "RECEIVED" } });
  const evidenceUpload = await reserve(inspector, "inspection"), encrypted = legacy(process.env.INSPECTION_EVIDENCE_ENCRYPTION_KEY);
  const evidence = await db.inspectionEvidence.create({ data: { packageId: parcel.id, uploadedById: inspector.user.id, mediaKind: "PHOTO", mimeType: "image/png", sizeBytes: image.length, sha256: sha, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.tag } });
  await links.link({ sessionId: inspector.session.id, uploadId: evidenceUpload.id, kind: "inspection", subjectId: evidence.id });
  const evidenceUrl = `${origin}/api/v1/operations/inspection-evidence/${evidence.id}`; assert.equal((await fetch(evidenceUrl, { headers: { Cookie: owner.cookie } })).status, 200);
  onRead = () => controls.block(admin.session.id, evidenceUpload.id, { reason: "PRIVACY_REVIEW", confirmed: true, idempotencyKey: randomUUID() });
  await assert.rejects(() => delivery.read({ sessionId: owner.session.id, kind: "inspection", subjectId: evidence.id }), /PRIVATE_PHOTO_ACCESS_DENIED/);
  assert.equal((await fetch(evidenceUrl, { headers: { Cookie: owner.cookie } })).status, 410);
  assert.equal((await db.identityVerification.findUniqueOrThrow({ where: { id: identity.id } })).documentPhotoCiphertext.length > 0, true);
  // Exercise the real client form on desktop and mobile, using synthetic records.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [label, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      const uiUpload = await reserve(owner, "identity");
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addCookies([{ name: "crossly_session", value: admin.cookie.slice("crossly_session=".length), url: origin }]);
      const page = await context.newPage(); await page.goto(`${origin}/admin/private-photos`);
      const panel = page.locator("#admin-main-content"); await panel.waitFor({ state: "visible" });
      await panel.getByRole("heading", { name: "Review private photo uploads" }).waitFor();
      const card = panel.locator("article").filter({ hasText: uiUpload.id });
      await card.locator("summary").click(); await card.getByLabel("Reason", { exact: true }).selectOption("PRIVACY_REVIEW");
      await card.getByRole("checkbox").check();
      let interrupted = false;
      if (label === "desktop") await page.route("**/api/v1/admin/private-photos/*/quarantine", async route => {
        if (!interrupted) { interrupted = true; await route.fetch(); await route.abort(); }
        else await route.continue();
      });
      await page.screenshot({ path: `/tmp/deshdak-quarantine-${label}-form-20261107.png`, fullPage: false });
      await card.getByRole("button", { name: "Confirm quarantine", exact: true }).click();
      if (label === "desktop") {
        await card.getByRole("alert").waitFor();
        assert(await card.getByLabel("Reason", { exact: true }).isDisabled());
        await card.getByRole("button", { name: "Confirm quarantine", exact: true }).click();
      }
      await card.getByText(/Quarantined/).first().waitFor();
      assert(await db.privatePhotoQuarantine.findUnique({ where: { uploadId: uiUpload.id } }));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} page has horizontal overflow`);
      await page.waitForLoadState("networkidle", { timeout: 15000 });
      await page.screenshot({ path: `/tmp/deshdak-quarantine-${label}-20261107.png`, fullPage: false });
      await context.close();
    }
  } finally { await browser.close(); }
  await db.authSession.update({ where: { id: admin.session.id }, data: { revokedAt: new Date() } }); await assert.rejects(() => controls.list(admin.session.id, {}), /PHOTO_QUARANTINE_DENIED/);
  console.log("Private photo quarantine passed: real protected Admin API/page, MFA/CSRF/validation, redacted queue, concurrent idempotency, immutable database blocks, blocked legacy/object reads and bindings, quarantine during read/PUT, recovery cannot release, preserved evidence and revoked-session rejection. PostgreSQL/encryption were real; S3 and scan proofs were simulated. Permanent fixture quarantines are removed only by dropping the generated disposable schema.");
} finally { await db.$disconnect(); }
