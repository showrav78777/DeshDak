import type { Prisma, PrismaClient } from "@prisma/client";

import { ROLE } from "@/lib/roles";
import { ACTIVE_TICKET_STATUSES, getSupportOperatingPolicy } from "@/modules/support/policy";

type TransactionClient = Prisma.TransactionClient | PrismaClient;
type SupportSession = { userId: string; roles: string[]; portal: string };
type TicketAccessRecord = { id?: string; customerId: string; assignedAgentId: string | null };

export async function findLeastLoadedSupportAgent(tx: TransactionClient) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
  const now = new Date();
  const policy = await getSupportOperatingPolicy(tx);
  const scheduledAgentIds = policy.requireScheduledShift ? new Set((await tx.supportShift.findMany({ where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } }, select: { agentId: true } })).map((shift) => shift.agentId)) : null;
  const agents = await tx.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } },
    select: { id: true, supportAgentProfile: { select: { availability: true, acceptingNewTickets: true, maxActiveTickets: true } }, _count: { select: { assignedSupportTickets: { where: { status: { in: ACTIVE_TICKET_STATUSES } } } } } },
    orderBy: { id: "asc" },
  });
  return agents
    .filter((agent) => (!scheduledAgentIds || scheduledAgentIds.has(agent.id)) && (!agent.supportAgentProfile || (agent.supportAgentProfile.availability === "AVAILABLE" && agent.supportAgentProfile.acceptingNewTickets)) && agent._count.assignedSupportTickets < (agent.supportAgentProfile?.maxActiveTickets ?? 20))
    .sort((left, right) => {
      const leftRatio = left._count.assignedSupportTickets / (left.supportAgentProfile?.maxActiveTickets ?? 20);
      const rightRatio = right._count.assignedSupportTickets / (right.supportAgentProfile?.maxActiveTickets ?? 20);
      return leftRatio - rightRatio || left._count.assignedSupportTickets - right._count.assignedSupportTickets || left.id.localeCompare(right.id);
    })[0]?.id ?? null;
}

export async function supportAgentCapacity(client: TransactionClient, agentId: string) {
  const [agent, policy] = await Promise.all([client.user.findFirst({
    where: { id: agentId, deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } },
    select: { id: true, supportAgentProfile: { select: { availability: true, acceptingNewTickets: true, maxActiveTickets: true } }, _count: { select: { assignedSupportTickets: { where: { status: { in: ACTIVE_TICKET_STATUSES } } } } } },
  }), getSupportOperatingPolicy(client)]);
  if (!agent) return { eligible: false, reason: "NOT_ACTIVE" as const, activeTickets: 0, maxActiveTickets: 0 };
  const maxActiveTickets = agent.supportAgentProfile?.maxActiveTickets ?? 20;
  const activeTickets = agent._count.assignedSupportTickets;
  if (policy.requireScheduledShift) {
    const now = new Date();
    const scheduled = await client.supportShift.count({ where: { agentId, status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } } });
    if (!scheduled) return { eligible: false, reason: "OUTSIDE_SHIFT" as const, activeTickets, maxActiveTickets };
  }
  if (agent.supportAgentProfile && (agent.supportAgentProfile.availability !== "AVAILABLE" || !agent.supportAgentProfile.acceptingNewTickets)) return { eligible: false, reason: "NOT_ACCEPTING" as const, activeTickets, maxActiveTickets };
  if (activeTickets >= maxActiveTickets) return { eligible: false, reason: "AT_CAPACITY" as const, activeTickets, maxActiveTickets };
  return { eligible: true, reason: null, activeTickets, maxActiveTickets };
}

export function isAdminSupportObserver(session: SupportSession) {
  return session.roles.includes(ROLE.ADMIN) && session.portal === "admin";
}

export function isAssignedSupportAgent(session: SupportSession, ticket: TicketAccessRecord) {
  return session.roles.includes(ROLE.CUSTOMER_SERVICE) && session.portal === "support" && ticket.assignedAgentId === session.userId;
}

export function isTicketCustomer(session: SupportSession, ticket: TicketAccessRecord) {
  return session.portal === "customer" && session.roles.includes(ROLE.CUSTOMER_PERSONAL) && ticket.customerId === session.userId;
}

export function canAccessTicket(session: SupportSession, ticket: TicketAccessRecord) {
  return isAdminSupportObserver(session) || isAssignedSupportAgent(session, ticket) || isTicketCustomer(session, ticket);
}

export function canViewInternalSupportContent(session: SupportSession, ticket: TicketAccessRecord) {
  return isAdminSupportObserver(session) || isAssignedSupportAgent(session, ticket);
}

export async function recordSupportAccessDenied(client: TransactionClient, input: { actorId: string; ticketId: string; operation: string; portal: string }) {
  await client.auditLog.create({
    data: {
      actorId: input.actorId,
      action: "ticket.access_denied",
      entityType: "Ticket",
      entityId: input.ticketId,
      metadata: { operation: input.operation, portal: input.portal },
    },
  });
}
