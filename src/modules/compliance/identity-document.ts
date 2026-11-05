import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import sharp from "sharp";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type EncryptedIdentityDocument = {
  documentPhotoCiphertext: string;
  documentPhotoIv: string;
  documentPhotoTag: string;
  documentPhotoMimeType: string;
  documentPhotoSizeBytes: number;
  documentPhotoSha256: string;
};

function documentKey() {
  const configured = process.env.KYC_DOCUMENT_ENCRYPTION_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("KYC_DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return decoded;
  }
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  if (process.env.NODE_ENV === "production") throw new Error("KYC_DOCUMENT_ENCRYPTION_KEY is required in production.");
  return createHash("sha256").update(`duar:kyc-document:development:${authSecret}`).digest();
}

function isValidImageSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return mimeType === "image/webp" && bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
}

export function identityDocumentUploadsEnabled() {
  // Never enable this DB-backed development intake on a production deployment.
  // Production must use the approved private-object-storage + malware-scan pipeline.
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_KYC_DOCUMENT_UPLOADS === "true";
}

export async function encryptUploadedIdentityDocument(file: File): Promise<EncryptedIdentityDocument> {
  if (!allowedMimeTypes.has(file.type)) throw new Error("Use a JPEG, PNG, or WebP document photo.");
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new Error("Document photo must be smaller than 5 MB.");
  let bytes = Buffer.from(await file.arrayBuffer());
  if (!isValidImageSignature(bytes, file.type)) throw new Error("The uploaded file does not match its declared image type.");
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, animated: false, failOn: "warning" });
    if (((await image.metadata()).pages ?? 1) > 1) throw new Error("Animated identity photo");
    bytes = await image.rotate().toFormat(file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpeg").toBuffer();
  } catch { throw new Error("Choose a valid, non-animated document photo under 24 megapixels."); }
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Processed document photo must be smaller than 5 MB.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", documentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    documentPhotoCiphertext: ciphertext.toString("base64"),
    documentPhotoIv: iv.toString("base64"),
    documentPhotoTag: cipher.getAuthTag().toString("base64"),
    documentPhotoMimeType: file.type,
    documentPhotoSizeBytes: bytes.length,
    documentPhotoSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function decryptIdentityDocument(record: Pick<EncryptedIdentityDocument, "documentPhotoCiphertext" | "documentPhotoIv" | "documentPhotoTag">) {
  const decipher = createDecipheriv("aes-256-gcm", documentKey(), Buffer.from(record.documentPhotoIv, "base64"));
  decipher.setAuthTag(Buffer.from(record.documentPhotoTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.documentPhotoCiphertext, "base64")), decipher.final()]);
}
