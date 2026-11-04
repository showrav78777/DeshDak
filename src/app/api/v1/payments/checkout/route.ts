import { type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { publicApplicationUrl } from "@/lib/security-secrets";
import { createFxSnapshot } from "@/modules/fx/service";
import { resolvePaymentMethod } from "@/modules/payments/availability";
import { createSslCommerzSession, SslCommerzError, type SslCommerzConfig } from "@/modules/payments/sslcommerz";

const schema = z.object({ quoteId: z.string().uuid().optional(), orderId: z.string().uuid().optional(), provider: z.string().trim().min(2).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/).transform((value) => value.toUpperCase()) }).refine((value) => Boolean(value.quoteId) !== Boolean(value.orderId), { message: "Choose either a quotation or an order." });
class PaymentMethodUnavailable extends Error {}
class PaymentRequestConflict extends Error {}
class PaymentProfileIncomplete extends Error {}
class InventoryReservationExpired extends Error {}

const addressSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(20),
  addressLine1: z.string().trim().min(1).max(150),
  addressLine2: z.string().trim().max(150).optional().nullable(),
  city: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().max(20).optional().nullable(),
  countryCode: z.string().trim().length(2),
});

function sslCommerzConfig(): SslCommerzConfig {
  const environment = process.env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== "sandbox" && environment !== "live") throw new PaymentMethodUnavailable();
  return {
    environment,
    storeId: process.env.SSLCOMMERZ_STORE_ID ?? "",
    storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD ?? "",
    appBaseUrl: publicApplicationUrl(),
  };
}

function savedGatewayRedirect(payload: Prisma.JsonValue | null, environment: "sandbox" | "live") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = "redirectUrl" in payload && typeof payload.redirectUrl === "string" ? payload.redirectUrl : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const hostname = environment === "sandbox" ? "sandbox.sslcommerz.com" : "securepay.sslcommerz.com";
    return url.protocol === "https:" && url.hostname === hostname && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

