import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifyHuman } from "@/lib/human-verification";
import { consumeConfirmationLimit } from "@/modules/auth/rate-limit";
import { tokenHash } from "@/modules/auth/security-token-service";
import { recordUserEvent } from "@/modules/activity/service";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VERIFICATION_LINK_INVALID", "This verification link is invalid or expired.", 422);
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "email_verification_confirm"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const limit = await consumeConfirmationLimit(request, "email-verification-confirm");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many attempts. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const token = await tx.securityToken.findUnique({ where: { tokenHash: tokenHash("EMAIL_VERIFICATION", parsed.data.token) }, include: { user: { select: { id: true, status: true, deletedAt: true } } } });
    if (!token || token.purpose !== "EMAIL_VERIFICATION" || token.usedAt || token.expiresAt <= now || token.user.deletedAt) return null;
    const consumed = await tx.securityToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumed.count !== 1) return null;
    if (token.user.status === "PENDING_VERIFICATION") await tx.user.update({ where: { id: token.user.id }, data: { status: "ACTIVE" } });
    await tx.securityToken.updateMany({ where: { userId: token.user.id, purpose: "EMAIL_VERIFICATION", usedAt: null }, data: { usedAt: now } });
    await tx.notification.create({ data: { userId: token.user.id, eventType: "EMAIL_VERIFIED", category: "SECURITY", title: "Email address verified", body: "Your email address was verified successfully.", titleBn: "ইমেইল ঠিকানা যাচাই হয়েছে", bodyBn: "আপনার ইমেইল ঠিকানা সফলভাবে যাচাই হয়েছে।", entityType: "User", entityId: token.user.id, idempotencyKey: `email-verified:${token.id}`, deliveries: { create: { channel: "IN_APP", status: "DELIVERED", deliveredAt: now, idempotencyKey: `email-verified:${token.id}:in-app` } } } });
    await tx.auditLog.create({ data: { actorId: token.user.id, action: "auth.email_verified", entityType: "User", entityId: token.user.id, metadata: { securityTokenId: token.id } } });
    await recordUserEvent(tx, { userId: token.user.id, category: "SECURITY", eventType: "EMAIL_VERIFIED", objectType: "User", objectId: token.user.id });
    return token.user.id;
  });
  if (!result) return apiError("VERIFICATION_LINK_INVALID", "This verification link is invalid or expired.", 422);
  return apiSuccess({ verified: true, nextAction: "SIGN_IN" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
