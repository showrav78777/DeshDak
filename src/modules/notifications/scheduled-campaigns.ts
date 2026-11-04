import "server-only";

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT, marketingConsentWhere, marketingEligibleWhere, type MarketingAudience } from "@/modules/notifications/marketing-campaigns";

export const MARKETING_CAMPAIGN_JOB_KEY = "marketing_campaign_delivery";
export const MARKETING_CAMPAIGN_JOB_BATCH_SIZE = 25;

async function deliverCampaign(campaignId: string, actorId: string | null, now: Date) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.marketingCampaign.updateMany({ where: { id: campaignId, status: "SCHEDULED", scheduledFor: { lte: now } }, data: { status: "PROCESSING", failureCode: null } });
    if (!claimed.count) return { state: "SKIPPED" as const, recipients: 0 };
    const campaign = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    const audience: MarketingAudience = { targetUserId: campaign.targetUserId ?? undefined, accountType: campaign.audienceAccountType ?? undefined, locale: campaign.audienceLocale === "en" || campaign.audienceLocale === "bn" ? campaign.audienceLocale : undefined };
    const [matchedConsentCount, preferences] = await Promise.all([
      tx.notificationPreference.count({ where: marketingConsentWhere(audience) }),
      tx.notificationPreference.findMany({ where: marketingEligibleWhere(audience, now), select: { id: true, updatedAt: true, user: { select: { id: true, locale: true, accountType: true } } }, orderBy: { userId: "asc" }, take: MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT + 1 }),
    ]);
    if (preferences.length > MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT) {
      await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "FAILED", failureCode: "CAMPAIGN_TOO_LARGE", matchedConsentCount, frequencySuppressedCount: Math.max(0, matchedConsentCount - preferences.length), recipientCount: 0 } });
      await tx.auditLog.create({ data: { actorId, action: "marketing.campaign_delivery_failed", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { campaignCode: campaign.campaignCode, failureCode: "CAMPAIGN_TOO_LARGE", trigger: "SCHEDULED", matchedConsentCount } } });
      return { state: "FAILED" as const, recipients: 0 };
    }
    const notifications = preferences.map((preference) => ({ id: randomUUID(), userId: preference.user.id, eventType: "MARKETING_CAMPAIGN", category: "MARKETING" as const, priority: "NORMAL" as const, title: campaign.title, body: campaign.body, titleBn: campaign.titleBn, bodyBn: campaign.bodyBn, deepLink: campaign.deepLink, entityType: "MarketingCampaign", entityId: campaign.id, idempotencyKey: `marketing-campaign:${campaign.id}:${preference.user.id}`, createdAt: now }));
    if (notifications.length) {
      await tx.notification.createMany({ data: notifications });
      await tx.notificationDelivery.createMany({ data: notifications.map((notification) => ({ notificationId: notification.id, channel: "IN_APP" as const, status: "DELIVERED" as const, idempotencyKey: `${notification.id}:in-app`, deliveredAt: now })) });
      await tx.marketingCampaignRecipient.createMany({ data: preferences.map((preference, index) => ({ campaignId: campaign.id, userId: preference.user.id, notificationId: notifications[index].id, localeSnapshot: preference.user.locale, accountTypeSnapshot: preference.user.accountType, consentPreferenceId: preference.id, consentPreferenceUpdatedAt: preference.updatedAt, createdAt: now })) });
    }
    await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentAt: now, failureCode: null, matchedConsentCount, frequencySuppressedCount: Math.max(0, matchedConsentCount - preferences.length), recipientCount: preferences.length } });
    await tx.auditLog.create({ data: { actorId, action: "marketing.campaign_sent", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { campaignCode: campaign.campaignCode, matchedConsentCount, frequencySuppressedCount: Math.max(0, matchedConsentCount - preferences.length), recipientCount: preferences.length, audienceAccountType: campaign.audienceAccountType, audienceLocale: campaign.audienceLocale, targetedCustomer: Boolean(campaign.targetUserId), channel: "IN_APP", trigger: "SCHEDULED", createdById: campaign.createdById } } });
    return { state: "SENT" as const, recipients: preferences.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

export async function runScheduledMarketingCampaigns(input: { triggerSource: "ADMIN" | "SCHEDULER" | "TEST"; triggeredById?: string | null }) {
  const now = new Date();
  await prisma.maintenanceJobState.upsert({ where: { jobKey: MARKETING_CAMPAIGN_JOB_KEY }, update: {}, create: { jobKey: MARKETING_CAMPAIGN_JOB_KEY } });
  const claimed = await prisma.maintenanceJobState.updateMany({ where: { jobKey: MARKETING_CAMPAIGN_JOB_KEY, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { lockedUntil: new Date(now.getTime() + 10 * 60_000), lastStartedAt: now, lastStatus: "RUNNING", lastErrorCode: null } });
  if (!claimed.count) {
    const run = await prisma.maintenanceJobRun.create({ data: { jobKey: MARKETING_CAMPAIGN_JOB_KEY, triggerSource: input.triggerSource, triggeredById: input.triggeredById ?? null, status: "SKIPPED", startedAt: now, finishedAt: now, summary: { reason: "already_running" } } });
    return { run, skipped: true, summary: { examined: 0, sent: 0, failed: 0, recipients: 0 } };
  }
  const run = await prisma.maintenanceJobRun.create({ data: { jobKey: MARKETING_CAMPAIGN_JOB_KEY, triggerSource: input.triggerSource, triggeredById: input.triggeredById ?? null, startedAt: now } });
  try {
    const due = await prisma.marketingCampaign.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: now } }, select: { id: true }, orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }], take: MARKETING_CAMPAIGN_JOB_BATCH_SIZE });
    let sent = 0; let failed = 0; let recipients = 0;
    for (const campaign of due) {
      try {
        const result = await deliverCampaign(campaign.id, input.triggeredById ?? null, now);
        if (result.state === "SENT") { sent += 1; recipients += result.recipients; }
        else if (result.state === "FAILED") failed += 1;
      } catch {
        failed += 1;
        await prisma.$transaction([
          prisma.marketingCampaign.updateMany({ where: { id: campaign.id, status: { in: ["SCHEDULED", "PROCESSING"] } }, data: { status: "FAILED", failureCode: "DELIVERY_FAILED" } }),
          prisma.auditLog.create({ data: { actorId: input.triggeredById ?? null, action: "marketing.campaign_delivery_failed", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { failureCode: "DELIVERY_FAILED", trigger: "SCHEDULED" } } }),
        ]);
      }
    }
    const summary = { examined: due.length, sent, failed, recipients, remainingMayExist: due.length === MARKETING_CAMPAIGN_JOB_BATCH_SIZE };
    const finishedAt = new Date();
    await prisma.$transaction([
      prisma.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt, summary } }),
      prisma.maintenanceJobState.update({ where: { jobKey: MARKETING_CAMPAIGN_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: finishedAt, lastStatus: "SUCCEEDED", lastSummary: summary, lastErrorCode: null } }),
    ]);
    return { run: { ...run, status: "SUCCEEDED" as const, finishedAt, summary }, skipped: false, summary };
  } catch {
    const failedAt = new Date();
    await prisma.$transaction([
      prisma.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: failedAt, errorCode: "MARKETING_CAMPAIGN_DELIVERY_FAILED" } }),
      prisma.maintenanceJobState.update({ where: { jobKey: MARKETING_CAMPAIGN_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: failedAt, lastStatus: "FAILED", lastErrorCode: "MARKETING_CAMPAIGN_DELIVERY_FAILED" } }),
    ]);
    throw new Error("MARKETING_CAMPAIGN_DELIVERY_FAILED");
  }
}
