import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { decideSettlementResolution, proposeSettlementResolution, SettlementResolutionError } from "../src/modules/payments/reconciliation.ts";

const prisma = new PrismaClient(); const marker = randomBytes(8).toString("hex"); const rollback = new Error("ROLLBACK_VERIFICATION");
try {
  await prisma.$transaction(async (tx) => {
    const maker = await tx.user.create({ data: { email: `chargeback-maker-${marker}@example.test`, fullName: "Chargeback Maker", passwordHash: "not-used", status: "ACTIVE" } });
    const checker = await tx.user.create({ data: { email: `chargeback-checker-${marker}@example.test`, fullName: "Chargeback Checker", passwordHash: "not-used", status: "ACTIVE" } });
    const customer = await tx.user.create({ data: { email: `chargeback-customer-${marker}@example.test`, fullName: "Chargeback Customer", passwordHash: "not-used", status: "ACTIVE" } });
    const order = await tx.order.create({ data: { orderNumber: `CB-${marker}`, customerId: customer.id, status: "PAID", currency: "BDT", productTotal: 1000, grandTotal: 1000 } });
    const payment = await tx.paymentIntent.create({ data: { reference: `PAY-${marker}`, idempotencyKey: `payment-${marker}`, provider: "SSLCOMMERZ", orderId: order.id, amount: 1000, currency: "BDT", status: "SUCCEEDED" } });
    const batch = await tx.paymentSettlementBatch.create({ data: { reference: `STL-${marker}`, provider: "SSLCOMMERZ", externalBatchReference: `CHARGEBACK-${marker}`, settlementDate: new Date(), currency: "BDT", status: "EXCEPTIONS", sourceFingerprint: `source-${marker}`, idempotencyKey: `batch-${marker}`, importedById: maker.id, rowCount: 1, matchedCount: 0, exceptionCount: 1 } });
    const entry = await tx.paymentSettlementEntry.create({ data: { batchId: batch.id, rowNumber: 1, externalTransactionId: payment.reference, grossAmount: 1000, gatewayFee: 0, netAmount: 1000, currency: "BDT", settledAt: new Date(), matchStatus: "DUPLICATE_TRANSACTION", exceptionReason: "Provider reported a chargeback against a previously settled payment.", paymentIntentId: payment.id, evidenceFingerprint: `evidence-${marker}` } });
    const proposed = await proposeSettlementResolution(tx, { settlementEntryId: entry.id, resolutionType: "CHARGEBACK_CONFIRMED", reason: "Authenticated provider evidence confirms the chargeback.", evidenceReference: `PROVIDER-CASE-${marker}`, proposedById: maker.id, idempotencyKey: `proposal-${marker}` });
    await assert.rejects(() => decideSettlementResolution(tx, { proposalId: proposed.proposal.id, decision: "APPROVED", reason: "Self approval must not be accepted by the control.", reviewedById: maker.id, idempotencyKey: `self-${marker}` }), (error) => error instanceof SettlementResolutionError && error.code === "INDEPENDENT_REVIEW_REQUIRED");
    const decided = await decideSettlementResolution(tx, { proposalId: proposed.proposal.id, decision: "APPROVED", reason: "Independent review confirms exact provider chargeback evidence.", reviewedById: checker.id, idempotencyKey: `decision-${marker}` });
    assert.equal(decided.resolutionDecision.decision, "APPROVED");
    const journal = await tx.financialJournal.findUniqueOrThrow({ where: { eventType_eventId: { eventType: "CHARGEBACK_CONFIRMED", eventId: proposed.proposal.id } }, include: { entries: true } });
    assert.equal(journal.entries.length, 2); assert.equal(journal.entries.filter((row) => row.direction === "DEBIT")[0].amount.toString(), "1000"); assert.equal(journal.entries.filter((row) => row.direction === "CREDIT")[0].amount.toString(), "1000");
    assert.equal(await tx.walletTransaction.count({ where: { wallet: { userId: customer.id } } }), 0); assert.equal((await tx.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
assert.equal(await prisma.financialJournal.count({ where: { eventType: "CHARGEBACK_CONFIRMED", description: { contains: marker } } }), 0);
await prisma.$disconnect();
console.log("Chargeback posting verification passed: exact provider/payment evidence, Finance maker/checker separation, one balanced company journal, no wallet/order mutation, and rollback cleanup.");
