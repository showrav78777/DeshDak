import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { customerShippingQuote } from "@/modules/orders/customer-dto";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/orders/[orderId]/shipping-quote/accept">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to continue.", 401);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const { orderId } = await context.params;
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId: session.userId }, include: { shippingQuotes: { orderBy: { version: "desc" }, take: 1 } } });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  const quote = order.shippingQuotes[0];
  if (!quote) return apiError("SHIPPING_QUOTE_NOT_FOUND", "No shipping quote is available.", 404);
  if (quote.decisionIdempotencyKey === idempotencyKey && quote.status === "ACCEPTED") return apiSuccess({ quote: customerShippingQuote(quote), idempotentReplay: true });
  if (order.status !== "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL" || quote.status !== "SENT") return apiError("SHIPPING_QUOTE_NOT_ACTIONABLE", "This shipping quote is no longer awaiting approval.", 409);
  if (quote.expiresAt <= new Date()) {
    await prisma.shippingQuote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
    return apiError("SHIPPING_QUOTE_EXPIRED", "This shipping quote has expired. Please wait for an updated quote.", 409);
  }
  try {
    const accepted = await prisma.$transaction(async (tx) => {
      const quoteChange = await tx.shippingQuote.updateMany({ where: { id: quote.id, status: "SENT" }, data: { status: "ACCEPTED", acceptedAt: new Date(), decisionIdempotencyKey: idempotencyKey } });
      if (quoteChange.count !== 1) throw new Error("SHIPPING_QUOTE_ALREADY_DECIDED");
      const orderChange = await tx.order.updateMany({ where: { id: order.id, status: "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL" }, data: { status: "SHIPPING_QUOTE_READY", shippingApprovalStatus: "ACCEPTED", shippingApprovalAt: new Date() } });
      if (orderChange.count !== 1) throw new Error("SHIPPING_QUOTE_ALREADY_DECIDED");
      await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "SHIPPING_QUOTE_READY", actorId: session.userId, note: "Customer accepted the final measured shipping quote." } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "shipping_quote.accepted", entityType: "ShippingQuote", entityId: quote.id, metadata: { orderId: order.id, version: quote.version } } });
      return tx.shippingQuote.findUniqueOrThrow({ where: { id: quote.id } });
    });
    return apiSuccess({ quote: customerShippingQuote(accepted) });
  } catch (error) {
    if ((error as Error).message === "SHIPPING_QUOTE_ALREADY_DECIDED") return apiError("SHIPPING_QUOTE_NOT_ACTIONABLE", "This shipping quote has already been decided.", 409);
    if ((error as { code?: string }).code === "P2002") return apiError("IDEMPOTENCY_KEY_REUSED", "This action key has already been used.", 409);
    throw error;
  }
}
