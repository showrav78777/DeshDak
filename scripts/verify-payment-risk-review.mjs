import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const marker = randomBytes(8).toString("hex");
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for payment-risk verification.");
const ids = { users: [], sessions: [], orders: [], payments: [], decisions: [] };
function assert(condition, message) { if (!condition) throw new Error(message); }
async function decide(cookie, paymentId, key, decision, reason, includeOrigin = true) {
  const response = await fetch(`${origin}/api/v1/admin/payment-risk/${paymentId}/decision`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": key, ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify({ decision, reason }) });
  return { response, body: await response.json() };
}

try {
  const role = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
  const admin = await prisma.user.create({ data: { email: `risk-admin-${marker}@example.test`, fullName: "Risk Test Administrator", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(admin.id);
  const customer = await prisma.user.create({ data: { email: `risk-customer-${marker}@example.test`, fullName: "Risk Test Customer", phone: `019${randomBytes(6).toString("hex").slice(0, 8)}`, passwordHash: "not-used", status: "ACTIVE" } }); ids.users.push(customer.id);
  const authSession = await prisma.authSession.create({ data: { userId: admin.id, portal: "admin", clientName: "Risk verification", clientType: "WEB", mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) } }); ids.sessions.push(authSession.id);
  const token = await new SignJWT({ email: admin.email, name: admin.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(authSession.id).setSubject(admin.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
  const cookie = `crossly_session=${token}; __Host-crossly_session=${token}`;
  async function heldPayment(suffix) {
    const order = await prisma.order.create({ data: { orderNumber: `RISK-${suffix}-${marker}`, customerId: customer.id, type: "BUY_AND_SHIP", status: "PENDING_PAYMENT", currency: "BDT", grandTotal: 500 } }); ids.orders.push(order.id);
    const payment = await prisma.paymentIntent.create({ data: { reference: `PAY-${suffix}-${marker}`, idempotencyKey: `risk-payment-${suffix}-${marker}`, provider: "SSLCOMMERZ", orderId: order.id, amount: 500, currency: "BDT", status: "PENDING", gatewayPayload: { reviewRequired: true, evidence: { validationId: `VAL-${suffix}-${marker}`, bankTransactionId: `BANK-${suffix}-${marker}`, providerStatus: "VALID", riskLevel: 1, riskTitle: "Manual review test" } } } }); ids.payments.push(payment.id); return { order, payment };
  }

  const rejected = await heldPayment("REJECT");
  const blocked = await decide(cookie, rejected.payment.id, `risk-origin-${marker}`, "REJECTED", "Provider evidence requires financial investigation.", false);
  assert(blocked.response.status === 403 && blocked.body.error?.code === "UNTRUSTED_ORIGIN", "Risk decision accepted a missing trusted Origin.");
  const rejectKey = `risk-reject-${marker}`;
  const first = await decide(cookie, rejected.payment.id, rejectKey, "REJECTED", "Provider evidence requires financial investigation.");
  assert(first.response.status === 201 && first.body.data.decision.decision === "REJECTED" && first.body.data.paymentStatus === "PENDING", "Rejected risk payment was not preserved for financial resolution."); ids.decisions.push(first.body.data.decision.id);
  const replay = await decide(cookie, rejected.payment.id, rejectKey, "REJECTED", "Provider evidence requires financial investigation.");
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay === true, "Risk decision did not replay idempotently.");
  const conflict = await decide(cookie, rejected.payment.id, rejectKey, "APPROVED", "Changed decision must be rejected safely.");
  assert(conflict.response.status === 409 && conflict.body.error?.code === "IDEMPOTENCY_KEY_REUSED", "Changed risk decision reused an idempotency key.");

  const approved = await heldPayment("APPROVE");
  const approval = await decide(cookie, approved.payment.id, `risk-approve-${marker}`, "APPROVED", "Identity and provider evidence were manually verified.");
  assert(approval.response.status === 201 && approval.body.data.paymentStatus === "SUCCEEDED", "Approved risk payment did not become succeeded."); ids.decisions.push(approval.body.data.decision.id);
  const approvedOrder = await prisma.order.findUniqueOrThrow({ where: { id: approved.order.id } });
  assert(approvedOrder.status === "PENDING_PURCHASE_REVIEW", "Approved payment did not release the order to Admin purchase review.");
  const auditCount = await prisma.auditLog.count({ where: { entityType: "PaymentIntent", entityId: { in: ids.payments }, action: { startsWith: "sslcommerz.risk_payment_" } } });
  assert(auditCount === 2, "Risk decisions did not create the expected audit records.");
  let immutable = false;
  try { await prisma.paymentRiskDecision.update({ where: { id: ids.decisions[0] }, data: { reason: "Attempted mutation" } }); } catch { immutable = true; }
  assert(immutable, "Database allowed an immutable payment-risk decision to be changed.");
  console.log("Payment-risk review verification passed: MFA Admin boundary, trusted origin, immutable decisions, idempotent replay, rejection hold, approval, audit, and safe order release.");
} finally {
  if (ids.decisions.length) await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('ALTER TABLE "PaymentRiskDecision" DISABLE TRIGGER "PaymentRiskDecision_immutable"'); await tx.paymentRiskDecision.deleteMany({ where: { id: { in: ids.decisions } } }); await tx.$executeRawUnsafe('ALTER TABLE "PaymentRiskDecision" ENABLE TRIGGER "PaymentRiskDecision_immutable"'); });
  if (ids.payments.length) await prisma.auditLog.deleteMany({ where: { entityType: "PaymentIntent", entityId: { in: ids.payments } } });
  if (ids.users.length) { await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.userEvent.deleteMany({ where: { userId: { in: ids.users } } }); }
  if (ids.payments.length) await prisma.paymentIntent.deleteMany({ where: { id: { in: ids.payments } } });
  if (ids.orders.length) { await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
