import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { verifyPrivateVideoPreview } from "./lib/private-video-preview-acceptance.mjs";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid"), origin = process.env.TEST_BASE_URL;
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "") || !origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Video evidence tests require an isolated local database and test server.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) {
  let text = (await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const dependency of ["zod", "@aws-sdk/client-s3"]) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(dependency)).href)}`);
  for (const [dependency, url] of Object.entries(replacements)) text = text.replace(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;
}
const photos = await source("modules/private-storage/photos"), artifacts = await source("modules/private-storage/video-artifacts", { "./photos": photos });
const jobsUrl = await source("modules/private-storage/video-jobs", { "./video-artifacts": artifacts });
const provenance = await source("modules/private-storage/video-provenance", { "./video-artifacts": artifacts });
const account = await source("modules/auth/account-mutation");
const authorization = await source("modules/private-storage/video-authorization", { "@/modules/auth/account-mutation": account });
const { createPrivateVideoArtifactStore } = await import(artifacts);
const { createPrivateVideoJobs } = await import(jobsUrl);
const { createPrivateInspectionVideoProcessor } = await import(await source("modules/private-storage/video-processing"));
const { createPrivateVideoIntake } = await import(await source("modules/private-storage/video-intake", { "./video-jobs": jobsUrl, "./video-provenance": provenance, "./video-authorization": authorization }));
const { createPrivateVideoEvidence } = await import(await source("modules/private-storage/video-evidence", { "./video-artifacts": artifacts, "./video-provenance": provenance, "./video-authorization": authorization }));
const db = new PrismaClient(), marker = randomBytes(8).toString("hex"), users = [], parcels = [], orders = [], warehouses = [];
const objects = new Map(), readKeys = []; let reads = 0, onRead = null;
const config = { bucket: "deshdak-private-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
const store = createPrivateVideoArtifactStore({ config, keys: { original: randomBytes(32), video: randomBytes(32), poster: randomBytes(32) }, client: { send: async command => {
  const data = command.input, kind = command.constructor.name;
  if (kind === "PutObjectCommand") { assert(!objects.has(data.Key)); objects.set(data.Key, { bytes: Buffer.from(data.Body), checksum: data.ChecksumSHA256, version: `synthetic-${objects.size + 1}` }); }
  const value = objects.get(data.Key); if (!value) throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");
  const metadata = { VersionId: value.version, ContentLength: value.bytes.length, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: value.checksum };
  if (kind === "GetObjectCommand") { reads++; readKeys.push(data.Key); if (onRead) { const action = onRead; onRead = null; await action(); } return { ...metadata, Body: Readable.from([value.bytes]) }; }
  return metadata;
} } });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const raw = Buffer.alloc(40); raw.writeUInt32BE(24); raw.write("ftypisom", 4);
const video = Buffer.from(raw); video[39] = 1; const poster = Buffer.from([255, 216, 255, 0, 255, 217]);
const processor = createPrivateInspectionVideoProcessor({ url: "https://video-processor.example.test/process", token: randomBytes(32).toString("hex") }, async (_url, options) => {
  const artifact = (bytes, mimeType) => ({ bytesBase64: bytes.toString("base64"), sha256: sha(bytes), mimeType });
  return Response.json({ profile: "inspection-video-v1", originalSha256: sha(Buffer.from(options.body)), durationMs: 1000, width: 320, height: 240, audio: true, video: artifact(video, "video/mp4"), poster: artifact(poster, "image/jpeg") });
});
const intake = createPrivateVideoIntake(db, store, processor), binding = createPrivateVideoEvidence(db, store);
const safeFailure = error => { assert.equal(error.message, "PRIVATE_VIDEO_BINDING_UNAVAILABLE"); return true; };
async function actor(label, roleCode, portal) {
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await db.user.create({ data: { email: `video-binding-${label}-${marker}@example.test`, fullName: "Synthetic video binding", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: role.id } } } }); users.push(user.id);
  const session = await db.authSession.create({ data: { userId: user.id, portal, expiresAt: new Date(Date.now() + 3600000), clientType: "WEB" } });
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [roleCode] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return { user, session, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
try {
  const owner = await actor("owner", "customer_personal", "customer"), staff = await actor("staff", "inspector", "inspector"), other = await actor("other", "customer_personal", "customer");
  const warehouse = await db.warehouse.create({ data: { name: `Video binding ${marker}`, country: "CN", type: "ORIGIN" } }); warehouses.push(warehouse.id);
  const assignment = await db.warehouseStaffAssignment.create({ data: { userId: staff.user.id, warehouseId: warehouse.id, assignedById: staff.user.id } });
  const order = await db.order.create({ data: { customerId: owner.user.id, orderNumber: `VBIND-${marker}`, grandTotal: 0, status: "WAREHOUSE_RECEIVED" } }); orders.push(order.id);
  const parcel = await db.package.create({ data: { orderId: order.id, warehouseId: warehouse.id, status: "RECEIVED", packageCode: `VBIND-${marker.toUpperCase()}` } }); parcels.push(parcel.id);
  async function submitted(label) { return intake.submit({ actorId: staff.user.id, sessionId: staff.session.id, packageId: parcel.id, requestKey: `video-binding-${marker}-${label}`, file: new File([raw], "PRIVATE_WAREHOUSE_FILENAME.mp4", { type: "video/mp4" }) }); }
  const first = await submitted("first");
  const input = { actorId: staff.user.id, sessionId: staff.session.id, jobId: first.jobId };
  assert.equal(await db.privateVideoProcessingProof.count({ where: { jobId: first.jobId } }), 1);
  const linked = await binding.bind(input); assert.equal(linked.state, "STAGED"); assert.equal(linked.replayed, false);
  assert.equal((await binding.bind(input)).evidenceId, linked.evidenceId);
  assert.equal(await db.auditLog.count({ where: { entityId: first.jobId, action: "private_video.evidence_staged" } }), 1);
  const saved = await db.inspectionEvidence.findUniqueOrThrow({ where: { id: linked.evidenceId } });
  assert.equal(saved.sha256, sha(video)); assert.equal(saved.ciphertext, null); assert.equal(saved.originalName, null);
  await assert.rejects(() => db.inspectionEvidence.create({ data: { packageId: parcel.id, uploadedById: staff.user.id, mediaKind: "VIDEO", mimeType: "video/mp4", sizeBytes: video.length, sha256: sha(video) } }), /complete staged binding/);
  await assert.rejects(() => db.privateVideoEvidenceLink.delete({ where: { jobId: first.jobId } }), /complete staged binding/);
  await assert.rejects(() => db.privateVideoEvidenceLink.update({ where: { jobId: first.jobId }, data: { status: "ACTIVE" } }));
  assert.equal(await db.privateVideoEvidenceLink.count({ where: { jobId: first.jobId } }), 1);
  const deniedReads = reads;
  await assert.rejects(() => binding.bind({ ...input, actorId: other.user.id, sessionId: other.session.id }), safeFailure); assert.equal(reads, deniedReads);
  await assert.rejects(() => binding.bind({ ...input, sessionId: owner.session.id }), safeFailure);
  await assert.rejects(() => createPrivateVideoEvidence(db, { namespace: "f".repeat(64), read: store.read }).bind(input), safeFailure);

  const second = await submitted("second"), next = { ...input, jobId: second.jobId };
  const proof = await db.privateVideoProcessingProof.findUniqueOrThrow({ where: { jobId: second.jobId } });
  for (const patch of [{ manifestSha256: "0".repeat(64) }, { verifiedAt: new Date(Date.now() + 60000) }, { verifiedAt: new Date(0) }]) {
    await db.privateVideoProcessingProof.update({ where: { id: proof.id }, data: patch });
    await assert.rejects(() => binding.bind(next), safeFailure);
    await db.privateVideoProcessingProof.update({ where: { id: proof.id }, data: { manifestSha256: proof.manifestSha256, verifiedAt: proof.verifiedAt } });
  }
  const candidate = await db.privateVideoArtifact.findUniqueOrThrow({ where: { jobId_role: { jobId: second.jobId, role: "video" } } });
  await db.privateVideoArtifact.update({ where: { id: candidate.id }, data: { storedReference: { ...candidate.storedReference, versionId: "wrong-version" } } });
  await assert.rejects(() => binding.bind(next), safeFailure);
  await db.privateVideoArtifact.update({ where: { id: candidate.id }, data: { storedReference: candidate.storedReference } });
  onRead = () => db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
  await assert.rejects(() => binding.bind(next), safeFailure);
  assert.equal(await db.inspectionEvidence.count({ where: { packageId: parcel.id } }), 1);
  await db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: true } });
  const concurrent = await Promise.all([binding.bind(next), binding.bind(next)]);
  assert.equal(concurrent[0].evidenceId, concurrent[1].evidenceId); assert.equal(concurrent.filter(item => !item.replayed).length, 1);

  // A raw storage ledger entry cannot acquire scan provenance or evidence approval.
  const ledger = createPrivateVideoJobs(db, store);
  const rawJob = await ledger.stage({ actorId: staff.user.id, packageId: parcel.id, idempotencyKey: `unproven-video-${marker}`, original: raw, video, poster, profile: { profile: "inspection-video-v1", originalSha256: sha(raw), durationMs: 1000, width: 320, height: 240, audio: true } });
  await ledger.run(rawJob.jobId); await assert.rejects(() => binding.bind({ ...input, jobId: rawJob.jobId }), safeFailure);

  // Existing HTTP paths must never fall through to legacy video delivery/use.
  const list = await fetch(`${origin}/api/v1/operations/packages/${parcel.id}/inspection-evidence`, { headers: { Cookie: staff.cookie } }); assert.equal(list.status, 200);
  const listed = await list.json(); assert(listed.data.evidence.filter(row => [linked.evidenceId, concurrent[0].evidenceId].includes(row.id)).every(row => row.availableForInspection === false));
  assert(!JSON.stringify(listed).includes("privateVideoLink"));
  for (const account of [staff, owner]) {
    const download = await fetch(`${origin}/api/v1/operations/inspection-evidence/${linked.evidenceId}`, { headers: { Cookie: account.cookie } });
    assert.equal(download.status, 409); assert.equal((await download.json()).error.code, "VIDEO_EVIDENCE_NOT_READY");
  }
  assert.equal((await fetch(`${origin}/api/v1/operations/inspection-evidence/${linked.evidenceId}`, { headers: { Cookie: other.cookie } })).status, 403);
  for (const type of ["VIDEO", "BASIC"]) {
    const inspect = await fetch(`${origin}/api/v1/operations/packages/${parcel.id}/inspect`, { method: "POST", headers: { Cookie: staff.cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": `staged-video-${marker}-${type}` }, body: JSON.stringify({ type, result: "PASSED", mediaReference: `inspection-evidence/${linked.evidenceId}` }) });
    assert.equal(inspect.status, 409); assert.equal((await inspect.json()).error.code, "EVIDENCE_UNDER_REVIEW");
  }
  assert.equal((await db.package.findUniqueOrThrow({ where: { id: parcel.id } })).status, "RECEIVED");
  assert.equal(await db.inspection.count({ where: { packageId: parcel.id } }), 0);
  const page = await fetch(`${origin}/orders/${order.id}`, { headers: { Cookie: owner.cookie } }); assert.equal(page.status, 200); const html = await page.text(); assert(!html.includes(linked.evidenceId)); assert(!html.includes(concurrent[0].evidenceId));
  await verifyPrivateVideoPreview({ db, store, source, artifacts, provenance, account, staff, owner, other, actor, parcel, order, warehouse, assignment, jobId: first.jobId, evidenceId: linked.evidenceId, video, poster, objects, readKeys, setOnRead: callback => { onRead = callback; } });
  console.log("Private video evidence passed: atomic processor provenance and staged binding, exact-version verification, missing/tampered/future proof denial, actor/session/namespace guards, revocation during storage reads, concurrent idempotency, raw unproven job rejection, real HTTP list/download/inspection rejection and customer-page exclusion. Actual PostgreSQL; media/processor/S3 were simulated. Publication, playback and production remain disabled.");
} finally {
  onRead = null; store.close();
  const ids = (await db.privateVideoJob.findMany({ where: { actorId: { in: users } }, select: { id: true } })).map(row => row.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityType: "PrivateVideoJob", entityId: { in: ids } }, { entityType: "Package", entityId: { in: parcels } }] } });
  await db.$transaction(async tx => {
    await tx.privateVideoEvidenceLink.deleteMany({ where: { jobId: { in: ids } } });
    await tx.inspectionEvidence.deleteMany({ where: { packageId: { in: parcels } } });
  });
  await db.privateVideoProcessingProof.deleteMany({ where: { jobId: { in: ids } } }); await db.privateVideoArtifact.deleteMany({ where: { jobId: { in: ids } } }); await db.privateVideoJob.deleteMany({ where: { id: { in: ids } } });
  await db.inspectionEvidence.deleteMany({ where: { packageId: { in: parcels } } }); await db.package.deleteMany({ where: { id: { in: parcels } } }); await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.warehouseStaffAssignment.deleteMany({ where: { userId: { in: users } } }); await db.warehouse.deleteMany({ where: { id: { in: warehouses } } }); await db.authSession.deleteMany({ where: { userId: { in: users } } }); await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
}
