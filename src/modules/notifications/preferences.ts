import { NotificationCategory, NotificationChannel, type NotificationPreference } from "@prisma/client";

export const notificationChannels: NotificationChannel[] = ["IN_APP", "EMAIL", "PUSH", "SMS", "WHATSAPP"];
export const notificationCategories: NotificationCategory[] = ["TRANSACTIONAL", "SECURITY", "MARKETING"];

export function notificationPreferencePolicy(category: NotificationCategory, channel: NotificationChannel) {
  const emailConfigured = process.env.EMAIL_DELIVERY_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
  const available = channel === "IN_APP" || (channel === "EMAIL" && emailConfigured);
  const locked = (category === "TRANSACTIONAL" && channel === "IN_APP") || (category === "SECURITY" && (channel === "IN_APP" || channel === "EMAIL"));
  const deliveryState = channel === "IN_APP" ? "ACTIVE" : channel === "EMAIL" && emailConfigured ? "ACTIVE" : channel === "EMAIL" ? "QUEUED_UNTIL_PROVIDER" : "NOT_AVAILABLE";
  return { available, locked, deliveryState } as const;
}

export function notificationPreferenceItems(saved: Pick<NotificationPreference, "category" | "channel" | "enabled" | "locale">[], locale: string) {
  const byKey = new Map(saved.map((item) => [`${item.category}:${item.channel}`, item]));
  return notificationCategories.flatMap((category) => notificationChannels.map((channel) => {
    const current = byKey.get(`${category}:${channel}`);
    const policy = notificationPreferencePolicy(category, channel);
    const defaultEnabled = policy.available && category !== "MARKETING";
    return { category, channel, enabled: policy.locked || (policy.available && (current?.enabled ?? defaultEnabled)), locale: current?.locale ?? locale, ...policy };
  }));
}
