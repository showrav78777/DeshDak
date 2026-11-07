import { readPrivateControlJson } from "@/modules/private-storage/control-body";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { prisma } from "@/lib/prisma";
import { createPhotoQuarantine, photoQuarantineRequest } from "@/modules/private-storage/quarantine";

export async function POST(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Quarantine must originate from the protected Admin application.", 403);
  const { uploadId } = await context.params;
  const key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422);
  const body = await readPrivateControlJson(request);
  const parsed = z.object({ reason: photoQuarantineRequest.shape.reason, confirmed: z.literal(true) }).strict().safeParse(body);
  if (!z.uuid().safeParse(uploadId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Choose a reason and confirm the permanent block.", 422);
  try { return apiSuccess(await createPhotoQuarantine(prisma).block(session.sessionId, uploadId, { ...parsed.data, idempotencyKey: key! }), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch (error) {
    if (error instanceof Error && error.message === "PHOTO_QUARANTINE_CONFLICT") return apiError("PHOTO_QUARANTINE_CONFLICT", "The photo or retry key was already reviewed. Reload the current queue.", 409);
    if (error instanceof Error && error.message === "PHOTO_QUARANTINE_DENIED") return apiError("PHOTO_QUARANTINE_DENIED", "The photo or current administrator access could not be verified.", 403);
    return apiError("PHOTO_QUARANTINE_UNAVAILABLE", "The block could not be confirmed. Retry the same request.", 503);
  }
}
