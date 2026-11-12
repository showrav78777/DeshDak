import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

export const phoneOtpOperationsQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["all", "queued", "accepted", "unconfirmed", "cancelled"]).default("unconfirmed") });
export const phoneOtpJobSelect = { id: true, status: true, attempts: true, providerReference: true, sentAt: true, failedAt: true, createdAt: true } satisfies Prisma.NotificationDeliverySelect;
const base = { channel: "SMS" as const, notification: { eventType: "PHONE_OTP_DISPATCH", entityType: "SecurityToken" } };
export function phoneOtpOperationsWhere(state: z.infer<typeof phoneOtpOperationsQuery>["state"]): Prisma.NotificationDeliveryWhereInput {
  if (state === "queued") return { ...base, status: "QUEUED", attempts: 0 };
  if (state === "accepted") return { ...base, status: "SENT", attempts: 1, providerReference: { not: null } };
  if (state === "unconfirmed") return { ...base, attempts: { gt: 0 }, providerReference: null };
  if (state === "cancelled") return { ...base, status: "FAILED", attempts: 0 };
  return base;
}
export function phoneOtpJobLabel(row: { status: string; attempts: number; providerReference: string | null }) {
  if (row.attempts > 0 && !row.providerReference) return "Unconfirmed attempt — reconcile";
  if (row.status === "SENT" && row.attempts === 1 && row.providerReference) return "Accepted — delivery unconfirmed";
  if (row.status === "QUEUED" && row.attempts === 0 && !row.providerReference) return "Queued — not attempted";
  if (row.status === "FAILED" && row.attempts === 0 && !row.providerReference) return "Cancelled before sending";
  return "Unexpected state — review required";
}

/** No decryption or sending. Purge only obsolete, never-attempted OTP payloads. */
export async function purgeObsoletePhoneOtpJobs(db: PrismaClient | Prisma.TransactionClient, batchSize = 100) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Invalid OTP cleanup batch size.");
  const candidates = await db.notificationDelivery.findMany({ where: { ...base, status: "QUEUED", attempts: 0, providerReference: null }, select: { id: true, notification: { select: { userId: true, entityId: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: batchSize });
  let purged = 0;
  for (const candidate of candidates) {
    // Match ownership and purpose as well as identity. Do not follow arbitrary tokens.
    const token = candidate.notification.entityId ? await db.securityToken.findFirst({ where: { id: candidate.notification.entityId, userId: candidate.notification.userId, purpose: "PHONE_VERIFICATION" }, select: { usedAt: true, expiresAt: true } }) : null;
    if (token && !token.usedAt && token.expiresAt > new Date()) continue;
    const purgeCandidate = async (tx: Prisma.TransactionClient) => {
      const changed = await tx.notificationDelivery.updateMany({ where: { ...base, id: candidate.id, status: "QUEUED", attempts: 0, providerReference: null }, data: { status: "FAILED", failedAt: new Date(), nextAttemptAt: null, lastError: "Verification token expired, was invalidated or is no longer retained.", securePayloadCiphertext: null, securePayloadIv: null, securePayloadTag: null } });
      if (changed.count === 1) await tx.auditLog.create({ data: { action: "auth.phone_otp_payload_purged", entityType: "NotificationDelivery", entityId: candidate.id, metadata: { reason: "TOKEN_NO_LONGER_ELIGIBLE" } } });
      return changed.count;
    };
    purged += "$transaction" in db ? await db.$transaction(purgeCandidate) : await purgeCandidate(db);
  }
  return { inspected: candidates.length, purged };
}
