import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { ACTIVE_TICKET_STATUSES } from "@/modules/support/policy";

export async function POST(request: Request) {
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) return apiError("MAINTENANCE_NOT_CONFIGURED", "Scheduled maintenance is not configured.", 503);
  if (!authorization.authorized) return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  const now = new Date(); const legacyApproachingAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [tickets, admins] = await Promise.all([
    prisma.ticket.findMany({ where: { status: { in: ACTIVE_TICKET_STATUSES }, firstResponseAt: null, OR: [{ slaDueAt: { lte: now }, slaBreached: false }, { slaDueAt: { gt: now }, escalatedAt: null, OR: [{ slaApproachingAt: { lte: now } }, { slaApproachingAt: null, slaDueAt: { lte: legacyApproachingAt } }] }] }, select: { id: true, reference: true, subject: true, assignedAgentId: true, slaDueAt: true, slaApproachingAt: true, slaBreached: true, escalatedAt: true }, take: 500 }),
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.ADMIN } } } }, select: { id: true } }),
  ]);
  let approaching = 0; let breached = 0;
  for (const ticket of tickets) {
    const isBreached = ticket.slaDueAt <= now;
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticket.id }, data: { escalatedAt: ticket.escalatedAt ?? now, slaBreached: ticket.slaBreached || isBreached } });
      const recipients = [...new Set([ticket.assignedAgentId, ...admins.map((admin) => admin.id)].filter((value): value is string => Boolean(value)))];
      for (const userId of recipients) await createTransactionalNotification(tx, { userId, eventType: isBreached ? "TICKET_SLA_BREACHED" : "TICKET_SLA_APPROACHING", title: `${ticket.reference}: SLA ${isBreached ? "breached" : "approaching"}`, body: ticket.subject, deepLink: userId === ticket.assignedAgentId ? `/support/tickets/${ticket.reference}` : `/admin/support/${ticket.id}`, entityType: "Ticket", entityId: ticket.id, priority: "HIGH", channels: ["IN_APP"], idempotencyKey: `ticket-sla:${isBreached ? "breached" : "approaching"}:${ticket.id}:${userId}` });
      await tx.auditLog.create({ data: { action: isBreached ? "ticket.sla_breached" : "ticket.sla_approaching", entityType: "Ticket", entityId: ticket.id, metadata: { slaDueAt: ticket.slaDueAt.toISOString(), assignedAgentId: ticket.assignedAgentId } } });
    });
    if (isBreached) breached += 1; else approaching += 1;
  }
  return apiSuccess({ examined: tickets.length, approaching, breached, completedAt: new Date().toISOString() });
}
