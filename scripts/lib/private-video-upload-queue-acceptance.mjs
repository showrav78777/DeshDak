import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

export async function verifyPrivateVideoUploadQueue(ctx) {
  const { db, source, artifacts, provenance, authorization, jobsUrl, store, processor, raw, actorId, parcelId, sessionId, assignmentId, setOnProcess, setOnPut, counters } = ctx;
  const intakeUrl = await source("modules/private-storage/video-intake", { "./video-jobs": jobsUrl, "./video-authorization": authorization, "./video-provenance": provenance });
  const { createPrivateVideoUploadQueue } = await import(await source("modules/private-storage/video-upload-queue", { "./video-authorization": authorization, "./video-intake": intakeUrl, "./video-artifacts": artifacts }));
  const key = randomBytes(32), make = () => createPrivateVideoUploadQueue(db, store, processor, key), queue = make();
  const input = label => ({ actorId, sessionId, packageId: parcelId, requestKey: `video-upload-${randomUUID()}-${label}`, file: new File([raw], "PRIVATE_QUEUE_FILENAME.mp4", { type: "video/mp4" }) });
  const scope = (input, uploadId) => { const { file, ...rest } = input; void file; return { ...rest, uploadId }; };
  const firstInput = input("restart"), before = counters(), first = await queue.enqueue(firstInput);
  assert.deepEqual(Object.keys(first).sort(), ["state", "uploadId"]); assert.equal(first.state, "QUEUED"); assert.deepEqual(counters(), before);
  const { file: originalFile, ...firstScope } = firstInput;
  assert(originalFile instanceof File);
  assert.deepEqual(await make().status(firstScope), first);
  await assert.rejects(() => queue.status({ ...firstScope, requestKey: randomUUID() }), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.deepEqual(counters(), before);
  const uploadRequest = headers => new Request("https://example.test/inspection", {
    method: "POST", headers: { "content-type": "video/mp4", ...headers }, body: raw,
  });
  assert.deepEqual(await queue.enqueueRequest(firstScope, uploadRequest({})), first);
  for (const headers of [{ "content-length": "31457281" }, { "content-length": String(raw.length + 1) }, { "content-encoding": "gzip" }]) {
    await assert.rejects(() => queue.enqueueRequest(firstScope, uploadRequest(headers)), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  }
  const deniedRequest = uploadRequest({});
  await assert.rejects(() => queue.enqueueRequest({ ...firstScope, actorId: randomUUID() }, deniedRequest), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal(deniedRequest.bodyUsed, false);
  const pendingBodies = [new TransformStream(), new TransformStream()];
  const pendingUploads = pendingBodies.map(({ readable }) => make().enqueueRequest(firstScope, new Request("https://example.test/inspection", {
    method: "POST", headers: { "content-type": "video/mp4" }, body: readable, duplex: "half",
  })));
  const excess = uploadRequest({});
  await assert.rejects(() => queue.enqueueRequest(firstScope, excess), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal(excess.bodyUsed, false);
  await Promise.all(pendingBodies.map(async ({ writable }) => {
    const writer = writable.getWriter();
    await writer.write(raw);
    await writer.close();
  }));
  for (const result of await Promise.all(pendingUploads)) assert.deepEqual(result, first);
  assert.deepEqual(await queue.enqueueRequest(firstScope, excess), first);
  const persisted = await db.privateVideoUpload.findUniqueOrThrow({ where: { id: first.uploadId } });
  assert(!Buffer.from(persisted.encryptedBody).equals(raw)); assert.equal(persisted.encryptedBody.length, raw.length + 16); assert(!JSON.stringify(persisted).includes("PRIVATE_QUEUE_FILENAME"));
  for (const replay of await Promise.all([queue.enqueue(firstInput), queue.enqueue(firstInput)])) assert.deepEqual(replay, first);
  const modified = Buffer.from(raw); modified[39] = 7;
  await assert.rejects(() => queue.enqueue({ ...firstInput, file: new File([modified], "changed.mp4", { type: "video/mp4" }) }), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  const stored = await make().run(scope(firstInput, first.uploadId)); assert.equal(stored.state, "STORED");
  assert.deepEqual(await queue.status(firstScope), stored);
  const processed = counters(); assert.deepEqual(await make().run(scope(firstInput, first.uploadId)), stored); assert.deepEqual(counters(), processed);
  assert.equal(await db.inspectionEvidence.count({ where: { packageId: parcelId } }), 0);
  await assert.rejects(() => db.privateVideoUpload.update({ where: { id: first.uploadId }, data: { originalSha256: "0".repeat(64) } }), /immutable/);
  await assert.rejects(() => queue.run({ ...scope(firstInput, first.uploadId), actorId: randomUUID() }), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);

  const cancelInput = input("cancel"), cancelled = await queue.enqueue(cancelInput), cancelScope = scope(cancelInput, cancelled.uploadId);
  assert.equal((await queue.cancel(cancelScope)).state, "CANCELLED"); assert.equal((await queue.cancel(cancelScope)).state, "CANCELLED");
  assert.equal((await queue.run(cancelScope)).state, "CANCELLED"); assert.deepEqual(counters(), processed);
  assert.equal((await db.privateVideoUpload.findUniqueOrThrow({ where: { id: cancelled.uploadId } })).encryptedBody.length, raw.length + 16);

  const raceInput = input("cancel-processing"), raced = await queue.enqueue(raceInput), raceScope = scope(raceInput, raced.uploadId);
  const count = await db.privateVideoJob.count({ where: { actorId } });
  setOnProcess(async () => { setOnProcess(null); assert.equal((await queue.run(raceScope)).state, "BUSY");
    const otherInput = input("global-busy"), other = await queue.enqueue(otherInput);
    assert.equal((await queue.run(scope(otherInput, other.uploadId))).state, "BUSY");
    await queue.cancel(raceScope); });
  await assert.rejects(() => queue.run(raceScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal((await db.privateVideoUpload.findUniqueOrThrow({ where: { id: raced.uploadId } })).status, "CANCELLED"); assert.equal(await db.privateVideoJob.count({ where: { actorId } }), count);

  const leaseInput = input("replace-lease"), leased = await queue.enqueue(leaseInput), leaseScope = scope(leaseInput, leased.uploadId);
  setOnProcess(async () => {
    setOnProcess(null);
    await db.privateVideoUpload.update({ where: { id: leased.uploadId }, data: { leaseExpiresAt: new Date(0) } });
    assert.equal((await make().run(leaseScope)).state, "STORED");
  });
  await assert.rejects(() => queue.run(leaseScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal((await db.privateVideoUpload.findUniqueOrThrow({ where: { id: leased.uploadId } })).status, "STORED");

  const writeInput = input("cancel-write"), writing = await queue.enqueue(writeInput), writeScope = scope(writeInput, writing.uploadId);
  setOnPut(async () => { setOnPut(null); await queue.cancel(writeScope); });
  await assert.rejects(() => queue.run(writeScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  const stopped = await db.privateVideoUpload.findUniqueOrThrow({ where: { id: writing.uploadId } });
  assert.equal(stopped.status, "CANCELLED"); assert(stopped.storedJobId);
  const { createPrivateVideoJobs } = await import(jobsUrl), beforeRecovery = counters();
  await assert.rejects(() => createPrivateVideoJobs(db, store).run(stopped.storedJobId)); assert.deepEqual(counters(), beforeRecovery);
  const { createPrivateVideoEvidence } = await import(await source("modules/private-storage/video-evidence", { "./video-artifacts": artifacts, "./video-provenance": provenance, "./video-authorization": authorization }));
  await assert.rejects(() => createPrivateVideoEvidence(db, store).bind({ actorId, sessionId, jobId: stopped.storedJobId }));

  const revokedInput = input("revoked"), revoked = await queue.enqueue(revokedInput), revScope = scope(revokedInput, revoked.uploadId), revokedBefore = counters();
  await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: false } });
  await assert.rejects(() => queue.run(revScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/); assert.deepEqual(counters(), revokedBefore);
  await db.warehouseStaffAssignment.update({ where: { id: assignmentId }, data: { isActive: true } });
  const wrongKey = createPrivateVideoUploadQueue(db, store, processor, randomBytes(32));
  await assert.rejects(() => wrongKey.run(revScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/); assert.deepEqual(counters(), revokedBefore);
  await db.privateVideoUpload.update({ where: { id: revoked.uploadId }, data: { status: "PROCESSING", attempts: 5, leaseToken: randomUUID(), leaseExpiresAt: new Date(0) } });
  assert.equal((await queue.run(revScope)).state, "REVIEW_REQUIRED"); assert.deepEqual(counters(), revokedBefore);

  const badInput = input("processor-failure"), bad = await queue.enqueue(badInput), badScope = scope(badInput, bad.uploadId);
  const offline = createPrivateVideoUploadQueue(db, store, async () => { throw new Error("PRIVATE_DIAGNOSTIC"); }, key);
  await assert.rejects(() => offline.run(badScope), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal((await queue.run(badScope)).state, "REVIEW_REQUIRED");
  assert.equal((await db.privateVideoUpload.findUniqueOrThrow({ where: { id: bad.uploadId } })).encryptedBody.length, raw.length + 16);

  const renewedInput = input("new-session"), renewed = await queue.enqueue(renewedInput);
  const replacement = await db.authSession.create({ data: { userId: actorId, portal: "inspector", expiresAt: new Date(Date.now() + 3600000), clientType: "WEB" } });
  await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await assert.rejects(() => queue.run(scope(renewedInput, renewed.uploadId)), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/);
  assert.equal((await make().run({ ...scope(renewedInput, renewed.uploadId), sessionId: replacement.id })).state, "STORED");
  await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: null } });

  // Preserved completed/cancelled rows consume capacity too; no hidden pruning.
  while (await db.privateVideoUpload.count({ where: { actorId } }) < 20) await queue.enqueue(input("capacity"));
  const cap = await db.privateVideoUpload.count(); await assert.rejects(() => queue.enqueue(input("over-capacity")), /PRIVATE_VIDEO_QUEUE_UNAVAILABLE/); assert.equal(await db.privateVideoUpload.count(), cap);
  const audits = await db.auditLog.findMany({ where: { actorId } }); assert(!JSON.stringify(audits).includes("PRIVATE_QUEUE_FILENAME")); assert(!JSON.stringify(audits).includes("encryptedBody"));
  console.log("Private video upload queue passed: encrypted pre-conversion persistence, restart without file resubmission, exact retry/conflict, immutable source, bounded preserved capacity, current authorization/new-session recovery, cancellation during processing/PUT, competing/expired lease fencing and attempt cap. Actual disposable PostgreSQL; processor/cloud bytes simulated. No public upload, scheduler, publication or deletion enabled.");
}
