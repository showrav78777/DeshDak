import "server-only";
import type { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;
export const emailEventTypes = ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"] as const;
const suppressionTypes = new Set(["email.bounced", "email.complained", "email.suppressed"]);

export async function lockEmailReference(tx: Transaction, reference: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deshdak:email-reference:${reference}`}, 0))`;
}
export async function lockEmailRecipient(tx: Transaction, hash: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deshdak:email-recipient:${hash}`}, 0))`;
}

/** Caller holds the reference lock. Pending receipts cover callback-before-send-commit races. */
export async function applyPendingEmailEvents(tx: Transaction, reference: string) {
  const matches = await tx.notificationDelivery.findMany({ where: { channel: "EMAIL", providerReference: reference }, take: 2 });
  if (matches.length !== 1) return;
  let delivery = matches[0];
  const pending = await tx.emailWebhookEvent.findMany({ where: { providerReference: reference, processedAt: null }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1001 });
  if (pending.length > 1000) throw new Error("EMAIL_RECEIPT_REVIEW_REQUIRED");
  for (const event of pending) {
    const negative = suppressionTypes.has(event.eventType);
    // Legacy records without a recipient snapshot require evidence review.
    if (negative && !delivery.recipientHash) continue;
    if (negative && delivery.recipientHash) {
      await lockEmailRecipient(tx, delivery.recipientHash);
      const current = await tx.emailSuppression.findUnique({ where: { recipientHash: delivery.recipientHash } });
      if (!current) {
        await tx.emailSuppression.create({ data: { recipientHash: delivery.recipientHash, reason: event.eventType, sourceDeliveryId: delivery.id, lastSeenAt: event.occurredAt } });
      } else if ((!current.releasedAt || event.occurredAt > current.releasedAt) && event.occurredAt >= current.lastSeenAt) {
        await tx.emailSuppression.update({ where: { id: current.id }, data: { active: true, reason: event.eventType, sourceDeliveryId: delivery.id, lastSeenAt: event.occurredAt, version: { increment: 1 } } });
      }
    }
    const latest = !delivery.providerEventAt || event.occurredAt >= delivery.providerEventAt;
    const terminal = suppressionTypes.has(delivery.providerEventType ?? "");
    let applied = false;
    if (negative) {
      delivery = await tx.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", failedAt: event.occurredAt, nextAttemptAt: null, lastError: "Recipient delivery was rejected or suppressed; review is required.", providerEventType: event.eventType, providerEventAt: latest ? event.occurredAt : delivery.providerEventAt } });
      applied = true;
    } else if (latest && !terminal) {
      const confirmed = ["DELIVERED", "READ"].includes(delivery.status);
      if (event.eventType === "email.delivered") {
        delivery = await tx.notificationDelivery.update({ where: { id: delivery.id }, data: { status: delivery.status === "READ" ? "READ" : "DELIVERED", deliveredAt: event.occurredAt, failedAt: null, lastError: null, nextAttemptAt: null, providerEventAt: event.occurredAt, providerEventType: event.eventType } });
        applied = true;
      } else if (!confirmed) {
        delivery = await tx.notificationDelivery.update({ where: { id: delivery.id }, data: { status: event.eventType === "email.failed" ? "FAILED" : "SENT", failedAt: event.eventType === "email.failed" ? event.occurredAt : null, lastError: event.eventType === "email.failed" ? "The email provider confirmed a send failure." : null, nextAttemptAt: null, providerEventAt: event.occurredAt, providerEventType: event.eventType } });
        applied = true;
      }
    }
    await tx.emailWebhookEvent.update({ where: { id: event.id }, data: { deliveryId: delivery.id, processedAt: new Date(), outcome: applied ? "APPLIED" : "IGNORED" } });
    await tx.auditLog.create({ data: { action: "notification.email_receipt_recorded", entityType: "NotificationDelivery", entityId: delivery.id, metadata: { eventId: event.id, eventType: event.eventType, outcome: applied ? "APPLIED" : "IGNORED" } } });
  }
}
