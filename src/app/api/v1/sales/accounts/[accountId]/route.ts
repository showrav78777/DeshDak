import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/sales/accounts/[accountId]">) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  const { accountId } = await context.params;
  const account = await prisma.businessAccount.findFirst({ where: { id: accountId, status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } }, select: { id: true, accountCode: true, organizationName: true, status: true, owner: { select: { personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, orders: { select: { id: true, orderNumber: true, status: true, grandTotal: true, currency: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }, sourcingRequests: { select: { id: true, reference: true, productTitle: true, status: true, quantity: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }, supportTickets: { select: { id: true, reference: true, subject: true, status: true, priority: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 } } }, activities: { select: { id: true, activityCode: true, type: true, subject: true, note: true, occurredAt: true, followUpAt: true, createdAt: true, author: { select: { personCode: true, fullName: true } }, sourcingRequest: { select: { id: true, reference: true, productTitle: true } } }, orderBy: { occurredAt: "desc" }, take: 100 } } });
  if (!account) return apiError("ACCOUNT_NOT_FOUND", "The account was not found in your assigned portfolio.", 404);
  return apiSuccess({ account }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
