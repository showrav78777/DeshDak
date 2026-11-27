import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";

const require = createRequire(import.meta.url);
async function moduleSource(name, replacements = {}) {
  let source = (await readFile(new URL(`../src/modules/private-storage/${name}.ts`, import.meta.url), "utf8")).replace('import "server-only";', "");
  for (const dependency of ["@aws-sdk/client-s3", "zod"]) source = source.replace(`from "${dependency}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(dependency)).href)}`);
  for (const [dependency, url] of Object.entries(replacements)) source = source.replace(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
}
const photoModule = await moduleSource("photos");
const { createPrivateVideoArtifactStore, parsePrivateVideoArtifactReference } = await import(await moduleSource("video-artifacts", { "./photos": photoModule }));
const config = { bucket: "deshdak-private-test", region: "us-east-1", expectedOwner: "123456789012", kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111" };
const keys = { original: randomBytes(32), video: randomBytes(32), poster: randomBytes(32) };
const objects = new Map(), requests = []; let mode = "normal";
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"), chunks = [];
  for await (const part of req) chunks.push(part);
  const bytes = Buffer.concat(chunks); requests.push({ method: req.method, version: url.searchParams.get("versionId") });
  assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=SYNTHETIC_VIDEO_STORAGE\//);
  assert.equal(req.headers["x-amz-expected-bucket-owner"], config.expectedOwner);
  assert.match(url.pathname, /^\/deshdak-private-test\/private\/inspection-video\/v1\/(original|video|poster)\/[a-f0-9]{64}$/);
  if (mode === "forbidden") { res.writeHead(403); res.end("PRIVATE_PROVIDER_DIAGNOSTIC"); return; }
  if (req.method === "PUT") {
    assert.equal(req.headers["if-none-match"], "*"); assert.equal(req.headers["x-amz-acl"], undefined);
    assert.equal(req.headers["content-type"], "application/octet-stream");
    assert.equal(req.headers["x-amz-server-side-encryption"], "aws:kms");
    assert.equal(req.headers["x-amz-server-side-encryption-aws-kms-key-id"], config.kmsKeyArn);
    if (objects.has(url.pathname)) { res.writeHead(412); res.end(); return; }
    objects.set(url.pathname, { bytes, version: `synthetic-${objects.size + 1}`, checksum: req.headers["x-amz-checksum-sha256"] });
  }
  const object = objects.get(url.pathname);
  if (!object) { res.writeHead(404); res.end(); return; }
  if (req.method === "GET") assert.equal(url.searchParams.get("versionId"), object.version);
  assert(["PUT", "HEAD", "GET"].includes(req.method), "No deletion or public delivery is authorized");
  const headers = { "Content-Type": mode === "mime" ? "video/mp4" : "application/octet-stream", "x-amz-server-side-encryption": mode === "encryption" ? "AES256" : "aws:kms", "x-amz-server-side-encryption-aws-kms-key-id": mode === "kms" ? config.kmsKeyArn.replace("11111111", "22222222") : config.kmsKeyArn, "x-amz-checksum-sha256": mode === "checksum" ? Buffer.alloc(32).toString("base64") : object.checksum };
  if (mode !== "unversioned") headers["x-amz-version-id"] = mode === "version" ? "different-version" : object.version;
  if (req.method !== "PUT") headers["Content-Length"] = object.bytes.length;
  res.writeHead(200, headers);
  if (req.method !== "GET") { res.end(); return; }
  if (mode === "stalled") { res.flushHeaders(); return; }
  const output = Buffer.from(object.bytes); if (mode === "tampered") output[0] ^= 255;
  res.end(output);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const client = new S3Client({ region: config.region, endpoint: `http://127.0.0.1:${server.address().port}`, forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: "SYNTHETIC_VIDEO_STORAGE", secretAccessKey: randomBytes(32).toString("hex") }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const store = createPrivateVideoArtifactStore({ config, keys, client });
const safeFailure = error => { assert.equal(error.message, "Private video storage could not be confirmed. Use the controlled recovery process."); return true; };
try {
  assert.throws(() => createPrivateVideoArtifactStore({ config, keys: { ...keys, poster: keys.video }, client }));
  assert.throws(() => createPrivateVideoArtifactStore({ config, keys: { ...keys, original: Buffer.alloc(31) }, client }));
  assert.notEqual(store.namespace, createPrivateVideoArtifactStore({ config, keys: { ...keys, video: randomBytes(32) }, client }).namespace);
  for (const [role, mime, limit] of [["original", "video/mp4", 30 * 1024 * 1024], ["video", "video/mp4", 8 * 1024 * 1024], ["poster", "image/jpeg", 512 * 1024]]) {
    const bytes = Buffer.alloc(limit, 71); const prepared = store.prepare(role, bytes, mime);
    assert(!prepared.encryptedBody.includes(bytes));
    assert.throws(() => store.prepare(role, Buffer.alloc(limit + 1), mime));
    assert.throws(() => store.prepare(role, bytes, mime === "video/mp4" ? "image/jpeg" : "video/mp4"));
    const reference = await store.write(prepared);
    assert.deepEqual(await store.read(reference), bytes); assert.deepEqual(await store.confirm(prepared), reference);
    await assert.rejects(() => store.write(prepared), safeFailure);
    for (const patch of [{ role: role === "poster" ? "video" : "poster" }, { format: 1 }, { key: "../../private" }, { versionId: "null" }, { sizeBytes: limit + 1 }, { mimeType: "image/png" }]) {
      const count = requests.length; assert.throws(() => parsePrivateVideoArtifactReference({ ...reference, ...patch }), safeFailure);
      await assert.rejects(() => store.read({ ...reference, ...patch }), safeFailure); assert.equal(requests.length, count);
    }
    for (const patch of [{ iv: randomBytes(12).toString("base64") }, { plaintextSha256: "0".repeat(64) }]) await assert.rejects(() => store.read({ ...reference, ...patch }), safeFailure);
    for (const state of ["encryption", "kms", "unversioned", "version", "mime", "checksum", "tampered", "forbidden"]) { mode = state; await assert.rejects(() => store.read(reference), safeFailure); }
    mode = "normal";
  }
  const bytes = Buffer.from("SYNTHETIC_VIDEO_ARTIFACT"), pending = store.prepare("video", bytes, "video/mp4");
  mode = "unversioned"; await assert.rejects(() => store.write(pending), safeFailure);
  mode = "normal"; const recovered = await store.confirm(pending); assert.deepEqual(await store.read(recovered), bytes);
  const before = requests.length;
  await assert.rejects(() => store.write({ ...pending, encryptedBody: Buffer.alloc(1) }), safeFailure); assert.equal(requests.length, before);
  const corrupt = Buffer.from(pending.encryptedBody); corrupt[0] ^= 255;
  for (const prepared of [
    { ...pending, reference: { ...pending.reference, iv: randomBytes(12).toString("base64") } },
    { ...pending, reference: { ...pending.reference, plaintextSha256: "0".repeat(64) } },
    { encryptedBody: corrupt, reference: { ...pending.reference, ciphertextSha256: createHash("sha256").update(corrupt).digest("base64") } },
  ]) {
    await assert.rejects(() => store.write(prepared), safeFailure);
    await assert.rejects(() => store.confirm(prepared), safeFailure);
    assert.equal(requests.length, before, "Invalid persisted preparation reached cloud storage");
  }
  const wrongRole = { ...recovered, role: "original", key: recovered.key.replace("/video/", "/original/") };
  const stored = objects.get(`/${config.bucket}/${recovered.key}`); objects.set(`/${config.bucket}/${wrongRole.key}`, stored);
  await assert.rejects(() => store.read(wrongRole), safeFailure);
  const fakeBody = Readable.from([Buffer.alloc(bytes.length + 17)]); let destroyed = false; fakeBody.on("close", () => { destroyed = true; });
  const fake = { send: async () => ({ Body: fakeBody, VersionId: recovered.versionId, ContentLength: bytes.length + 16, ContentType: "application/octet-stream", ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, ChecksumSHA256: createHash("sha256").update(pending.encryptedBody).digest("base64") }) };
  await assert.rejects(() => createPrivateVideoArtifactStore({ config, keys, client: fake }).read(recovered), safeFailure);
  await new Promise(resolve => setImmediate(resolve)); assert(destroyed);
  mode = "stalled"; await assert.rejects(() => store.read(recovered), safeFailure);
  console.log("Private video artifact storage passed: SDK-signed loopback requests, original/video/poster bounds, distinct encryption keys and authenticated role separation, private conditional writes, KMS/owner/version/checksum checks, tamper rejection, interrupted-write recovery, bounded/stalled reads and redacted failures. Cloud responses were simulated; no upload route, database, evidence binding, public delivery or production activation.");
} finally { client.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
