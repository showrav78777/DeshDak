import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { orderCodeAccessWhere } from "@/modules/identifiers/order-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/identifiers/orders/[orderNumber]">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to open this order.", 401);
  const { orderNumber } = await context.params;
  if (!isPlatformCode(orderNumber) || !orderNumber.startsWith("ORD-")) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  const where = orderCodeAccessWhere(orderNumber, session);
  const order = where ? await prisma.order.findFirst({ where, select: { id: true, orderNumber: true, type: true, status: true, currency: true, grandTotal: true, createdAt: true, updatedAt: true } }) : null;
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  return apiSuccess({ order, identifiers: { code: orderNumber, barcodeValue: orderNumber, qrAssetUrl: `/api/v1/identifiers/orders/${orderNumber}/qr`, barcodeAssetUrl: `/api/v1/identifiers/orders/${orderNumber}/barcode`, orderUrl: `/orders/${order.id}` } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
