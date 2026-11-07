import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { prisma } from "@/lib/prisma";
import { readPrivateControlJson } from "@/modules/private-storage/control-body";
import { createPhotoQuarantine, photoReviewRequest, photoReviewPage } from "@/modules/private-storage/quarantine";

function failed(error: unknown) {
  if (error instanceof Error && error.message === "PHOTO_QUARANTINE_CONFLICT") return apiError("PHOTO_REVIEW_CONFLICT", "This review or retry key changed. Reload the latest review before recording a decision.", 409);
  if (error instanceof Error && error.message === "PHOTO_QUARANTINE_DENIED") return apiError("PHOTO_REVIEW_DENIED", "The quarantine or current administrator access could not be verified.", 403);
  return apiError("PHOTO_REVIEW_UNAVAILABLE", "The review could not be confirmed. Retry the same request; the file remains blocked.", 503);
}
export async function GET(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  const { uploadId } = await context.params; const parsed = photoReviewPage.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!z.uuid().safeParse(uploadId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid upload reference and review page.", 422);
  try { return apiSuccess(await createPhotoQuarantine(prisma).history(session.sessionId, uploadId, parsed.data), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch (error) { return failed(error); }
}
export async function POST(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Review must originate from the protected Admin application.", 403);
  const { uploadId } = await context.params; const key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422);
  const parsed = photoReviewRequest.omit({ idempotencyKey: true }).safeParse(await readPrivateControlJson(request));
  if (!z.uuid().safeParse(uploadId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Provide a decision, incident reference, current review number and confirmation that the photo stays blocked.", 422);
  try { return apiSuccess(await createPhotoQuarantine(prisma).review(session.sessionId, uploadId, { ...parsed.data, idempotencyKey: key! }), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch (error) { return failed(error); }
}
