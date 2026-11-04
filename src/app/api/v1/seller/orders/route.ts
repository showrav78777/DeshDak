import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER)) return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const orders = await prisma.sellerOrder.findMany({
    where: { sellerProfile: { userId: session.userId }, status: { not: "PENDING_PAYMENT" } },
    select: {
      id: true, status: true, currency: true, productSubtotal: true, reviewedAt: true, approvedAt: true, readyAt: true, createdAt: true, updatedAt: true,
      order: { select: { id: true, orderNumber: true, type: true, status: true, destinationCountryCode: true, createdAt: true } },
      items: { select: { id: true, productTitle: true, quantity: true, variantSnapshot: true }, orderBy: { createdAt: "asc" } },
      statusHistory: { select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return apiSuccess({ orders }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
