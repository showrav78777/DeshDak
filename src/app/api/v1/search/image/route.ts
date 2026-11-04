import { createHash } from "crypto";
import { AiCapability } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { checkPublicAiRateLimit } from "@/modules/ai/public-rate-limit";
import { getAiConfiguration } from "@/modules/ai/configuration";

function detectedType(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: NextRequest) {
  const configuration = await getAiConfiguration(AiCapability.IMAGE_SEARCH); const maxBytes = configuration.maxInputBytes ?? 5 * 1024 * 1024;
  const rate = await checkPublicAiRateLimit(request, "public-image-search", configuration.anonymousLimit);
  if (!rate.allowed) return apiError("HUMAN_VERIFICATION_REQUIRED", "Too many anonymous image searches. Please wait and verify you are human before continuing.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
  const form = await request.formData().catch(() => null); const image = form?.get("image");
  if (!(image instanceof File)) return apiError("IMAGE_REQUIRED", "Upload a JPG, PNG, or WebP image.", 422);
  if (image.size < 1024 || image.size > maxBytes) return apiError("IMAGE_SIZE_INVALID", "Image size must be between 1 KB and 5 MB.", 422);
  const bytes = new Uint8Array(await image.arrayBuffer()); const type = detectedType(bytes);
  if (!type || type !== image.type) return apiError("IMAGE_TYPE_INVALID", "The file content must be a valid JPG, PNG, or WebP image.", 422);
  const fingerprint = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return apiError("IMAGE_SEARCH_NOT_CONFIGURED", "Image search is ready for a vision provider, but no approved vision API is configured yet.", 503, { uploadValidated: true, stored: false, fingerprint, supportedTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes });
}
