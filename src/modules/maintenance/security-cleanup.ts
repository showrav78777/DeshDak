import "server-only";

import { prisma } from "@/lib/prisma";
import { releaseExpiredInventoryReservations } from "@/modules/inventory/reservations";

import { purgeObsoletePhoneOtpJobs } from "@/modules/notifications/phone-otp-operations";

export const SECURITY_CLEANUP_KEY = "security_cleanup";

export async function getSecurityCleanupConfiguration() {
  return prisma.maintenanceConfiguration.upsert({ where: { key: SECURITY_CLEANUP_KEY }, update: {}, create: { key: SECURITY_CLEANUP_KEY } });
}

export async function runSecurityCleanup(input: { triggerSource: "ADMIN" | "SCHEDULER" | "TEST"; triggeredById?: string | null }) {
  const now = new Date();
  const configuration = await getSecurityCleanupConfiguration();
  await prisma.maintenanceJobState.upsert({ where: { jobKey: SECURITY_CLEANUP_KEY }, update: {}, create: { jobKey: SECURITY_CLEANUP_KEY } });
  const claimed = await prisma.maintenanceJobState.updateMany({
    where: { jobKey: SECURITY_CLEANUP_KEY, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { lockedUntil: new Date(now.getTime() + 10 * 60_000), lastStartedAt: now, lastStatus: "RUNNING", lastErrorCode: null },
  });
  if (!claimed.count) {
    const run = await prisma.maintenanceJobRun.create({ data: { jobKey: SECURITY_CLEANUP_KEY, triggerSource: input.triggerSource, triggeredById: input.triggeredById ?? null, status: "SKIPPED", startedAt: now, finishedAt: now, summary: { reason: "already_running" } } });
    return { run, skipped: true };
  }
  const run = await prisma.maintenanceJobRun.create({ data: { jobKey: SECURITY_CLEANUP_KEY, triggerSource: input.triggerSource, triggeredById: input.triggeredById ?? null, startedAt: now } });
  try {
    const completed = await prisma.$transaction(async (tx) => {
      const tokenRetentionCutoff = new Date(now.getTime() - configuration.securityTokenRetentionDays * 24 * 60 * 60_000);
      const rateLimitCutoff = new Date(now.getTime() - configuration.rateLimitRetentionHours * 60 * 60_000);
      const mfaCutoff = new Date(now.getTime() - configuration.mfaEnrollmentRetentionHours * 60 * 60_000);
      const inactiveTokens = await tx.securityToken.findMany({ where: { OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }] }, select: { id: true, expiresAt: true, usedAt: true }, orderBy: { expiresAt: "asc" }, take: 500 });
      const deliveryKeys = inactiveTokens.map((token) => `security-token:${token.id}:email`);
      const expiredEmailDeliveriesFailed = deliveryKeys.length ? await tx.notificationDelivery.updateMany({ where: { idempotencyKey: { in: deliveryKeys }, status: "QUEUED" }, data: { status: "FAILED", failedAt: now, nextAttemptAt: null, lastError: "Security link expired or was already consumed." } }) : { count: 0 };
      const protectedPayloadsPurged = deliveryKeys.length ? await tx.notificationDelivery.updateMany({ where: { idempotencyKey: { in: deliveryKeys }, securePayloadCiphertext: { not: null } }, data: { securePayloadCiphertext: null, securePayloadIv: null, securePayloadTag: null } }) : { count: 0 };
      const smsCleanup = await purgeObsoletePhoneOtpJobs(tx, 100);
      const deletableTokenIds = inactiveTokens.filter((token) => token.expiresAt <= tokenRetentionCutoff || Boolean(token.usedAt && token.usedAt <= tokenRetentionCutoff)).map((token) => token.id);
      const securityTokensDeleted = deletableTokenIds.length ? await tx.securityToken.deleteMany({ where: { id: { in: deletableTokenIds } } }) : { count: 0 };
      const staleRateLimitIds = await tx.securityRateLimit.findMany({ where: { updatedAt: { lte: rateLimitCutoff }, OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }] }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 1_000 });
      const rateLimitsDeleted = staleRateLimitIds.length ? await tx.securityRateLimit.deleteMany({ where: { id: { in: staleRateLimitIds.map((item) => item.id) } } }) : { count: 0 };
      const expiredMfaIds = await tx.mfaEnrollment.findMany({ where: { expiresAt: { lte: mfaCutoff } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 500 });
      const mfaEnrollmentsDeleted = expiredMfaIds.length ? await tx.mfaEnrollment.deleteMany({ where: { id: { in: expiredMfaIds.map((item) => item.id) } } }) : { count: 0 };
      const inventoryReservationsReleased = await releaseExpiredInventoryReservations(tx, now, configuration.inventoryBatchSize);
      const expiredAiConversationIds = await tx.aiConversation.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 500 });
      const aiConversationsDeleted = expiredAiConversationIds.length ? await tx.aiConversation.deleteMany({ where: { id: { in: expiredAiConversationIds.map((conversation) => conversation.id) } } }) : { count: 0 };
      const summary = { phoneOtpJobsInspected: smsCleanup.inspected, phoneOtpPayloadsPurged: smsCleanup.purged, expiredEmailDeliveriesFailed: expiredEmailDeliveriesFailed.count, protectedPayloadsPurged: protectedPayloadsPurged.count, securityTokensDeleted: securityTokensDeleted.count, rateLimitsDeleted: rateLimitsDeleted.count, mfaEnrollmentsDeleted: mfaEnrollmentsDeleted.count, inventoryReservationsReleased, aiConversationsDeleted: aiConversationsDeleted.count };
      await tx.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), summary } });
      await tx.maintenanceJobState.update({ where: { jobKey: SECURITY_CLEANUP_KEY }, data: { lockedUntil: null, lastFinishedAt: new Date(), lastStatus: "SUCCEEDED", lastSummary: summary, lastErrorCode: null } });
      if (input.triggeredById) await tx.auditLog.create({ data: { actorId: input.triggeredById, action: "maintenance.security_cleanup_completed", entityType: "MaintenanceJobRun", entityId: run.id, metadata: { triggerSource: input.triggerSource, ...summary } } });
      return summary;
    }, { maxWait: 5_000, timeout: 30_000 });
    return { run: { ...run, status: "SUCCEEDED" as const, finishedAt: new Date(), summary: completed }, skipped: false };
  } catch {
    const failedAt = new Date();
    await prisma.$transaction([
      prisma.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: failedAt, errorCode: "MAINTENANCE_RUN_FAILED" } }),
      prisma.maintenanceJobState.update({ where: { jobKey: SECURITY_CLEANUP_KEY }, data: { lockedUntil: null, lastFinishedAt: failedAt, lastStatus: "FAILED", lastErrorCode: "MAINTENANCE_RUN_FAILED" } }),
    ]);
    throw new Error("MAINTENANCE_RUN_FAILED");
  }
}
