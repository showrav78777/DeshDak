import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptOutboxPayload } from "@/lib/security-secrets";
import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { openPhoneOtpForDispatch, sealPhoneOtpPayload, PhoneOtpPayloadError } from "@/modules/notifications/phone-otp-payload";

const EVENT = "PHONE_OTP_DISPATCH";
const UNKNOWN = "SMS acceptance is unconfirmed. Reconcile before any further action; do not retry.";
const purge = { securePayloadCiphertext: null, securePayloadIv: null, securePayloadTag: null };
type JobIdentity = { userId: string; sessionId: string; tokenId: string };
type Sender = { submitOtp: (input: { recipient: string; code: string; clientReference: string; expiresAt: Date }) => Promise<{ state: "ACCEPTED"; clientReference: string; providerReference: string }> };
function id(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }

async function context(tx: Prisma.TransactionClient, identity: JobIdentity) {
  const user = await lockActiveAccount(tx, identity.userId, identity.sessionId);
  await tx.$queryRaw`SELECT "id" FROM "SecurityToken" WHERE "id" = ${identity.tokenId} FOR UPDATE`;
  const token = await tx.securityToken.findUnique({ where: { id: identity.tokenId } });
  if (!user?.phone || !token || token.userId !== identity.userId || token.purpose !== "PHONE_VERIFICATION") throw new PhoneOtpPayloadError();
  return { ...identity, phone: user.phone, tokenHash: token.tokenHash, expiresAt: token.expiresAt, accountActive: true, sessionActive: true, phoneVerified: user.phoneVerifiedAt !== null, tokenUsed: token.usedAt !== null };
}

/** Caller owns the token-issuance transaction. No route currently invokes this. */
export async function enqueuePhoneOtp(tx: Prisma.TransactionClient, identity: JobIdentity & { code: string }) {
  if (!id(identity.userId) || !id(identity.sessionId) || !id(identity.tokenId)) throw new PhoneOtpPayloadError();
  const current = await context(tx, identity);
  if (current.phoneVerified || current.tokenUsed) throw new PhoneOtpPayloadError();
  const encrypted = sealPhoneOtpPayload(current, identity.code);
  const key = `phone-otp:${identity.tokenId}`;
  // Account + token locks serialize concurrent producers; never recreate a consumed job.
  const existing = await tx.notificationDelivery.findUnique({ where: { idempotencyKey: `${key}:sms` }, select: { id: true, notification: { select: { userId: true, entityId: true, eventType: true } } } });
  if (existing) {
    if (existing.notification.userId !== identity.userId || existing.notification.entityId !== identity.tokenId || existing.notification.eventType !== EVENT) throw new PhoneOtpPayloadError();
    return { id: existing.id, created: false };
  }
  const notification = await tx.notification.create({ data: {
    userId: identity.userId, eventType: EVENT, category: "SECURITY", priority: "HIGH",
    title: "Phone verification requested", body: "A phone verification request is awaiting processing.",
    titleBn: "ফোন যাচাইকরণ অনুরোধ", bodyBn: "ফোন যাচাইকরণের অনুরোধ প্রক্রিয়াকরণের অপেক্ষায় আছে।",
    entityType: "SecurityToken", entityId: identity.tokenId, idempotencyKey: key,
    deliveries: { create: { channel: "SMS", status: "QUEUED", idempotencyKey: `${key}:sms`, nextAttemptAt: new Date(), ...encrypted } },
  }, select: { deliveries: { select: { id: true } } } });
  return { id: notification.deliveries[0].id, created: true };
}

/**
 * Internal worker core. No scheduler, route, environment flag or Admin toggle
 * activates it. The caller must supply a reviewed sender and explicitly approve.
 * A committed attempt is NEVER reclaimed, including after process death.
 */
