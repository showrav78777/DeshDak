import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { createFxSnapshot, quoteFx } from "@/modules/fx/service";
import { createOrderFromPaidPayment } from "@/modules/orders/create-from-payment";
import { InsufficientWalletBalanceError, postWalletTransaction } from "@/modules/wallet/ledger";

const schema = z.object({ quoteId: z.string().uuid().optional(), orderId: z.string().uuid().optional() }).refine((value) => Boolean(value.quoteId) !== Boolean(value.orderId), { message: "Choose either a quotation or an order." });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid payable order.", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentIntent.findUnique({ where: { idempotencyKey }, include: { sourcingQuote: { include: { sourcingRequest: { select: { customerId: true } } } }, order: { select: { customerId: true } } } });
      if (existing) {
        if (existing.order?.customerId !== session.userId && existing.sourcingQuote?.sourcingRequest.customerId !== session.userId) return null;
        if (existing.orderId !== (parsed.data.orderId ?? null) || existing.sourcingQuoteId !== (parsed.data.quoteId ?? null) || existing.provider !== "WALLET") throw new Error("IDEMPOTENCY_KEY_REUSED");
        return { payment: existing, replay: true };
      }
      const customer = await tx.user.findUnique({ where: { id: session.userId }, select: { accountType: true } });
      if (!customer) return null;
      const target = parsed.data.orderId
        ? await tx.order.findFirst({ where: { id: parsed.data.orderId, customerId: session.userId, status: "PENDING_PAYMENT", paymentIntent: null, OR: [{ type: { notIn: ["LOCAL_SELLER", "EXPORT_MARKETPLACE"] } }, { inventoryReservations: { none: { OR: [{ status: { in: ["EXPIRED", "RELEASED"] } }, { status: "ACTIVE", expiresAt: { lte: new Date() } }] } } }] }, select: { id: true, grandTotal: true } })
        : await tx.sourcingQuote.findFirst({ where: { id: parsed.data.quoteId, status: "ACCEPTED", expiresAt: { gt: new Date() }, sourcingRequest: { customerId: session.userId } }, select: { id: true, totalBdt: true } });
      if (!target) return null;
      const targetId = target.id;
      const amount = "grandTotal" in target ? target.grandTotal : target.totalBdt;
      const fxQuote = await quoteFx(tx, { baseCurrency: "BDT", quoteCurrency: "BDT", amount, customerSegment: customer.accountType });
      const fxSnapshot = await createFxSnapshot(tx, fxQuote, { type: "PAYMENT", id: targetId });
      const payment = await tx.paymentIntent.create({ data: { reference: createReference("PAY"), idempotencyKey, ...(parsed.data.orderId ? { orderId: targetId } : { sourcingQuoteId: targetId }), provider: "WALLET", amount, currency: "BDT", status: "SUCCEEDED", fxSnapshotId: fxSnapshot.id } });
      await postWalletTransaction(tx, { userId: session.userId, currency: "BDT", amount, direction: "DEBIT", type: "PAYMENT_DEBIT", idempotencyKey: `wallet-payment:${idempotencyKey}`, description: `Wallet payment ${payment.reference}`, sourceType: "PAYMENT", sourceId: payment.id, debitAccountCode: "CUSTOMER_WALLET_LIABILITY", creditAccountCode: "CUSTOMER_PAYMENT_CLEARING" });
      const order = await createOrderFromPaidPayment(tx, payment);
      await tx.auditLog.create({ data: { actorId: session.userId, action: "wallet.payment_completed", entityType: "PaymentIntent", entityId: payment.id, metadata: { orderId: order.id, amount: amount.toString(), currency: "BDT" } } });
      return { payment, replay: false };
    }, { isolationLevel: "Serializable" });
    if (!result) return apiError("PAYMENT_NOT_AVAILABLE", "This order or quotation is not available for payment.", 409);
    return apiSuccess({ paymentIntent: { id: result.payment.id, reference: result.payment.reference, amount: result.payment.amount, currency: result.payment.currency, status: result.payment.status, provider: result.payment.provider }, idempotentReplay: result.replay, nextAction: "ORDER_CREATED" }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof InsufficientWalletBalanceError || (error as Error).message === "INSUFFICIENT_WALLET_BALANCE") return apiError("INSUFFICIENT_WALLET_BALANCE", "Your available wallet balance is not enough for this payment.", 409);
    if ((error as Error).message === "IDEMPOTENCY_KEY_REUSED") return apiError("IDEMPOTENCY_KEY_REUSED", "This wallet payment key was already used for a different payable item.", 409);
    if ((error as { code?: string }).code === "P2034") return apiError("PAYMENT_RETRY_REQUIRED", "The wallet was updated by another request. Please retry safely.", 409);
    throw error;
  }
}
