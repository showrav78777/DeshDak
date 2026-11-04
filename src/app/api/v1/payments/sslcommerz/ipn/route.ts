import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createOrderFromPaidPayment } from "@/modules/orders/create-from-payment";
import { SslCommerzError, validateSslCommerzTransaction, type SslCommerzConfig } from "@/modules/payments/sslcommerz";

const ipnSchema = z.object({
  tran_id: z.string().trim().min(1).max(30),
  val_id: z.string().trim().min(1).max(100),
});

const retainedFields = ["tran_id", "val_id", "status", "amount", "currency", "bank_tran_id", "card_type", "risk_level", "risk_title", "verify_sign"] as const;

function response(message: string, status = 200) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function config(): SslCommerzConfig | null {
  const environment = process.env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== "sandbox" && environment !== "live") return null;
  const storeId = process.env.SSLCOMMERZ_STORE_ID?.trim();
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD?.trim();
  if (!storeId || !storePassword) return null;
  return { environment, storeId, storePassword, appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000" };
}

function sanitizedPayload(form: URLSearchParams): Prisma.InputJsonObject {
  const payload: Record<string, string> = {};
  for (const field of retainedFields) {
    const value = form.get(field);
    if (value && value.length <= 500) payload[field] = value;
  }
  return payload;
}

export async function POST(request: NextRequest) {
  const configured = config();
  if (!configured) return response("Gateway unavailable", 503);
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredSize) || declaredSize > 32_768) return response("Payload too large", 413);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return response("Unsupported payload", 415);
  const body = await request.text().catch(() => null);
  if (body === null) return response("Invalid payload", 400);
  if (Buffer.byteLength(body, "utf8") > 32_768) return response("Payload too large", 413);
  const form = new URLSearchParams(body);
  const parsed = ipnSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return response("Invalid payload", 400);
  const payload = sanitizedPayload(form);
  const payment = await prisma.paymentIntent.findFirst({ where: { reference: parsed.data.tran_id, provider: "SSLCOMMERZ" } });
  if (!payment) return response("Ignored");
  const previousEvent = await prisma.paymentWebhookEvent.findUnique({ where: { provider_providerEventId: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id } } });
  if (previousEvent?.processedAt) return response("OK");

  let validation;
  try {
    validation = await validateSslCommerzTransaction({ validationId: parsed.data.val_id, expectedReference: payment.reference, expectedAmount: payment.amount.toString(), expectedCurrency: payment.currency }, configured);
  } catch (error) {
    await prisma.paymentWebhookEvent.upsert({
      where: { provider_providerEventId: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id } },
      create: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id, signatureValid: false, payload, processedAt: new Date() },
      update: { signatureValid: false, payload, processedAt: new Date() },
    });
    return response(error instanceof SslCommerzError ? "Validation rejected" : "Validation unavailable", error instanceof SslCommerzError ? 400 : 503);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.paymentWebhookEvent.upsert({
        where: { provider_providerEventId: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id } },
        create: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id, signatureValid: true, payload },
        update: { signatureValid: true, payload },
      });
      const current = await tx.paymentIntent.findUnique({ where: { id: payment.id } });
      if (!current) throw new Error("PAYMENT_MISSING");
      if (current.status === "SUCCEEDED") {
        await tx.paymentWebhookEvent.update({ where: { provider_providerEventId: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id } }, data: { processedAt: new Date() } });
        return;
      }
      if (!["CREATED", "PENDING"].includes(current.status)) throw new Error("PAYMENT_NOT_PAYABLE");
      if (validation.outcome === "REVIEW_REQUIRED") {
        await tx.paymentIntent.update({ where: { id: current.id }, data: { status: "PENDING", gatewayPayload: { reviewRequired: true, evidence: validation.evidence } } });
        await tx.auditLog.create({ data: { action: "sslcommerz.payment_held_for_review", entityType: "PaymentIntent", entityId: current.id, metadata: validation.evidence } });
      } else {
        const paid = await tx.paymentIntent.update({ where: { id: current.id }, data: { status: "SUCCEEDED", providerTransactionId: validation.evidence.validationId, gatewayPayload: { reviewRequired: false, evidence: validation.evidence } } });
        const order = await createOrderFromPaidPayment(tx, paid);
        await tx.auditLog.create({ data: { action: "sslcommerz.payment_validated", entityType: "PaymentIntent", entityId: paid.id, metadata: { orderId: order.id, providerStatus: validation.evidence.providerStatus, validationId: validation.evidence.validationId } } });
      }
      await tx.paymentWebhookEvent.update({ where: { provider_providerEventId: { provider: "SSLCOMMERZ", providerEventId: parsed.data.val_id } }, data: { processedAt: new Date() } });
    }, { isolationLevel: "Serializable" });
    return response(validation.outcome === "REVIEW_REQUIRED" ? "HELD" : "OK");
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") return response("Retry", 503);
    if ((error as Error).message === "PAYMENT_NOT_PAYABLE") return response("Ignored");
    throw error;
  }
}
