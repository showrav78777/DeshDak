import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/orders/[orderId]/timeline">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  const { orderId } = await context.params;
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: session.userId },
    select: {
      id: true, orderNumber: true, status: true,
      statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, note: true, createdAt: true } },
      packages: {
        select: {
          packageCode: true, status: true,
          shipmentPackages: {
            select: {
              shipment: {
                select: {
                  trackingNumber: true, status: true,
                  events: { orderBy: { occurredAt: "asc" }, select: { status: true, location: true, description: true, occurredAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order not found.", 404);
  return apiSuccess({ order }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
