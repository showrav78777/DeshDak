import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { hashPhoneVerificationCode } from "@/lib/security-secrets";
import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { enqueuePhoneOtp } from "@/modules/notifications/phone-otp-jobs";

export class PhoneOtpIssuanceError extends Error {
  constructor(code: "PHONE_ACCOUNT_CHANGED" | "PHONE_CODE_COOLDOWN" | "PHONE_CODE_GENERATION_FAILED") { super(code); }
}

/**
 * Internal issuance transaction. The future protected route must authenticate,
 * enforce trusted origin + IP/account quotas and certify live-channel readiness.
 * No route or environment flag currently activates queued issuance.
 */
export async function issueQueuedPhoneVerification(tx: Prisma.TransactionClient, input: { userId: string; sessionId: string; expectedPhone: string }) {
  if (!input || typeof input.userId !== "string" || typeof input.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.userId ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionId ?? "") || typeof input.expectedPhone !== "string" || !/^\+8801[3-9]\d{8}$/.test(input.expectedPhone)) throw new PhoneOtpIssuanceError("PHONE_ACCOUNT_CHANGED");
  const { userId, sessionId, expectedPhone } = input;
  const current = await lockActiveAccount(tx, userId, sessionId);
  if (!current?.phone || current.phone !== expectedPhone || current.phoneVerifiedAt) throw new PhoneOtpIssuanceError("PHONE_ACCOUNT_CHANGED");
  const now = new Date();
  // Serialize resends across sessions/devices. Issued tokens remain quota evidence
  // even when consumed or invalidated; IP/account abuse quotas are additional.
  const recent = await tx.securityToken.findFirst({ where: { userId, purpose: "PHONE_VERIFICATION", createdAt: { gt: new Date(now.getTime() - 60_000) } }, select: { id: true } });
  if (recent) throw new PhoneOtpIssuanceError("PHONE_CODE_COOLDOWN");
  let code = "", tokenHash = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const hash = hashPhoneVerificationCode(userId, current.phone, candidate);
    // SecurityToken hashes are unique even after use. Avoid reissuing a historical
    // code or failing the whole transaction on a six-digit collision.
    if (!await tx.securityToken.findUnique({ where: { tokenHash: hash }, select: { id: true } })) { code = candidate; tokenHash = hash; break; }
  }
  if (!code) throw new PhoneOtpIssuanceError("PHONE_CODE_GENERATION_FAILED");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await tx.securityToken.updateMany({ where: { userId, purpose: "PHONE_VERIFICATION", usedAt: null }, data: { usedAt: now } });
  // Never reset or purge the reconciliation state of an already attempted job.
  await tx.notificationDelivery.updateMany({ where: { channel: "SMS", status: "QUEUED", attempts: 0, providerReference: null, notification: { userId, eventType: "PHONE_OTP_DISPATCH", entityType: "SecurityToken" } }, data: { status: "FAILED", failedAt: now, nextAttemptAt: null, lastError: "Replaced by a newer verification request.", securePayloadCiphertext: null, securePayloadIv: null, securePayloadTag: null } });
  const token = await tx.securityToken.create({ data: { userId, purpose: "PHONE_VERIFICATION", tokenHash, expiresAt, createdAt: now } });
  await enqueuePhoneOtp(tx, { userId, sessionId, tokenId: token.id, code });
  await tx.auditLog.create({ data: { actorId: userId, action: "auth.phone_otp_queued", entityType: "SecurityToken", entityId: token.id, metadata: { expiresAt: expiresAt.toISOString(), deliveryStatus: "QUEUED" } } });
  // No code, hashes, recipient, job reference or provider details in the DTO.
  return { requested: true as const, expiresAt, deliveryStatus: "QUEUED" as const };
}
