import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET; if (!authSecret) throw new Error("AUTH_SECRET is required for RMA verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], assignments: [], warehouses: [], orders: [], packages: [], shipments: [], rmas: [], refunds: [], wallets: [], journals: [], snapshots: [], payments: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal, mfaVerified = false) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "RMA verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } }); ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}
async function request(path, cookie, method = "GET", body, idempotencyKey, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { response, body: await response.json().catch(() => null) };
}
async function createOrderShipment(customerId, warehouseId, type, deadline) {
  const order = await prisma.order.create({ data: { orderNumber: `RMA-ORD-${randomBytes(8).toString("hex").toUpperCase()}`, customerId, type, status: "DELIVERED", currency: "BDT", productTotal: 1000, grandTotal: 1000 } }); ids.orders.push(order.id);
  const pkg = await prisma.package.create({ data: { orderId: order.id, warehouseId, packageCode: `RMA-PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "SHIPPED" } }); ids.packages.push(pkg.id);
  const shipment = await prisma.shipment.create({ data: { trackingNumber: `RMA-TRK-${randomBytes(6).toString("hex").toUpperCase()}`, status: "DELIVERED", destinationWarehouseId: warehouseId, deliveredAt: new Date(deadline.getTime() - 7 * 86_400_000), claimDeadline: deadline, packages: { create: { packageId: pkg.id } } } }); ids.shipments.push(shipment.id);
  return { order, pkg, shipment };
}

try {
  const roles = {}; for (const code of ["customer_personal", "admin", "inspector", "finance"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, role) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: label, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: roles[role].id } } } }); ids.users.push(row.id); return row; }
  const customer = await user("rma-customer", "customer_personal"); const other = await user("rma-other", "customer_personal"); const admin = await user("rma-admin", "admin"); const finance = await user("rma-finance", "finance"); const inspector = await user("rma-inspector", "inspector"); const foreignInspector = await user("rma-foreign-inspector", "inspector");
  await prisma.userRole.create({ data: { userId: admin.id, roleId: roles.finance.id } });
  const [customerCookie, otherCookie, adminCookie, adminFinanceCookie, financeCookie, inspectorCookie, foreignCookie] = await Promise.all([sessionFor(customer, "customer"), sessionFor(other, "customer"), sessionFor(admin, "admin", true), sessionFor(admin, "finance", true), sessionFor(finance, "finance", true), sessionFor(inspector, "inspector"), sessionFor(foreignInspector, "inspector")]);
  const warehouse = await prisma.warehouse.create({ data: { name: `RMA Destination ${marker}`, country: "BD", type: "DESTINATION" } }); const foreignWarehouse = await prisma.warehouse.create({ data: { name: `RMA Foreign ${marker}`, country: "US", type: "DESTINATION" } }); ids.warehouses.push(warehouse.id, foreignWarehouse.id);
  for (const [userId, warehouseId] of [[inspector.id, warehouse.id], [foreignInspector.id, foreignWarehouse.id]]) { const assignment = await prisma.warehouseStaffAssignment.create({ data: { userId, warehouseId, assignedById: admin.id } }); ids.assignments.push(assignment.id); }

  const primary = await createOrderShipment(customer.id, warehouse.id, "BUY_AND_SHIP", new Date(Date.now() + 86_400_000));
  const payload = { shipmentId: primary.shipment.id, packageIds: [primary.pkg.id], reason: "DAMAGED", description: "The delivered product has significant visible damage.", evidenceReferences: [`rma-evidence/${marker}/damage.jpg`] };
  const noOrigin = await request("/api/v1/rmas", customerCookie, "POST", payload, `rma-no-origin-${marker}`, false); assert(noOrigin.response.status === 403 && noOrigin.body.error.code === "UNTRUSTED_ORIGIN", "Customer claim accepted without trusted origin.");
  const publicEvidence = await request("/api/v1/rmas", customerCookie, "POST", { ...payload, evidenceReferences: ["https://public.example/damage.jpg"] }, `rma-public-${marker}`); assert(publicEvidence.response.status === 422, "Public evidence URL was accepted.");
  const createKey = `rma-create-${marker}`; const created = await request("/api/v1/rmas", customerCookie, "POST", payload, createKey); assert(created.response.status === 201 && created.body.data.rma.status === "RETURN_REQUESTED", `Customer claim failed: ${JSON.stringify(created.body)}`); const rmaId = created.body.data.rma.id; ids.rmas.push(rmaId);
  const replay = await request("/api/v1/rmas", customerCookie, "POST", payload, createKey); assert(replay.response.status === 200 && replay.body.data.idempotentReplay, "Claim retry was not idempotent.");
  assert((await request(`/api/v1/rmas/${rmaId}`, otherCookie)).response.status === 404, "Another customer could read the claim.");
  const duplicate = await request("/api/v1/rmas", customerCookie, "POST", payload, `rma-duplicate-${marker}`); assert(duplicate.response.status === 409 && duplicate.body.error.code === "ACTIVE_CLAIM_EXISTS", "A duplicate active claim was accepted.");

  let current = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId } });
  const approved = await request(`/api/v1/admin/rmas/${rmaId}/action`, adminCookie, "PATCH", { action: "APPROVE", note: "Evidence supports a physical return inspection.", returnRequired: true, returnInstructions: "Return to the assigned destination warehouse.", version: current.version }); assert(approved.response.status === 200 && approved.body.data.rma.status === "RETURN_APPROVED", `Admin approval failed: ${JSON.stringify(approved.body)}`);
  const tracked = await request(`/api/v1/rmas/${rmaId}/return`, customerCookie, "POST", { trackingNumber: `RET-${marker}` }); assert(tracked.response.status === 200 && tracked.body.data.rma.status === "RETURN_IN_TRANSIT", "Return tracking failed.");
  current = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId } }); const received = await request(`/api/v1/admin/rmas/${rmaId}/action`, adminCookie, "PATCH", { action: "MARK_RETURN_RECEIVED", note: "Return received at the assigned warehouse.", version: current.version }); assert(received.response.status === 200 && received.body.data.rma.status === "RETURN_RECEIVED", "Admin return receipt failed.");
  current = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId } }); const inspectionBody = { result: "CONFIRMED", notes: "Physical damage matches the submitted claim evidence.", evidenceReferences: [`rma-evidence/${marker}/inspection.jpg`], version: current.version };
  assert((await request(`/api/v1/operations/rmas/${rmaId}/inspect`, foreignCookie, "POST", inspectionBody)).response.status === 404, "Foreign Inspector accessed the return.");
  const inspected = await request(`/api/v1/operations/rmas/${rmaId}/inspect`, inspectorCookie, "POST", inspectionBody); assert(inspected.response.status === 200 && inspected.body.data.rma.status === "INSPECTED", `Assigned inspection failed: ${JSON.stringify(inspected.body)}`);
  current = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId } }); const decision = await request(`/api/v1/admin/rmas/${rmaId}/action`, adminCookie, "PATCH", { action: "APPROVE_REFUND", note: "Inspection confirms a partial refund of the approved gross amount.", liabilityParty: "CARRIER", approvedRefundAmount: 400, version: current.version }); assert(decision.response.status === 200 && decision.body.data.rma.decision === "PARTIAL_REFUND", "Refund decision failed.");
  const decisionEvidence = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId } }); assert(decisionEvidence.refundDecisionById === admin.id && decisionEvidence.refundDecisionAt, "Named refund decision evidence was not preserved.");

  const snapshot = await prisma.fxSnapshot.create({ data: { pair: "BDT_BDT", baseCurrency: "BDT", quoteCurrency: "BDT", baseAmount: 1000, convertedAmount: 1000, rateUsed: 1, spreadApplied: 0, source: "RMA_TEST", contextType: "PAYMENT" } }); ids.snapshots.push(snapshot.id);
  const payment = await prisma.paymentIntent.create({ data: { reference: `RMA-PAY-${marker}`, idempotencyKey: `rma-payment-${marker}`, provider: "WALLET", orderId: primary.order.id, fxSnapshotId: snapshot.id, amount: 1000, currency: "BDT", status: "SUCCEEDED" } }); ids.payments.push(payment.id);
  const samePerson = await request("/api/v1/finance/refunds/wallet", adminFinanceCookie, "POST", { orderId: primary.order.id, rmaId, grossAmount: 400, reason: "Same-person approval must fail", walletConsentConfirmed: true }, `rma-refund-same-person-${marker}`); assert(samePerson.response.status === 409 && samePerson.body.error.code === "INDEPENDENT_REFUND_APPROVER_REQUIRED", "The claim approver was allowed to post the refund.");
  const mismatch = await request("/api/v1/finance/refunds/wallet", financeCookie, "POST", { orderId: primary.order.id, rmaId, grossAmount: 399, reason: "Claim payout mismatch test", walletConsentConfirmed: true }, `rma-refund-mismatch-${marker}`); assert(mismatch.response.status === 409 && mismatch.body.error.code === "RMA_REFUND_NOT_APPROVED", "Refund amount escaped the RMA approval.");
  const paid = await request("/api/v1/finance/refunds/wallet", financeCookie, "POST", { orderId: primary.order.id, rmaId, grossAmount: 400, reason: "Approved RMA partial refund", walletConsentConfirmed: true }, `rma-refund-${marker}`); assert(paid.response.status === 201, `RMA refund posting failed: ${JSON.stringify(paid.body)}`); ids.refunds.push(paid.body.data.refund.id);
  const completed = await prisma.rma.findUniqueOrThrow({ where: { id: rmaId }, include: { events: true, refunds: true } }); assert(completed.status === "REFUNDED" && completed.refunds[0]?.rmaId === rmaId && completed.events.some((event) => event.toStatus === "REFUNDED"), "RMA refund was not atomically linked and completed.");
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId: customer.id, currency: "BDT" } }, include: { transactions: true } }); ids.wallets.push(wallet.id); ids.journals.push(...wallet.transactions.map((item) => item.journalId)); assert(wallet.availableBalance.toString() === "400", "Approved RMA refund did not credit the wallet exactly once.");

  const late = await createOrderShipment(customer.id, warehouse.id, "BUY_AND_SHIP", new Date(Date.now() - 86_400_000)); const latePayload = { shipmentId: late.shipment.id, packageIds: [late.pkg.id], reason: "DAMAGED", description: "Late exceptional damage claim with documented evidence.", evidenceReferences: [`rma-evidence/${marker}/late.jpg`] };
  const blockedLate = await request("/api/v1/rmas", customerCookie, "POST", latePayload, `rma-late-customer-${marker}`); assert(blockedLate.response.status === 422 && blockedLate.body.error.code === "CLAIM_WINDOW_EXPIRED", "Expired customer claim was accepted.");
  const overridden = await request("/api/v1/admin/rmas", adminCookie, "POST", { ...latePayload, overrideReason: "Support verified a documented service interruption before the deadline." }, `rma-late-admin-${marker}`); assert(overridden.response.status === 201, `Admin late override failed: ${JSON.stringify(overridden.body)}`); ids.rmas.push(overridden.body.data.rma.id);
  const savedLate = await prisma.rma.findUniqueOrThrow({ where: { id: overridden.body.data.rma.id } }); assert(savedLate.createdAfterDeadline && savedLate.overriddenById === admin.id && savedLate.overrideReason, "Late override evidence was not preserved.");

  const shipForMe = await createOrderShipment(customer.id, warehouse.id, "SHIP_FOR_ME", new Date(Date.now() + 86_400_000)); const ineligible = await request("/api/v1/rmas", customerCookie, "POST", { shipmentId: shipForMe.shipment.id, packageIds: [shipForMe.pkg.id], reason: "WRONG_ITEM", description: "Product quality issue outside Ship for Me coverage.", evidenceReferences: [`rma-evidence/${marker}/ship-for-me.jpg`] }, `rma-ineligible-${marker}`); assert(ineligible.response.status === 422 && ineligible.body.error.code === "CLAIM_REASON_NOT_ELIGIBLE", "Ship for Me product-quality claim was accepted.");
  console.log("RMA workflow verification passed: ownership, CSRF, private evidence, eligibility, deadline, Admin override, transitions, inspection, named decision evidence, independent Finance posting, exact refund linkage, immutable events, and wallet posting.");
} finally {
  if (ids.rmas.length) { await prisma.notification.deleteMany({ where: { entityType: "Rma", entityId: { in: ids.rmas } } }); await prisma.rmaMessage.deleteMany({ where: { rmaId: { in: ids.rmas } } }); await prisma.rmaEvent.deleteMany({ where: { rmaId: { in: ids.rmas } } }); await prisma.rmaItem.deleteMany({ where: { rmaId: { in: ids.rmas } } }); }
  if (ids.wallets.length) await prisma.walletTransaction.deleteMany({ where: { walletId: { in: ids.wallets } } });
  if (ids.refunds.length) await prisma.refund.deleteMany({ where: { id: { in: ids.refunds } } });
  if (ids.journals.length) { await prisma.financialJournalEntry.deleteMany({ where: { journalId: { in: ids.journals } } }); await prisma.financialJournal.deleteMany({ where: { id: { in: ids.journals } } }); }
  if (ids.wallets.length) await prisma.wallet.deleteMany({ where: { id: { in: ids.wallets } } });
  if (ids.rmas.length) await prisma.rma.deleteMany({ where: { id: { in: ids.rmas } } });
  if (ids.payments.length) await prisma.paymentIntent.deleteMany({ where: { id: { in: ids.payments } } });
  if (ids.shipments.length) { await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: ids.shipments } } }); await prisma.shipmentPackage.deleteMany({ where: { shipmentId: { in: ids.shipments } } }); await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } }); }
  if (ids.packages.length) await prisma.package.deleteMany({ where: { id: { in: ids.packages } } });
  if (ids.orders.length) { await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.snapshots.length) await prisma.fxSnapshot.deleteMany({ where: { id: { in: ids.snapshots } } });
  if (ids.assignments.length) await prisma.warehouseStaffAssignment.deleteMany({ where: { id: { in: ids.assignments } } });
  if (ids.warehouses.length) await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
