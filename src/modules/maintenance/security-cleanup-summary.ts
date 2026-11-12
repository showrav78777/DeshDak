import "server-only";
import type { Prisma } from "@prisma/client";

/** Whitelist count fields; never render arbitrary JSON or diagnostic strings. */
export function formatSecurityCleanupSummary(summary: Prisma.JsonValue | null) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "No result yet";
  if (summary.reason === "already_running") return "Skipped because another cleanup was running.";
  const labels: Record<string, string> = {
    phoneOtpJobsInspected: "SMS jobs inspected", phoneOtpPayloadsPurged: "SMS payloads removed",
    expiredEmailDeliveriesFailed: "Expired email jobs stopped", protectedPayloadsPurged: "Email payloads removed",
    securityTokensDeleted: "Expired tokens deleted", rateLimitsDeleted: "Stale counters deleted",
    mfaEnrollmentsDeleted: "Expired MFA enrollments deleted", inventoryReservationsReleased: "Inventory reservations released",
    aiConversationsDeleted: "Expired AI conversations deleted",
  };
  const items = Object.entries(labels).flatMap(([key, label]) => {
    const value = summary[key];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [`${label}: ${value}`] : [];
  });
  return items.length ? items.join(" · ") : "No recognized cleanup counts recorded.";
}
