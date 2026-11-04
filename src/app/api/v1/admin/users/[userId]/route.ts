import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/admin/users/[userId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const { userId } = await context.params;
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true, personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, status: true, locale: true, accountType: true, preferredCurrency: true, kycStatus: true, analyticsConsent: true, analyticsConsentAt: true, createdAt: true, updatedAt: true,
      roles: { select: { role: { select: { code: true, description: true } } } },
      addresses: { where: { deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      authSessions: { select: { id: true, portal: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true }, orderBy: { createdAt: "desc" }, take: 20 },
      orders: { select: { id: true, orderNumber: true, type: true, status: true, currency: true, grandTotal: true, createdAt: true, updatedAt: true, statusHistory: { select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { createdAt: "desc" }, take: 30 },
      sourcingRequests: { select: { id: true, reference: true, productTitle: true, status: true, quantity: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 },
      wallets: { select: { id: true, currency: true, availableBalance: true, heldBalance: true, transactions: { select: { id: true, reference: true, type: true, status: true, amount: true, description: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 15 } } },
      userEvents: { select: { id: true, category: true, eventType: true, objectType: true, objectId: true, source: true, path: true, metadata: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 60 },
      notifications: { select: { id: true, eventType: true, title: true, readAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!user) return apiError("USER_NOT_FOUND", "Customer account was not found.", 404);
  await prisma.auditLog.create({ data: { actorId: session.userId, action: "admin.customer_record_viewed", entityType: "User", entityId: user.id, metadata: { sections: ["profile", "addresses", "sessions", "orders", "wallets", "activity"] } } });
  return apiSuccess({ user }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
