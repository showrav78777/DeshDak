import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
const require = createRequire(import.meta.url);
async function source(path) {
  let code = (await readFile(new URL(path, import.meta.url), "utf8")).replace('import "server-only";', "");
  code = code.replace('from "sharp"', `from ${JSON.stringify(pathToFileURL(require.resolve("sharp")).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`);
}
const { readBoundedMultipart } = await source("../src/lib/uploads/bounded-multipart.ts");
const identity = await source("../src/modules/compliance/identity-document.ts");
const evidence = await source("../src/modules/operations/inspection-evidence.ts");
const saved = Object.fromEntries(["NODE_ENV", "AUTH_SECRET", "KYC_DOCUMENT_ENCRYPTION_KEY", "INSPECTION_EVIDENCE_ENCRYPTION_KEY", "ALLOW_DEV_KYC_DOCUMENT_UPLOADS", "ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS"].map(name => [name, process.env[name]]));
try {
  process.env.NODE_ENV = "development"; process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  process.env.KYC_DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.INSPECTION_EVIDENCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const privatePhoto = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#135f78" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const file = new File([privatePhoto], "../../PRIVATE_IDENTITY_NAME.jpg", { type: "image/jpeg" });
  const encrypted = await identity.encryptUploadedIdentityDocument(file);
  assert.notEqual(encrypted.documentPhotoCiphertext, privatePhoto.toString("base64"));
  const clean = identity.decryptIdentityDocument(encrypted); const metadata = await sharp(clean).metadata();
  assert.equal(metadata.width, 8); assert.equal(metadata.height, 12); assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  assert.equal(encrypted.documentPhotoSizeBytes, clean.length); assert.equal(encrypted.documentPhotoSha256, createHash("sha256").update(clean).digest("hex"));
  assert.throws(() => identity.decryptIdentityDocument({ ...encrypted, documentPhotoTag: randomBytes(16).toString("base64") }));
  const uploaded = await evidence.encryptInspectionEvidence(file); const inspected = await sharp(evidence.decryptInspectionEvidence(uploaded)).metadata();
  assert.equal(inspected.exif, undefined); assert.equal(inspected.width, 8); assert.equal(inspected.height, 12);
  const animated = Buffer.from("UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AQBBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA", "base64");
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(() => identity.encryptUploadedIdentityDocument(new File([animated],"animated.webp",{type:"image/webp"})));
  await assert.rejects(() => evidence.encryptInspectionEvidence(new File([animated],"animated.webp",{type:"image/webp"})));
  const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  for (const invalid of [new File([Buffer.from([0xff,0xd8,0xff,0,0])],"fake.jpg",{type:"image/jpeg"}),new File([privatePhoto],"fake.png",{type:"image/png"}),new File([bomb],"large-dimensions.png",{type:"image/png"}),new File(["<svg/>"],"image.svg",{type:"image/svg+xml"})]) {
    await assert.rejects(() => identity.encryptUploadedIdentityDocument(invalid));
    await assert.rejects(() => evidence.encryptInspectionEvidence(invalid));
  }
  function request(body, headers) { return new Request("http://localhost/upload", { method: "POST", body, headers, duplex: "half" }); }
  const form = new FormData(); form.set("documentPhoto", file); form.set("documentType", "PASSPORT");
  const encoded = request(form); const type = encoded.headers.get("content-type"); const bytes = new Uint8Array(await encoded.arrayBuffer());
  const parsed = await readBoundedMultipart(request(bytes, { "Content-Type": type }), bytes.length);
  assert.equal(parsed.get("documentType"), "PASSPORT"); assert.equal(parsed.get("documentPhoto").size, privatePhoto.length);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readBoundedMultipart(request(stream, { "Content-Type": type, "Content-Length": "1" }), bytes.length), error => error.status === 413);
  assert(cancelled, "Oversized chunked upload was not cancelled.");
  for (const headers of [{ "Content-Type":type,"Content-Length":String(bytes.length+1) },{"Content-Type":type,"Content-Length":"-1"}]) await assert.rejects(() => readBoundedMultipart(request(bytes, headers), bytes.length), error => error.status === 413);
  await assert.rejects(() => readBoundedMultipart(request(bytes,{"Content-Type":type,"Content-Length":"1"}),bytes.length),error=>error.status===422);
  await assert.rejects(() => readBoundedMultipart(request(bytes,{"Content-Type":"application/json"}),bytes.length),error=>error.status===415);
  await assert.rejects(() => readBoundedMultipart(request(bytes,{"Content-Type":type,"Content-Encoding":"gzip"}),bytes.length),error=>error.status===415);
  await assert.rejects(() => readBoundedMultipart(request("bad boundary",{"Content-Type":type}),bytes.length),error=>error.status===422);
  let stalledCancelled = false;
  const stalled = new ReadableStream({ pull() {}, cancel() { stalledCancelled = true; } });
  await assert.rejects(() => readBoundedMultipart(request(stalled,{"Content-Type":type}),bytes.length,20),error=>error.status===408);
  assert(stalledCancelled, "Timed-out upload stream was not cancelled.");
  process.env.NODE_ENV = "production"; process.env.ALLOW_DEV_KYC_DOCUMENT_UPLOADS = "true"; process.env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS = "true";
  assert.equal(identity.identityDocumentUploadsEnabled(), false); assert.equal(evidence.inspectionEvidenceUploadsEnabled(), false);
  console.log("Private upload safety passed: decoded image limits, metadata stripping/orientation, authenticated encryption, actual streamed-byte limits, timeout/cancellation, multipart validation and production fail-closed gates.");
} finally { for (const [name,value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name]=value; } }