export async function runPhoneOtpJobs(db: PrismaClient, sender: Sender, options: { approved?: boolean; batchSize?: number } = {}) {
  const result = { configured: false, claimed: 0, accepted: 0, cancelled: 0, unconfirmed: 0 };
  if (options.approved !== true) return result;
  if (!Number.isInteger(options.batchSize ?? 25) || (options.batchSize ?? 25) < 1 || (options.batchSize ?? 25) > 100) throw new Error("Invalid SMS batch size.");
  if (!sender || typeof sender.submitOtp !== "function") throw new Error("A reviewed SMS sender is required.");
  result.configured = true;
  const eligible = { channel: "SMS" as const, status: "QUEUED" as const, attempts: 0, providerReference: null, notification: { eventType: EVENT, entityType: "SecurityToken" }, nextAttemptAt: { lte: new Date() } };
  const candidates = await db.notificationDelivery.findMany({ where: eligible, select: { id: true, notification: { select: { userId: true, entityId: true } }, securePayloadCiphertext: true, securePayloadIv: true, securePayloadTag: true }, orderBy: { createdAt: "asc" }, take: options.batchSize ?? 25 });
  for (const candidate of candidates) {
    const prepared = await db.$transaction(async tx => {
      let input: Parameters<Sender["submitOtp"]>[0];
      try {
        if (!candidate.securePayloadCiphertext || candidate.securePayloadCiphertext.length > 4096 || candidate.securePayloadIv?.length !== 16 || candidate.securePayloadTag?.length !== 24) throw new PhoneOtpPayloadError();
        const encrypted = { securePayloadCiphertext: candidate.securePayloadCiphertext, securePayloadIv: candidate.securePayloadIv, securePayloadTag: candidate.securePayloadTag };
        let raw: Record<string, unknown>;
        try { raw = decryptOutboxPayload(encrypted); } catch { throw new Error("Encrypted SMS payload requires operator review."); }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PhoneOtpPayloadError();
        if (!id(raw.sessionId) || !id(candidate.notification.entityId)) throw new PhoneOtpPayloadError();
        const current = await context(tx, { userId: candidate.notification.userId, sessionId: raw.sessionId, tokenId: candidate.notification.entityId });
        input = openPhoneOtpForDispatch(encrypted, current);
      } catch (error) {
        // Only known validation failures are terminal. Database failures must roll
        // back and surface to the operator rather than discard a valid job.
        if (!(error instanceof PhoneOtpPayloadError)) throw error;
        const changed = await tx.notificationDelivery.updateMany({ where: { ...eligible, id: candidate.id }, data: { status: "FAILED", failedAt: new Date(), nextAttemptAt: null, lastError: "Phone verification is no longer eligible for dispatch.", ...purge } });
        return { cancelled: changed.count, input: null };
      }
      const claimed = await tx.notificationDelivery.updateMany({ where: { ...eligible, id: candidate.id, securePayloadCiphertext: candidate.securePayloadCiphertext, securePayloadIv: candidate.securePayloadIv, securePayloadTag: candidate.securePayloadTag }, data: { status: "SENT", attempts: 1, sentAt: new Date(), nextAttemptAt: null, lastError: UNKNOWN, ...purge } });
      if (claimed.count === 1) await tx.auditLog.create({ data: { action: "auth.phone_otp_claimed", entityType: "NotificationDelivery", entityId: candidate.id, metadata: { clientReference: input.clientReference } } });
      return { cancelled: 0, input: claimed.count === 1 ? input : null };
    });
    result.cancelled += prepared.cancelled;
    if (!prepared.input) continue;
    result.claimed++;
    const lease = { id: candidate.id, channel: "SMS" as const, status: "SENT" as const, attempts: 1, providerReference: null };
    let acknowledgement: Awaited<ReturnType<Sender["submitOtp"]>>;
    try {
      acknowledgement = await sender.submitOtp(prepared.input);
      if (acknowledgement.state !== "ACCEPTED" || acknowledgement.clientReference !== prepared.input.clientReference || typeof acknowledgement.providerReference !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(acknowledgement.providerReference)) throw new Error("Unconfirmed acknowledgement");
    } catch { result.unconfirmed++; continue; }
    // A persistence failure here surfaces to operations. The durable SENT claim
    // remains uncertain and is never reset/retried by this worker.
    const changed = await db.notificationDelivery.updateMany({ where: lease, data: { providerReference: acknowledgement.providerReference, lastError: null } });
    if (changed.count === 1) result.accepted++; else result.unconfirmed++;
  }
  return result;
}
