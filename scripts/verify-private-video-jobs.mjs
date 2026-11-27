import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Video jobs require a generated disposable local schema.");
const require = createRequire(import.meta.url);
async function source(name, replacements = {}) {
  let text = (await readFile(new URL(`../src/modules/private-storage/${name}.ts`, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const dependency of ["zod", "@aws-sdk/client-s3"]) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(dependency)).href)}`);
  for (const [dependency, url] of Object.entries(replacements)) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;
}
const photo = await source("photos"), artifacts = await source("video-artifacts", { "./photos": photo });
const { createPrivateVideoArtifactStore } = await import(artifacts);
const { createPrivateVideoJobs } = await import(await source("video-jobs", { "./video-artifacts": artifacts }));
const db = new PrismaClient(), marker = randomBytes(8).toString("hex"), jobIds = [], users = [], parcels = [], orders = [];
const objects = new Map(); let puts = 0, mode = "normal", onPut = null;
const config = { bucket: "deshdak-private-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
const store = createPrivateVideoArtifactStore({ config, keys: { original: randomBytes(32), video: randomBytes(32), poster: randomBytes(32) }, client: { send: async command => {
  const data = command.input, kind = command.constructor.name;
  assert.notEqual(kind, "DeleteObjectCommand");
  if (kind === "PutObjectCommand") {
    puts++; assert(!objects.has(data.Key), "An uncertain PUT was repeated");
    if (mode !== "missing") objects.set(data.Key, { bytes: Buffer.from(data.Body), checksum: data.ChecksumSHA256, version: `synthetic-${puts}` });
    if (onPut) await onPut(data);
    if (mode === "lost" || mode === "missing") throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");
  }
  const object = objects.get(data.Key); if (!object) throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");
  const metadata = { VersionId: object.version, ContentLength: object.bytes.length, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: object.checksum };
  if (kind === "PutObjectCommand") return metadata;
  if (kind === "HeadObjectCommand") return metadata;
  assert.equal(kind, "GetObjectCommand"); assert.equal(data.VersionId, object.version);
  return { ...metadata, Body: Readable.from([object.bytes]) };
} } });
const jobs = createPrivateVideoJobs(db, store);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let input;
async function stage(label, patch = {}) {
  const result = await jobs.stage({ ...input, idempotencyKey: `video-job-${marker}-${label}`, ...patch });
  if (!jobIds.includes(result.jobId)) jobIds.push(result.jobId);
  return result.jobId;
}
try {
  const actor = await db.user.create({ data: { email: `video-jobs-${marker}@example.test`, fullName: "Synthetic video jobs", status: "ACTIVE", passwordHash: "unused" } }); users.push(actor.id);
  const order = await db.order.create({ data: { customerId: actor.id, orderNumber: `VIDEO-${marker}`, grandTotal: 0, status: "WAREHOUSE_RECEIVED" } }); orders.push(order.id);
  const parcel = await db.package.create({ data: { orderId: order.id, status: "RECEIVED", packageCode: `VIDEO-${marker.toUpperCase()}` } }); parcels.push(parcel.id);
  const original = Buffer.from("SYNTHETIC_ORIGINAL_VIDEO"), video = Buffer.from("SYNTHETIC_NORMALIZED_VIDEO"), poster = Buffer.from("SYNTHETIC_POSTER");
  input = { actorId: actor.id, packageId: parcel.id, original, video, poster, profile: { profile: "inspection-video-v1", originalSha256: sha(original), durationMs: 1000, width: 320, height: 240, audio: true } };
  const good = await stage("good"), before = puts;
  assert.equal(await stage("good"), good);
  assert.equal((await jobs.run(good)).state, "STORED"); assert.equal(puts, before + 3);
  assert.equal((await jobs.run(good)).state, "STORED"); assert.equal(puts, before + 3);
  const rows = await db.privateVideoArtifact.findMany({ where: { jobId: good } });
  assert.equal(rows.length, 3); assert(rows.every(row => row.status === "STORED" && row.encryptedBody === null));
  assert.equal(await db.auditLog.count({ where: { entityId: good, action: "private_video.bundle_stored" } }), 1);
  await assert.rejects(() => stage("good", { video: Buffer.from("DIFFERENT") }), error => error.message === "PRIVATE_VIDEO_JOB_CONFLICT");
  await assert.rejects(() => stage("digest", { profile: { ...input.profile, originalSha256: "0".repeat(64) } }));

  // Each role can lose its acknowledgement. Recovery confirms that exact object
  // and does not repeat PUT for any previously attempted role.
  for (const role of ["original", "video", "poster"]) {
    const id = await stage(`lost-${role}`); let failed = false;
    onPut = data => { if (!failed && data.Key.includes(`/${role}/`)) { failed = true; throw new Error("Lost acknowledgement"); } };
    assert.equal((await jobs.run(id)).state, "REVIEW_REQUIRED");
    assert.equal((await db.privateVideoJob.findUniqueOrThrow({ where: { id } })).status, "REVIEW_REQUIRED");
    onPut = null; assert.equal((await jobs.run(id)).state, "STORED");
  }
  // A missing uncertain write stays in review; it is never silently reuploaded.
  const missing = await stage("missing"); mode = "missing";
  assert.equal((await jobs.run(missing)).state, "REVIEW_REQUIRED"); const missingPuts = puts; mode = "normal";
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await jobs.run(missing)).state, "REVIEW_REQUIRED");
  assert.equal(puts, missingPuts); assert.equal((await db.privateVideoJob.findUniqueOrThrow({ where: { id: missing } })).attempts, 5);

  // An in-flight worker owns the lease; concurrent work must report BUSY.
  const concurrent = await stage("concurrent"); let release, entered;
  const started = new Promise(resolve => { entered = resolve; }); const paused = new Promise(resolve => { release = resolve; });
  onPut = async () => { entered(); await paused; };
  const running = jobs.run(concurrent); await started;
  assert.equal((await jobs.run(concurrent)).state, "BUSY"); release(); onPut = null;
  assert.equal((await running).state, "STORED");

  // Simulate a process dying after its journaled write, before commit.
  const crashed = await stage("crashed"); const candidate = await db.privateVideoArtifact.findUniqueOrThrow({ where: { jobId_role: { jobId: crashed, role: "original" } } });
  await db.privateVideoArtifact.update({ where: { id: candidate.id }, data: { status: "WRITING" } });
  await store.write({ reference: candidate.preparedReference, encryptedBody: Buffer.from(candidate.encryptedBody) });
  await db.privateVideoJob.update({ where: { id: crashed }, data: { status: "PROCESSING", attempts: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(0) } });
  const crashedPuts = puts; assert.equal((await jobs.run(crashed)).state, "STORED"); assert.equal(puts, crashedPuts + 2);

  const expired = await stage("expired"); onPut = async () => { await db.privateVideoJob.update({ where: { id: expired }, data: { leaseExpiresAt: new Date(0) } }); onPut = null; };
  assert.equal((await jobs.run(expired)).state, "REVIEW_REQUIRED");
  assert.notEqual((await db.privateVideoArtifact.findUniqueOrThrow({ where: { jobId_role: { jobId: expired, role: "original" } } })).status, "STORED");
  assert.equal((await jobs.run(expired)).state, "STORED");

  const replaced = await stage("replaced"), replacementToken = randomUUID();
  onPut = async () => {
    onPut = null;
    await db.privateVideoJob.update({ where: { id: replaced }, data: { leaseToken: replacementToken, leaseExpiresAt: new Date(Date.now() + 300_000) } });
  };
  assert.equal((await jobs.run(replaced)).state, "BUSY");
  const replacement = await db.privateVideoJob.findUniqueOrThrow({ where: { id: replaced } });
  assert.equal(replacement.leaseToken, replacementToken); assert.equal(replacement.status, "PROCESSING");
  assert.equal((await jobs.run(replaced)).state, "BUSY");
  await db.privateVideoJob.update({ where: { id: replaced }, data: { leaseExpiresAt: new Date(0) } });
  assert.equal((await jobs.run(replaced)).state, "STORED");

  const revoked = await stage("revoked"); onPut = async () => { onPut = null; await db.user.update({ where: { id: actor.id }, data: { status: "SUSPENDED" } }); };
  assert.equal((await jobs.run(revoked)).state, "REVIEW_REQUIRED");
  await assert.rejects(() => jobs.run(revoked), error => error.message === "PRIVATE_VIDEO_JOB_UNAVAILABLE");
  await db.user.update({ where: { id: actor.id }, data: { status: "ACTIVE" } });
  assert.equal((await jobs.run(revoked)).state, "STORED");
  await db.package.update({ where: { id: parcel.id }, data: { isOutboundActive: false } });
  await assert.rejects(() => stage("inactive-package"));
  await db.package.update({ where: { id: parcel.id }, data: { isOutboundActive: true } });
  const audit = await db.auditLog.findMany({ where: { entityType: "PrivateVideoJob", entityId: { in: jobIds } } });
  assert(!JSON.stringify(audit).includes("private/inspection-video/"));
  assert(!JSON.stringify(audit).includes("PRIVATE_PROVIDER_DIAGNOSTIC"));
  assert.equal(await db.inspectionEvidence.count({ where: { packageId: parcel.id } }), 0);
  console.log("Private video jobs passed: real disposable PostgreSQL, three-object encrypted staging, atomic bundle completion, per-role lost-ack recovery without duplicate PUT, missing-object review and attempt cap, concurrent leases, expired/crashed-worker recovery, account/package revocation and redacted audits. S3 responses and media were synthetic; no evidence binding, delivery or production activation.");
} finally {
  onPut = null; store.close();
  await db.auditLog.deleteMany({ where: { entityType: "PrivateVideoJob", entityId: { in: jobIds } } });
  await db.privateVideoArtifact.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.privateVideoJob.deleteMany({ where: { id: { in: jobIds } } });
  await db.package.deleteMany({ where: { id: { in: parcels } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
