import { type NextRequest } from "next/server";

import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { renderBarcodeSvg, svgResponse } from "@/modules/identifiers/assets";
import { orderCodeAccessWhere } from "@/modules/identifiers/order-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/identifiers/orders/[orderNumber]/barcode">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to open this order asset.", 401);
  const { orderNumber } = await context.params;
  if (!isPlatformCode(orderNumber) || !orderNumber.startsWith("ORD-")) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  const where = orderCodeAccessWhere(orderNumber, session);
  const exists = where ? await prisma.order.count({ where }) : 0;
  if (!exists) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  return svgResponse(renderBarcodeSvg(orderNumber), orderNumber, "barcode", "private");
}
