import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { privateStorageConfigSchema } from "./photos";

type Configuration = z.infer<typeof privateStorageConfigSchema>;
const roleSchema = z.enum(["original", "video", "poster"]);
type Role = z.infer<typeof roleSchema>;
const referenceSchema = z.object({
  format: z.literal(2), role: roleSchema,
  key: z.string().regex(/^private\/inspection-video\/v1\/(?:original|video|poster)\/[a-f0-9]{64}$/),
  versionId: z.string().min(1).max(1024).refine(value => value !== "null" && !/[\s\u0000-\u001f]/.test(value)),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  plaintextSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ciphertextSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  sizeBytes: z.number().int().positive().max(30 * 1024 * 1024),
  mimeType: z.enum(["video/mp4", "image/jpeg"]),
}).strict().refine(value => value.key.startsWith(`private/inspection-video/v1/${value.role}/`) && value.sizeBytes <= maximum(value.role) && value.mimeType === (value.role === "poster" ? "image/jpeg" : "video/mp4"));
export function parsePrivateVideoArtifactReference(value: unknown) {
  try { return referenceSchema.parse(value); }
  catch { throw new PrivateVideoStorageError(); }
}
export type PrivateVideoArtifactReference = z.infer<typeof referenceSchema>;
export type PreparedPrivateVideoArtifact = { reference: Omit<PrivateVideoArtifactReference, "versionId">; encryptedBody: Buffer };
export class PrivateVideoStorageError extends Error {
  constructor() { super("Private video storage could not be confirmed. Use the controlled recovery process."); }
}
function hash(bytes: Buffer, encoding: "hex" | "base64") { return createHash("sha256").update(bytes).digest(encoding); }
function aad(role: Role, key: string) { return Buffer.from(`deshdak:private-inspection-video:v1:${role}:${key}`); }
function maximum(role: Role) { return role === "original" ? 30 * 1024 * 1024 : role === "video" ? 8 * 1024 * 1024 : 512 * 1024; }

