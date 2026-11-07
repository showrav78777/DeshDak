import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Private delivery verification requires a generated disposable local schema.");
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
const db = new PrismaClient(), users = [], warehouses = [], orders = [], packages = [];
const marker = randomBytes(8).toString("hex"), objects = new Map();
const config = { bucket: "deshdak-private-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
let gets = 0, duringRead = null, storageFailure = false;
const store = createPrivatePhotoStore({ config, keys: { identity: randomBytes(32), inspection: randomBytes(32) }, client: { send: async command => {
  const input = command.input;
  if (command.constructor.name === "PutObjectCommand") {
    const value = { bytes: Buffer.from(input.Body), checksum: input.ChecksumSHA256, version: `synthetic-${objects.size + 1}` };
    objects.set(input.Key, value);
    return { VersionId: value.version, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: value.checksum };
  }
  gets++;
  if (duringRead) { const mutation = duringRead; duringRead = null; await mutation(); }
  if (storageFailure) throw new Error("SECRET_PROVIDER_DIAGNOSTIC");
  const value = objects.get(input.Key);
  assert.equal(input.VersionId, value.version);
  return { VersionId: value.version, ContentLength: value.bytes.length, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: value.checksum, Body: Readable.from([value.bytes]) };
} } });
const links = createPrivatePhotoLinks(db, store.namespace), delivery = createPrivatePhotoDelivery(db, store);
const image = await sharp({ create: { width: 5, height: 7, channels: 3, background: "#135f78" } }).png().toBuffer();
const sha = createHash("sha256").update(image).digest("hex");
const denied = error => error.message === "PRIVATE_PHOTO_ACCESS_DENIED";
const unavailable = error => error.message === "PRIVATE_PHOTO_UNAVAILABLE";
async function actor(label, role, portal) {
  const assigned = await db.role.findUniqueOrThrow({ where: { code: role } });
  const user = await db.user.create({ data: { email: `delivery-${label}-${marker}@example.test`, fullName: "Synthetic private delivery actor", status: "ACTIVE", passwordHash: "not-used", roles: { create: { roleId: assigned.id } } } }); users.push(user.id);
  const session = await db.authSession.create({ data: { userId: user.id, portal, expiresAt: new Date(Date.now() + 3_600_000), clientType: "WEB", clientName: "Synthetic private delivery" } });
  return { user, session, role: assigned };
}
async function upload(actor, kind) {
  const prepared = store.prepare(kind, image, "image/png"), reference = await store.write(prepared);
  const row = await db.privatePhotoUpload.create({ data: { actorId: actor.user.id, purpose: kind, idempotencyKey: `delivery:${randomBytes(12).toString("hex")}`, fingerprint: randomBytes(32).toString("hex"), storageNamespace: store.namespace, status: "STORED", preparedReference: prepared.reference, storedReference: reference } });
  await db.privatePhotoUpload.update({ where: { id: row.id }, data: { originalScanSha256: sha, originalScanVerifiedAt: row.createdAt, scanVerifiedSha256: sha, scanVerifiedAt: new Date(row.createdAt.getTime() + 1) } });
  return row;
}
async function expectDenied(input) { const before = gets; await assert.rejects(() => delivery.read(input), denied); assert.equal(gets, before, "Unauthorized request contacted storage"); }
try {
  const customer = await actor("owner", "customer_personal", "customer"), other = await actor("other", "customer_personal", "customer"), compliance = await actor("reviewer", "compliance", "compliance"), inspector = await actor("inspector", "inspector", "inspector"), warehouse = await actor("warehouse", "warehouse_worker", "warehouse"), admin = await actor("admin", "admin", "admin");
  for (const name of ["A", "B"]) { const row = await db.warehouse.create({ data: { name: `Delivery ${name} ${marker}`, country: "CN", type: "ORIGIN" } }); warehouses.push(row.id); }
  const assignment = await db.warehouseStaffAssignment.create({ data: { userId: inspector.user.id, warehouseId: warehouses[0], assignedById: admin.user.id } });
  await db.warehouseStaffAssignment.create({ data: { userId: warehouse.user.id, warehouseId: warehouses[0], assignedById: admin.user.id } });
  const order = await db.order.create({ data: { customerId: customer.user.id, orderNumber: `ORD-${randomBytes(12).toString("hex").toUpperCase()}`, status: "WAREHOUSE_RECEIVED", grandTotal: 0 } }); orders.push(order.id);
  const parcel = await db.package.create({ data: { orderId: order.id, warehouseId: warehouses[0], packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "RECEIVED" } }); packages.push(parcel.id);
  const identityUpload = await upload(customer, "identity");
  const identity = await db.identityVerification.create({ data: { userId: customer.user.id, documentType: "PASSPORT", issuingCountryCode: "BD", documentNumberLast4: "A123", documentPhotoSha256: sha, documentPhotoMimeType: "image/png", documentPhotoSizeBytes: image.length, documentPhotoCiphertext: "LEGACY_DO_NOT_FALL_BACK" } });
  await links.link({ sessionId: customer.session.id, uploadId: identityUpload.id, kind: "identity", subjectId: identity.id });
  const documentRead = { sessionId: compliance.session.id, kind: "identity", subjectId: identity.id };
  const document = await delivery.read(documentRead); assert(document.bytes.equals(image)); assert.equal(document.mimeType, "image/png"); assert.deepEqual(Object.keys(document).sort(), ["bytes", "mimeType"]);
  for (const actor of [customer, other, inspector, admin]) await expectDenied({ ...documentRead, sessionId: actor.session.id });
  await expectDenied({ ...documentRead, subjectId: randomUUID() });
  const evidenceUpload = await upload(inspector, "inspection");
  const evidence = await db.inspectionEvidence.create({ data: { packageId: parcel.id, uploadedById: inspector.user.id, mediaKind: "PHOTO", mimeType: "image/png", sizeBytes: image.length, sha256: sha, ciphertext: "LEGACY_DO_NOT_FALL_BACK", iv: "unused", authTag: "unused" } });
  await links.link({ sessionId: inspector.session.id, uploadId: evidenceUpload.id, kind: "inspection", subjectId: evidence.id });
  const photoRead = { sessionId: customer.session.id, kind: "inspection", subjectId: evidence.id };
  for (const actor of [customer, inspector, warehouse]) assert((await delivery.read({ ...photoRead, sessionId: actor.session.id })).bytes.equals(image));
  await expectDenied({ ...photoRead, sessionId: other.session.id }); await expectDenied({ ...photoRead, sessionId: compliance.session.id }); await expectDenied({ ...photoRead, sessionId: admin.session.id });
  await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: new Date() } }); assert((await delivery.read({ ...photoRead, sessionId: admin.session.id })).bytes.equals(image));
  await db.package.update({ where: { id: parcel.id }, data: { warehouseId: warehouses[1] } }); await expectDenied({ ...photoRead, sessionId: inspector.session.id }); await db.package.update({ where: { id: parcel.id }, data: { warehouseId: warehouses[0] } });
  await db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { status: "REVIEW_REQUIRED" } }); await expectDenied(photoRead); await db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { status: "STORED" } });
  await db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { originalScanSha256: null, originalScanVerifiedAt: null } }); await expectDenied(photoRead); await db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { originalScanSha256: sha, originalScanVerifiedAt: evidenceUpload.createdAt } });
  const wrongStore = createPrivatePhotoDelivery(db, { namespace: randomBytes(32).toString("hex"), read: store.read }); const beforeNamespace = gets; await assert.rejects(() => wrongStore.read(photoRead), denied); assert.equal(gets, beforeNamespace);
  for (const [input, mutate, restore] of [
    [documentRead, () => db.authSession.update({ where: { id: compliance.session.id }, data: { revokedAt: new Date() } }), () => db.authSession.update({ where: { id: compliance.session.id }, data: { revokedAt: null } })],
    [documentRead, () => db.userRole.deleteMany({ where: { userId: compliance.user.id, roleId: compliance.role.id } }), () => db.userRole.create({ data: { userId: compliance.user.id, roleId: compliance.role.id } })],
    [{ ...photoRead, sessionId: inspector.session.id }, () => db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: false } }), () => db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: true } })],
    [photoRead, () => db.order.update({ where: { id: order.id }, data: { customerId: other.user.id } }), () => db.order.update({ where: { id: order.id }, data: { customerId: customer.user.id } })],
    [photoRead, () => db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { status: "REVIEW_REQUIRED" } }), () => db.privatePhotoUpload.update({ where: { id: evidenceUpload.id }, data: { status: "STORED" } })],
  ]) {
    const viewed = await db.auditLog.count({ where: { action: "private_photo.viewed", actorId: { in: users } } });
    duringRead = mutate; await assert.rejects(() => delivery.read(input), denied); await restore();
    assert.equal(await db.auditLog.count({ where: { action: "private_photo.viewed", actorId: { in: users } } }), viewed);
  }
  const auditFailureDb = {
    authSession: db.authSession, auditLog: db.auditLog,
    $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, { get(target, property) {
      if (property === "auditLog") return { create: async () => { throw new Error("Synthetic audit write failure"); } };
      return Reflect.get(target, property);
    } }))),
  };
  const auditFailingDelivery = createPrivatePhotoDelivery(auditFailureDb, store);
  await assert.rejects(() => auditFailingDelivery.read(photoRead), unavailable);
  await db.authSession.update({ where: { id: customer.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); await expectDenied(photoRead);
  await db.authSession.update({ where: { id: customer.session.id }, data: { expiresAt: new Date(Date.now() + 3_600_000), portal: "support" } }); await expectDenied(photoRead);
  await db.authSession.update({ where: { id: customer.session.id }, data: { portal: "customer" } });
  storageFailure = true; await assert.rejects(() => delivery.read(photoRead), unavailable); storageFailure = false;
  const stored = await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: evidenceUpload.id } }); const object = objects.get(stored.storedReference.key); object.bytes[0] ^= 1; await assert.rejects(() => delivery.read(photoRead), unavailable); object.bytes[0] ^= 1;
  const brokenReader = createPrivatePhotoDelivery(db, { namespace: store.namespace, read: async () => Buffer.from("incorrect bytes") }); await assert.rejects(() => brokenReader.read(photoRead), unavailable);
  await db.user.update({ where: { id: customer.user.id }, data: { status: "SUSPENDED" } }); await expectDenied(photoRead);
  const audit = JSON.stringify(await db.auditLog.findMany({ where: { action: { in: ["private_photo.viewed", "private_photo.view_blocked"] } } }));
  for (const secret of ["private/v1/", "storedReference", "SECRET_PROVIDER_DIAGNOSTIC", "LEGACY_DO_NOT_FALL_BACK", store.namespace, sha]) assert(!audit.includes(secret));
  assert.equal((await db.identityVerification.findUniqueOrThrow({ where: { id: identity.id } })).documentPhotoCiphertext, "LEGACY_DO_NOT_FALL_BACK");
  console.log("Private photo delivery passed: current Compliance/customer/staff/MFA boundaries, exact-version decryption, namespace/scan guards, denial before storage, in-flight session/role/assignment/ownership/status changes, storage corruption/failure, audit-write failure, expired/wrong-portal sessions, redacted audit and unchanged legacy evidence. PostgreSQL and encryption were real; S3 and scan proofs were simulated. No HTTP download route was activated.");
} finally {
  if (users.length) {
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.privatePhotoLink.deleteMany({ where: { linkedById: { in: users } } }); await db.privatePhotoUpload.deleteMany({ where: { actorId: { in: users } } });
    await db.identityVerification.deleteMany({ where: { userId: { in: users } } }); await db.inspectionEvidence.deleteMany({ where: { uploadedById: { in: users } } }); await db.warehouseStaffAssignment.deleteMany({ where: { userId: { in: users } } });
  }
  if (packages.length) await db.package.deleteMany({ where: { id: { in: packages } } }); if (orders.length) await db.order.deleteMany({ where: { id: { in: orders } } }); if (warehouses.length) await db.warehouse.deleteMany({ where: { id: { in: warehouses } } });
  if (users.length) { await db.authSession.deleteMany({ where: { userId: { in: users } } }); await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); }
  await db.$disconnect();
}
