import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { readPrivateControlJson } from "@/modules/private-storage/control-body";
import { createPrivatePhotoRescanner, privatePhotoRescanRequest } from "@/modules/private-storage/rescan";
import { privatePhotoRescanRuntime } from "@/modules/private-storage/rescan-runtime";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Rescan must originate from the protected Admin application.", 403);
  const { uploadId } = await context.params; const key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422);
  const parsed = privatePhotoRescanRequest.omit({ idempotencyKey: true }).safeParse(await readPrivateControlJson(request));
  if (!z.uuid().safeParse(uploadId).success || !parsed.success) return apiError("VALIDATION_ERROR", "Provide the current rescan review number and confirm approved private scanning while quarantine stays in place.", 422);
  let configured: ReturnType<typeof privatePhotoRescanRuntime> = null;
  try {
    configured = privatePhotoRescanRuntime();
    if (!configured) return apiError("PRIVATE_RESCAN_SETUP_REQUIRED", "Private storage and scanner setup must be approved and configured before rescanning. See Admin live setup.", 503);
    const result = await createPrivatePhotoRescanner(prisma, configured.store, configured.scan).rescan(session.sessionId, uploadId, { ...parsed.data, idempotencyKey: key! });
    return apiSuccess(result, { status: result.state === "PENDING" ? 202 : 200, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PRIVATE_RESCAN_DENIED") return apiError("PRIVATE_RESCAN_DENIED", "The stored photo or current administrator access could not be verified.", 403);
    if (error instanceof Error && error.message === "PRIVATE_RESCAN_CONFLICT") return apiError("PRIVATE_RESCAN_CONFLICT", "Reload the latest review. One attempt is allowed per rescan review, with one pending attempt and at most five per photo per day.", 409);
    return apiError("PRIVATE_RESCAN_UNAVAILABLE", "The rescan could not be confirmed. Retry the same request or check its history; quarantine remains in place.", 503);
  } finally { configured?.store.close(); }
}
