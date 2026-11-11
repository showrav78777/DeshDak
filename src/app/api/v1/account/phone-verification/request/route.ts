import { randomInt } from "node:crypto";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hashSecurityToken } from "@/lib/security-secrets";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getPhoneVerificationMode } from "@/modules/auth/phone-verification-mode";
import { consumeIdentityRequestLimit } from "@/modules/auth/rate-limit";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to verify your phone number.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Phone verification must start from the protected customer application.", 403);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, phone: true, locale: true, phoneVerifiedAt: true } });
  if (!user?.phone) return apiError("PHONE_REQUIRED", "Add a valid phone number to your profile before requesting a verification code.", 422);
  if (user.phoneVerifiedAt) return apiSuccess({ verified: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (getPhoneVerificationMode() === "UNAVAILABLE") return apiError("SMS_PROVIDER_NOT_CONFIGURED", "Phone verification is temporarily unavailable. Please contact support.", 503);
  const limit = await consumeIdentityRequestLimit(request, user.phone, "phone-verification-request");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many verification requests. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.securityToken.updateMany({ where: { userId: user.id, purpose: "PHONE_VERIFICATION", usedAt: null }, data: { usedAt: now } });
    const token = await tx.securityToken.create({ data: { userId: user.id, purpose: "PHONE_VERIFICATION", tokenHash: hashSecurityToken("PHONE_VERIFICATION", code), expiresAt } });
    await tx.notification.create({ data: { userId: user.id, eventType: "PHONE_VERIFICATION_REQUESTED", category: "SECURITY", priority: "HIGH", title: "Phone verification code requested", body: "A development-only verification code was generated. No SMS was sent. It expires after 10 minutes.", titleBn: "ফোন যাচাইকরণ কোড অনুরোধ করা হয়েছে", bodyBn: "শুধু ডেভেলপমেন্ট পরীক্ষার জন্য একটি কোড তৈরি হয়েছে। কোনো এসএমএস পাঠানো হয়নি। কোডটি ১০ মিনিট পরে মেয়াদোত্তীর্ণ হবে।", deepLink: "/profile", entityType: "SecurityToken", entityId: token.id, idempotencyKey: `phone-verification:${token.id}`, deliveries: { create: [{ channel: "IN_APP", status: "DELIVERED", deliveredAt: now, idempotencyKey: `phone-verification:${token.id}:in-app` }] } } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "auth.phone_verification_requested", entityType: "SecurityToken", entityId: token.id, metadata: { expiresAt: expiresAt.toISOString(), deliveryStatus: "DEVELOPMENT_ONLY" } } });
  });
  const developmentCode = code;
  return apiSuccess({ requested: true, expiresAt, developmentCode, deliveryStatus: "DEVELOPMENT_ONLY" }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
