import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ROLE } from "@/lib/roles";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

export const phoneOtpInvestigationSchema = z.object({ reviewed: z.literal(true) }).strict();
export const PHONE_OTP_REVIEW_ACTION = "auth.phone_otp_investigation_acknowledged";

export function canAcknowledgePhoneOtpAttempt(job: { attempts: number; status: string; providerReference: string | null }) {
  return job.attempts === 1 && job.providerReference === null && ["SENT", "QUEUED", "FAILED"].includes(job.status);
}

/** One immutable acknowledgement per job, serialized with sender acknowledgement. */
export async function acknowledgePhoneOtpInvestigation(tx: Prisma.TransactionClient, actorId: string, sessionId: string, jobId: string) {
  const actor = await lockActiveAccount(tx, actorId, sessionId);
  if (!actor) return { outcome: "DENIED" as const };
  await tx.$queryRaw`SELECT "id" FROM "NotificationDelivery" WHERE "id" = ${jobId} FOR UPDATE`;
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
  const role = await tx.userRole.findFirst({ where: { userId: actorId, role: { code: ROLE.ADMIN } }, select: { userId: true } });
  if (!session?.mfaVerifiedAt || session.portal !== "admin" || session.expiresAt <= new Date() || !role) return { outcome: "DENIED" as const };
  const job = await tx.notificationDelivery.findUnique({ where: { id: jobId }, select: { channel: true, status: true, attempts: true, providerReference: true, notification: { select: { eventType: true, entityType: true } } } });
  if (!job || job.channel !== "SMS" || job.notification.eventType !== "PHONE_OTP_DISPATCH" || job.notification.entityType !== "SecurityToken") return { outcome: "CONFLICT" as const };
  const previous = await tx.auditLog.findFirst({ where: { action: PHONE_OTP_REVIEW_ACTION, entityType: "NotificationDelivery", entityId: jobId }, select: { id: true } });
  if (previous) return { outcome: "ACKNOWLEDGED" as const, replayed: true };
  if (!canAcknowledgePhoneOtpAttempt(job)) return { outcome: "CONFLICT" as const };
  await tx.auditLog.create({ data: { actorId, action: PHONE_OTP_REVIEW_ACTION, entityType: "NotificationDelivery", entityId: jobId, metadata: { reviewed: true, outcome: "INVESTIGATION_ONLY" } } });
  return { outcome: "ACKNOWLEDGED" as const, replayed: false };
}
