import "server-only";

import { type Prisma, type SecurityTokenPurpose } from "@prisma/client";
import { encryptOutboxPayload, generateSecurityToken, hashSecurityToken, publicApplicationUrl } from "@/lib/security-secrets";
import { recordUserEvent } from "@/modules/activity/service";

const settings: Record<SecurityTokenPurpose, { ttlMs: number; path: string; eventType: string; title: string; body: string; titleBn: string; bodyBn: string; templateKey: string }> = {
  EMAIL_VERIFICATION: { ttlMs: 24 * 60 * 60_000, path: "/verify-email", eventType: "EMAIL_VERIFICATION_REQUESTED", title: "Verify your email address", body: "A secure email-verification link was requested for your account. The link expires after 24 hours.", titleBn: "আপনার ইমেইল ঠিকানা যাচাই করুন", bodyBn: "আপনার অ্যাকাউন্টের জন্য একটি নিরাপদ ইমেইল যাচাইকরণ লিংক অনুরোধ করা হয়েছে। লিংকটি ২৪ ঘণ্টা পরে মেয়াদোত্তীর্ণ হবে।", templateKey: "security.email_verification" },
  PASSWORD_RESET: { ttlMs: 30 * 60_000, path: "/reset-password", eventType: "PASSWORD_RESET_REQUESTED", title: "Password reset requested", body: "A password reset was requested for your account. The secure email link expires after 30 minutes. Ignore it if you did not make this request.", titleBn: "পাসওয়ার্ড রিসেট অনুরোধ", bodyBn: "আপনার অ্যাকাউন্টের জন্য পাসওয়ার্ড রিসেট অনুরোধ করা হয়েছে। নিরাপদ ইমেইল লিংকটি ৩০ মিনিট পরে মেয়াদোত্তীর্ণ হবে। আপনি অনুরোধ না করলে এটি উপেক্ষা করুন।", templateKey: "security.password_reset" },
  PHONE_VERIFICATION: { ttlMs: 10 * 60_000, path: "/profile", eventType: "PHONE_VERIFICATION_REQUESTED", title: "Verify your phone number", body: "A phone verification code was requested for your account. It expires after 10 minutes.", titleBn: "ফোন নম্বর যাচাই করুন", bodyBn: "আপনার অ্যাকাউন্টের জন্য ফোন যাচাইকরণ কোড অনুরোধ করা হয়েছে। কোডটি ১০ মিনিট পরে মেয়াদোত্তীর্ণ হবে।", templateKey: "security.phone_verification" },
};

export async function issueSecurityToken(tx: Prisma.TransactionClient, user: { id: string; email: string; locale: string }, purpose: SecurityTokenPurpose) {
  const now = new Date(); const config = settings[purpose]; const rawToken = generateSecurityToken(); const expiresAt = new Date(now.getTime() + config.ttlMs);
  await tx.securityToken.updateMany({ where: { userId: user.id, purpose, usedAt: null }, data: { usedAt: now } });
  const token = await tx.securityToken.create({ data: { userId: user.id, purpose, tokenHash: hashSecurityToken(purpose, rawToken), expiresAt } });
  const actionUrl = `${publicApplicationUrl()}${config.path}#token=${encodeURIComponent(rawToken)}`;
  const securePayload = encryptOutboxPayload({ templateKey: config.templateKey, recipient: user.email, locale: user.locale, variables: { actionUrl, expiresAt: expiresAt.toISOString() } });
  await tx.notification.create({ data: { userId: user.id, eventType: config.eventType, category: "SECURITY", priority: "HIGH", title: config.title, body: config.body, titleBn: config.titleBn, bodyBn: config.bodyBn, entityType: "User", entityId: user.id, idempotencyKey: `security-token:${token.id}`, deliveries: { create: { channel: "EMAIL", status: "QUEUED", idempotencyKey: `security-token:${token.id}:email`, nextAttemptAt: now, ...securePayload } } } });
  await tx.auditLog.create({ data: { actorId: user.id, action: `auth.${purpose.toLowerCase()}_requested`, entityType: "SecurityToken", entityId: token.id, metadata: { purpose, expiresAt: expiresAt.toISOString() } } });
  await recordUserEvent(tx, { userId: user.id, category: "SECURITY", eventType: config.eventType, objectType: "SecurityToken", objectId: token.id, metadata: { expiresAt: expiresAt.toISOString() } });
  return { token, rawToken };
}

export function tokenHash(purpose: SecurityTokenPurpose, rawToken: string) {
  return hashSecurityToken(purpose, rawToken);
}
