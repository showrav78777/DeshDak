import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { prisma } from "@/lib/prisma";
import { createPhotoQuarantine, photoQuarantineRequest } from "@/modules/private-storage/quarantine";

async function boundedJson(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) return null;
  const reader = request.body.getReader(); const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) return null;
    const aborted = new Promise<never>((_, reject) => { stop = () => reject(new Error("Aborted")); signal.addEventListener("abort", stop, { once: true }); });
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const part = await Promise.race([reader.read(), aborted]); if (part.done) break; size += part.value.byteLength; if (size > 4096) return null; chunks.push(part.value); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { if (stop) signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function POST(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Quarantine must originate from the protected Admin application.", 403);
  const { uploadId } = await context.params;
  const key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422);
  const body = await boundedJson(request);
  const parsed = z.object({ reason: photoQuarantineRequest.shape.reason, confirmed: z.literal(true) }).strict().safeParse(body);
  if (!z.uuid().safeParse(uploadId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Choose a reason and confirm the permanent block.", 422);
  try { return apiSuccess(await createPhotoQuarantine(prisma).block(session.sessionId, uploadId, { ...parsed.data, idempotencyKey: key! }), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch (error) {
    if (error instanceof Error && error.message === "PHOTO_QUARANTINE_CONFLICT") return apiError("PHOTO_QUARANTINE_CONFLICT", "The photo or retry key was already reviewed. Reload the current queue.", 409);
    if (error instanceof Error && error.message === "PHOTO_QUARANTINE_DENIED") return apiError("PHOTO_QUARANTINE_DENIED", "The photo or current administrator access could not be verified.", 403);
    return apiError("PHOTO_QUARANTINE_UNAVAILABLE", "The block could not be confirmed. Retry the same request.", 503);
  }
}