/** Internal artifact storage only; no upload, evidence, delivery or deletion authority. */
export function createPrivateVideoArtifactStore(input: { config: Configuration; keys: Record<Role, Buffer>; client?: S3Client }) {
  const config = privateStorageConfigSchema.parse(input.config);
  const keys = { original: Buffer.from(input.keys.original), video: Buffer.from(input.keys.video), poster: Buffer.from(input.keys.poster) };
  const values = Object.values(keys);
  if (values.some(key => key.length !== 32) || values.some((key, index) => values.slice(index + 1).some(other => key.equals(other)))) throw new PrivateVideoStorageError();
  const client = input.client ?? new S3Client({ region: config.region, maxAttempts: 2, followRegionRedirects: false, ignoreConfiguredEndpointUrls: true, requestHandler: { connectionTimeout: 3000, requestTimeout: 12_000 } });
  function prepare(role: Role, bytes: Buffer, mimeType: PrivateVideoArtifactReference["mimeType"]): PreparedPrivateVideoArtifact {
    roleSchema.parse(role);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum(role) || mimeType !== (role === "poster" ? "image/jpeg" : "video/mp4")) throw new PrivateVideoStorageError();
    const key = `private/inspection-video/v1/${role}/${randomBytes(32).toString("hex")}`;
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keys[role], iv); cipher.setAAD(aad(role, key));
    const encryptedBody = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    return { reference: { format: 2, role, key, iv: iv.toString("base64"), plaintextSha256: hash(bytes,"hex"), ciphertextSha256: hash(encryptedBody,"base64"), sizeBytes: bytes.length, mimeType }, encryptedBody };
  }
  function validate(reference: PrivateVideoArtifactReference) {
    const parsed = referenceSchema.parse(reference);
    if (parsed.sizeBytes > maximum(parsed.role) || parsed.mimeType !== (parsed.role === "poster" ? "image/jpeg" : "video/mp4")) throw new PrivateVideoStorageError();
    return parsed;
  }
  function decrypt(reference: PrivateVideoArtifactReference, encrypted: Buffer) {
    if (!Buffer.isBuffer(encrypted) || encrypted.length !== reference.sizeBytes + 16 || hash(encrypted, "base64") !== reference.ciphertextSha256) throw new PrivateVideoStorageError();
    const decipher = createDecipheriv("aes-256-gcm", keys[reference.role], Buffer.from(reference.iv, "base64"));
    decipher.setAAD(aad(reference.role, reference.key)); decipher.setAuthTag(encrypted.subarray(-16));
    const bytes = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
    if (hash(bytes, "hex") !== reference.plaintextSha256) throw new PrivateVideoStorageError();
    return bytes;
  }
  async function write(prepared: PreparedPrivateVideoArtifact): Promise<PrivateVideoArtifactReference> {
    try {
      const reference = validate({ ...prepared.reference, versionId: "pending" });
      // Validate persisted/recovered preparation before any cloud mutation.
      decrypt(reference, prepared.encryptedBody);
      const result = await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: reference.key, ExpectedBucketOwner: config.expectedOwner, Body: prepared.encryptedBody, ContentType: "application/octet-stream", ContentLength: prepared.encryptedBody.length, ChecksumSHA256: reference.ciphertextSha256, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(12_000) });
      if (result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateVideoStorageError();
      if (!result.VersionId) throw new PrivateVideoStorageError();
      return validate({ ...reference, versionId: result.VersionId });
    } catch { throw new PrivateVideoStorageError(); }
  }
  async function confirm(prepared: PreparedPrivateVideoArtifact): Promise<PrivateVideoArtifactReference> {
    try {
      const reference = validate({ ...prepared.reference, versionId: "pending" });
      decrypt(reference, prepared.encryptedBody);
      const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: reference.key, ExpectedBucketOwner: config.expectedOwner, ChecksumMode: "ENABLED" }), { abortSignal: AbortSignal.timeout(12_000) });
      if (!result.VersionId || result.ContentLength !== reference.sizeBytes + 16 || result.ContentType !== "application/octet-stream" || result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateVideoStorageError();
      return validate({ ...reference, versionId: result.VersionId });
    } catch { throw new PrivateVideoStorageError(); }
  }
  async function read(rawReference: PrivateVideoArtifactReference): Promise<Buffer> {
    let body: (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
    let removeAbort: (() => void) | undefined;
    try {
      const reference = validate(rawReference);
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: reference.key, VersionId: reference.versionId, ExpectedBucketOwner: config.expectedOwner, ChecksumMode: "ENABLED" }), { abortSignal: controller.signal });
      body = result.Body as typeof body;
      if (!result.Body || result.VersionId !== reference.versionId || result.ContentLength !== reference.sizeBytes + 16 || result.ContentType !== "application/octet-stream" || result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateVideoStorageError();
      if (controller.signal.aborted || !body) throw new PrivateVideoStorageError();
      const aborted = new Promise<never>((_, reject) => {
        const stop = () => { body?.destroy?.(); reject(new PrivateVideoStorageError()); };
        controller.signal.addEventListener("abort", stop, { once: true });
        removeAbort = () => controller.signal.removeEventListener("abort", stop);
      });
      let size = 0; const chunks: Buffer[] = [];
      const iterator = body[Symbol.asyncIterator]();
      for (;;) {
        const part = await Promise.race([iterator.next(), aborted]); if (part.done) break;
        size += part.value.byteLength;
        if (size > reference.sizeBytes + 16) throw new PrivateVideoStorageError();
        chunks.push(Buffer.from(part.value));
      }
      const encrypted = Buffer.concat(chunks);
      if (size !== reference.sizeBytes + 16 || hash(encrypted,"base64") !== reference.ciphertextSha256) throw new PrivateVideoStorageError();
      return decrypt(reference, encrypted);
    } catch { throw new PrivateVideoStorageError(); }
    finally { clearTimeout(timer); removeAbort?.(); body?.destroy?.(); }
  }
  const namespace = createHmac("sha256", keys.original).update("deshdak:private-inspection-video-namespace:v1:").update(JSON.stringify(config)).update(keys.video).update(keys.poster).digest("hex");
  return { namespace, prepare, write, confirm, read, close: () => client.destroy?.() };
}
