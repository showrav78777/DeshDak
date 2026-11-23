import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { readPrivateControlJson } from "./control-body";
export const privateMediaHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export async function privateMediaHttpAccess(request: NextRequest, mutation = false) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) return { error: apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403) };
  if (mutation && !hasTrustedMutationOrigin(request)) return { error: apiError("UNTRUSTED_ORIGIN", "Use the protected Admin application.", 403) };
  if (!mutation) return { session };
  const key = request.headers.get("Idempotency-Key");
  if (!z.uuid().safeParse(key).success) return { error: apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a UUID retry key.", 422) };
  const body = await readPrivateControlJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "idempotencyKey")) return { error: apiError("VALIDATION_ERROR", "Use the bounded JSON form and send the retry key only in its header.", 422) };
  return { session, body: { ...body, idempotencyKey: key! } };
}
export function privateMediaHttpError(error: unknown) {
  if (error instanceof Error && error.message === "MEDIA_LIFECYCLE_CONFLICT") return apiError("MEDIA_LIFECYCLE_CONFLICT", "This record or retry key changed. Reload the latest history before making another decision.", 409);
  if (error instanceof Error && error.message === "MEDIA_LIFECYCLE_DENIED") return apiError("MEDIA_LIFECYCLE_DENIED", "Current access or the target could not be verified. Policy changes, independent hold release and deletion review decisions require the Compliance role.", 403);
  return apiError("MEDIA_LIFECYCLE_UNAVAILABLE", "The change could not be confirmed. Check history or retry the same request.", 503);
}
