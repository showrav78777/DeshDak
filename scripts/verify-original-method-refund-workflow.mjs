import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { originalRefundFingerprint, reserveOriginalMethodRefund } from "../src/modules/refunds/original-method.ts";

const prisma = new PrismaClient();
const marker = randomBytes(8).toString("hex");
const rollback = new Error("ROLLBACK_VERIFICATION");

try {
  await prisma.$transaction(async (tx) => {
    const customer = await tx.user.create({ data: { email: `original-refund-customer-${marker}@example.test`, fullName: "Original Refund Customer", passwordHash: "not-used", status: "ACTIVE" } });
    const admin = await tx.user.create({ data: { email: `original-refund-admin-${marker}@example.test`, fullName: "Original Refund Admin", passwordHash: "not-used", status: "ACTIVE" } });
    const finance = await tx.user.create({ data: { email: `original-refund-finance-${marker}@example.test`, fullName: "Original Refund Finance", passwordHash: "not-used", status: "ACTIVE" } });
    const order = await tx.order.create({ data: { orderNumber: `ORF-${marker}`, customerId: customer.id, status: "PAID", currency: "BDT", productTotal: 1000, discountTotal: 100, grandTotal: 900 } });
    const snapshot = await tx.fxSnapshot.create({ data: { pair: "BDT_BDT", baseCurrency: "BDT", quoteCurrency: "BDT", baseAmount: 900, convertedAmount: 900, rateUsed: 1, spreadApplied: 0, source: "ORIGINAL_REFUND_TEST", contextType: "PAYMENT" } });
    const payment = await tx.paymentIntent.create({ data: { reference: `PAY-${marker}`, idempotencyKey: `payment-${marker}`, provider: "SSLCOMMERZ", orderId: order.id, fxSnapshotId: snapshot.id, amount: 900, currency: "BDT", status: "SUCCEEDED", providerTransactionId: `VAL-${marker}`, gatewayPayload: { reviewRequired: false, evidence: { validationId: `VAL-${marker}`, bankTransactionId: `BANK-${marker}`, providerStatus: "VALID", riskLevel: 0 } } } });
    const batch = await tx.paymentSettlementBatch.create({ data: { reference: `STL-${marker}`, provider: "SSLCOMMERZ", externalBatchReference: `BATCH-${marker}`, settlementDate: new Date(), currency: "BDT", status: "RECONCILED", sourceFingerprint: `source-${marker}`, idempotencyKey: `settlement-${marker}`, importedById: finance.id, rowCount: 1, matchedCount: 1, exceptionCount: 0 } });
    await tx.paymentSettlementEntry.create({ data: { batchId: batch.id, rowNumber: 1, externalTransactionId: payment.reference, bankTransactionId: `BANK-${marker}`, grossAmount: 900, gatewayFee: 20, netAmount: 880, currency: "BDT", settledAt: new Date(), matchStatus: "MATCHED", paymentIntentId: payment.id, evidenceFingerprint: `evidence-${marker}` } });
    const shipment = await tx.shipment.create({ data: { trackingNumber: `TRK-${marker}`, status: "DELIVERED", deliveredAt: new Date(), claimDeadline: new Date(Date.now() + 86_400_000) } });
    const rma = await tx.rma.create({ data: { reference: `RMA-${marker}`, idempotencyKey: `rma-${marker}`, orderId: order.id, shipmentId: shipment.id, customerId: customer.id, status: "INSPECTED", reason: "DAMAGED", description: "Verified damage", evidenceRefs: [], claimDeadlineAtCreation: new Date(Date.now() + 86_400_000), slaDueAt: new Date(Date.now() + 86_400_000), decision: "PARTIAL_REFUND", liabilityParty: "CARRIER", approvedRefundAmount: 400, refundDecisionById: admin.id, refundDecisionAt: new Date(), inspectionResult: "CONFIRMED", inspectedAt: new Date() } });
    const input = { orderId: order.id, rmaId: rma.id, reason: "Approved inspected return", actorId: finance.id, idempotencyKey: `original-refund-${marker}` };
    const requestFingerprint = originalRefundFingerprint(input);
    const first = await reserveOriginalMethodRefund(tx, { ...input, requestFingerprint });
    assert.equal(first.replay, false);
    assert.equal(first.refund.status, "PROCESSING");
    assert.equal(first.refund.destination, "ORIGINAL_METHOD");
    assert.equal(first.refund.amount.toString(), "360");
    assert.equal(first.refund.promotionNettingBaseAmount?.toString(), "40");
    assert.equal(first.bankTransactionId, `BANK-${marker}`);
    assert.equal(first.refund.providerRefundTransactionId, first.refund.reference);
    const replayed = await reserveOriginalMethodRefund(tx, { ...input, requestFingerprint });
    assert.equal(replayed.replay, true);
    assert.equal(replayed.refund.id, first.refund.id);
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

const triggers = await prisma.$queryRaw`
  SELECT trigger_row.tgname
  FROM pg_trigger AS trigger_row
  INNER JOIN pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
  INNER JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
  WHERE trigger_row.tgname = 'RefundGatewayOperation_immutable'
    AND NOT trigger_row.tgisinternal
    AND schema_row.nspname = current_schema()
    AND table_row.relname = 'RefundGatewayOperation'
`;
assert.equal(triggers.length, 1, "Immutable gateway-operation trigger is missing.");
assert.equal(await prisma.refund.count({ where: { idempotencyKey: `original-refund-${marker}` } }), 0, "Verification records escaped the rollback transaction.");
await prisma.$disconnect();
console.log("Original-method refund workflow verification passed: reconciled verified evidence, independent approval, locked-FX promotion netting, processing reservation, deterministic provider ID, replay safety, immutable operation trigger, and rollback cleanup.");
