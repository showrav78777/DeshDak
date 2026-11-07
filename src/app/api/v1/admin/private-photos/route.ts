import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { prisma } from "@/lib/prisma";
import { createPhotoQuarantine, photoQueueQuery } from "@/modules/private-storage/quarantine";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  const parsed = photoQueueQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid queue filter and page.", 422);
  try { return apiSuccess(await createPhotoQuarantine(prisma).list(session.sessionId, parsed.data), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch { return apiError("PHOTO_QUEUE_UNAVAILABLE", "The private photo queue could not be opened securely.", 503); }
}
