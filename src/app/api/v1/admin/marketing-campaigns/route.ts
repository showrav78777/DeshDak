import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { MARKETING_FREQUENCY_HOURS, MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT, marketingConsentWhere, marketingEligibleWhere, safeMarketingDeepLink } from "@/modules/notifications/marketing-campaigns";

const audienceSchema = z.object({ targetUserId: z.string().uuid().optional(), accountType: z.enum(["PERSONAL", "BUSINESS"]).optional(), locale: z.enum(["en", "bn"]).optional() });
const campaignSchema = audienceSchema.extend({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(1000), titleBn: z.string().trim().min(3).max(120).optional(), bodyBn: z.string().trim().min(10).max(1000).optional(), deepLink: z.string().trim().max(500).optional(), scheduledFor: z.iso.datetime({ offset: true }).optional() }).superRefine((value, context) => { if (value.deepLink && !safeMarketingDeepLink(value.deepLink)) context.addIssue({ code: "custom", path: ["deepLink"], message: "Use a public DeshDak product, store, help, or trust link." }); });

function audienceFrom(params: URLSearchParams) {
  return audienceSchema.safeParse({ targetUserId: params.get("targetUserId") || undefined, accountType: params.get("accountType") || undefined, locale: params.get("locale") || undefined });
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = audienceFrom(request.nextUrl.searchParams);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the campaign audience filters.", 422);
  const now = new Date();
  const [matchedConsentCount, eligibleCount] = await prisma.$transaction([prisma.notificationPreference.count({ where: marketingConsentWhere(parsed.data) }), prisma.notificationPreference.count({ where: marketingEligibleWhere(parsed.data, now) })]);
  return apiSuccess({ preview: { matchedConsentCount, eligibleCount, frequencySuppressedCount: matchedConsentCount - eligibleCount, frequencyHours: MARKETING_FREQUENCY_HOURS, synchronousRecipientLimit: MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Send a valid Idempotency-Key for this campaign.", 422);
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the campaign content, audience, and public link.", 422, z.treeifyError(parsed.error));
  const scheduledFor = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
  const nowForValidation = Date.now();
  if (scheduledFor && scheduledFor.getTime() < nowForValidation + 5 * 60_000) return apiError("SCHEDULE_TIME_INVALID", "Schedule a campaign at least five minutes in the future.", 422);
  if (scheduledFor && scheduledFor.getTime() > nowForValidation + 365 * 24 * 60 * 60_000) return apiError("SCHEDULE_TIME_INVALID", "Campaigns can be scheduled up to one year ahead.", 422);
  const payload = { ...parsed.data, deepLink: safeMarketingDeepLink(parsed.data.deepLink), scheduledFor: scheduledFor?.toISOString() };
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  try {
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.marketingCampaign.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return { campaign: replay, replay: true };
      }
      const now = new Date();
      const consentWhere = marketingConsentWhere(payload);
      const eligibleWhere = marketingEligibleWhere(payload, now);
      if (scheduledFor) {
        const [matchedConsentCount, eligibleCount] = await Promise.all([tx.notificationPreference.count({ where: consentWhere }), tx.notificationPreference.count({ where: eligibleWhere })]);
        if (eligibleCount > MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT) throw new Error("CAMPAIGN_TOO_LARGE");
        if (!eligibleCount) throw new Error("NO_ELIGIBLE_RECIPIENTS");
        const campaign = await tx.marketingCampaign.create({ data: { campaignCode: `MKT-${randomBytes(10).toString("hex").toUpperCase()}`, idempotencyKey, requestFingerprint: fingerprint, title: payload.title, body: payload.body, titleBn: payload.titleBn ?? null, bodyBn: payload.bodyBn ?? null, deepLink: payload.deepLink, audienceAccountType: payload.accountType ?? null, audienceLocale: payload.locale ?? null, targetUserId: payload.targetUserId ?? null, status: "SCHEDULED", matchedConsentCount, frequencySuppressedCount: matchedConsentCount - eligibleCount, recipientCount: 0, createdById: session.userId, scheduledFor } });
        await tx.auditLog.create({ data: { actorId: session.userId, action: "marketing.campaign_scheduled", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { campaignCode: campaign.campaignCode, scheduledFor: scheduledFor.toISOString(), previewMatchedConsentCount: matchedConsentCount, previewEligibleCount: eligibleCount, audienceAccountType: campaign.audienceAccountType, audienceLocale: campaign.audienceLocale, targetedCustomer: Boolean(campaign.targetUserId), channel: "IN_APP" } } });
        return { campaign, replay: false };
      }
      const [matchedConsentCount, preferences] = await Promise.all([
        tx.notificationPreference.count({ where: consentWhere }),
        tx.notificationPreference.findMany({ where: eligibleWhere, select: { id: true, updatedAt: true, user: { select: { id: true, locale: true, accountType: true } } }, orderBy: { userId: "asc" }, take: MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT + 1 }),
      ]);
      if (preferences.length > MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT) throw new Error("CAMPAIGN_TOO_LARGE");
      if (!preferences.length) throw new Error("NO_ELIGIBLE_RECIPIENTS");
      const campaign = await tx.marketingCampaign.create({ data: { campaignCode: `MKT-${randomBytes(10).toString("hex").toUpperCase()}`, idempotencyKey, requestFingerprint: fingerprint, title: payload.title, body: payload.body, titleBn: payload.titleBn ?? null, bodyBn: payload.bodyBn ?? null, deepLink: payload.deepLink, audienceAccountType: payload.accountType ?? null, audienceLocale: payload.locale ?? null, targetUserId: payload.targetUserId ?? null, matchedConsentCount, frequencySuppressedCount: matchedConsentCount - preferences.length, recipientCount: preferences.length, createdById: session.userId, sentAt: now } });
      const notifications = preferences.map((preference) => ({ id: randomUUID(), userId: preference.user.id, eventType: "MARKETING_CAMPAIGN", category: "MARKETING" as const, priority: "NORMAL" as const, title: payload.title, body: payload.body, titleBn: payload.titleBn ?? null, bodyBn: payload.bodyBn ?? null, deepLink: payload.deepLink, entityType: "MarketingCampaign", entityId: campaign.id, idempotencyKey: `marketing-campaign:${campaign.id}:${preference.user.id}`, createdAt: now }));
      await tx.notification.createMany({ data: notifications });
      await tx.notificationDelivery.createMany({ data: notifications.map((notification) => ({ notificationId: notification.id, channel: "IN_APP" as const, status: "DELIVERED" as const, idempotencyKey: `${notification.id}:in-app`, deliveredAt: now })) });
      await tx.marketingCampaignRecipient.createMany({ data: preferences.map((preference, index) => ({ campaignId: campaign.id, userId: preference.user.id, notificationId: notifications[index].id, localeSnapshot: preference.user.locale, accountTypeSnapshot: preference.user.accountType, consentPreferenceId: preference.id, consentPreferenceUpdatedAt: preference.updatedAt, createdAt: now })) });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "marketing.campaign_sent", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { campaignCode: campaign.campaignCode, matchedConsentCount, frequencySuppressedCount: campaign.frequencySuppressedCount, recipientCount: campaign.recipientCount, audienceAccountType: campaign.audienceAccountType, audienceLocale: campaign.audienceLocale, targetedCustomer: Boolean(campaign.targetUserId), channel: "IN_APP" } } });
      return { campaign, replay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ campaign: { id: result.campaign.id, campaignCode: result.campaign.campaignCode, status: result.campaign.status, matchedConsentCount: result.campaign.matchedConsentCount, frequencySuppressedCount: result.campaign.frequencySuppressedCount, recipientCount: result.campaign.recipientCount, scheduledFor: result.campaign.scheduledFor, sentAt: result.campaign.sentAt }, idempotentReplay: result.replay }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if ((error as Error).message === "IDEMPOTENCY_KEY_REUSED") return apiError("IDEMPOTENCY_KEY_REUSED", "This campaign key was already used with different content or recipients.", 409);
    if ((error as Error).message === "CAMPAIGN_TOO_LARGE") return apiError("CAMPAIGN_TOO_LARGE", "Narrow the audience to 1,000 or fewer eligible customers for local delivery.", 409);
    if ((error as Error).message === "NO_ELIGIBLE_RECIPIENTS") return apiError("NO_ELIGIBLE_RECIPIENTS", "No explicitly opted-in customer is currently eligible for this campaign.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return apiError("CAMPAIGN_RETRY_REQUIRED", "Campaign recipients changed during delivery. Refresh the preview and try again.", 409);
    throw error;
  }
}
