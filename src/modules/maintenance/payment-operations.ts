import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

export const PAYMENT_OPERATIONS_JOB_KEY = "payment_operations_monitor";
const HOUR = 60 * 60_000;

type Issue = { code: string; entityType: string; entityId: string; reference: string; adminLink: string; financeLink: string };

export async function collectPaymentOperationalIssues(tx: Prisma.TransactionClient, now = new Date()): Promise<Issue[]> {
  const [payments, settlementEntries, refunds] = await Promise.all([
    tx.paymentIntent.findMany({ where: { provider: "SSLCOMMERZ", status: { in: ["CREATED", "PENDING"] }, updatedAt: { lte: new Date(now.getTime() - HOUR) } }, select: { id: true, reference: true, gatewayPayload: true }, take: 250 }),
    tx.paymentSettlementEntry.findMany({ where: { matchStatus: { not: "MATCHED" }, createdAt: { lte: new Date(now.getTime() - 4 * HOUR) }, resolutionDecisions: { none: { decision: "APPROVED" } } }, select: { id: true, batch: { select: { reference: true } } }, take: 250 }),
    tx.refund.findMany({ where: { destination: "ORIGINAL_METHOD", status: "PROCESSING", OR: [{ createdAt: { lte: new Date(now.getTime() - 24 * HOUR) } }, { providerRefundReference: null }] }, select: { id: true, reference: true }, take: 250 }),
  ]);
  const paymentIssues = payments.map((payment) => { const held = Boolean(payment.gatewayPayload && typeof payment.gatewayPayload === "object" && !Array.isArray(payment.gatewayPayload) && payment.gatewayPayload.reviewRequired === true); return { code: held ? "PAYMENT_RISK_REVIEW_OVERDUE" : "PAYMENT_PROCESSING_STUCK", entityType: "PaymentIntent", entityId: payment.id, reference: payment.reference, adminLink: held ? "/admin/payment-risk" : "/admin/payment-reconciliation", financeLink: held ? "/finance" : "/finance/payment-reconciliation" }; });
  return [...paymentIssues, ...settlementEntries.map((entry) => ({ code: "SETTLEMENT_EXCEPTION_OVERDUE", entityType: "PaymentSettlementEntry", entityId: entry.id, reference: entry.batch.reference, adminLink: "/admin/payment-reconciliation", financeLink: "/finance/payment-reconciliation" })), ...refunds.map((refund) => ({ code: "REFUND_PROCESSING_OVERDUE", entityType: "Refund", entityId: refund.id, reference: refund.reference, adminLink: "/admin/refunds", financeLink: "/finance/refunds" }))];
}

export async function runPaymentOperationsMonitor(input: { triggerSource: "SCHEDULER" | "TEST"; now?: Date }) {
  const now = input.now ?? new Date();
  await prisma.maintenanceJobState.upsert({ where: { jobKey: PAYMENT_OPERATIONS_JOB_KEY }, update: {}, create: { jobKey: PAYMENT_OPERATIONS_JOB_KEY } });
  const claimed = await prisma.maintenanceJobState.updateMany({ where: { jobKey: PAYMENT_OPERATIONS_JOB_KEY, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { lockedUntil: new Date(now.getTime() + 10 * 60_000), lastStartedAt: now, lastStatus: "RUNNING", lastErrorCode: null } });
  if (!claimed.count) { const run = await prisma.maintenanceJobRun.create({ data: { jobKey: PAYMENT_OPERATIONS_JOB_KEY, triggerSource: input.triggerSource, status: "SKIPPED", startedAt: now, finishedAt: now, summary: { reason: "already_running" } } }); return { run, skipped: true }; }
  const run = await prisma.maintenanceJobRun.create({ data: { jobKey: PAYMENT_OPERATIONS_JOB_KEY, triggerSource: input.triggerSource, startedAt: now } });
  try {
    const summary = await prisma.$transaction(async (tx) => {
      const [issues, recipients] = await Promise.all([collectPaymentOperationalIssues(tx, now), tx.user.findMany({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: { in: [ROLE.ADMIN, ROLE.FINANCE] } } } } }, select: { id: true, roles: { select: { role: { select: { code: true } } } } } })]);
      const dateBucket = now.toISOString().slice(0, 10); let alertsCreated = 0;
      for (const issue of issues) for (const recipient of recipients) { const finance = recipient.roles.some((item) => item.role.code === ROLE.FINANCE); const notification = await createTransactionalNotification(tx, { userId: recipient.id, eventType: issue.code, title: `${issue.reference} needs financial attention`, body: issue.code.replaceAll("_", " ").toLowerCase(), deepLink: finance ? issue.financeLink : issue.adminLink, entityType: issue.entityType, entityId: issue.entityId, priority: "HIGH", channels: ["IN_APP"], idempotencyKey: `payment-operations:${issue.code}:${issue.entityId}:${recipient.id}:${dateBucket}` }); if (notification.createdAt >= now) alertsCreated += 1; }
      const result = { issues: issues.length, alertsCreated, recipients: recipients.length, byType: issues.reduce<Record<string, number>>((counts, issue) => ({ ...counts, [issue.code]: (counts[issue.code] ?? 0) + 1 }), {}) };
      const finishedAt = new Date(); await tx.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt, summary: result } }); await tx.maintenanceJobState.update({ where: { jobKey: PAYMENT_OPERATIONS_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: finishedAt, lastStatus: "SUCCEEDED", lastSummary: result, lastErrorCode: null } }); await tx.auditLog.create({ data: { action: "payment.operations_monitor_completed", entityType: "MaintenanceJobRun", entityId: run.id, metadata: { triggerSource: input.triggerSource, ...result } } }); return result;
    }, { maxWait: 5_000, timeout: 30_000 });
    return { run: { ...run, status: "SUCCEEDED" as const, summary }, skipped: false };
  } catch { const failedAt = new Date(); await prisma.$transaction([prisma.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: failedAt, errorCode: "PAYMENT_OPERATIONS_MONITOR_FAILED" } }), prisma.maintenanceJobState.update({ where: { jobKey: PAYMENT_OPERATIONS_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: failedAt, lastStatus: "FAILED", lastErrorCode: "PAYMENT_OPERATIONS_MONITOR_FAILED" } })]); throw new Error("PAYMENT_OPERATIONS_MONITOR_FAILED"); }
}
