import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

export const privateStorageConfigSchema = z.object({
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/).refine(value => !value.includes("..") && !/^\d+\.\d+\.\d+\.\d+$/.test(value) && !value.startsWith("xn--") && !value.endsWith("-s3alias")),
  region: z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/),
  expectedOwner: z.string().regex(/^\d{12}$/),
  kmsKeyArn: z.string().regex(/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/),
}).strict().superRefine((value, ctx) => {
  const parts = value.kmsKeyArn.split(":");
  if (parts[3] !== value.region || parts[4] !== value.expectedOwner) ctx.addIssue({ code: "custom", message: "Storage encryption key must match the expected region and account." });
});
type Configuration = z.infer<typeof privateStorageConfigSchema>;
const purposeSchema = z.enum(["identity", "inspection"]);
type Purpose = z.infer<typeof purposeSchema>;
const referenceSchema = z.object({
  format: z.literal(1), purpose: purposeSchema,
  key: z.string().regex(/^private\/v1\/(?:identity|inspection)\/[a-f0-9]{64}$/),
  versionId: z.string().min(1).max(1024).refine(value => value !== "null" && !/[\s\u0000-\u001f]/.test(value)),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  plaintextSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ciphertextSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  sizeBytes: z.number().int().positive().max(8 * 1024 * 1024),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict().refine(value => value.key.startsWith(`private/v1/${value.purpose}/`));
export function parsePrivatePhotoReference(value: unknown) {
  try { return referenceSchema.parse(value); }
  catch { throw new PrivateStorageError(); }
}
export type PrivatePhotoReference = z.infer<typeof referenceSchema>;
export type PreparedPrivatePhoto = { reference: Omit<PrivatePhotoReference, "versionId">; encryptedBody: Buffer };
export class PrivateStorageError extends Error {
  constructor() { super("Private photo storage could not be confirmed. Use the controlled recovery process."); }
}
function hash(bytes: Buffer, encoding: "hex" | "base64") { return createHash("sha256").update(bytes).digest(encoding); }
function aad(purpose: Purpose, key: string) { return Buffer.from(`deshdak:private-photo:v1:${purpose}:${key}`); }
function maximum(purpose: Purpose) { return purpose === "identity" ? 5 * 1024 * 1024 : 8 * 1024 * 1024; }

/** Admin rescanning may use this adapter; normal private intake/delivery remains disabled. */
export function createPrivatePhotoStore(input: { config: Configuration; keys: Record<Purpose, Buffer>; client?: S3Client }) {
  const config = privateStorageConfigSchema.parse(input.config);
  const keys = { identity: Buffer.from(input.keys.identity), inspection: Buffer.from(input.keys.inspection) };
  if (keys.identity.length !== 32 || keys.inspection.length !== 32 || keys.identity.equals(keys.inspection)) throw new PrivateStorageError();
  const client = input.client ?? new S3Client({ region: config.region, maxAttempts: 2, followRegionRedirects: false, ignoreConfiguredEndpointUrls: true, requestHandler: { connectionTimeout: 3000, requestTimeout: 12_000 } });
  function prepare(purpose: Purpose, bytes: Buffer, mimeType: PrivatePhotoReference["mimeType"]): PreparedPrivatePhoto {
    purposeSchema.parse(purpose);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum(purpose) || !["image/jpeg","image/png","image/webp"].includes(mimeType)) throw new PrivateStorageError();
    const key = `private/v1/${purpose}/${randomBytes(32).toString("hex")}`;
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keys[purpose], iv); cipher.setAAD(aad(purpose, key));
    const encryptedBody = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    return { reference: { format: 1, purpose, key, iv: iv.toString("base64"), plaintextSha256: hash(bytes,"hex"), ciphertextSha256: hash(encryptedBody,"base64"), sizeBytes: bytes.length, mimeType }, encryptedBody };
  }
  function validate(reference: PrivatePhotoReference) {
    const parsed = referenceSchema.parse(reference);
    if (parsed.sizeBytes > maximum(parsed.purpose)) throw new PrivateStorageError();
    return parsed;
  }
  async function write(prepared: PreparedPrivatePhoto): Promise<PrivatePhotoReference> {
    try {
      const reference = validate({ ...prepared.reference, versionId: "pending" });
      if (!Buffer.isBuffer(prepared.encryptedBody) || prepared.encryptedBody.length !== reference.sizeBytes + 16 || hash(prepared.encryptedBody,"base64") !== reference.ciphertextSha256) throw new PrivateStorageError();
      const result = await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: reference.key, ExpectedBucketOwner: config.expectedOwner, Body: prepared.encryptedBody, ContentType: "application/octet-stream", ContentLength: prepared.encryptedBody.length, ChecksumSHA256: reference.ciphertextSha256, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyArn, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(12_000) });
      if (result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateStorageError();
      if (!result.VersionId) throw new PrivateStorageError();
      return validate({ ...reference, versionId: result.VersionId });
    } catch { throw new PrivateStorageError(); }
  }
  async function confirm(prepared: PreparedPrivatePhoto): Promise<PrivatePhotoReference> {
    try {
      const reference = validate({ ...prepared.reference, versionId: "pending" });
      if (!Buffer.isBuffer(prepared.encryptedBody) || prepared.encryptedBody.length !== reference.sizeBytes + 16 || hash(prepared.encryptedBody,"base64") !== reference.ciphertextSha256) throw new PrivateStorageError();
      const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: reference.key, ExpectedBucketOwner: config.expectedOwner, ChecksumMode: "ENABLED" }), { abortSignal: AbortSignal.timeout(12_000) });
      if (!result.VersionId || result.ContentLength !== reference.sizeBytes + 16 || result.ContentType !== "application/octet-stream" || result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateStorageError();
      return validate({ ...reference, versionId: result.VersionId });
    } catch { throw new PrivateStorageError(); }
  }
  async function read(rawReference: PrivatePhotoReference): Promise<Buffer> {
    let body: (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
    let removeAbort: (() => void) | undefined;
    try {
      const reference = validate(rawReference);
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: reference.key, VersionId: reference.versionId, ExpectedBucketOwner: config.expectedOwner, ChecksumMode: "ENABLED" }), { abortSignal: controller.signal });
      body = result.Body as typeof body;
      if (!result.Body || result.VersionId !== reference.versionId || result.ContentLength !== reference.sizeBytes + 16 || result.ContentType !== "application/octet-stream" || result.ServerSideEncryption !== "aws:kms" || result.SSEKMSKeyId !== config.kmsKeyArn || result.ChecksumSHA256 !== reference.ciphertextSha256) throw new PrivateStorageError();
      if (controller.signal.aborted || !body) throw new PrivateStorageError();
      const aborted = new Promise<never>((_, reject) => {
        const stop = () => { body?.destroy?.(); reject(new PrivateStorageError()); };
        controller.signal.addEventListener("abort", stop, { once: true });
        removeAbort = () => controller.signal.removeEventListener("abort", stop);
      });
      let size = 0; const chunks: Buffer[] = [];
      const iterator = body[Symbol.asyncIterator]();
      for (;;) {
        const part = await Promise.race([iterator.next(), aborted]); if (part.done) break;
        size += part.value.byteLength;
        if (size > reference.sizeBytes + 16) throw new PrivateStorageError();
        chunks.push(Buffer.from(part.value));
      }
      const encrypted = Buffer.concat(chunks);
      if (size !== reference.sizeBytes + 16 || hash(encrypted,"base64") !== reference.ciphertextSha256) throw new PrivateStorageError();
      const decipher = createDecipheriv("aes-256-gcm", keys[reference.purpose], Buffer.from(reference.iv,"base64"));
      decipher.setAAD(aad(reference.purpose,reference.key)); decipher.setAuthTag(encrypted.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);
      if (hash(plaintext,"hex") !== reference.plaintextSha256) throw new PrivateStorageError();
      return plaintext;
    } catch { throw new PrivateStorageError(); }
    finally { clearTimeout(timer); removeAbort?.(); body?.destroy?.(); }
  }
  async function remove(rawReference: PrivatePhotoReference) {
    try {
      const reference = validate(rawReference);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: reference.key, VersionId: reference.versionId, ExpectedBucketOwner: config.expectedOwner }), { abortSignal: AbortSignal.timeout(12_000) });
    } catch { throw new PrivateStorageError(); }
  }
  const namespace = createHmac("sha256",keys.identity).update("deshdak:private-photo-namespace:v1:").update(JSON.stringify(config)).update(keys.inspection).digest("hex");
  return { namespace, prepare, write, confirm, read, remove, close: () => client.destroy?.() };
}