async function startSslCommerzCheckout(paymentId: string) {
  const config = sslCommerzConfig();
  const payment = await prisma.paymentIntent.findUnique({
    where: { id: paymentId },
    include: {
      order: { select: { shippingAddress: true, items: { select: { productTitle: true, quantity: true }, take: 20 }, customer: { select: { id: true, fullName: true, email: true, phone: true } } } },
      sourcingQuote: { select: { sourcingRequest: { select: { productTitle: true, quantity: true, customer: { select: { id: true, fullName: true, email: true, phone: true } } } } } },
    },
  });
  if (!payment || payment.provider !== "SSLCOMMERZ" || !["CREATED", "PENDING"].includes(payment.status)) throw new PaymentMethodUnavailable();
  const storedRedirect = savedGatewayRedirect(payment.gatewayPayload, config.environment);
  if (payment.status === "PENDING" && storedRedirect) return storedRedirect;

  const customer = payment.order?.customer ?? payment.sourcingQuote?.sourcingRequest.customer;
  if (!customer?.email || !customer.phone) throw new PaymentProfileIncomplete();
  const orderAddress = payment.order ? addressSchema.safeParse(payment.order.shippingAddress) : null;
  const savedAddress = orderAddress?.success ? orderAddress.data : await prisma.address.findFirst({ where: { userId: customer.id, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  if (!savedAddress) throw new PaymentProfileIncomplete();
  const country = await prisma.country.findUnique({ where: { isoCode: savedAddress.countryCode.toUpperCase() }, select: { name: true } });
  if (!country) throw new PaymentProfileIncomplete();
  const itemCount = payment.order?.items.reduce((total, item) => total + item.quantity, 0) ?? payment.sourcingQuote?.sourcingRequest.quantity ?? 1;
  const productName = payment.order?.items.map((item) => item.productTitle).join(", ").slice(0, 255)
    || payment.sourcingQuote?.sourcingRequest.productTitle?.slice(0, 255)
    || `DeshDak payment ${payment.reference}`;
  const base = config.appBaseUrl;
  const gateway = await createSslCommerzSession({
    reference: payment.reference,
    internalPaymentId: payment.id,
    amount: payment.amount.toString(),
    currency: payment.currency,
    productName,
    productCategory: "ecommerce",
    itemCount,
    customer: {
      name: savedAddress.fullName || customer.fullName,
      email: customer.email,
      phone: savedAddress.phone || customer.phone,
      address: [savedAddress.addressLine1, savedAddress.addressLine2].filter(Boolean).join(", "),
      city: savedAddress.city,
      state: savedAddress.district,
      postcode: savedAddress.postalCode ?? undefined,
      country: country.name,
    },
    successUrl: `${base}/api/v1/payments/sslcommerz/return/success`,
    failUrl: `${base}/api/v1/payments/sslcommerz/return/fail`,
    cancelUrl: `${base}/api/v1/payments/sslcommerz/return/cancel`,
    ipnUrl: `${base}/api/v1/payments/sslcommerz/ipn`,
  }, config);
  await prisma.paymentIntent.updateMany({
    where: { id: payment.id, status: "CREATED" },
    data: { status: "PENDING", gatewayPayload: { sessionKey: gateway.sessionKey, redirectUrl: gateway.redirectUrl, environment: config.environment, createdAt: new Date().toISOString() } },
  });
  return gateway.redirectUrl;
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 255) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key for this payment request.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Select a valid payable order and payment provider.", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.paymentIntent.findUnique({ where: { idempotencyKey }, include: { sourcingQuote: { include: { sourcingRequest: { select: { customerId: true } } } }, order: { select: { customerId: true } } } });
    if (existing) {
      if (existing.order?.customerId !== session.userId && existing.sourcingQuote?.sourcingRequest.customerId !== session.userId) return null;
      if (existing.orderId !== (parsed.data.orderId ?? null) || existing.sourcingQuoteId !== (parsed.data.quoteId ?? null) || existing.provider !== parsed.data.provider) throw new PaymentRequestConflict();
      return { payment: existing, replay: true };
    }
    const customer = await tx.user.findUnique({ where: { id: session.userId }, select: { accountType: true } });
    if (!customer) return null;
    const target = parsed.data.orderId
      ? await tx.order.findFirst({ where: { id: parsed.data.orderId, customerId: session.userId, status: "PENDING_PAYMENT", paymentIntent: null, OR: [{ type: { notIn: ["LOCAL_SELLER", "EXPORT_MARKETPLACE"] } }, { inventoryReservations: { none: { OR: [{ status: { in: ["EXPIRED", "RELEASED"] } }, { status: "ACTIVE", expiresAt: { lte: new Date() } }] } } }] }, select: { id: true, grandTotal: true, currency: true, destinationCountryCode: true } })
      : await tx.sourcingQuote.findFirst({ where: { id: parsed.data.quoteId, status: "ACCEPTED", expiresAt: { gt: new Date() }, sourcingRequest: { customerId: session.userId } }, select: { id: true, totalBdt: true } });
    if (!target && parsed.data.orderId) {
      const expiredOrder = await tx.order.findFirst({ where: { id: parsed.data.orderId, customerId: session.userId, status: "PENDING_PAYMENT", paymentIntent: null, inventoryReservations: { some: { OR: [{ status: { in: ["EXPIRED", "RELEASED"] } }, { status: "ACTIVE", expiresAt: { lte: new Date() } }] } } }, select: { id: true } });
      if (expiredOrder) throw new InventoryReservationExpired();
    }
    if (!target) return null;
    const targetId = target.id;
    const amount = "grandTotal" in target ? target.grandTotal : target.totalBdt;
    const currency = "currency" in target ? target.currency : "BDT";
    const destinationCountryCode = "destinationCountryCode" in target ? (target.destinationCountryCode ?? "BD") : "BD";
    const method = await resolvePaymentMethod(tx, { providerCode: parsed.data.provider, countryCode: destinationCountryCode, baseCurrency: currency, amount, customerSegment: customer.accountType });
    if (!method) throw new PaymentMethodUnavailable();
    const fxSnapshot = await createFxSnapshot(tx, method.quote, { type: "PAYMENT", id: targetId });
    const created = await tx.paymentIntent.create({ data: { reference: createReference("PAY"), idempotencyKey, ...(parsed.data.orderId ? { orderId: targetId } : { sourcingQuoteId: targetId }), provider: parsed.data.provider, paymentMethodId: method.id, amount: method.quote.convertedAmount, currency: method.quote.quoteCurrency, status: "CREATED", fxSnapshotId: fxSnapshot.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "payment_intent.created", entityType: "PaymentIntent", entityId: created.id, metadata: { targetType: parsed.data.orderId ? "Order" : "SourcingQuote", targetId, provider: parsed.data.provider, fxSnapshotId: fxSnapshot.id, baseAmount: amount.toString(), baseCurrency: currency, payableAmount: created.amount.toString(), payableCurrency: created.currency } } });
    return { payment: created, replay: false };
    });
    if (!result) return apiError("PAYMENT_NOT_AVAILABLE", "This order or quotation is not available for payment.", 409);
    if (result.payment.provider !== "SSLCOMMERZ") return apiError("PAYMENT_ADAPTER_NOT_IMPLEMENTED", "This payment adapter is not available yet.", 409);
    const redirectUrl = await startSslCommerzCheckout(result.payment.id);
    return apiSuccess({ paymentIntent: { id: result.payment.id, reference: result.payment.reference, amount: result.payment.amount, currency: result.payment.currency, status: "PENDING", provider: result.payment.provider }, idempotentReplay: result.replay, nextAction: "REDIRECT", redirectUrl }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof PaymentMethodUnavailable) return apiError("PAYMENT_METHOD_UNAVAILABLE", "This payment method does not have complete country, currency, exchange-rate, runtime, and amount readiness.", 409);
    if (error instanceof InventoryReservationExpired) return apiError("INVENTORY_RESERVATION_EXPIRED", "This order's item reservation expired. Add the products to your cart again to create a fresh order before paying.", 409);
    if (error instanceof PaymentProfileIncomplete) return apiError("PAYMENT_PROFILE_INCOMPLETE", "Add a valid phone number and delivery address before using this payment method.", 422);
    if (error instanceof SslCommerzError) return apiError("PAYMENT_GATEWAY_UNAVAILABLE", "The secure payment page could not be prepared. No payment was taken; please retry.", 502);
    if (error instanceof PaymentRequestConflict) return apiError("IDEMPOTENCY_KEY_REUSED", "This payment key was already used with a different order, quotation, or provider.", 409);
    throw error;
  }
}
