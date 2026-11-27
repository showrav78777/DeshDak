import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

/** Reuses the isolated evidence fixture; all HTTP credentials/bytes are synthetic. */
export async function verifyPrivateVideoPreview(context) {
  const { db, store, source, artifacts, provenance, account, staff, owner, other, actor, parcel, order, warehouse, assignment, jobId, evidenceId, video, poster, objects, readKeys, setOnRead } = context;
  const range = await source("modules/private-storage/video-byte-range");
  const previewUrl = await source("modules/private-storage/video-preview", { "@/modules/auth/account-mutation": account, "./video-artifacts": artifacts, "./video-provenance": provenance, "./video-byte-range": range });
  const { createPrivateVideoPreview } = await import(previewUrl);
  const { createPrivateVideoPreviewResponse } = await import(await source("modules/private-storage/video-preview-response", { "./video-preview": previewUrl }));
  const preview = createPrivateVideoPreview(db, store), serve = createPrivateVideoPreviewResponse(preview);
  const admin = await actor("preview-admin", "admin", "admin"), worker = await actor("preview-worker", "warehouse_worker", "warehouse"), finance = await actor("preview-finance", "finance", "finance");
  await db.warehouseStaffAssignment.create({ data: { userId: worker.user.id, warehouseId: warehouse.id, assignedById: staff.user.id } });
  const tokens = new Map();
  for (const user of [staff, owner, other, admin, worker, finance]) { user.previewToken = randomBytes(32).toString("hex"); tokens.set(user.previewToken, user.session.id); }
  const server = createServer(async (req, res) => {
    try {
      // This local test server substitutes only the verified-session boundary.
      const sessionId = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!sessionId) { res.writeHead(401); res.end(); return; }
      const response = await serve({ sessionId, evidenceId, artifact: req.url === "/poster" ? "poster" : req.url === "/original" ? "original" : "video", method: req.method, range: req.headers.range, ifRange: req.headers["if-range"] });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, startRead = readKeys.length;
  async function get(user = staff, headers = {}, method = "GET", path = "/video") {
    const response = await fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${user.previewToken}`, ...headers } });
    const body = Buffer.from(await response.arrayBuffer());
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("etag"), null); assert.equal(response.headers.get("last-modified"), null);
    return { response, body };
  }
  async function deniedWithoutRead(user, status, headers = {}, path = "/video") {
    const before = readKeys.length, result = await get(user, headers, "GET", path);
    assert.equal(result.response.status, status); assert.equal(result.response.headers.get("content-range"), null); assert.equal(readKeys.length, before);
    return result;
  }
  try {
    assert.equal((await fetch(`${origin}/video`)).status, 401);
    for (const [header, status, start, end] of [
      [undefined, 200, 0, video.length - 1], ["bytes=0-0", 206, 0, 0], ["bytes=5-9", 206, 5, 9], ["bytes=39-", 206, 39, 39],
      ["bytes=-5", 206, 35, 39], ["bytes=-999999999999999999999999999", 206, 0, 39], ["bytes=0-99999999999999999999999", 206, 0, 39],
      ["bytes=0001-0003", 206, 1, 3], ["bytes=0-1,8-9", 200, 0, 39], ["items=0-1", 200, 0, 39],
    ]) {
      const result = await get(staff, header ? { Range: header } : {});
      assert.equal(result.response.status, status); assert.deepEqual(result.body, video.subarray(start, end + 1));
      assert.equal(result.response.headers.get("content-length"), String(end - start + 1));
      assert.equal(result.response.headers.get("content-type"), "video/mp4");
      assert.equal(result.response.headers.get("content-range"), status === 206 ? `bytes ${start}-${end}/${video.length}` : null);
    }
    for (const header of ["bytes=40-100", "bytes=20-10", "bytes=-0", "bytes=-", "bytes=nope", `bytes=${"9".repeat(100)}-`, `bytes=0-${"9".repeat(170)}`]) {
      const result = await get(staff, { Range: header }); assert.equal(result.response.status, 416);
      assert.equal(result.body.length, 0); assert.equal(result.response.headers.get("content-range"), `bytes */${video.length}`);
    }
    const head = await get(staff, { Range: "bytes=1-3" }, "HEAD"); assert.equal(head.response.status, 200); assert.equal(head.body.length, 0); assert.equal(head.response.headers.get("content-length"), String(video.length));
    for (const ifRange of ['"unissued-validator"', "Wed, 01 Jan 2020 00:00:00 GMT"]) { const result = await get(staff, { Range: "bytes=1-3", "If-Range": ifRange }); assert.equal(result.response.status, 200); assert.deepEqual(result.body, video); }
    const image = await get(staff, {}, "GET", "/poster"); assert.equal(image.response.status, 200); assert.equal(image.response.headers.get("content-type"), "image/jpeg"); assert.deepEqual(image.body, poster);
    assert.equal((await get(worker)).response.status, 200);
    await deniedWithoutRead(owner, 409, { Range: "bytes=9999-" }); await deniedWithoutRead(other, 403, { Range: "bytes=9999-" }); await deniedWithoutRead(finance, 403);
    await deniedWithoutRead(staff, 403, {}, "/original");
    assert.equal((await get(staff, {}, "POST")).response.status, 405);
    assert.equal((await serve({ sessionId: staff.session.id, evidenceId: randomUUID(), artifact: "video" })).status, 403);
    await deniedWithoutRead(admin, 403);
    const [clock] = await db.$queryRaw`SELECT clock_timestamp()::timestamp(3) AS "now"`;
    for (const date of [new Date(clock.now.getTime() - 16 * 60000), new Date(clock.now.getTime() + 60000)]) { await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: date } }); await deniedWithoutRead(admin, 403); }
    await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: clock.now } }); assert.equal((await get(admin)).response.status, 200);

    setOnRead(() => db.authSession.update({ where: { id: staff.session.id }, data: { revokedAt: new Date() } }));
    assert.equal((await get()).response.status, 403); await db.authSession.update({ where: { id: staff.session.id }, data: { revokedAt: null } });
    setOnRead(() => db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: false } }));
    assert.equal((await get()).response.status, 403); await db.warehouseStaffAssignment.update({ where: { id: assignment.id }, data: { isActive: true } });
    setOnRead(() => db.package.update({ where: { id: parcel.id }, data: { isOutboundActive: false } }));
    assert.equal((await get()).response.status, 403); await db.package.update({ where: { id: parcel.id }, data: { isOutboundActive: true } });
    const inspectorRole = await db.role.findUniqueOrThrow({ where: { code: "inspector" } });
    setOnRead(() => db.userRole.delete({ where: { userId_roleId: { userId: staff.user.id, roleId: inspectorRole.id } } }));
    assert.equal((await get()).response.status, 403); await db.userRole.create({ data: { userId: staff.user.id, roleId: inspectorRole.id } });
    setOnRead(() => db.order.update({ where: { id: order.id }, data: { customerId: other.user.id } }));
    assert.equal((await get()).response.status, 403); await db.order.update({ where: { id: order.id }, data: { customerId: owner.user.id } });
    const artifact = await db.privateVideoArtifact.findUniqueOrThrow({ where: { jobId_role: { jobId, role: "video" } } });
    setOnRead(() => db.privateVideoArtifact.update({ where: { id: artifact.id }, data: { storedReference: { ...artifact.storedReference, versionId: "different-version" } } }));
    assert.equal((await get()).response.status, 403); await db.privateVideoArtifact.update({ where: { id: artifact.id }, data: { storedReference: artifact.storedReference } });
    const proof = await db.privateVideoProcessingProof.findUniqueOrThrow({ where: { jobId } });
    await db.privateVideoProcessingProof.update({ where: { id: proof.id }, data: { manifestSha256: "0".repeat(64) } }); await deniedWithoutRead(staff, 403);
    await db.privateVideoProcessingProof.update({ where: { id: proof.id }, data: { manifestSha256: proof.manifestSha256 } });
    const stored = objects.get(artifact.storedReference.key), saved = Buffer.from(stored.bytes); stored.bytes[0] ^= 255;
    assert.equal((await get()).response.status, 503); stored.bytes = saved;
    assert.equal((await get()).response.status, 200);
    assert(!readKeys.slice(startRead).some(key => key.includes("/original/")), "Preview read raw original bytes");
    const beforeAudit = await db.auditLog.count({ where: { entityId: evidenceId, action: "private_video.previewed" } });
    const failing = createPrivateVideoPreview(new Proxy(db, { get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return callback => target.$transaction(tx => callback(new Proxy(tx, { get(real, field) { return field === "auditLog" ? { create: async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); } } : Reflect.get(real, field); } })));
    } }), store);
    assert.equal((await createPrivateVideoPreviewResponse(failing)({ sessionId: staff.session.id, evidenceId, artifact: "video" })).status, 503);
    assert.equal(await db.auditLog.count({ where: { entityId: evidenceId, action: "private_video.previewed" } }), beforeAudit);
    console.log("Private staged preview passed: actual local HTTP GET/HEAD/206/416, bounded/overflow-safe byte ranges, suffix/open ranges, unknown/multipart/If-Range fallback, poster delivery, no original reads, private headers, inspector/warehouse/admin access, unpublished owner and cross-customer denial, session/assignment/ownership/reference changes during reads, tamper rejection and audit-failure blocking. Media/cloud/auth transport were synthetic; customer publication and runtime routes remain disabled.");
  } finally { setOnRead(null); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
