import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { consumeSecurityRateLimit, requestIp } from "@/modules/auth/rate-limit";
import { privateVideoRuntime } from "@/modules/private-storage/video-runtime";

type Context = { params: Promise<{ packageId: string }> };
const noStore = { "Cache-Control": "private, no-store" };

async function handle(request: NextRequest, context: Context, upload: boolean) {
  const session = await getRequestSession(request);
  if (!session || !["inspector", "warehouse"].includes(session.portal)) {
    return apiError("VIDEO_ACCESS_REQUIRED", "Sign in to the inspection or warehouse portal.", 403);
  }
  if (upload && !hasTrustedMutationOrigin(request)) {
    return apiError("UNTRUSTED_ORIGIN", "Use the protected operations application.", 403);
  }
  const { packageId } = await context.params;
  const requestKey = request.headers.get(upload ? "Idempotency-Key" : "X-Upload-Request-Key");
  if (!z.uuid().safeParse(packageId).success || !requestKey || !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) {
    return apiError("VALIDATION_ERROR", "Provide a package and a stable upload request key.", 422);
  }
  const runtime = privateVideoRuntime();
  if (!runtime) return apiError("VIDEO_UPLOAD_UNAVAILABLE", "Private video upload is unavailable.", 503);

  const action = upload ? "upload" : "status";
  const limits = await Promise.all([
    consumeSecurityRateLimit(`inspection-video:${action}:staff`, session.userId, upload ? 20 : 120, 60 * 60_000),
    consumeSecurityRateLimit(`inspection-video:${action}:ip`, requestIp(request), upload ? 60 : 360, 60 * 60_000),
  ]);
  if (limits.some(limit => !limit.allowed)) {
    const response = apiError("RATE_LIMITED", "Wait before trying again.", 429);
    response.headers.set("Retry-After", String(Math.max(...limits.map(limit => limit.retryAfterSeconds))));
    return response;
  }

  try {
    const scope = { packageId, requestKey, actorId: session.userId, sessionId: session.sessionId };
    const result = upload ? await runtime.queue.enqueueRequest(scope, request) : await runtime.queue.status(scope);
    return apiSuccess(result, { status: upload ? 202 : 200, headers: noStore });
  } catch {
    return apiError("VIDEO_REQUEST_UNAVAILABLE", "The video request could not be confirmed. Check access and retry with the same request key.", 409);
  }
}

export function POST(request: NextRequest, context: Context) {
  return handle(request, context, true);
}

export function GET(request: NextRequest, context: Context) {
  return handle(request, context, false);
}
