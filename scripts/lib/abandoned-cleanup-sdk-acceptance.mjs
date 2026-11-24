import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";

// Explicit loopback endpoint and synthetic credentials: never resolves a real AWS account.
export async function verifyCleanupSdk({ db, createStore, createWorker, target, sessionId, requestBody }) {
  const config = { bucket: "deshdak-cleanup-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
  const versions = new Map(), calls = [], faults = [];
  let mode = "normal";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=SYNTHETIC_CLEANUP\//);
      assert.equal(req.headers["x-amz-expected-bucket-owner"], config.expectedOwner);
      calls.push({ method: req.method, key: url.pathname, version: url.searchParams.get("versionId") });
      if (req.method === "HEAD" && url.pathname === `/${config.bucket}/`) {
        res.writeHead(mode === "bucket-denied" ? 403 : 200, { "x-amz-bucket-region": config.region }); res.end(); return;
      }
      assert.match(url.pathname, /^\/deshdak-cleanup-test\/private\/v1\/identity\/[a-f0-9]{64}$/);
      if (req.method === "PUT") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        assert.equal(req.headers["if-none-match"], "*");
        assert.equal(req.headers["x-amz-server-side-encryption"], "aws:kms");
        assert.equal(req.headers["x-amz-server-side-encryption-aws-kms-key-id"], config.kmsKeyArn);
        const object = { bytes: Buffer.concat(chunks), version: randomUUID(), checksum: req.headers["x-amz-checksum-sha256"] };
        versions.set(`${url.pathname}:${object.version}`, object);
        res.writeHead(200, { "x-amz-version-id": object.version, "x-amz-checksum-sha256": object.checksum, "x-amz-server-side-encryption": "aws:kms", "x-amz-server-side-encryption-aws-kms-key-id": config.kmsKeyArn }); res.end(); return;
      }
      const key = `${url.pathname}:${url.searchParams.get("versionId")}`, object = versions.get(key);
      if (!object) { res.writeHead(404); res.end(); return; }
      if (req.method === "HEAD" || req.method === "GET") {
        const headers = { etag: '"cleanup-test-etag"', "Content-Type": "application/octet-stream", "Content-Length": object.bytes.length, "x-amz-version-id": object.version, "x-amz-server-side-encryption": "aws:kms", "x-amz-server-side-encryption-aws-kms-key-id": config.kmsKeyArn, "x-amz-checksum-sha256": mode === "bad-checksum" ? randomBytes(32).toString("base64") : object.checksum };
        if (mode === "storage-hold") headers["x-amz-object-lock-legal-hold"] = "ON";
        res.writeHead(200, headers); res.end(req.method === "GET" ? object.bytes : undefined); return;
      }
      assert.equal(req.method, "DELETE");
      assert.equal(req.headers["if-match"], '"cleanup-test-etag"');
      assert.equal(req.headers["x-amz-bypass-governance-retention"], undefined);
      const attempt = await db.privateMediaCleanupAttempt.findFirstOrThrow({ where: { referenceSnapshot: { path: ["versionId"], equals: object.version } } });
      assert.equal(await db.auditLog.count({ where: { action: "private_media.cleanup_reserved", entityId: attempt.id } }), 1);
      versions.delete(key);
      if (mode === "lost-ack") { res.writeHead(500, { "Content-Type": "application/xml" }); res.end("<Error><Code>InternalError</Code></Error>"); return; }
      res.writeHead(204, { "x-amz-version-id": object.version }); res.end();
    } catch (error) { faults.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const client = new S3Client({ region: config.region, endpoint: `http://127.0.0.1:${server.address().port}`, forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: "SYNTHETIC_CLEANUP", secretAccessKey: "SYNTHETIC_CLEANUP_SECRET" } });
  const store = createStore({ config, keys: { identity: randomBytes(32), inspection: randomBytes(32) }, client });
  const worker = createWorker(db, store, { enabled: true });
  const deletes = () => calls.filter(call => call.method === "DELETE").length;
  try {
    for (const scenario of ["normal", "lost-ack", "storage-hold", "bad-checksum", "bucket-denied", "audit-failure", "historical-version"]) {
      mode = "normal";
      const bytes = Buffer.from(`SYNTHETIC_SDK_CLEANUP_${scenario}`);
      const reference = await store.write(store.prepare("identity", bytes, "image/png"));
      assert.deepEqual(await store.read(reference), bytes);
      const item = await target(`sdk-${scenario}`, { storageNamespace: store.namespace, storedReference: reference, originalScanSha256: reference.plaintextSha256, scanVerifiedSha256: reference.plaintextSha256 });
      const input = requestBody(item), before = deletes(), objectKey = `/${config.bucket}/${reference.key}:${reference.versionId}`;
      let newer;
      if (scenario === "historical-version") { newer = { ...versions.get(objectKey), version: randomUUID() }; versions.set(`/${config.bucket}/${reference.key}:${newer.version}`, newer); }
      mode = scenario;
      const fault = `cleanup_sdk_audit_${randomBytes(8).toString("hex")}`;
      if (scenario === "audit-failure") {
        await db.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='private_media.cleanup_observed' THEN RAISE EXCEPTION 'SYNTHETIC_SDK_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
        await db.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      }
      let result;
      try {
        if (scenario === "audit-failure") await assert.rejects(() => worker.execute(sessionId, input), /CLEANUP_UNAVAILABLE/);
        else result = await worker.execute(sessionId, input);
      } finally {
        if (scenario === "audit-failure") { await db.$executeRawUnsafe(`DROP TRIGGER "${fault}" ON "AuditLog"`); await db.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`); }
      }
      assert.deepEqual(faults, [], "Local SDK simulator assertion failed");
      const retained = ["storage-hold", "bad-checksum"].includes(scenario);
      assert.equal(deletes(), before + (retained ? 0 : 1));
      assert.equal(versions.has(objectKey), retained);
      const attempt = await db.privateMediaCleanupAttempt.findUniqueOrThrow({ where: { uploadId: item.upload.id } });
      const initial = scenario === "audit-failure" ? "PENDING" : retained || ["lost-ack", "bucket-denied"].includes(scenario) ? "UNCERTAIN" : "VERSION_ABSENT";
      if (result) assert.equal(result.state, initial);
      assert.equal((await worker.execute(sessionId, input)).state, initial);
      mode = "normal";
      const reconciled = await worker.reconcile(sessionId, attempt.id, { idempotencyKey: randomUUID(), confirmed: true });
      assert.equal(reconciled.state, retained ? "UNCERTAIN" : "VERSION_ABSENT");
      assert.equal(deletes(), before + (retained ? 0 : 1), "SDK replay/reconciliation must never repeat DELETE");
      const upload = await db.privatePhotoUpload.findUniqueOrThrow({ where: { id: item.upload.id } });
      assert.equal(upload.status, retained ? "STORED" : "REMOVED");
      if (!retained) { assert.equal(upload.storedReference, null); assert.deepEqual(upload.preparedReference, {}); }
      if (newer) assert.deepEqual(await store.read({ ...reference, versionId: newer.version }), bytes);
    }
    assert.deepEqual(faults, []);
    assert.equal(calls.some(call => !["PUT", "GET", "HEAD", "DELETE"].includes(call.method)), false);
    console.log("Combined cleanup SDK/PostgreSQL acceptance passed: 7 scenarios; signed loopback requests, committed attempt before DELETE, holds/checksum preservation, lost response/bucket denial, audit rollback, no repeated DELETE, read-only reconciliation and newer-version preservation. Synthetic storage only; no live AWS/customer data.");
  } finally { store.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
