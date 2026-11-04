import type { CustomerAccountType, Prisma } from "@prisma/client";

export const MARKETING_FREQUENCY_HOURS = 24;
export const MARKETING_SYNCHRONOUS_RECIPIENT_LIMIT = 1000;

export type MarketingAudience = { targetUserId?: string; accountType?: CustomerAccountType; locale?: "en" | "bn" };

export function marketingConsentWhere(audience: MarketingAudience): Prisma.NotificationPreferenceWhereInput {
  return {
    category: "MARKETING",
    channel: "IN_APP",
    enabled: true,
    ...(audience.targetUserId ? { userId: audience.targetUserId } : {}),
    user: { is: { status: "ACTIVE", deletedAt: null, roles: { some: { role: { code: { in: ["customer_personal", "customer_business"] } } } }, ...(audience.accountType ? { accountType: audience.accountType } : {}), ...(audience.locale ? { locale: audience.locale } : {}) } },
  };
}

export function marketingEligibleWhere(audience: MarketingAudience, now = new Date()): Prisma.NotificationPreferenceWhereInput {
  const cutoff = new Date(now.getTime() - MARKETING_FREQUENCY_HOURS * 3_600_000);
  const base = marketingConsentWhere(audience);
  return { ...base, user: { is: { ...(base.user && "is" in base.user ? base.user.is : {}), notifications: { none: { category: "MARKETING", createdAt: { gte: cutoff } } } } } };
}

export function safeMarketingDeepLink(value?: string) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const allowed = ["/products", "/stores", "/help", "/trust"];
  return allowed.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)) ? value : null;
}
