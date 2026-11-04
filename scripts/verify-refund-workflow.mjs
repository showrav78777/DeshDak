import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const marker = randomBytes(8).toString("hex");
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for refund workflow verification.");

let adminId; let customerId; let sessionId; let orderId; let paymentId; let snapshotId; let walletId;
const refundIds = []; const journalIds = [];
function assert(condition, message) { if (!condition) throw new Error(message); }
async function post(cookie, idempotencyKey, body, includeOrigin = true) {
  const response = await fetch(`${origin}/api/v1/admin/refunds/wallet`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": idempotencyKey, ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

try {
  const role = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
  const admin = await prisma.user.create({ data: { email: `refund-admin-${marker}@example.test`, fullName: "Refund Test Administrator", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); adminId = admin.id;
  const customer = await prisma.user.create({ data: { email: `refund-customer-${marker}@example.test`, fullName: "Refund Test Customer", passwordHash: "not-used", status: "ACTIVE" } }); customerId = customer.id;
  const authSession = await prisma.authSession.create({ data: { userId: admin.id, portal: "admin", clientName: "Refund verification", clientType: "WEB", mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) } }); sessionId = authSession.id;
  const token = await new SignJWT({ email: admin.email, name: admin.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(authSession.id).setSubject(admin.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
  const cookie = `crossly_session=${token}; __Host-crossly_session=${token}`;

  const snapshot = await prisma.fxSnapshot.create({ data: { pair: "BDT_USD", baseCurrency: "BDT", quoteCurrency: "USD", baseAmount: 900, convertedAmount: 1125, rateUsed: 1.25, spreadApplied: 0, source: "LOCKED_TEST_RATE", contextType: "PAYMENT" } }); snapshotId = snapshot.id;
  const order = await prisma.order.create({ data: { orderNumber: `REFUND-${marker}`, customerId: customer.id, type: "BUY_AND_SHIP", status: "PAID", currency: "BDT", productTotal: 1000, discountTotal: 100, grandTotal: 900 } }); orderId = order.id;
  const payment = await prisma.paymentIntent.create({ data: { reference: `PAY-${marker}`, idempotencyKey: `payment-${marker}`, provider: "EXTERNAL_TEST", orderId: order.id, fxSnapshotId: snapshot.id, amount: 1125, currency: "USD", status: "SUCCEEDED", providerTransactionId: `provider-${marker}` } }); paymentId = payment.id;

  const untrusted = await post(cookie, `refund-origin-${marker}`, { orderId: order.id, grossAmount: 400, reason: "Approved partial refund", walletConsentConfirmed: true }, false);
  assert(untrusted.response.status === 403 && untrusted.body.error?.code === "UNTRUSTED_ORIGIN", "Financial mutation accepted a missing Origin header.");
  const noConsent = await post(cookie, `refund-consent-${marker}`, { orderId: order.id, grossAmount: 400, reason: "Approved partial refund", walletConsentConfirmed: false });
  assert(noConsent.response.status === 409 && noConsent.body.error?.code === "WALLET_REFUND_CONSENT_REQUIRED", "External payment was redirected to wallet without consent.");

  const firstKey = `refund-first-${marker}`;
  const first = await post(cookie, firstKey, { orderId: order.id, grossAmount: 400, reason: "Approved partial refund", walletConsentConfirmed: true });
  assert(first.response.status === 201 && first.body.data.refund.amount === "450" && first.body.data.refund.calculation.promotionNetted === "40", "First locked-FX promotional refund calculation failed."); refundIds.push(first.body.data.refund.id);
  const replay = await post(cookie, firstKey, { orderId: order.id, grossAmount: 400, reason: "Approved partial refund", walletConsentConfirmed: true });
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay === true && replay.body.data.refund.id === first.body.data.refund.id, "Identical retry did not replay safely.");
  const mismatch = await post(cookie, firstKey, { orderId: order.id, grossAmount: 401, reason: "Approved partial refund", walletConsentConfirmed: true });
  assert(mismatch.response.status === 409 && mismatch.body.error?.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "Changed refund payload reused an idempotency key.");

  const second = await post(cookie, `refund-second-${marker}`, { orderId: order.id, grossAmount: 600, reason: "Approved final refund", walletConsentConfirmed: true });
  assert(second.response.status === 201 && second.body.data.refund.amount === "675" && second.body.data.refund.calculation.promotionNetted === "60", "Final locked-FX promotional refund calculation failed."); refundIds.push(second.body.data.refund.id);
  const over = await post(cookie, `refund-over-${marker}`, { orderId: order.id, grossAmount: 0.01, reason: "Attempted excess refund", walletConsentConfirmed: true });
  assert(over.response.status === 409 && over.body.error?.code === "REFUND_AMOUNT_TOO_HIGH", "Over-refund protection failed.");

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId: customer.id, currency: "USD" } }, include: { transactions: { include: { journal: { include: { entries: true } } } } } }); walletId = wallet.id;
  assert(wallet.availableBalance.toString() === "1125" && wallet.transactions.length === 2, "Wallet did not receive exactly the original paid settlement amount.");
  for (const transaction of wallet.transactions) {
    journalIds.push(transaction.journalId);
    const debit = transaction.journal.entries.filter((entry) => entry.direction === "DEBIT").reduce((sum, entry) => sum + Number(entry.amount), 0);
    const credit = transaction.journal.entries.filter((entry) => entry.direction === "CREDIT").reduce((sum, entry) => sum + Number(entry.amount), 0);
    assert(debit === credit && debit === Number(transaction.amount), "Refund journal is not balanced.");
  }
  const refunds = await prisma.refund.findMany({ where: { id: { in: refundIds } } });
  assert(refunds.length === 2 && refunds.every((refund) => refund.fxSnapshotId === snapshot.id && refund.calculationVersion === "PROMO_NET_LOCKED_FX_V1" && refund.requestFingerprint), "Refund evidence did not preserve its locked snapshot, version, and request fingerprint.");
  const refundedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { statusHistory: { where: { toStatus: "REFUNDED" } } } });
  assert(refundedOrder.status === "REFUNDED" && refundedOrder.statusHistory.length === 1, "A fully refunded eligible order did not receive an auditable terminal state.");
  console.log("Refund workflow verification passed: MFA session, trusted origin, consent, promo netting, locked FX, replay safety, over-refund guard, and balanced journals.");
} finally {
  if (refundIds.length) await prisma.auditLog.deleteMany({ where: { entityType: "Refund", entityId: { in: refundIds } } });
  if (walletId) await prisma.walletTransaction.deleteMany({ where: { walletId } });
  if (refundIds.length) await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  if (journalIds.length) { await prisma.financialJournalEntry.deleteMany({ where: { journalId: { in: journalIds } } }); await prisma.financialJournal.deleteMany({ where: { id: { in: journalIds } } }); }
  if (walletId) await prisma.wallet.deleteMany({ where: { id: walletId } });
  if (paymentId) await prisma.paymentIntent.deleteMany({ where: { id: paymentId } });
  if (orderId) await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (snapshotId) await prisma.fxSnapshot.deleteMany({ where: { id: snapshotId } });
  if (sessionId) await prisma.authSession.deleteMany({ where: { id: sessionId } });
  const userIds = [adminId, customerId].filter(Boolean);
  if (userIds.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } }); }
  await prisma.$disconnect();
}
