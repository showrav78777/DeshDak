import { type NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createReportPdf } from "@/lib/report-pdf";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/orders/[orderId]/summary">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Sign in to download your order summary.", 403);
  const { orderId } = await context.params;
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId: session.userId }, select: { orderNumber: true, status: true, createdAt: true, currency: true, productTotal: true, discountTotal: true, grandTotal: true, items: { select: { productTitle: true, quantity: true, unitPrice: true, total: true } }, shippingPayment: { select: { amount: true, currency: true, status: true } } } });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  const demo = request.nextUrl.searchParams.get("template") === "demo-invoice";
  const bytes = await createReportPdf(demo ? "DEMO INVOICE - PREVIEW ONLY" : "Order summary", [
    ...(demo ? [
      "DEMO - NOT VALID FOR TAX OR PAYMENT",
      "Seller: DeshDak Demo Trading Company (fictional)",
      "Demo billing address: 123 Example Road, Dhaka, Bangladesh (fictional)",
      "Tax/VAT registration: DEMO-ONLY (not a valid registration)",
      `Preview reference: DEMO-${order.orderNumber}`,
      "Tax treatment: not configured. No demo tax has been calculated or added.",
      "This preview is not an issued invoice and does not request or confirm payment.",
    ] : []),
    `Order: ${order.orderNumber}`, `Created: ${order.createdAt.toISOString()}`, `Status: ${order.status}`,
    demo ? "Order amounts below are copied for layout preview only." : "ORDER SUMMARY - not a tax invoice or proof of payment.",
    ...order.items.map(item => `${item.productTitle} | Qty ${item.quantity} | Unit ${order.currency} ${item.unitPrice.toFixed(2)} | Line ${item.total.toFixed(2)}`),
    `Products: ${order.currency} ${order.productTotal.toFixed(2)}`, `Discount: ${order.currency} ${order.discountTotal.toFixed(2)}`, `Order total: ${order.currency} ${order.grandTotal.toFixed(2)}`,
    order.shippingPayment ? `Separate shipping payment: ${order.shippingPayment.currency} ${order.shippingPayment.amount.toFixed(2)} (${order.shippingPayment.status})` : "Final shipping charges are confirmed separately after warehouse measurement.",
    "For original product titles and the current tracking history, open this order in your DeshDak account.",
  ], { demo });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${order.orderNumber.replace(/[^A-Za-z0-9_-]/g, "_")}-${demo ? "demo-invoice" : "summary"}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
