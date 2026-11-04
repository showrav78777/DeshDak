import type { Prisma } from "@prisma/client";

export const CAMPAIGN_REPORT_PAGE_SIZE = 50;

export function normalizeCampaignReportQuery(value: string | null | undefined) {
  return value?.trim().slice(0, 120) ?? "";
}

export function campaignRecipientSearchWhere(query: string): Prisma.MarketingCampaignRecipientWhereInput {
  if (!query) return {};
  return { user: { OR: [{ fullName: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { personCode: { contains: query, mode: "insensitive" } }] } };
}

export const campaignRecipientReportSelect = {
  id: true,
  localeSnapshot: true,
  accountTypeSnapshot: true,
  consentPreferenceUpdatedAt: true,
  createdAt: true,
  user: { select: { id: true, personCode: true, fullName: true, email: true } },
  notification: { select: { id: true, readAt: true, deliveries: { where: { channel: "IN_APP" }, select: { status: true, deliveredAt: true, readAt: true }, take: 1 } } },
} satisfies Prisma.MarketingCampaignRecipientSelect;
