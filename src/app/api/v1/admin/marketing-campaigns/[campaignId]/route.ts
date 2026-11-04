import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { CAMPAIGN_REPORT_PAGE_SIZE, campaignRecipientReportSelect, campaignRecipientSearchWhere, normalizeCampaignReportQuery } from "@/modules/notifications/campaign-report";

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const rawCampaignId = (await context.params).campaignId;
  if (!z.string().uuid().safeParse(rawCampaignId).success) return apiError("VALIDATION_ERROR", "The campaign identifier is invalid.", 422);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1));
  const query = normalizeCampaignReportQuery(request.nextUrl.searchParams.get("q"));
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: rawCampaignId }, select: { id: true, campaignCode: true, title: true, body: true, titleBn: true, bodyBn: true, deepLink: true, status: true, audienceAccountType: true, audienceLocale: true, targetUserId: true, matchedConsentCount: true, frequencySuppressedCount: true, recipientCount: true, scheduledFor: true, sentAt: true, cancelledAt: true, failureCode: true, createdAt: true, createdBy: { select: { id: true, personCode: true, fullName: true } } } });
  if (!campaign) return apiError("CAMPAIGN_NOT_FOUND", "The marketing campaign was not found.", 404);
  const where = { campaignId: campaign.id, ...campaignRecipientSearchWhere(query) };
  const [total, campaignTotal, readCount, recipients] = await prisma.$transaction([
    prisma.marketingCampaignRecipient.count({ where }),
    prisma.marketingCampaignRecipient.count({ where: { campaignId: campaign.id } }),
    prisma.marketingCampaignRecipient.count({ where: { campaignId: campaign.id, notification: { is: { readAt: { not: null } } } } }),
    prisma.marketingCampaignRecipient.findMany({ where, select: campaignRecipientReportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * CAMPAIGN_REPORT_PAGE_SIZE, take: CAMPAIGN_REPORT_PAGE_SIZE }),
  ]);
  return apiSuccess({ campaign, recipients, query, metrics: { recipientCount: campaignTotal, readCount, unreadCount: campaignTotal - readCount, readRatePercent: campaignTotal ? Number(((readCount / campaignTotal) * 100).toFixed(2)) : 0 }, pagination: { page, pageSize: CAMPAIGN_REPORT_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / CAMPAIGN_REPORT_PAGE_SIZE)) } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const campaignId = (await context.params).campaignId;
  if (!z.string().uuid().safeParse(campaignId).success) return apiError("VALIDATION_ERROR", "The campaign identifier is invalid.", 422);
  const body = z.object({ action: z.literal("CANCEL") }).safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("VALIDATION_ERROR", "Choose the supported campaign action.", 422);
  try {
    const campaign = await prisma.$transaction(async (tx) => {
      const cancelledAt = new Date();
      const updated = await tx.marketingCampaign.updateMany({ where: { id: campaignId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelledAt } });
      if (!updated.count) throw new Error("CAMPAIGN_NOT_CANCELLABLE");
      const result = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { id: true, campaignCode: true, status: true, scheduledFor: true, cancelledAt: true } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "marketing.campaign_cancelled", entityType: "MarketingCampaign", entityId: campaignId, metadata: { campaignCode: result.campaignCode, scheduledFor: result.scheduledFor?.toISOString() } } });
      return result;
    });
    return apiSuccess({ campaign }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if ((error as Error).message === "CAMPAIGN_NOT_CANCELLABLE") return apiError("CAMPAIGN_NOT_CANCELLABLE", "Only a campaign waiting for delivery can be cancelled.", 409);
    throw error;
  }
}
