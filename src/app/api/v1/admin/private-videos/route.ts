import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createVideoSafety, videoSafetyQuery } from "@/modules/private-storage/video-safety";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (session?.portal !== "admin" || !session.roles.includes("admin") || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with fresh MFA is required.", 403);
  const query = videoSafetyQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return apiError("VALIDATION_ERROR", "Choose a valid filter and page.", 422);
  try { return apiSuccess(await createVideoSafety(prisma).list(session.sessionId, query.data), { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  catch (error) {
    if (error instanceof Error && error.message === "VIDEO_SAFETY_DENIED") return apiError("VIDEO_SAFETY_DENIED", "Verify fresh administrator MFA before opening this queue.", 403);
    return apiError("VIDEO_SAFETY_UNAVAILABLE", "The safety queue could not be opened securely.", 503);
  }
}
