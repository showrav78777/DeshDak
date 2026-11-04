import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const marker = randomBytes(8).toString("hex");
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for payment reconciliation verification.");
const ids = { users: [], sessions: [], payments: [], batches: [] };
function assert(condition, message) { if (!condition) throw new Error(message); }
async function submit(cookie, idempotencyKey, externalBatchReference, entries, includeOrigin = true) {
  const response = await fetch(`${origin}/api/v1/finance/payment-reconciliation`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": idempotencyKey, ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify({ provider: "SSLCOMMERZ", externalBatchReference, settlementDate: "2026-09-08", currency: "BDT", entries }) });
  return { response, body: await response.json() };
}

try {
  const role = await prisma.role.upsert({ where: { code: "finance" }, update: {}, create: { code: "finance", description: "Finance operator" } });
  const user = await prisma.user.create({ data: { email: `settlement-${marker}@example.test`, fullName: "Settlement Test Finance", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(user.id);
  const authSession = await prisma.authSession.create({ data: { userId: user.id, portal: "finance", clientName: "Settlement verification", clientType: "WEB", mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) } }); ids.sessions.push(authSession.id);
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: ["finance"] }).setProtectedHeader({ alg: "HS256" }).setJti(authSession.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
  const cookie = `crossly_session=${token}; __Host-crossly_session=${token}`;
  for (const [suffix, status] of [["MATCH", "SUCCEEDED"], ["AMOUNT", "SUCCEEDED"], ["PENDING", "PENDING"]]) {
    const payment = await prisma.paymentIntent.create({ data: { reference: `PAY-${suffix}-${marker}`, idempotencyKey: `payment-${suffix}-${marker}`, provider: "SSLCOMMERZ", amount: 1000, currency: "BDT", status } }); ids.payments.push(payment.id);
  }
  const settledAt = "2026-09-08T12:00:00+06:00";
  const rows = [
    { externalTransactionId: `PAY-MATCH-${marker}`, grossAmount: 1000, gatewayFee: 25, netAmount: 975, currency: "BDT", settledAt },
    { externalTransactionId: `PAY-AMOUNT-${marker}`, grossAmount: 900, gatewayFee: 25, netAmount: 875, currency: "BDT", settledAt },
    { externalTransactionId: `PAY-MISSING-${marker}`, grossAmount: 1000, gatewayFee: 25, netAmount: 975, currency: "BDT", settledAt },
    { externalTransactionId: `PAY-MATCH-${marker}`, grossAmount: 1000, gatewayFee: 25, netAmount: 975, currency: "BDT", settledAt },
    { externalTransactionId: `PAY-PENDING-${marker}`, grossAmount: 1000, gatewayFee: 25, netAmount: 975, currency: "BDT", settledAt },
  ];
  const noOrigin = await submit(cookie, `settlement-origin-${marker}`, `BATCH-ORIGIN-${marker}`, rows, false);
  assert(noOrigin.response.status === 403 && noOrigin.body.error?.code === "UNTRUSTED_ORIGIN", "Settlement import accepted a missing trusted Origin.");
  const key = `settlement-import-${marker}`;
  const first = await submit(cookie, key, `BATCH-${marker}`, rows);
  assert(first.response.status === 201, `Settlement import failed: ${JSON.stringify(first.body)}`); ids.batches.push(first.body.data.batch.id);
  assert(!("idempotencyKey" in first.body.data.batch) && !("sourceFingerprint" in first.body.data.batch) && first.body.data.batch.entries.every((entry) => !("evidenceFingerprint" in entry) && !("paymentIntentId" in entry)), "Settlement response exposed internal security metadata.");
  assert(first.body.data.batch.matchedCount === 1 && first.body.data.batch.exceptionCount === 4 && first.body.data.batch.status === "EXCEPTIONS", "Settlement match totals are incorrect.");
  const statuses = first.body.data.batch.entries.map((entry) => entry.matchStatus);
  for (const expected of ["MATCHED", "AMOUNT_MISMATCH", "PAYMENT_NOT_FOUND", "DUPLICATE_TRANSACTION", "PAYMENT_NOT_SUCCEEDED"]) assert(statuses.includes(expected), `Missing settlement outcome ${expected}.`);
  const replay = await submit(cookie, key, `BATCH-${marker}`, rows);
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay === true, "Settlement report did not replay idempotently.");
  const changed = await submit(cookie, key, `BATCH-CHANGED-${marker}`, rows);
  assert(changed.response.status === 409 && changed.body.error?.code === "IDEMPOTENCY_KEY_REUSED", "Changed settlement report reused an idempotency key.");
  assert(await prisma.auditLog.count({ where: { action: "payment.settlement_imported", entityId: first.body.data.batch.id } }) === 1, "Settlement import audit evidence is missing or duplicated.");
  let immutable = false;
  try { await prisma.paymentSettlementBatch.update({ where: { id: first.body.data.batch.id }, data: { externalBatchReference: "MUTATED" } }); } catch { immutable = true; }
  assert(immutable, "Database allowed settlement evidence to be changed.");
  console.log("Payment reconciliation verification passed: Finance MFA boundary, trusted origin, exact matching, exception classification, idempotency, audit evidence, and database immutability.");
} finally {
  if (ids.batches.length) await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementEntry" DISABLE TRIGGER "PaymentSettlementEntry_immutable"'); await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementBatch" DISABLE TRIGGER "PaymentSettlementBatch_immutable"'); await tx.paymentSettlementEntry.deleteMany({ where: { batchId: { in: ids.batches } } }); await tx.paymentSettlementBatch.deleteMany({ where: { id: { in: ids.batches } } }); await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementBatch" ENABLE TRIGGER "PaymentSettlementBatch_immutable"'); await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementEntry" ENABLE TRIGGER "PaymentSettlementEntry_immutable"'); });
  if (ids.payments.length) await prisma.paymentIntent.deleteMany({ where: { id: { in: ids.payments } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
