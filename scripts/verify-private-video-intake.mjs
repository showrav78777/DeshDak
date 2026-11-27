import assert from "node:assert/strict";
import { verifyPrivateVideoUploadQueue } from "./lib/private-video-upload-queue-acceptance.mjs";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Video intake requires a generated disposable local schema.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
  let text = (await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const dependency of ["zod", "@aws-sdk/client-s3"]) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(dependency)).href)}`);
  for (const [dependency, url] of Object.entries(replacements)) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;
}
const photo = await source("modules/private-storage/photos");
const artifacts = await source("modules/private-storage/video-artifacts", { "./photos": photo });
const jobsUrl = await source("modules/private-storage/video-jobs", { "./video-artifacts": artifacts });
const provenance = await source("modules/private-storage/video-provenance", { "./video-artifacts": artifacts });
const account = await source("modules/auth/account-mutation");
const authorization = await source("modules/private-storage/video-authorization", { "@/modules/auth/account-mutation": account });
const { createPrivateVideoArtifactStore } = await import(artifacts);
const { createPrivateInspectionVideoProcessor } = await import(await source("modules/private-storage/video-processing"));
const { createPrivateVideoIntake } = await import(await source("modules/private-storage/video-intake", { "./video-jobs": jobsUrl, "./video-authorization": authorization, "./video-provenance": provenance }));
const db = new PrismaClient(), marker = randomBytes(8).toString("hex"), users = [], orders = [], parcels = [], warehouses = [];
const objects = new Map(); let processCalls = 0, puts = 0, onProcess = null, onPut = null, mode = "normal";
const config = { bucket: "deshdak-private-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
const store = createPrivateVideoArtifactStore({ config, keys: { original: randomBytes(32), video: randomBytes(32), poster: randomBytes(32) }, client: { send: async command => {
  const data = command.input, kind = command.constructor.name;
  if (kind === "PutObjectCommand") {
    puts++; assert(!objects.has(data.Key)); objects.set(data.Key, { bytes: Buffer.from(data.Body), checksum: data.ChecksumSHA256, version: `synthetic-${puts}` });
    if (onPut) await onPut();
  }
  const value = objects.get(data.Key); if (!value) throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");
  const metadata = { VersionId: value.version, ContentLength: value.bytes.length, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: value.checksum };
  return kind === "GetObjectCommand" ? { ...metadata, Body: Readable.from([value.bytes]) } : metadata;
} } });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const raw = Buffer.alloc(40); raw.writeUInt32BE(24); raw.write("ftypisom", 4);
const normalized = Buffer.from(raw); normalized[39] = 1;
const poster = Buffer.from([255, 216, 255, 0, 255, 217]);
const processor = createPrivateInspectionVideoProcessor({ url: "https://video-processor.example.test/process", token: randomBytes(32).toString("hex") }, async (url, options) => {
  processCalls++; assert.equal(new URL(url).protocol, "https:"); assert.equal(options.headers["X-Deshdak-Video-Sha256"], sha(Buffer.from(options.body)));
  if (onProcess) await onProcess();
  if (mode === "offline") return new Response("PRIVATE_PROVIDER_DIAGNOSTIC", { status: 503 });
  const artifact = (bytes, mimeType) => ({ bytesBase64: bytes.toString("base64"), mimeType, sha256: mode === "tampered" ? "0".repeat(64) : sha(bytes) });
  return Response.json({ profile: "inspection-video-v1", originalSha256: sha(Buffer.from(options.body)), durationMs: 1000, width: 320, height: 240, audio: true, video: artifact(normalized, "video/mp4"), poster: artifact(poster, "image/jpeg") });
});
const intake = createPrivateVideoIntake(db, store, processor);
let actorId, parcelId, sessionId, assignmentId, inspectorRole;
async function submit(label, patch = {}) {
  return intake.submit({ actorId, packageId: parcelId, sessionId, requestKey: `video-intake-${marker}-${label}`, file: new File([raw], "PRIVATE_EMPLOYEE_FILENAME.mp4", { type: "video/mp4" }), ...patch });
}
const safeFailure = error => { assert.match(error.message, /^PRIVATE_VIDEO_INTAKE_(UNAVAILABLE|ACCESS_CHANGED|CONFLICT)$/); return true; };
try {
  inspectorRole = await db.role.upsert({ where: { code: "inspector" }, create: { code: "inspector", description: "Synthetic intake verification" }, update: {} });
  const actor = await db.user.create({ data: { email: `video-intake-${marker}@example.test`, fullName: "Synthetic video intake", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: inspectorRole.id } } } }); actorId = actor.id; users.push(actorId);
  const session = await db.authSession.create({ data: { userId: actorId, portal: "inspector", expiresAt: new Date(Date.now() + 3600000), clientType: "WEB" } }); sessionId = session.id;
  const warehouse = await db.warehouse.create({ data: { name: `Video ${marker}`, country: "CN", type: "ORIGIN" } }); warehouses.push(warehouse.id);
  const assignment = await db.warehouseStaffAssignment.create({ data: { userId: actorId, warehouseId: warehouse.id, assignedById: actorId } }); assignmentId = assignment.id;
  const order = await db.order.create({ data: { customerId: actorId, orderNumber: `VINT-${marker}`, grandTotal: 0, status: "WAREHOUSE_RECEIVED" } }); orders.push(order.id);
  const parcel = await db.package.create({ data: { orderId: order.id, warehouseId: warehouse.id, status: "RECEIVED", packageCode: `VINT-${marker.toUpperCase()}` } }); parcelId = parcel.id; parcels.push(parcelId);
  const first = await submit("good"); assert.equal(first.state, "STORED"); assert.equal(processCalls, 1); assert.equal(puts, 3);
  assert.deepEqual(await submit("good"), first); assert.equal(processCalls, 1); assert.equal(puts, 3);
  assert.deepEqual(Object.keys(first).sort(), ["jobId", "state"]);
  const changed = Buffer.from(raw); changed[39] = 4;
  await assert.rejects(() => submit("good", { file: new File([changed], "changed.mp4", { type: "video/mp4" }) }), safeFailure);
  for (const state of ["offline", "tampered"]) {
    mode = state; const before = await db.privateVideoJob.count({ where: { actorId } });
    await assert.rejects(() => submit(state), safeFailure);
    assert.equal(await db.privateVideoJob.count({ where: { actorId } }), before);
  } mode = "normal";
  const before = processCalls;
  await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: false } });
  await assert.rejects(() => submit("unassigned"), safeFailure); assert.equal(processCalls, before);
  await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: true } });
  await db.authSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(0) } });
  await assert.rejects(() => submit("expired"), safeFailure); assert.equal(processCalls, before);
  await db.authSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 3600000) } });

  for (const kind of ["session", "assignment", "role"]) {
    const count = await db.privateVideoJob.count({ where: { actorId } });
    onProcess = async () => {
      onProcess = null;
      if (kind === "session") await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      if (kind === "assignment") await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: false } });
      if (kind === "role") await db.userRole.delete({ where: { userId_roleId: { userId: actorId, roleId: inspectorRole.id } } });
    };
    await assert.rejects(() => submit(`revoked-${kind}`), safeFailure);
    assert.equal(await db.privateVideoJob.count({ where: { actorId } }), count);
    await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: null } });
    await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: true } });
    if (kind === "role") await db.userRole.create({ data: { userId: actorId, roleId: inspectorRole.id } });
  }
  onPut = async () => { onPut = null; await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: false } }); };
  await assert.rejects(() => submit("mid-write"), safeFailure);
  assert.equal(await db.privateVideoJob.count({ where: { actorId, status: "STORED" } }), 1);
  await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: true } });
  const processed = processCalls; assert.equal((await submit("mid-write")).state, "STORED"); assert.equal(processCalls, processed);

  await verifyPrivateVideoUploadQueue({ db, source, artifacts, provenance, authorization, jobsUrl, store, processor, raw, actorId, parcelId, sessionId, assignmentId, setOnProcess: value => { onProcess = value; }, setOnPut: value => { onPut = value; }, counters: () => ({ processCalls, puts }) });
  const workerRole = await db.role.upsert({ where: { code: "warehouse_worker" }, create: { code: "warehouse_worker", description: "Synthetic intake verification" }, update: {} });
  await db.userRole.create({ data: { userId: actorId, roleId: workerRole.id } });
  await db.authSession.update({ where: { id: sessionId }, data: { portal: "warehouse" } });
  assert.equal((await submit("warehouse-worker")).state, "STORED");
  const deniedBefore = processCalls;
  await assert.rejects(() => submit("foreign-actor", { actorId: randomUUID() }), safeFailure);
  await db.authSession.update({ where: { id: sessionId }, data: { portal: "customer" } });
  await assert.rejects(() => submit("wrong-portal"), safeFailure); assert.equal(processCalls, deniedBefore);

  const adminRole = await db.role.upsert({ where: { code: "admin" }, create: { code: "admin", description: "Synthetic intake verification" }, update: {} });
  await db.userRole.create({ data: { userId: actorId, roleId: adminRole.id } });
  await db.authSession.update({ where: { id: sessionId }, data: { portal: "admin", mfaVerifiedAt: null } });
  const adminBefore = processCalls;
  for (const date of [null, new Date(Date.now() - 16 * 60000), new Date(Date.now() + 60000)]) {
    await db.authSession.update({ where: { id: sessionId }, data: { mfaVerifiedAt: date } });
    await assert.rejects(() => submit("bad-admin"), safeFailure);
  } assert.equal(processCalls, adminBefore);
  await db.authSession.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
  assert.equal((await submit("admin")).state, "STORED");
  // Proof chronology must use the same database clock as session authorization.
  const SystemDate = globalThis.Date;
  globalThis.Date = class extends SystemDate {
    constructor(...args) { super(...(args.length ? args : [SystemDate.now() + 2000])); }
    static now() { return SystemDate.now() + 2000; }
  };
  try { assert.equal((await submit("clock-skew")).state, "STORED"); }
  finally { globalThis.Date = SystemDate; }
  const audits = await db.auditLog.findMany({ where: { actorId } });
  assert(audits.some(row => row.action === "private_video.intake_failed"));
  assert(!JSON.stringify(audits).includes("PRIVATE_EMPLOYEE_FILENAME")); assert(!JSON.stringify(audits).includes("PRIVATE_PROVIDER_DIAGNOSTIC"));
  assert.equal(await db.inspectionEvidence.count({ where: { packageId: parcelId } }), 0);
  console.log("Private video intake passed: actual strict HTTPS client and real disposable PostgreSQL storage jobs, processor-error/tamper rejection, idempotent replay without retranscoding, inspector assignment and admin fresh MFA, session/role/assignment revocation during processing/storage, recovery without resending media, opaque responses and redacted failures. Processor/cloud replies and bytes were synthetic; no HTTP upload route, evidence release or production activation.");
} finally {
  onProcess = null; onPut = null; store.close();
  const ids = (await db.privateVideoJob.findMany({ where: { actorId: { in: users } }, select: { id: true } })).map(row => row.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityType: "PrivateVideoJob", entityId: { in: ids } }, { entityType: "Package", entityId: { in: parcels } }] } });
  await db.privateVideoUpload.deleteMany({ where: { actorId: { in: users } } });
  await db.privateVideoProcessingProof.deleteMany({ where: { jobId: { in: ids } } });
  await db.privateVideoArtifact.deleteMany({ where: { jobId: { in: ids } } }); await db.privateVideoJob.deleteMany({ where: { id: { in: ids } } });
  await db.package.deleteMany({ where: { id: { in: parcels } } }); await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.warehouseStaffAssignment.deleteMany({ where: { userId: { in: users } } }); await db.warehouse.deleteMany({ where: { id: { in: warehouses } } });
  await db.authSession.deleteMany({ where: { userId: { in: users } } }); await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
}
