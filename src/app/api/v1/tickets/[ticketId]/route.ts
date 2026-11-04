import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ticketSlaState } from "@/modules/support/policy";
import { canAccessTicket, canViewInternalSupportContent, recordSupportAccessDenied } from "@/modules/support/service";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/tickets/[ticketId]">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to view this support request.", 401);
  const { ticketId } = await context.params;
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { customer: { select: { fullName: true, email: true, phone: true, accountType: true } }, assignedAgent: { select: { id: true, fullName: true } }, order: { select: { id: true, orderNumber: true, status: true } }, rma: { select: { id: true, reference: true, status: true } }, conversation: { include: { messages: { include: { sender: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "asc" } } } }, events: { select: { id: true, fromStatus: true, toStatus: true, note: true, occurredAt: true }, orderBy: { occurredAt: "asc" } }, satisfactionRating: { select: { score: true, issueResolved: true, comment: true, ticketVersion: true, submittedAt: true } } } });
  if (!ticket) return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  if (!canAccessTicket(session, ticket)) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: ticket.id, operation: "ticket.read", portal: session.portal });
    return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  }
  const staff = canViewInternalSupportContent(session, ticket);
  const messages = ticket.conversation?.messages.filter((message) => staff || !message.internalNote).map((message) => ({ id: message.id, body: message.body, attachmentReferences: message.attachmentRefs, internalNote: message.internalNote, sender: { fullName: message.sender.fullName }, mine: message.senderId === session.userId, createdAt: message.createdAt })) ?? [];
  return apiSuccess({ ticket: { id: ticket.id, reference: ticket.reference, category: ticket.category, subject: ticket.subject, status: ticket.status, priority: ticket.priority, slaDueAt: ticket.slaDueAt, slaState: ticketSlaState(ticket), firstResponseAt: ticket.firstResponseAt, resolvedAt: ticket.resolvedAt, escalatedAt: ticket.escalatedAt, version: ticket.version, assignedAgent: ticket.assignedAgent, order: ticket.order, rma: ticket.rma, satisfactionRating: ticket.satisfactionRating, messages, events: ticket.events, ...(staff ? { customer: ticket.customer } : {}) } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
