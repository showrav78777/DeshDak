import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { calculateSupportSla, ticketSlaState } from "@/modules/support/policy";
import { createTicketSchema } from "@/modules/support/schemas";
import { findLeastLoadedSupportAgent, recordSupportAccessDenied } from "@/modules/support/service";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer sign-in is required.", 401);
  const tickets = await prisma.ticket.findMany({ where: { customerId: session.userId }, select: { id: true, reference: true, category: true, subject: true, status: true, priority: true, slaDueAt: true, slaApproachingAt: true, firstResponseAt: true, resolvedAt: true, assignedAgent: { select: { fullName: true } }, conversation: { select: { lastMessageAt: true } }, order: { select: { orderNumber: true } }, rma: { select: { reference: true } }, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 100 });
  return apiSuccess({ tickets: tickets.map((ticket) => ({ ...ticket, slaState: ticketSlaState(ticket) })) }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer sign-in is required.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This request must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = createTicketSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the support request.", 422);
  const replay = await prisma.ticket.findUnique({ where: { idempotencyKey }, select: { id: true, reference: true, status: true, customerId: true } });
  if (replay) {
    if (replay.customerId !== session.userId) {
      await recordSupportAccessDenied(prisma, { actorId: session.userId, ticketId: replay.id, operation: "ticket.create.replay", portal: session.portal });
      return apiError("IDEMPOTENCY_KEY_CONFLICT", "This request key is unavailable. Use a new key for a new support request.", 409);
    }
    return apiSuccess({ ticket: { id: replay.id, reference: replay.reference, status: replay.status }, idempotentReplay: true }, { headers: noStore });
  }
  const input = parsed.data;
  const [order, rma] = await Promise.all([
    input.orderId ? prisma.order.findFirst({ where: { id: input.orderId, customerId: session.userId }, select: { id: true } }) : null,
    input.rmaId ? prisma.rma.findFirst({ where: { id: input.rmaId, customerId: session.userId }, select: { id: true, orderId: true } }) : null,
  ]);
  if (input.orderId && !order) return apiError("ORDER_NOT_FOUND", "The linked order was not found.", 404);
  if (input.rmaId && !rma) return apiError("RMA_NOT_FOUND", "The linked claim was not found.", 404);
  if (order && rma && rma.orderId !== order.id) return apiError("SUPPORT_LINK_MISMATCH", "The selected order and claim do not belong together.", 422);
  const now = new Date();
  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const assignedAgentId = await findLeastLoadedSupportAgent(tx);
      const sla = await calculateSupportSla(tx, now);
      const created = await tx.ticket.create({ data: { reference: createReference("TKT"), idempotencyKey, customerId: session.userId, assignedAgentId, orderId: order?.id ?? rma?.orderId ?? null, rmaId: rma?.id ?? null, category: input.category, subject: input.subject, status: assignedAgentId ? "ASSIGNED" : "OPEN", priority: ["PAYMENT", "RETURN_REFUND"].includes(input.category) ? "HIGH" : "NORMAL", slaDueAt: sla.dueAt, slaApproachingAt: sla.approachingAt, conversation: { create: { lastMessageAt: now, messages: { create: { idempotencyKey: `ticket-initial:${idempotencyKey}`, senderId: session.userId, body: input.body, attachmentRefs: input.attachmentReferences.length ? input.attachmentReferences : undefined } } } }, events: { create: { toStatus: assignedAgentId ? "ASSIGNED" : "OPEN", actorId: session.userId, note: "Customer opened a support ticket.", idempotencyKey: `ticket-created:${idempotencyKey}`, metadata: { category: input.category, attachmentCount: input.attachmentReferences.length, autoAssigned: Boolean(assignedAgentId), slaPolicyVersion: sla.policyVersion } } } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "ticket.customer_created", entityType: "Ticket", entityId: created.id, metadata: { category: created.category, orderId: created.orderId, rmaId: created.rmaId, assignedAgentId: created.assignedAgentId } } });
      await createTransactionalNotification(tx, { userId: session.userId, eventType: "TICKET_CREATED", title: `Support request ${created.reference} received`, body: "Your request is recorded. You can follow every reply from the support center.", deepLink: `/support/${created.id}`, entityType: "Ticket", entityId: created.id, idempotencyKey: `ticket-notification:customer-created:${created.id}` });
      if (assignedAgentId) await createTransactionalNotification(tx, { userId: assignedAgentId, eventType: "TICKET_ASSIGNED", title: `New ticket ${created.reference}`, body: input.subject, deepLink: `/support/tickets/${created.reference}`, entityType: "Ticket", entityId: created.id, priority: created.priority === "HIGH" ? "HIGH" : "NORMAL", channels: ["IN_APP"], idempotencyKey: `ticket-notification:assigned:${created.id}:1` });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ ticket: { id: ticket.id, reference: ticket.reference, status: ticket.status, slaDueAt: ticket.slaDueAt }, idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("TICKET_CREATE_CONFLICT", "This support request was already created.", 409);
    throw error;
  }
}
