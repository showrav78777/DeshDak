import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

export type EncryptedInspectionEvidence = {
  mediaKind: "PHOTO" | "VIDEO";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  originalName: string | null;
};

function evidenceKey() {
  const configured = process.env.INSPECTION_EVIDENCE_ENCRYPTION_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("INSPECTION_EVIDENCE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return decoded;
  }
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  if (process.env.NODE_ENV === "production") throw new Error("INSPECTION_EVIDENCE_ENCRYPTION_KEY is required in production.");
  return createHash("sha256").update(`duar:inspection-evidence:development:${authSecret}`).digest();
}

function hasExpectedSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  // ISO BMFF files, including MP4, must include the ftyp box near the start.
  return mimeType === "video/mp4" && bytes.length >= 12 && bytes.subarray(4, 8).equals(Buffer.from("ftyp"));
}

export function inspectionEvidenceUploadsEnabled() {
  // Production must use private object storage, asynchronous malware scanning,
  // EXIF removal, and signed delivery. This encrypted DB intake exists only for
  // local development and test environments.
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS === "true";
}

export async function encryptInspectionEvidence(file: File): Promise<EncryptedInspectionEvidence> {
  const isImage = IMAGE_TYPES.has(file.type);
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) throw new Error("Use a JPEG, PNG, WebP image, or MP4 video.");
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!file.size || file.size > maxBytes) throw new Error(`${isVideo ? "Video" : "Image"} must be smaller than ${isVideo ? "30" : "8"} MB.`);
  let bytes = Buffer.from(await file.arrayBuffer());
  if (!hasExpectedSignature(bytes, file.type)) throw new Error("The selected file does not match its declared media type.");
  // Re-encode photos to strip location/EXIF data and reject invalid or excessive
  // decoded dimensions. Video intake remains confined to development.
  if (isImage) {
    try {
      const image = sharp(bytes, { limitInputPixels: 24_000_000, animated: false, failOn: "warning" });
      if (((await image.metadata()).pages ?? 1) > 1) throw new Error("Animated evidence image");
      bytes = await image.rotate().toFormat(file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpeg").toBuffer();
    } catch { throw new Error("Choose a valid, non-animated evidence photo under 24 megapixels."); }
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Processed evidence photo must be smaller than 8 MB.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", evidenceKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    mediaKind: isVideo ? "VIDEO" : "PHOTO",
    mimeType: file.type,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    originalName: file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || null,
  };
}

export function decryptInspectionEvidence(record: { ciphertext: string | null; iv: string | null; authTag: string | null }) {
  if (!record.ciphertext || !record.iv || !record.authTag) throw new Error("Private object delivery is required for this evidence.");
  const decipher = createDecipheriv("aes-256-gcm", evidenceKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
}
