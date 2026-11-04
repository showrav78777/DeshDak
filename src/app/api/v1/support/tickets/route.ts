import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { ACTIVE_TICKET_STATUSES, ticketSlaState } from "@/modules/support/policy";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_SERVICE) || session.portal !== "support") return apiError("SUPPORT_ACCESS_REQUIRED", "Customer Service access is required.", 403);
  const scope = request.nextUrl.searchParams.get("scope") === "unassigned" ? "unassigned" : "mine";
  const common = { id: true, reference: true, category: true, subject: true, status: true, priority: true, slaDueAt: true, slaApproachingAt: true, firstResponseAt: true, resolvedAt: true, order: { select: { orderNumber: true } }, rma: { select: { reference: true } }, conversation: { select: { lastMessageAt: true } }, createdAt: true, updatedAt: true, version: true } as const;
  const tickets = scope === "unassigned"
    ? await prisma.ticket.findMany({ where: { assignedAgentId: null, status: { in: ACTIVE_TICKET_STATUSES } }, select: { ...common, customer: { select: { accountType: true } } }, orderBy: [{ slaDueAt: "asc" }, { updatedAt: "desc" }], take: 100 })
    : await prisma.ticket.findMany({ where: { assignedAgentId: session.userId, status: { in: ACTIVE_TICKET_STATUSES } }, select: { ...common, customer: { select: { fullName: true, accountType: true } } }, orderBy: [{ slaDueAt: "asc" }, { updatedAt: "desc" }], take: 100 });
  return apiSuccess({ scope, tickets: tickets.map((ticket) => ({ ...ticket, slaState: ticketSlaState(ticket) })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
