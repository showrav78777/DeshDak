import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { ticketMessageSchema } from "@/modules/support/schemas";
import { isAdminSupportObserver, isAssignedSupportAgent, isTicketCustomer, recordSupportAccessDenied } from "@/modules/support/service";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/tickets/[ticketId]/messages">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to send a support message.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This update must originate from the protected application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = ticketMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the message.", 422);
  const { ticketId } = await context.params;
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, reference: true, subject: true, customerId: true, assignedAgentId: true, status: true, version: true, firstResponseAt: true, conversation: { select: { id: true } } } });
  if (!ticket || !ticket.conversation) return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  const adminObserver = isAdminSupportObserver(session);
  const assignedAgent = isAssignedSupportAgent(session, ticket);
  const customer = isTicketCustomer(session, ticket);
  if (adminObserver) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: ticket.id, operation: "message.create.admin_observer", portal: session.portal });
    return apiError("SUPPORT_REPLY_ROLE_REQUIRED", "Only the assigned Customer Service agent can reply to customers or add internal notes.", 403);
  }
  if (!assignedAgent && !customer) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: ticket.id, operation: "message.create", portal: session.portal });
    return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  }
  if (parsed.data.internalNote && !assignedAgent) {
    await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: ticket.id, operation: "message.internal_note", portal: session.portal });
    return apiError("INTERNAL_NOTE_FORBIDDEN", "Only the assigned Customer Service agent can create internal notes.", 403);
  }
  if (ticket.status === "CLOSED") return apiError("TICKET_CLOSED", "This support request is closed. Open a new request if you need more help.", 409);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ ticketId: ticket.id, senderId: session.userId, body: parsed.data.body, attachmentReferences: parsed.data.attachmentReferences, internalNote: parsed.data.internalNote })).digest("hex");
  const replay = await prisma.conversationMessage.findUnique({ where: { idempotencyKey }, select: { id: true, createdAt: true, conversationId: true, senderId: true, requestFingerprint: true } });
  if (replay) {
    if (replay.conversationId !== ticket.conversation.id || replay.senderId !== session.userId || replay.requestFingerprint !== requestFingerprint) return apiError("IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used for a different message.", 409);
    return apiSuccess({ message: { id: replay.id, createdAt: replay.createdAt }, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  const now = new Date();
  const nextStatus = parsed.data.internalNote ? ticket.status : assignedAgent ? "WAITING_FOR_CUSTOMER" as const : "WAITING_FOR_SUPPORT" as const;
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    const changed = await tx.ticket.updateMany({ where: { id: ticket.id, version: ticket.version }, data: { status: nextStatus, version: { increment: 1 }, ...(assignedAgent && !parsed.data.internalNote && !ticket.firstResponseAt ? { firstResponseAt: now } : {}), ...(ticket.status === "RESOLVED" && customer ? { resolvedAt: null } : {}) } });
    if (changed.count !== 1) return null;
    const message = await tx.conversationMessage.create({ data: { idempotencyKey, requestFingerprint, conversationId: ticket.conversation!.id, senderId: session.userId, body: parsed.data.body, attachmentRefs: parsed.data.attachmentReferences.length ? parsed.data.attachmentReferences : undefined, internalNote: parsed.data.internalNote } });
    await tx.conversation.update({ where: { id: ticket.conversation!.id }, data: { lastMessageAt: now, status: "OPEN" } });
    if (nextStatus !== ticket.status) await tx.ticketEvent.create({ data: { ticketId: ticket.id, fromStatus: ticket.status, toStatus: nextStatus, actorId: session.userId, note: parsed.data.internalNote ? "Internal note added." : assignedAgent ? "Customer Service replied." : "Customer replied.", idempotencyKey: `ticket-message-event:${idempotencyKey}` } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: parsed.data.internalNote ? "ticket.internal_note_added" : assignedAgent ? "ticket.staff_replied" : "ticket.customer_replied", entityType: "Ticket", entityId: ticket.id, metadata: { messageId: message.id, attachmentCount: parsed.data.attachmentReferences.length } } });
    if (!parsed.data.internalNote && assignedAgent) await createTransactionalNotification(tx, { userId: ticket.customerId, eventType: "TICKET_REPLY", title: `Reply on ${ticket.reference}`, body: parsed.data.body.slice(0, 300), deepLink: `/support/${ticket.id}`, entityType: "Ticket", entityId: ticket.id, idempotencyKey: `ticket-notification:reply:${message.id}` });
    if (!parsed.data.internalNote && customer && ticket.assignedAgentId) await createTransactionalNotification(tx, { userId: ticket.assignedAgentId, eventType: "TICKET_CUSTOMER_REPLY", title: `${ticket.reference}: customer replied`, body: ticket.subject, deepLink: `/support/tickets/${ticket.reference}`, entityType: "Ticket", entityId: ticket.id, priority: "HIGH", channels: ["IN_APP"], idempotencyKey: `ticket-notification:customer-reply:${message.id}` });
    return message;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedReplay = await prisma.conversationMessage.findUnique({ where: { idempotencyKey }, select: { id: true, createdAt: true, conversationId: true, senderId: true, requestFingerprint: true } });
      if (racedReplay?.conversationId === ticket.conversation.id && racedReplay.senderId === session.userId && racedReplay.requestFingerprint === requestFingerprint) return apiSuccess({ message: { id: racedReplay.id, createdAt: racedReplay.createdAt }, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
      return apiError("IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used for a different message.", 409);
    }
    throw error;
  }
  if (!result) return apiError("TICKET_STATE_CHANGED", "The support request changed while your message was saved. Refresh and try again.", 409);
  return apiSuccess({ message: result, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
