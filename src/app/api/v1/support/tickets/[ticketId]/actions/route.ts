import type { TicketStatus } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { canTransitionTicket, ticketStatusLabel } from "@/modules/support/policy";
import { ticketActionSchema } from "@/modules/support/schemas";
import { recordSupportAccessDenied, supportAgentCapacity } from "@/modules/support/service";

const ADMIN_OVERSIGHT_ACTIONS = new Set(["ASSIGN", "SET_PRIORITY", "ESCALATE"]);

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/support/tickets/[ticketId]/actions">) {
  const session = await getRequestSession(request);
  const isAdmin = Boolean(session?.roles.includes(ROLE.ADMIN) && session.portal === "admin");
  const isAgent = Boolean(session?.roles.includes(ROLE.CUSTOMER_SERVICE) && session.portal === "support");
  if (!session || (!isAdmin && !isAgent)) return apiError("SUPPORT_ACCESS_REQUIRED", "Customer Service or Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This update must originate from the protected application.", 403);
  const parsed = ticketActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the ticket action.", 422);
  const { ticketId } = await context.params;
  const current = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!current) return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  if (current.version !== parsed.data.version) return apiError("TICKET_STATE_CHANGED", "This support request changed after the page loaded. Refresh before updating it.", 409);
  const action = parsed.data.action;
  if (isAdmin && !ADMIN_OVERSIGHT_ACTIONS.has(action)) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: current.id, operation: `action.${action.toLowerCase()}.admin_observer`, portal: session.portal });
    return apiError("SUPPORT_AGENT_ACTION_REQUIRED", "Only the assigned Customer Service agent can perform customer-support lifecycle actions.", 403);
  }
  if (isAgent && action !== "CLAIM" && current.assignedAgentId !== session.userId) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: current.id, operation: `action.${action.toLowerCase()}`, portal: session.portal });
    return apiError("TICKET_NOT_ASSIGNED", "Only the assigned agent can update this support request.", 403);
  }
  if (action === "CLAIM" && (!isAgent || current.assignedAgentId)) return apiError("TICKET_CLAIM_CONFLICT", "Only an unassigned support request can be claimed by a Customer Service agent.", 409);
  if (action === "ASSIGN" && !isAdmin) return apiError("ADMIN_ACCESS_REQUIRED", "Only Admin can reassign a support request.", 403);
  if (action === "ASSIGN" && !parsed.data.agentId) return apiError("AGENT_REQUIRED", "Choose an active Customer Service agent.", 422);
  if (action === "SET_PRIORITY" && !parsed.data.priority) return apiError("PRIORITY_REQUIRED", "Choose a priority.", 422);
  let assignedAgentId = current.assignedAgentId;
  if (action === "CLAIM") assignedAgentId = session.userId;
  if (action === "ASSIGN") {
    const agent = await prisma.user.findFirst({ where: { id: parsed.data.agentId, deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } }, select: { id: true } });
    if (!agent) return apiError("SUPPORT_AGENT_NOT_FOUND", "The selected Customer Service agent is not active.", 404);
    assignedAgentId = agent.id;
  }
  let nextStatus: TicketStatus = current.status;
  if (["CLAIM", "ASSIGN"].includes(action) && ["OPEN", "WAITING_FOR_SUPPORT"].includes(current.status)) nextStatus = "ASSIGNED";
  if (action === "WAITING_FOR_CUSTOMER") nextStatus = "WAITING_FOR_CUSTOMER";
  if (action === "RESOLVE") nextStatus = "RESOLVED";
  if (action === "REOPEN") nextStatus = "WAITING_FOR_SUPPORT";
  if (action === "CLOSE") nextStatus = "CLOSED";
  if (!["SET_PRIORITY", "ESCALATE"].includes(action) && !canTransitionTicket(current.status, nextStatus)) return apiError("INVALID_TICKET_TRANSITION", `Ticket cannot move from ${ticketStatusLabel(current.status)} to ${ticketStatusLabel(nextStatus)}.`, 409);
  const now = new Date();
  let capacityFailure: Awaited<ReturnType<typeof supportAgentCapacity>> | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    if (["CLAIM", "ASSIGN"].includes(action) && assignedAgentId && assignedAgentId !== current.assignedAgentId) {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
      const capacity = await supportAgentCapacity(tx, assignedAgentId);
      if (!capacity.eligible) { capacityFailure = capacity; return null; }
    }
    const changed = await tx.ticket.updateMany({ where: { id: current.id, version: current.version, assignedAgentId: current.assignedAgentId }, data: { assignedAgentId, status: nextStatus, priority: action === "SET_PRIORITY" ? parsed.data.priority : action === "ESCALATE" ? "URGENT" : current.priority, escalatedAt: action === "ESCALATE" ? now : current.escalatedAt, resolvedAt: action === "RESOLVE" || action === "CLOSE" ? now : action === "REOPEN" ? null : current.resolvedAt, firstResponseAt: action === "WAITING_FOR_CUSTOMER" ? current.firstResponseAt ?? now : current.firstResponseAt, slaBreached: current.slaBreached || (!current.firstResponseAt && current.slaDueAt <= now), version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    if (nextStatus !== current.status || assignedAgentId !== current.assignedAgentId || action === "ESCALATE" || action === "SET_PRIORITY") await tx.ticketEvent.create({ data: { ticketId: current.id, fromStatus: current.status, toStatus: nextStatus, actorId: session.userId, note: parsed.data.note, metadata: { action, assignedAgentId, priority: action === "SET_PRIORITY" ? parsed.data.priority : action === "ESCALATE" ? "URGENT" : current.priority } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `ticket.${action.toLowerCase()}`, entityType: "Ticket", entityId: current.id, metadata: { fromStatus: current.status, toStatus: nextStatus, fromAgentId: current.assignedAgentId, toAgentId: assignedAgentId, note: parsed.data.note } } });
    if (assignedAgentId && assignedAgentId !== current.assignedAgentId) await createTransactionalNotification(tx, { userId: assignedAgentId, eventType: "TICKET_ASSIGNED", title: `Assigned ${current.reference}`, body: current.subject, deepLink: `/support/tickets/${current.reference}`, entityType: "Ticket", entityId: current.id, priority: "HIGH", channels: ["IN_APP"], idempotencyKey: `ticket-notification:assigned:${current.id}:${current.version + 1}` });
    if (["WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"].includes(nextStatus) && nextStatus !== current.status) await createTransactionalNotification(tx, { userId: current.customerId, eventType: `TICKET_${nextStatus}`, title: `${current.reference}: ${ticketStatusLabel(nextStatus)}`, body: parsed.data.note, deepLink: `/support/${current.id}`, entityType: "Ticket", entityId: current.id, priority: nextStatus === "WAITING_FOR_CUSTOMER" ? "HIGH" : "NORMAL", idempotencyKey: `ticket-notification:status:${current.id}:${current.version + 1}` });
    return tx.ticket.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, reference: true, status: true, priority: true, assignedAgentId: true, version: true } });
  });
  const blockedCapacity = capacityFailure as Awaited<ReturnType<typeof supportAgentCapacity>> | null;
  if (blockedCapacity) return apiError("SUPPORT_AGENT_UNAVAILABLE", blockedCapacity.reason === "AT_CAPACITY" ? `This agent has reached the active-ticket limit (${blockedCapacity.activeTickets}/${blockedCapacity.maxActiveTickets}).` : "This Customer Service agent is not accepting new tickets.", 409, blockedCapacity);
  if (!updated) return apiError("TICKET_STATE_CHANGED", "This support request changed while the update was saved. Refresh and review it.", 409);
  return apiSuccess({ ticket: updated }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
