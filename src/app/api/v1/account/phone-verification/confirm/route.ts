import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { hashSecurityToken } from "@/lib/security-secrets";
import { consumeConfirmationLimit } from "@/modules/auth/rate-limit";
import { recordUserEvent } from "@/modules/activity/service";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to verify your phone number.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Phone verification must be completed from the protected customer application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("PHONE_CODE_INVALID", "Enter the six-digit verification code.", 422);
  const limit = await consumeConfirmationLimit(request, "phone-verification-confirm");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many attempts. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const now = new Date();
  const verified = await prisma.$transaction(async (tx) => {
    const token = await tx.securityToken.findUnique({ where: { tokenHash: hashSecurityToken("PHONE_VERIFICATION", parsed.data.code) }, select: { id: true, userId: true, purpose: true, usedAt: true, expiresAt: true } });
    if (!token || token.userId !== session.userId || token.purpose !== "PHONE_VERIFICATION" || token.usedAt || token.expiresAt <= now) return false;
    const consumed = await tx.securityToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumed.count !== 1) return false;
    await tx.user.update({ where: { id: session.userId }, data: { phoneVerifiedAt: now } });
    await tx.securityToken.updateMany({ where: { userId: session.userId, purpose: "PHONE_VERIFICATION", usedAt: null }, data: { usedAt: now } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "auth.phone_verified", entityType: "User", entityId: session.userId, metadata: { securityTokenId: token.id } } });
    await recordUserEvent(tx, { userId: session.userId, category: "SECURITY", eventType: "PHONE_VERIFIED", objectType: "User", objectId: session.userId });
    return true;
  });
  if (!verified) return apiError("PHONE_CODE_INVALID", "That code is invalid or expired. Request a new code and try again.", 422);
  return apiSuccess({ verified: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
