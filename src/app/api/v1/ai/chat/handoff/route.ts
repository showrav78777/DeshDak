import { AiConversationStatus, Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { recordUserEvent } from "@/modules/activity/service";
import { findAiConversation } from "@/modules/ai/chat-session";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { calculateSupportSla } from "@/modules/support/policy";
import { findLeastLoadedSupportAgent } from "@/modules/support/service";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function categoryFor(messages: { role: string; body: string }[]) {
  const customerText = messages.filter((message) => message.role === "USER").map((message) => message.body).join(" ");
  if (/refund|return|damaged|lost|ফেরত|রিফান্ড/i.test(customerText)) return "RETURN_REFUND" as const;
  if (/payment|wallet|charge|pay|পেমেন্ট|ওয়ালেট/i.test(customerText)) return "PAYMENT" as const;
  if (/shipping|delivery|warehouse|track|শিপিং|ডেলিভারি/i.test(customerText)) return "SHIPPING" as const;
  if (/account|login|password|email|অ্যাকাউন্ট|লগইন/i.test(customerText)) return "ACCOUNT" as const;
  if (/find|search|source|product|supplier|পণ্য|খুঁজ/i.test(customerText)) return "SOURCING" as const;
  return "GENERAL" as const;
}

function transcriptChunks(messages: { role: string; body: string }[]) {
  const entries = messages.map((message) => `${message.role === "USER" ? "Customer" : "Shopping assistant"}: ${message.body}`);
  const chunks: string[] = [];
  let current = "";
  for (const entry of entries) {
    if (current && current.length + entry.length + 2 > 4_400) { chunks.push(current); current = entry; }
    else current = current ? `${current}\n\n${entry}` : entry;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => `Shopping assistant transcript (part ${index + 1} of ${chunks.length})\n\n${chunk}`);
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer sign-in is required before this conversation can be transferred.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This handoff must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const conversation = await findAiConversation(request, true);
  if (!conversation || conversation.expiresAt <= new Date()) return apiError("CHAT_CONVERSATION_NOT_FOUND", "This public conversation expired or is unavailable. Start a new conversation before requesting support.", 404);
  if (conversation.customerId && conversation.customerId !== session.userId) return apiError("CHAT_CONVERSATION_NOT_FOUND", "This public conversation is unavailable.", 404);
  if (conversation.handoffTicketId) {
    const ticket = await prisma.ticket.findFirst({ where: { id: conversation.handoffTicketId, customerId: session.userId }, select: { id: true, reference: true, status: true } });
    if (ticket) return apiSuccess({ ticket, idempotentReplay: true }, { headers: noStore });
  }
  if (!conversation.messages.some((message) => message.role === "USER")) return apiError("CHAT_CONVERSATION_EMPTY", "Send a message before requesting Customer Service.", 422);
  const category = categoryFor(conversation.messages);
  const chunks = transcriptChunks(conversation.messages);
  const now = new Date();
  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const fresh = await tx.aiConversation.findUnique({ where: { id: conversation.id }, select: { customerId: true, handoffTicketId: true, status: true, expiresAt: true } });
      if (!fresh || fresh.expiresAt <= now || fresh.status !== AiConversationStatus.ACTIVE || (fresh.customerId && fresh.customerId !== session.userId) || fresh.handoffTicketId) throw new Error("AI_HANDOFF_STATE_CHANGED");
      const assignedAgentId = await findLeastLoadedSupportAgent(tx);
      const sla = await calculateSupportSla(tx, now);
      const created = await tx.ticket.create({ data: {
        reference: createReference("TKT"), idempotencyKey: `ai-handoff:${conversation.id}`, customerId: session.userId, assignedAgentId,
        category, subject: "Shopping assistant handoff", status: assignedAgentId ? "ASSIGNED" : "OPEN",
        priority: ["PAYMENT", "RETURN_REFUND"].includes(category) ? "HIGH" : "NORMAL", slaDueAt: sla.dueAt, slaApproachingAt: sla.approachingAt,
        conversation: { create: { lastMessageAt: now, messages: { create: chunks.map((body, index) => ({ idempotencyKey: `ai-handoff-message:${conversation.id}:${index + 1}`, senderId: session.userId, body })) } } },
        events: { create: { toStatus: assignedAgentId ? "ASSIGNED" : "OPEN", actorId: session.userId, note: "Shopping assistant conversation transferred to Customer Service.", idempotencyKey: `ai-handoff-event:${conversation.id}`, metadata: { source: "PUBLIC_SHOPPING_ASSISTANT", transcriptMessages: conversation.messages.length, transcriptParts: chunks.length, autoAssigned: Boolean(assignedAgentId), slaPolicyVersion: sla.policyVersion } } },
      } });
      const claimed = await tx.aiConversation.updateMany({ where: { id: conversation.id, handoffTicketId: null, status: AiConversationStatus.ACTIVE }, data: { customerId: session.userId, handoffTicketId: created.id, status: AiConversationStatus.HANDED_OFF } });
      if (claimed.count !== 1) throw new Error("AI_HANDOFF_STATE_CHANGED");
      await tx.auditLog.create({ data: { actorId: session.userId, action: "ai.chat_handoff_created", entityType: "Ticket", entityId: created.id, metadata: { aiConversationId: conversation.id, category, assignedAgentId, requestIdempotencyKey: idempotencyKey.slice(0, 32) } } });
      await recordUserEvent(tx, { idempotencyKey: `ai-handoff:${conversation.id}`, userId: session.userId, authSessionId: session.sessionId, category: "SUPPORT", eventType: "AI_CHAT_HANDED_OFF", objectType: "Ticket", objectId: created.id, path: "/", metadata: { category, transcriptMessages: conversation.messages.length } });
      await createTransactionalNotification(tx, { userId: session.userId, eventType: "TICKET_CREATED", title: `Support request ${created.reference} received`, body: "Your shopping-assistant conversation was securely transferred to Customer Service.", deepLink: `/support/${created.id}`, entityType: "Ticket", entityId: created.id, idempotencyKey: `ai-handoff-notification:customer:${created.id}` });
      if (assignedAgentId) await createTransactionalNotification(tx, { userId: assignedAgentId, eventType: "TICKET_ASSIGNED", title: `Assistant handoff ${created.reference}`, body: "A customer conversation is ready for review.", deepLink: `/support/tickets/${created.reference}`, entityType: "Ticket", entityId: created.id, priority: created.priority === "HIGH" ? "HIGH" : "NORMAL", channels: ["IN_APP"], idempotencyKey: `ai-handoff-notification:agent:${created.id}` });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ ticket: { id: ticket.id, reference: ticket.reference, status: ticket.status }, idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002" || (error as Error).message === "AI_HANDOFF_STATE_CHANGED") {
      const replay = await prisma.aiConversation.findUnique({ where: { id: conversation.id }, select: { customerId: true, handoffTicket: { select: { id: true, reference: true, status: true } } } });
      if (replay?.customerId === session.userId && replay.handoffTicket) return apiSuccess({ ticket: replay.handoffTicket, idempotentReplay: true }, { headers: noStore });
      return apiError("CHAT_HANDOFF_CONFLICT", "The conversation changed while it was being transferred. Refresh before trying again.", 409);
    }
    throw error;
  }
}
