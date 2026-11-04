import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/sourcing/requests/[requestId]/accept-quote">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  const { requestId } = await context.params;
  const quote = await prisma.$transaction(async (tx) => {
    const sourcingRequest = await tx.sourcingRequest.findFirst({ where: { id: requestId, customerId: session.userId, status: "QUOTED" }, include: { quotes: { where: { status: "SENT" }, orderBy: { version: "desc" }, take: 1 } } });
    const activeQuote = sourcingRequest?.quotes[0];
    if (!sourcingRequest || !activeQuote || activeQuote.expiresAt <= new Date()) return null;
    const accepted = await tx.sourcingQuote.update({ where: { id: activeQuote.id }, data: { status: "ACCEPTED" } });
    await tx.sourcingRequest.update({ where: { id: requestId }, data: { status: "APPROVED" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "sourcing_quote.accepted", entityType: "SourcingQuote", entityId: accepted.id } });
    return accepted;
  });
  if (!quote) return apiError("QUOTE_NOT_AVAILABLE", "No valid quote is available to accept.", 409);
  return apiSuccess({ quote });
}
