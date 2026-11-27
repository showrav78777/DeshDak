import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { readPrivateControlJson } from "@/modules/private-storage/control-body";
import { consumeSecurityRateLimit, requestIp } from "@/modules/auth/rate-limit";
import { createVideoSafety, videoQuarantineRequest } from "@/modules/private-storage/video-safety";

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const session = await getRequestSession(request);
  if (session?.portal !== "admin" || !session.roles.includes("admin") || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with fresh MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Use the protected Admin application.", 403);
  const { jobId } = await context.params, key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422);
  const parsed = videoQuarantineRequest.omit({ idempotencyKey: true }).safeParse(await readPrivateControlJson(request));
  if (!z.uuid().safeParse(jobId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Choose a reason, enter a controlled case reference and confirm the block.", 422);
  const limits = await Promise.all([consumeSecurityRateLimit("video-quarantine:admin", session.userId, 30, 3600000), consumeSecurityRateLimit("video-quarantine:ip", requestIp(request), 90, 3600000)]);
  if (limits.some(limit => !limit.allowed)) {
    const response = apiError("RATE_LIMITED", "Too many control requests. Wait before retrying.", 429);
    response.headers.set("Retry-After", String(Math.max(...limits.map(limit => limit.retryAfterSeconds)))); return response;
  }
  try {
    const result = await createVideoSafety(prisma).block(session.sessionId, jobId, { ...parsed.data, idempotencyKey: key! });
    return apiSuccess(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_SAFETY_DENIED") return apiError("VIDEO_SAFETY_DENIED", "The bundle or current administrator access could not be verified.", 403);
    if (error instanceof Error && error.message === "VIDEO_SAFETY_CONFLICT") return apiError("VIDEO_SAFETY_CONFLICT", "This bundle or retry key was already reviewed. Reload the queue.", 409);
    return apiError("VIDEO_SAFETY_UNAVAILABLE", "The block could not be confirmed. Retry the same request.", 503);
  }
}
