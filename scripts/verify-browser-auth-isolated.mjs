import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL);
const baseURL = new URL(process.env.TEST_BASE_URL);
const localHosts = ["localhost", "127.0.0.1", "[::1]"];
if (!localHosts.includes(database.hostname) || !localHosts.includes(baseURL.hostname)
  || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) {
  throw new Error("Run browser authentication through verify:launch:isolated only.");
}
const prisma = new PrismaClient();
const stateFile = "e2e/.auth/customer.json";
const staffRoles = { warehouse: "warehouse_worker", inspector: "inspector", logistics: "logistics_worker", support: "customer_service" };
const stateFiles = [stateFile, ...Object.keys(staffRoles).map((portal) => `e2e/.auth/${portal}.json`)];
const shard = process.env.E2E_SHARD;
const updateSnapshots = process.env.E2E_UPDATE_SNAPSHOTS === "1";
if (updateSnapshots && process.env.GITHUB_ACTIONS === "true") throw new Error("CI must compare reviewed snapshots, not update them.");
if (shard && !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error("E2E_SHARD must be a positive shard/total pair.");
if (shard) {
  const [current, total] = shard.split("/").map(Number);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current > total) throw new Error("E2E_SHARD index must not exceed its total.");
}
try {
  const mfaCheck = spawnSync("npm", ["run", "test:admin-mfa"], { env: process.env, stdio: "inherit", timeout: 120_000 });
  if (mfaCheck.error || mfaCheck.status !== 0) throw new Error("Isolated MFA API regression checks failed before browser fixtures.");
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "customer_personal" } });
  const password = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({ data: {
    email: `browser-${randomBytes(12).toString("hex")}@example.test`,
    fullName: "Isolated browser customer", status: "ACTIVE",
    passwordHash: await bcrypt.hash(password, 12),
    roles: { create: { roleId: role.id } },
  }, select: { id: true, email: true } });
  const station = await prisma.warehouse.create({ data: { name: "Assigned browser station", country: "CN", type: "ORIGIN" } });
  // Direct legacy/import writers must obey the same case-insensitive identity
  // rule as supplier dispatch. Dedicated synthetic order, never customer data.
  const trackingOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "DRAFT", grandTotal: 0 } });
  const tracking = `CASE-${randomBytes(12).toString("hex")}`;
  const trackingPackage = value => ({ orderId: trackingOrder.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, inboundTracking: value, status: "EXPECTED" });
  const competing = await Promise.allSettled([
    prisma.package.create({ data: trackingPackage(tracking.toLowerCase()) }),
    prisma.package.create({ data: trackingPackage(tracking.toUpperCase()) }),
  ]);
  if (competing.filter(result => result.status === "fulfilled").length !== 1 || competing.filter(result => result.status === "rejected" && result.reason.code === "P2002").length !== 1) throw new Error("Case-insensitive concurrent tracking uniqueness was not enforced.");
  const distinct = await prisma.package.create({ data: trackingPackage(`${tracking}-OTHER`) });
  let updateBlocked = false;
  try { await prisma.package.update({ where: { id: distinct.id }, data: { inboundTracking: tracking.toUpperCase() } }); }
  catch (error) { if (error.code === "P2002") updateBlocked = true; else throw error; }
  if (!updateBlocked) throw new Error("Case-insensitive tracking update conflict was not rejected.");
  await prisma.package.create({ data: trackingPackage(null) });
  await prisma.package.create({ data: trackingPackage(null) });
  const preflight = spawnSync("npm", ["run", "db:tracking:check"], { env: process.env, stdio: "inherit", timeout: 30_000 });
  if (preflight.error || preflight.status !== 0) throw new Error("Read-only tracking preflight failed on the isolated schema.");
  console.log("Inbound tracking identity: concurrent mixed-case insert and update conflicts blocked; distinct and null tracking allowed.");
  await prisma.warehouse.create({ data: { name: "Unassigned browser station", country: "CN", type: "ORIGIN" } });
  const location = await prisma.warehouseLocation.create({ data: { warehouseId: station.id, code: "BROWSER-BIN", type: "BIN" } });
  const source = await prisma.country.upsert({ where: { isoCode: "CN" }, update: {}, create: { isoCode: "CN", name: "China", defaultCurrency: "CNY", isActive: true } });
  const destination = await prisma.country.upsert({ where: { isoCode: "BD" }, update: {}, create: { isoCode: "BD", name: "Bangladesh", defaultCurrency: "BDT", isActive: true } });
  const lane = await prisma.shippingLane.create({ data: { name: "Disposable browser lane", originCountryId: source.id, destinationCountryId: destination.id, dimensionalWeightDivisor: 5000, isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true } });
  const workflowOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SUPPLIER_SHIPPED", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  // Post-payment starting state only; this is not evidence of a real payment.
  const receiptRaceOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SUPPLIER_SHIPPED", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  const deliveryOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "READY_TO_SHIP", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  const deliveryPackage = await prisma.package.create({ data: { orderId: deliveryOrder.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "READY_TO_SHIP" } });
  const destinationStation = await prisma.warehouse.create({ data: { name: "Browser destination hub", country: "BD", type: "DESTINATION" } });
  const inboundOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, type: "SHIP_FOR_ME", status: "DRAFT", grandTotal: 0, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  await prisma.shipForMeRequest.create({ data: { reference: `SFM-${randomBytes(8).toString("hex").toUpperCase()}`, idempotencyKey: randomBytes(16).toString("hex"), customerId: user.id, orderId: inboundOrder.id, originWarehouseId: station.id, shippingLaneId: lane.id, status: "TRACKING_SUBMITTED", itemDescription: "Synthetic two-parcel receipt", expectedPackageCount: 2, warehouseAddress: {} } });
  const inboundPackages = [];
  for (let index = 0; index < 2; index++) inboundPackages.push(await prisma.package.create({ data: { orderId: inboundOrder.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, inboundTracking: `IN-${randomBytes(8).toString("hex")}`, status: "EXPECTED" } }));
  const deliveryShipment = await prisma.shipment.create({ data: { trackingNumber: `BROWSER-${randomBytes(8).toString("hex").toUpperCase()}`, originWarehouseId: station.id, destinationWarehouseId: destinationStation.id, carrierName: "Synthetic test carrier", packages: { create: { packageId: deliveryPackage.id } } } });
  const quoteFixtures = [];
  const manualRequest = await prisma.sourcingRequest.create({ data: { reference: `BS-${randomBytes(8).toString("hex").toUpperCase()}`, customerId: user.id, productUrl: "https://supplier.example.test/fixture", productTitle: "Synthetic manual sourcing item", quantity: 2, sourceCountryCode: "CN" } });
  const manualPurchaseOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, sourcingRequestId: manualRequest.id, status: "PENDING_PURCHASE_REVIEW", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  const issuanceOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "MEASURED", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  await prisma.package.create({ data: { orderId: issuanceOrder.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "MEASURED", qcStatus: "PASSED", chargeableWeightGrams: 1200 } });
  for (const action of ["accept", "reject", "expired"]) {
    const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
    await prisma.shippingQuote.create({ data: { orderId: order.id, version: 1, shippingLaneId: lane.id, chargeableWeightGrams: 1200, declaredWeightGrams: 1000, discrepancyPercent: 20, discrepancyThresholdPercent: 10, ratePerKgBdt: 800, shippingAmountBdt: 960, handlingFeeBdt: 100, totalBdt: 1060, createdById: user.id, expiresAt: new Date(Date.now() + (action === "expired" ? -3_600_000 : 3_600_000)), note: "Synthetic measured shipping quote for browser testing." } });
    quoteFixtures.push({ action, orderId: order.id });
  }
  // Synthetic opening balance in the disposable schema, not a gateway deposit.
  const paymentWallet = await prisma.wallet.create({ data: { userId: user.id, currency: "BDT", availableBalance: 1060 } });
  const paymentOrders = [];
  for (let index = 0; index < 2; index += 1) {
    const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SHIPPING_QUOTE_READY", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
    await prisma.package.create({ data: { orderId: order.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "MEASURED", qcStatus: "PASSED", actualWeightGrams: 1200, chargeableWeightGrams: 1200 } });
    await prisma.shippingQuote.create({ data: { orderId: order.id, version: 1, shippingLaneId: lane.id, chargeableWeightGrams: 1200, discrepancyThresholdPercent: 10, ratePerKgBdt: 800, shippingAmountBdt: 960, handlingFeeBdt: 100, totalBdt: 1060, createdById: user.id, status: "ACCEPTED", acceptedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
    paymentOrders.push(order.id);
  }
  const staff = [];
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
  const admin = await prisma.user.create({ data: { email: `browser-admin-${randomBytes(12).toString("hex")}@example.test`, fullName: "Disposable MFA administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
  const supportReviewAdmins = {};
  const supportRole = await prisma.role.findUniqueOrThrow({ where: { code: "customer_service" } });
  for (const viewport of ["desktop", "mobile"]) {
    const reviewer = await prisma.user.create({ data: { email: `workforce-admin-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic workforce administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
    const agent = await prisma.user.create({ data: { email: `workforce-agent-${randomBytes(10).toString("hex")}@example.test`, fullName: `Synthetic workforce target ${viewport}`, status: "ACTIVE", passwordHash: "not-used", roles: { create: { roleId: supportRole.id } }, supportAgentProfile: { create: { availability: "OFFLINE", acceptingNewTickets: false, maxActiveTickets: 20, languages: ["bn", "en"] } } }, select: { id: true, email: true } });
    supportReviewAdmins[viewport] = { ...reviewer, agentId: agent.id, agentEmail: agent.email };
  }
  process.env.E2E_SUPPORT_REVIEW_ADMINS = JSON.stringify(supportReviewAdmins);
  const calendarAdmins = {};
  for (const viewport of ["desktop", "mobile"]) {
    const reviewer = await prisma.user.create({ data: { email: `calendar-admin-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic calendar administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
    calendarAdmins[viewport] = { ...reviewer, agentId: supportReviewAdmins[viewport].agentId };
  }
  process.env.E2E_CALENDAR_ADMINS = JSON.stringify(calendarAdmins);
  const sourcingStaffAdmins = {}; const sourcingDecisionAdmins = {};
  for (const [label, fixtures] of [["sourcing-staff", sourcingStaffAdmins], ["sourcing-decision", sourcingDecisionAdmins]]) {
    for (const viewport of ["desktop", "mobile"]) fixtures[viewport] = await prisma.user.create({ data: { email: `${label}-${randomBytes(10).toString("hex")}@example.test`, fullName: `Synthetic ${label} administrator`, status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
  }
  process.env.E2E_SOURCING_STAFF_ADMINS = JSON.stringify(sourcingStaffAdmins);
  process.env.E2E_SOURCING_DECISION_ADMINS = JSON.stringify(sourcingDecisionAdmins);
  const liveSetupAdmins = {};
  for (const viewport of ["desktop", "mobile"]) liveSetupAdmins[viewport] = await prisma.user.create({ data: { email: `live-setup-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic live setup administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
  process.env.E2E_LIVE_SETUP_ADMINS = JSON.stringify(liveSetupAdmins);
  const supportRoleAdmins = {};
  for (const viewport of ["desktop", "mobile"]) {
    const reviewer = await prisma.user.create({ data: { email: `role-admin-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic access administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
    const agent = await prisma.user.create({ data: { email: `role-target-${randomBytes(10).toString("hex")}@example.test`, fullName: `Synthetic access target ${viewport}`, status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), supportAgentProfile: { create: { availability: "OFFLINE", acceptingNewTickets: false, maxActiveTickets: 20, languages: ["bn", "en"] } } }, select: { id: true, email: true } });
    supportRoleAdmins[viewport] = { ...reviewer, agentId: agent.id, agentEmail: agent.email };
  }
  process.env.E2E_SUPPORT_ROLE_ADMINS = JSON.stringify(supportRoleAdmins);
  const privileged = [];
  const cappedOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "ON_HOLD", grandTotal: 0, originCountryCode: "CN" } });
  await prisma.supplierOrderRecord.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ orderId: cappedOrder.id, allocationKey: "SOURCING_REQUEST", supplierName: "PRIVATE-CAPPED-SUPPLIER", supplierOrderReference: `PRIVATE-CAPPED-${index}`, supplierReferenceKey: randomBytes(32).toString("hex"), variantDescription: "Synthetic capacity boundary", quantity: 1, originWarehouseId: station.id, originCountryCode: "CN", recordedById: admin.id, internalNote: "Disposable capacity fixture", idempotencyKey: randomBytes(16).toString("hex"), requestFingerprint: randomBytes(32).toString("hex"), createdAt: new Date(Date.UTC(2020, 0, 1) + index) })) });
  const cappedRecord = await prisma.supplierOrderRecord.findFirstOrThrow({ where: { orderId: cappedOrder.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const cappedHold = await prisma.orderStatusHistory.create({ data: { orderId: cappedOrder.id, fromStatus: "SOURCING", toStatus: "ON_HOLD", actorId: admin.id, note: "Synthetic capacity review hold" } });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "order.purchase_review.place_on_hold", entityType: "Order", entityId: cappedOrder.id, metadata: { historyId: cappedHold.id, supplierRecordId: cappedRecord.id, correctionRequested: true } } });
  // Legacy/import fixture beyond the write cap: browsing must not hide evidence
  // or permit new records merely because the current page is small.
  const pagedOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SOURCING", grandTotal: 0, originCountryCode: "CN" } });
  await prisma.supplierOrderRecord.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ orderId: pagedOrder.id, allocationKey: "SOURCING_REQUEST", supplierName: "PRIVATE-PAGED-SUPPLIER", supplierOrderReference: `PRIVATE-PAGED-${String(index).padStart(3, "0")}`, supplierReferenceKey: randomBytes(32).toString("hex"), variantDescription: "Synthetic legacy record", quantity: 1, originWarehouseId: station.id, originCountryCode: "CN", recordedById: admin.id, internalNote: "Disposable pagination fixture", idempotencyKey: randomBytes(16).toString("hex"), requestFingerprint: randomBytes(32).toString("hex"), createdAt: new Date(Date.UTC(2020, 0, 1) + index) })) });
  const dispatchRequest = await prisma.sourcingRequest.create({ data: { reference: `BS-${randomBytes(8).toString("hex").toUpperCase()}`, customerId: user.id, productTitle: "Synthetic inbound manifest", productUrl: "https://supplier.example.test/inbound", quantity: 2, sourceCountryCode: "CN" } });
  const dispatchOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, sourcingRequestId: dispatchRequest.id, status: "PURCHASED", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  const dispatchFixtures = [];
  for (let index = 0; index < 2; index++) {
    const reference = `PRIVATE-DISPATCH-${index}`;
    const record = await prisma.supplierOrderRecord.create({ data: { orderId: dispatchOrder.id, allocationKey: "SOURCING_REQUEST", supplierName: "PRIVATE-INBOUND-SUPPLIER", supplierOrderReference: reference, supplierReferenceKey: randomBytes(32).toString("hex"), variantDescription: "Synthetic single item", quantity: 1, originWarehouseId: station.id, originCountryCode: "CN", recordedById: admin.id, internalNote: "Synthetic dispatch evidence fixture", idempotencyKey: randomBytes(16).toString("hex"), requestFingerprint: randomBytes(32).toString("hex") } });
    dispatchFixtures.push({ recordId: record.id, reference, tracking: `DSP-${randomBytes(8).toString("hex").toUpperCase()}` });
  }
  const reviewer = await prisma.user.create({ data: { email: `browser-reviewer-${randomBytes(12).toString("hex")}@example.test`, fullName: "Independent correction reviewer", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
  const correctionOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "SOURCING", grandTotal: 100, originCountryCode: "CN", destinationCountryCode: "BD", shippingLaneId: lane.id } });
  const correctionRecord = await prisma.supplierOrderRecord.create({ data: { orderId: correctionOrder.id, allocationKey: "SOURCING_REQUEST", supplierName: "PRIVATE-CORRECTION-SUPPLIER", supplierOrderReference: "PRIVATE-CORRECTION-REF", supplierReferenceKey: randomBytes(32).toString("hex"), variantDescription: "Synthetic mistaken variant", quantity: 1, originWarehouseId: station.id, originCountryCode: "CN", recordedById: admin.id, internalNote: "Synthetic evidence for correction testing", idempotencyKey: randomBytes(16).toString("hex"), requestFingerprint: randomBytes(32).toString("hex") } });
  const screeningFixtures = [];
  for (const decision of ["APPROVED", "REJECTED"]) {
    const screening = await prisma.complianceScreeningAttempt.create({ data: { subject: "SOURCING_REQUEST", customerId: user.id, originCountryCode: "CN", destinationCountryCode: "BD", inputHash: randomBytes(32).toString("hex"), matchedRuleCodes: [`BROWSER_${decision}`], outcome: "REVIEW_REQUIRED" } });
    screeningFixtures.push({ id: screening.id, decision });
  }
  for (const portal of ["finance", "compliance"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: portal } });
    const employee = await prisma.user.create({ data: { email: `browser-${portal}-${randomBytes(12).toString("hex")}@example.test`, fullName: `Disposable ${portal} officer`, status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: role.id } } }, select: { id: true, email: true } });
    privileged.push({ ...employee, portal, password });
  }
  for (const [portal, code] of Object.entries(staffRoles)) {
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { code } });
    const employee = await prisma.user.create({ data: {
      email: `browser-${randomBytes(12).toString("hex")}@example.test`, fullName: "Isolated browser employee", status: "ACTIVE",
      passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: staffRole.id } },
    }, select: { id: true, email: true } });
    if (portal !== "support") await prisma.warehouseStaffAssignment.create({ data: { userId: employee.id, warehouseId: station.id } });
    staff.push({ ...employee, portal, password });
  }
  const sourcingAccounts = {};
  const sourcingRole = await prisma.role.findUniqueOrThrow({ where: { code: "sourcing_agent" } });
  for (const viewport of ["desktop", "mobile"]) {
    const employee = await prisma.user.create({ data: { email: `sourcing-browser-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic sourcing employee", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: sourcingRole.id } } }, select: { id: true, email: true } });
    sourcingAccounts[viewport] = employee;
  }
  process.env.E2E_SOURCING_ACCOUNTS = JSON.stringify(sourcingAccounts);
  const sourcingQuoteFixtures = {};
  for (const viewport of ["desktop", "mobile"]) {
    const employee = await prisma.user.create({ data: { email: `quote-browser-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic quote employee", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: sourcingRole.id } } }, select: { id: true, email: true } });
    const request = await prisma.sourcingRequest.create({ data: { reference: `BS-DRAFT-${randomBytes(8).toString("hex").toUpperCase()}`, customerId: user.id, productUrl: "https://supplier.example.test/draft", productTitle: `Synthetic draft ${viewport}`, quantity: 2, sourceCountryCode: "CN", status: "SUBMITTED" }, select: { id: true, reference: true } });
    sourcingQuoteFixtures[viewport] = { ...employee, requestId: request.id, reference: request.reference };
  }
  process.env.E2E_SOURCING_QUOTES = JSON.stringify(sourcingQuoteFixtures);
  const sourcingReviewFixtures = {};
  for (const viewport of ["desktop", "mobile"]) {
    sourcingReviewFixtures[viewport] = {};
    for (const action of ["APPROVE", "REJECT"]) {
      const request = await prisma.sourcingRequest.create({ data: { reference: `BS-REVIEW-${randomBytes(8).toString("hex").toUpperCase()}`, customerId: user.id, productUrl: "https://supplier.example.test/review", productTitle: `Synthetic review ${viewport} ${action}`, quantity: 2, sourceCountryCode: "CN", status: "UNDER_REVIEW" } });
      const quote = await prisma.sourcingQuote.create({ data: { sourcingRequestId: request.id, version: 1, productCostBdt: 1000, serviceFeeBdt: 100, estimatedShippingBdt: 200, totalBdt: 1300, expiresAt: new Date(Date.now() + 86_400_000), createdById: sourcingAccounts[viewport].id, status: "DRAFT" } });
      sourcingReviewFixtures[viewport][action] = { requestId: request.id, quoteId: quote.id, reference: request.reference };
    }
  }
  process.env.E2E_SOURCING_REVIEWS = JSON.stringify(sourcingReviewFixtures);
  const claimDetails = {};
  const qualityReviewAdmins = {};
  for (const viewport of ["desktop", "mobile"]) {
    const reviewer = await prisma.user.create({ data: { email: `quality-admin-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic quality administrator", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: adminRole.id } } }, select: { id: true, email: true } });
    const agentId = staff.find(employee => employee.portal === "support").id;
    // Resolved starting fixture only, not evidence of a real resolution/customer interaction.
    const ticket = await prisma.ticket.create({ data: { reference: `TKT-QA-${randomBytes(8).toString("hex").toUpperCase()}`, idempotencyKey: randomBytes(16).toString("hex"), customerId: user.id, assignedAgentId: agentId, category: "GENERAL", subject: `Synthetic quality review ${viewport}`, status: "RESOLVED", resolvedAt: new Date(), slaDueAt: new Date(Date.now() + 86_400_000), conversation: { create: { messages: { create: { idempotencyKey: randomBytes(16).toString("hex"), senderId: user.id, body: "Synthetic resolved conversation for quality review testing." } } } } } });
    qualityReviewAdmins[viewport] = { ...reviewer, ticketId: ticket.id, reference: ticket.reference, agentId };
  }
  process.env.E2E_QUALITY_REVIEW_ADMINS = JSON.stringify(qualityReviewAdmins);
  for (const viewport of ["desktop", "mobile"]) {
    const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "DELIVERED", grandTotal: 0 } });
    const pkg = await prisma.package.create({ data: { orderId: order.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, status: "SHIPPED" } });
    const deadline = new Date(Date.now() + 86_400_000);
    const shipment = await prisma.shipment.create({ data: { trackingNumber: `CLAIM-${randomBytes(8).toString("hex").toUpperCase()}`, originWarehouseId: station.id, destinationWarehouseId: destinationStation.id, status: "DELIVERED", claimDeadline: deadline, packages: { create: { packageId: pkg.id } } } });
    const rma = await prisma.rma.create({ data: { reference: `RMA-${randomBytes(10).toString("hex").toUpperCase()}`, idempotencyKey: randomBytes(16).toString("hex"), orderId: order.id, shipmentId: shipment.id, customerId: user.id, status: "RETURN_APPROVED", reason: "DAMAGED", description: "Synthetic approved return recovery fixture", evidenceRefs: [], claimDeadlineAtCreation: deadline, slaDueAt: deadline, returnRequired: true, returnInstructions: "Synthetic test warehouse only", items: { create: { packageId: pkg.id } } } });
    claimDetails[viewport] = rma.id;
  }
  process.env.E2E_CLAIM_DETAILS = JSON.stringify(claimDetails);
  const reviewProduct = await prisma.product.create({ data: { titleEn: "Synthetic account review item", variants: { create: { priceBdt: 10 } } }, include: { variants: true } });
  const reviewOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: user.id, status: "DRAFT", productTotal: 60, grandTotal: 60, items: { create: [1, 2, 3].map((quantity, index) => ({ productId: reviewProduct.id, productVariantId: reviewProduct.variants[0].id, productTitle: `Synthetic account review item ${index + 1}`, quantity, unitPrice: 10, total: quantity * 10 })) } } });
  const claimStates = [];
  for (const [status, deadline] of [["DELIVERED", "open"], ["DELIVERED", "expired"], ["DELIVERED", "missing"], ["IN_TRANSIT", "open"], ["DAMAGED", "open"], ["LOST", "expired"]]) {
    const pkg = await prisma.package.create({ data: { orderId: reviewOrder.id, warehouseId: station.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}` } });
    const shipment = await prisma.shipment.create({ data: { trackingNumber: `CLAIM-${randomBytes(8).toString("hex").toUpperCase()}`, originWarehouseId: station.id, destinationWarehouseId: destinationStation.id, status, claimDeadline: deadline === "missing" ? null : new Date(Date.now() + (deadline === "open" ? 86_400_000 : -86_400_000)), packages: { create: { packageId: pkg.id } } } });
    claimStates.push({ status, deadline, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, packageId: pkg.id });
  }
  process.env.E2E_CLAIM_REVIEW = JSON.stringify(claimStates);
  const foreignOwner = await prisma.user.create({ data: { email: `foreign-review-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic foreign owner", status: "ACTIVE", passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12) } });
  const foreignReviewOrder = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: foreignOwner.id, status: "DRAFT", grandTotal: 0 } });
  const emptyCustomer = await prisma.user.create({ data: { email: `empty-review-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic empty customer", phone: "+8801700000000", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: role.id } } } });
  // Synthetic identifiers/email only; password stays in the existing process-local credential.
  const profileCustomers = {};
  for (const [index, viewport] of ["desktop", "mobile"].entries()) {
    const customer = await prisma.user.create({ data: { email: `profile-review-${randomBytes(10).toString("hex")}@example.test`, fullName: "Synthetic profile customer", phone: `+880170000000${index + 1}`, status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: role.id } } } });
    profileCustomers[viewport] = { id: customer.id, email: customer.email };
  }
  process.env.E2E_PROFILE_CUSTOMERS = JSON.stringify(profileCustomers);
  process.env.E2E_ACCOUNT_REVIEW = JSON.stringify({ orderId: reviewOrder.id, orderNumber: reviewOrder.orderNumber, foreignOrderId: foreignReviewOrder.id, foreignOrderNumber: foreignReviewOrder.orderNumber, emptyEmail: emptyCustomer.email });
  // Credentials are process-local, never command arguments or report attachments.
  const testArguments = [...(shard ? [`--shard=${shard}`] : []), ...(updateSnapshots ? ["--update-snapshots=all"] : []), ...(process.env.E2E_GREP ? ["--grep", process.env.E2E_GREP] : [])];
  const result = spawnSync("npm", ["run", "test:e2e", ...(testArguments.length ? ["--", ...testArguments] : [])], {
    env: { ...process.env, E2E_BASE_URL: baseURL.origin, E2E_CUSTOMER_EMAIL: user.email, E2E_CUSTOMER_PASSWORD: password, E2E_STAFF_ACCOUNTS: JSON.stringify(staff.map(({ portal, email, password }) => ({ portal, email, password }))), E2E_WORKFLOW: JSON.stringify({ supplierInbound: { orderNumber: dispatchOrder.orderNumber, orderId: dispatchOrder.id, parcels: dispatchFixtures }, orderId: workflowOrder.id, orderNumber: workflowOrder.orderNumber, locationId: location.id, warehouseId: station.id, raceOrderNumber: receiptRaceOrder.orderNumber, inboundOrderNumber: inboundOrder.orderNumber, inboundPackages: inboundPackages.map(pkg => ({ packageCode: pkg.packageCode, inboundTracking: pkg.inboundTracking })) }), E2E_DELIVERY: JSON.stringify({ orderId: deliveryOrder.id, shipmentId: deliveryShipment.id, trackingNumber: deliveryShipment.trackingNumber }), E2E_QUOTES: JSON.stringify(quoteFixtures), E2E_PAYMENTS: JSON.stringify(paymentOrders), E2E_SCREENINGS: JSON.stringify(screeningFixtures), E2E_ADMIN: JSON.stringify({ capacity: { orderId: cappedOrder.id, recordId: cappedRecord.id, holdHistoryId: cappedHold.id }, pagedOrderId: pagedOrder.id, email: admin.email, password, reviewer: { email: reviewer.email, password }, inbound: { orderId: dispatchOrder.id, orderNumber: dispatchOrder.orderNumber, warehouseId: station.id, parcels: dispatchFixtures }, correction: { orderId: correctionOrder.id, recordId: correctionRecord.id }, manualPurchase: { warehouseId: station.id, orderId: manualPurchaseOrder.id, orderNumber: manualPurchaseOrder.orderNumber }, issuance: { orderId: issuanceOrder.id, orderNumber: issuanceOrder.orderNumber, laneId: lane.id } }), E2E_PRIVILEGED: JSON.stringify(privileged.map(({ portal, email, password }) => ({ portal, email, password }))) },
    stdio: "inherit", timeout: 660_000,
  });
  if (result.error || result.status !== 0) throw new Error("Isolated browser verification failed; inspect its HTML/JUnit report.");
  const supportRecoveryTickets = await prisma.ticket.findMany({ where: { customerId: user.id, subject: { startsWith: "Synthetic support recovery " } }, include: { conversation: { include: { messages: true } }, events: true } });
  for (const ticket of supportRecoveryTickets) {
    if (ticket.conversation?.messages.length !== 1 || ticket.events.length !== 1 || await prisma.ticket.count({ where: { customerId: user.id, subject: ticket.subject } }) !== 1 || await prisma.auditLog.count({ where: { entityType: "Ticket", entityId: ticket.id, action: "ticket.customer_created" } }) !== 1) throw new Error("Support creation lost-response retry duplicated ticket/message/event/audit evidence.");
  }
  const supportReplyTickets = await prisma.ticket.findMany({ where: { customerId: user.id, subject: { startsWith: "Synthetic support reply " } }, include: { conversation: { include: { messages: true } }, events: true } });
  for (const ticket of supportReplyTickets) {
    if (ticket.conversation?.messages.length !== 3 || ticket.events.length !== 2 || ticket.conversation.messages.filter(message => message.internalNote).length !== 1 || await prisma.auditLog.count({ where: { entityId: ticket.id, action: "ticket.customer_replied" } }) !== 1 || await prisma.auditLog.count({ where: { entityId: ticket.id, action: "ticket.internal_note_added" } }) !== 1) throw new Error("Support reply lost-response retry duplicated messages/events/audits or lost internal-note evidence.");
  }
  const feedbackTickets = await prisma.ticket.findMany({ where: { customerId: user.id, subject: { startsWith: "Synthetic support feedback " } }, include: { satisfactionRating: true } });
  for (const ticket of feedbackTickets) {
    if (ticket.satisfactionRating?.score !== 2 || ticket.satisfactionRating.issueResolved || await prisma.auditLog.count({ where: { entityId: ticket.id, action: "support.satisfaction_submitted" } }) !== 1) throw new Error("Support feedback immutable rating/audit evidence failed.");
    const notifications = await prisma.notification.findMany({ where: { entityId: ticket.id, eventType: "SUPPORT_SATISFACTION_FOLLOW_UP" }, select: { userId: true } });
    const administrators = await prisma.user.count({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: "admin" } } } } });
    if (notifications.length !== administrators || new Set(notifications.map(row => row.userId)).size !== administrators) throw new Error("Low feedback follow-up duplicated or omitted an Admin notification.");
  }
  const actionTickets = await prisma.ticket.findMany({ where: { customerId: user.id, subject: { startsWith: "Synthetic support actions " } }, include: { events: true } });
  for (const ticket of actionTickets) {
    if (ticket.status !== "CLOSED" || ticket.priority !== "URGENT" || ticket.version !== 8 || ticket.events.length !== 8) throw new Error("Support lifecycle state/version/event cardinality failed.");
    for (const [action, count] of [["resolve", 2], ["reopen", 1], ["set_priority", 1], ["escalate", 1], ["waiting_for_customer", 1], ["close", 1]]) {
      if (await prisma.auditLog.count({ where: { entityId: ticket.id, action: `ticket.${action}` } }) !== count) throw new Error("Support lifecycle action audit cardinality failed.");
    }
  }
  if (await prisma.rma.count({ where: { orderId: reviewOrder.id } })) throw new Error("Rejected claim-review submissions must not create any RMA.");
  for (const { id } of Object.values(profileCustomers)) {
    const created = await prisma.auditLog.count({ where: { actorId: id, action: "address.created" } });
    if (!created) continue; // Filtered/sharded run did not exercise this customer.
    if (created !== 2 || await prisma.address.count({ where: { userId: id, deletedAt: null } }) !== 0 || await prisma.auditLog.count({ where: { actorId: id, action: "address.updated" } }) !== 2 || await prisma.auditLog.count({ where: { actorId: id, action: "address.deleted" } }) !== 2 || await prisma.auditLog.count({ where: { actorId: id, action: "user.profile_updated" } }) !== 1) throw new Error("Profile/address CRUD state or audit cardinality failed.");
  }
  for (const id of Object.values(claimDetails)) {
    const claim = await prisma.rma.findUniqueOrThrow({ where: { id }, include: { messages: true, events: true } });
    if (claim.status === "RETURN_APPROVED" && claim.messages.length === 0) continue; // Filtered/sharded run did not exercise this fixture.
    if (claim.status !== "RETURN_IN_TRANSIT" || claim.messages.length !== 1 || claim.events.filter(event => event.toStatus === "RETURN_IN_TRANSIT").length !== 1 || await prisma.auditLog.count({ where: { entityType: "Rma", entityId: id, action: "rma.customer_message_added" } }) !== 1 || await prisma.auditLog.count({ where: { entityType: "Rma", entityId: id, action: "rma.return_tracking_submitted" } }) !== 1) throw new Error("Claim update state, message/event or audit cardinality failed.");
  }
  const purchaseResult = await prisma.order.findUniqueOrThrow({ where: { id: manualPurchaseOrder.id } });
  const dispatchResult = await prisma.order.findUniqueOrThrow({ where: { id: dispatchOrder.id }, include: { packages: true, statusHistory: true } });
  const dispatches = await prisma.supplierInboundDispatch.findMany({ where: { supplierRecord: { orderId: dispatchOrder.id } } });
  if (dispatches.length) {
    if (dispatches.length !== 2 || dispatchResult.status !== "WAREHOUSE_RECEIVED" || dispatchResult.packages.length !== 2 || dispatchResult.packages.some(pkg => pkg.status !== "RECEIVED") || !dispatchResult.grandTotal.equals(100) || dispatchResult.statusHistory.filter(event => event.toStatus === "SUPPLIER_SHIPPED").length !== 1 || dispatchResult.statusHistory.filter(event => event.toStatus === "WAREHOUSE_RECEIVED").length !== 1 || JSON.stringify(dispatchResult.statusHistory).includes("PRIVATE")) throw new Error("Supplier dispatch manifest, physical receipt, privacy or financial guard failed.");
    for (const mutation of [() => prisma.supplierInboundDispatch.update({ where: { id: dispatches[0].id }, data: { carrierName: "must not change" } }), () => prisma.supplierInboundDispatch.delete({ where: { id: dispatches[0].id } })]) {
      let blocked = false; try { await mutation(); } catch { blocked = true; }
      if (!blocked) throw new Error("Immutable supplier dispatch accepted a mutation.");
    }
    console.log("Supplier inbound: two linked parcels, immutable dispatches, one shipped/received history each, private supplier evidence and unchanged total verified.");
  }
  const inboundResult = await prisma.order.findUniqueOrThrow({ where: { id: inboundOrder.id }, include: { shipForMeRequest: true, packages: true } });
  if (inboundResult.status !== "DRAFT" && (inboundResult.status !== "WAREHOUSE_RECEIVED" || inboundResult.shipForMeRequest.status !== "WAREHOUSE_RECEIVED" || inboundResult.packages.length !== 2 || inboundResult.packages.some(pkg => pkg.status !== "RECEIVED") || await prisma.orderStatusHistory.count({ where: { orderId: inboundOrder.id, toStatus: "WAREHOUSE_RECEIVED" } }) !== 1)) throw new Error("Ship for Me parcel matching or final receipt completion was incorrect.");
  const raceReceipts = await prisma.package.findMany({ where: { orderId: receiptRaceOrder.id } });
  const workflowPackages = await prisma.package.findMany({ where: { orderId: workflowOrder.id }, select: { id: true } });
  if (workflowPackages.length) {
    const inspections = await prisma.inspection.findMany({ where: { packageId: { in: workflowPackages.map(pkg => pkg.id) } } });
    if (inspections.length) {
      if (inspections.length !== 1 || !inspections[0].idempotencyKey || !inspections[0].requestFingerprint || await prisma.packageEvent.count({ where: { packageId: inspections[0].packageId, eventType: "INSPECTED" } }) !== 1 || await prisma.auditLog.count({ where: { entityId: inspections[0].packageId, action: "inspection.package_completed" } }) !== 1) throw new Error("Lost-response inspection retry duplicated its decision/event/audit or lost request identity.");
      console.log("Inspection lost-response retry: one decision, event and audit with actor/package/payload request identity verified.");
    }
  }
  if (raceReceipts.length) {
    const events = await prisma.packageEvent.count({ where: { packageId: { in: raceReceipts.map(pkg => pkg.id) }, eventType: "RECEIVED" } });
    const historyCount = await prisma.orderStatusHistory.count({ where: { orderId: receiptRaceOrder.id, toStatus: "WAREHOUSE_RECEIVED" } });
    if (raceReceipts.length !== 1 || events !== 1 || historyCount !== 1) throw new Error("Concurrent receipt created duplicate packages/events/history.");
    console.log("Concurrent warehouse receipt: exactly one package, receipt event and order history verified.");
  }
  const correctionResult = await prisma.order.findUniqueOrThrow({ where: { id: correctionOrder.id } });
  const cappedResult = await prisma.order.findUniqueOrThrow({ where: { id: cappedOrder.id } });
  if (cappedResult.status !== "ON_HOLD" || await prisma.supplierOrderRecord.count({ where: { orderId: cappedOrder.id } }) !== 100 || await prisma.supplierRecordCorrection.count({ where: { originalRecordId: cappedRecord.id } }) !== 0 || await prisma.orderStatusHistory.count({ where: { orderId: cappedOrder.id } }) !== 1 || await prisma.auditLog.count({ where: { entityId: cappedOrder.id, action: "supplier_order_record.replaced" } }) !== 0) throw new Error("Capacity rejection changed retained evidence or released the order hold.");
  console.log("Supplier capacity boundary: 100 records retained, one hold, no replacement or release verified.");
  if (await prisma.orderStatusHistory.count({ where: { orderId: correctionOrder.id } })) {
    const correctionHistory = await prisma.orderStatusHistory.findMany({ where: { orderId: correctionOrder.id } });
    const correctionAudits = await prisma.auditLog.findMany({ where: { entityId: correctionOrder.id, action: "order.purchase_review.place_on_hold" } });
    const originalRecord = await prisma.supplierOrderRecord.findUniqueOrThrow({ where: { id: correctionRecord.id } });
    const correction = await prisma.supplierRecordCorrection.findUniqueOrThrow({ where: { originalRecordId: correctionRecord.id } });
    const replacement = await prisma.supplierOrderRecord.findUniqueOrThrow({ where: { id: correction.replacementRecordId } });
    if (correctionResult.status !== "SOURCING" || correctionHistory.length !== 2 || correctionAudits.length !== 1 || correctionAudits[0].metadata.supplierRecordId !== correctionRecord.id || correction.approvedById !== reviewer.id || replacement.quantity !== originalRecord.quantity || replacement.originWarehouseId !== originalRecord.originWarehouseId || replacement.variantDescription !== "PRIVATE corrected variant" || originalRecord.variantDescription !== "Synthetic mistaken variant" || !correctionResult.grandTotal.equals(100) || JSON.stringify(correctionHistory).includes("PRIVATE")) throw new Error("Supplier correction replacement lost independent approval, privacy, immutability or allocation/financial guards.");
    for (const mutation of [() => prisma.supplierRecordCorrection.update({ where: { originalRecordId: correctionRecord.id }, data: { reason: "must not change" } }), () => prisma.supplierRecordCorrection.delete({ where: { originalRecordId: correctionRecord.id } })]) {
      let blocked = false; try { await mutation(); } catch { blocked = true; }
      if (!blocked) throw new Error("Correction approval accepted a mutation.");
    }
    console.log("Supplier correction: independent replacement, immutable approval/original, safe hold/release history and unchanged quantity/warehouse/total verified.");
  }
  if (purchaseResult.status !== "PENDING_PURCHASE_REVIEW") {
    const records = await prisma.supplierOrderRecord.findMany({ where: { orderId: manualPurchaseOrder.id } });
    const recordAudits = await prisma.auditLog.count({ where: { action: "supplier_order_record.created", entityId: { in: records.map(record => record.id) } } });
    if (records.length !== 1 || records[0].quantity !== 2 || recordAudits !== 1 || !purchaseResult.grandTotal.equals(100)) throw new Error("Supplier record allocation, audit count or unchanged order total was incorrect.");
    for (const mutation of [() => prisma.supplierOrderRecord.update({ where: { id: records[0].id }, data: { internalNote: "must not change" } }), () => prisma.supplierOrderRecord.delete({ where: { id: records[0].id } })]) {
      let blocked = false;
      try { await mutation(); } catch { blocked = true; }
      if (!blocked) throw new Error("Immutable supplier record accepted a mutation.");
    }
    console.log("Synthetic supplier reference: one immutable record, one private audit, quantity allocation and unchanged financial total verified.");
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: manualPurchaseOrder.id }, orderBy: { createdAt: "asc" } });
    const auditCount = await prisma.auditLog.count({ where: { entityId: manualPurchaseOrder.id, action: { startsWith: "order.purchase_review." } } });
    if (purchaseResult.status !== "PURCHASED" || history.length !== 2 || auditCount !== 2 || JSON.stringify(history).includes("PRIVATE-SUPPLIER-FIXTURE")) throw new Error("Manual purchase history, privacy or audit count was incorrect.");
    console.log("Synthetic manual purchase: two status changes, two private audits and no supplier note in customer history verified.");
  }
  const payments = await prisma.shippingPayment.findMany({ where: { orderId: { in: paymentOrders } } });
  for (const fixture of screeningFixtures) {
    const screening = await prisma.complianceScreeningAttempt.findUniqueOrThrow({ where: { id: fixture.id } });
    if (screening.outcome !== "REVIEW_REQUIRED") {
      const audits = await prisma.auditLog.count({ where: { entityType: "ComplianceScreeningAttempt", entityId: fixture.id, action: `compliance.screening_${fixture.decision.toLowerCase()}` } });
      if (screening.outcome !== fixture.decision || screening.version !== 2 || !screening.reviewedAt || !screening.reviewedById || audits !== 1) throw new Error("Compliance decision or immutable audit count was incorrect.");
    }
  }
  // The payment scenario may be assigned to a different shard.
  if (payments.length) {
    if (payments.length !== 1 || payments[0].orderId !== paymentOrders[0] || !payments[0].amount.equals(1060)) throw new Error("Shipping payment was not settled exactly once.");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: paymentWallet.id } });
    const transactions = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, include: { journal: { include: { entries: true } } } });
    if (!wallet.availableBalance.equals(0) || transactions.length !== 1) throw new Error("Shipping wallet debit count or final balance was incorrect.");
    const entries = transactions[0].journal.entries;
    if (entries.length !== 2 || !entries.some(entry => entry.direction === "DEBIT" && entry.amount.equals(1060)) || !entries.some(entry => entry.direction === "CREDIT" && entry.amount.equals(1060))) throw new Error("Shipping settlement double-entry journal was not balanced.");
    console.log("Synthetic shipping settlement: one payment, one wallet debit, zero remaining balance and balanced journal verified.");
  }
  const userIds = [user.id, ...staff.map((employee) => employee.id)];
  for (const { agentId } of Object.values(supportReviewAdmins)) {
    const audits = await prisma.auditLog.count({ where: { entityId: agentId, action: "support.agent_profile_changed" } });
    if (!audits) continue; // Other filtered/sharded scenarios do not exercise this fixture.
    const saved = await prisma.supportAgentProfile.findUniqueOrThrow({ where: { userId: agentId } });
    if (audits !== 2 || saved.version !== 3 || saved.availability !== "OFFLINE" || saved.acceptingNewTickets || saved.maxActiveTickets !== 4 || saved.statusNote !== null) throw new Error("Workforce settings state/version/audit cardinality failed.");
  }
  for (const { ticketId, agentId } of Object.values(qualityReviewAdmins)) {
    const review = await prisma.supportQualityReview.findUnique({ where: { ticketId } });
    if (!review) continue;
    if (review.version !== 2 || review.score !== 4 || review.outcome !== "PASS" || review.coachingAction !== null || await prisma.auditLog.count({ where: { entityId: review.id, action: "support.quality_review_created" } }) !== 1 || await prisma.auditLog.count({ where: { entityId: review.id, action: "support.quality_review_updated" } }) !== 1 || await prisma.notification.count({ where: { entityId: review.id, userId: agentId, eventType: "SUPPORT_QUALITY_REVIEW" } }) !== 2) throw new Error("Quality review state/version/audit/notification cardinality failed.");
  }
  for (const { agentId } of Object.values(supportRoleAdmins)) {
    const grants = await prisma.auditLog.count({ where: { entityId: agentId, action: "support.agent_role_granted" } });
    if (!grants) continue;
    if (grants !== 1 || await prisma.auditLog.count({ where: { entityId: agentId, action: "support.agent_role_revoked" } }) !== 1 || await prisma.userRole.count({ where: { userId: agentId, roleId: supportRole.id } }) !== 0) throw new Error("Support access recovery did not grant/remove exactly once.");
    const sessions = await prisma.authSession.findMany({ where: { userId: agentId, portal: "support" }, select: { revokedAt: true } });
    if (!sessions.length || sessions.some(session => !session.revokedAt)) throw new Error("Removed support access retained a session.");
  }
  for (const [viewport, reviewer] of Object.entries(calendarAdmins)) {
    const audits = await prisma.auditLog.findMany({ where: { actorId: reviewer.id, action: { startsWith: "support." } } });
    if (!audits.length) continue; // This filtered/sharded run did not exercise calendar settings.
    for (const action of ["operating_policy_changed", "holiday_created", "holiday_removed", "shift_created", "shift_cancelled"]) {
      if (audits.filter(row => row.action === `support.${action}`).length !== 1) throw new Error("Calendar recovery duplicated or omitted mutation audit evidence.");
    }
    if (await prisma.supportHoliday.count({ where: { name: `Synthetic calendar ${viewport}` } })) throw new Error("Calendar removal left the closed date active.");
    const shiftId = audits.find(row => row.action === "support.shift_created").entityId;
    const shift = await prisma.supportShift.findUniqueOrThrow({ where: { id: shiftId } });
    if (shift.status !== "CANCELLED" || shift.agentId !== reviewer.agentId || shift.startsAt.toISOString() !== "2060-05-31T23:00:00.000Z" || shift.endsAt.toISOString() !== "2060-06-01T07:00:00.000Z") throw new Error("Calendar cancellation or device-timezone conversion failed.");
  }
  for (const employee of Object.values(sourcingAccounts)) {
    const sessions = await prisma.authSession.findMany({ where: { userId: employee.id, portal: "sourcing" }, select: { revokedAt: true } });
    if (sessions.length && (sessions.length !== 1 || sessions.some(session => !session.revokedAt))) throw new Error("Sourcing sign-in created duplicate or unrevoked sessions.");
  }
  for (const employee of Object.values(sourcingQuoteFixtures)) {
    const quotes = await prisma.sourcingQuote.findMany({ where: { sourcingRequestId: employee.requestId } });
    if (!quotes.length) continue; // Filtered/sharded run did not submit this fixture.
    const request = await prisma.sourcingRequest.findUniqueOrThrow({ where: { id: employee.requestId } });
    if (quotes.length !== 1 || quotes[0].status !== "DRAFT" || quotes[0].version !== 1 || quotes[0].createdById !== employee.id || !quotes[0].totalBdt.equals(1350) || request.status !== "UNDER_REVIEW" || await prisma.auditLog.count({ where: { entityId: quotes[0].id, action: "sourcing_quote.draft_submitted" } }) !== 1 || await prisma.notification.count({ where: { entityType: "SourcingQuote", entityId: quotes[0].id } })) throw new Error("Sourcing draft recovery duplicated evidence, changed totals or published an unreviewed quote.");
    const sessions = await prisma.authSession.findMany({ where: { userId: employee.id, portal: "sourcing" }, select: { revokedAt: true } });
    if (sessions.length !== 1 || sessions.some(session => !session.revokedAt)) throw new Error("Sourcing quote session was duplicated or not revoked.");
  }
  const adminSessions = await prisma.authSession.findMany({ where: { userId: { in: [admin.id, ...privileged.map(employee => employee.id), ...Object.values(supportReviewAdmins).map(reviewer => reviewer.id), ...Object.values(calendarAdmins).map(reviewer => reviewer.id), ...Object.values(sourcingStaffAdmins).map(reviewer => reviewer.id), ...Object.values(sourcingDecisionAdmins).map(reviewer => reviewer.id), ...Object.values(qualityReviewAdmins).map(reviewer => reviewer.id), ...Object.values(supportRoleAdmins).map(reviewer => reviewer.id)] } }, select: { revokedAt: true } });
  if (adminSessions.some(session => session.revokedAt === null)) throw new Error("Disposable admin session was not revoked.");
  const sessions = await prisma.authSession.findMany({ where: { userId: { in: userIds } }, select: { userId: true, revokedAt: true } });
  for (const reviewer of Object.values(liveSetupAdmins)) {
    const used = await prisma.authSession.findMany({ where: { userId: reviewer.id }, select: { revokedAt: true } });
    if (used.length && (used.length !== 1 || used.some(session => !session.revokedAt))) throw new Error("Live setup review left duplicate or unrevoked Admin sessions.");
  }
  for (const [viewport, fixtures] of Object.entries(sourcingReviewFixtures)) {
    for (const [action, fixture] of Object.entries(fixtures)) {
      const quote = await prisma.sourcingQuote.findUniqueOrThrow({ where: { id: fixture.quoteId } });
      if (quote.status === "DRAFT") continue; // Filtered/sharded run did not exercise this review.
      const request = await prisma.sourcingRequest.findUniqueOrThrow({ where: { id: fixture.requestId } });
      if (quote.status !== (action === "APPROVE" ? "SENT" : "REJECTED") || request.status !== (action === "APPROVE" ? "QUOTED" : "SUBMITTED") || quote.reviewedById !== sourcingDecisionAdmins[viewport].id || !quote.reviewedAt || !quote.totalBdt.equals(1300)) throw new Error("Sourcing review changed the wrong state, reviewer or total.");
      if (await prisma.auditLog.count({ where: { entityId: quote.id, action: `sourcing_quote.${action.toLowerCase()}` } }) !== 1 || await prisma.notification.count({ where: { entityId: quote.id, entityType: "SourcingQuote" } }) !== 1) throw new Error("Sourcing review duplicated its audit or customer notification.");
    }
  }
  if (userIds.some((id) => !sessions.some((session) => session.userId === id)) || sessions.some((session) => session.revokedAt === null)) throw new Error("Browser authentication teardown did not revoke every fixture session.");
  for (const stateFile of stateFiles) {
  let stateRemains = false;
  try { await access(stateFile); stateRemains = true; } catch { /* Expected after teardown. */ }
  if (stateRemains) throw new Error("Browser authentication state was not removed.");
  }
  console.log("Isolated customer/employee login, persisted browser states, session revocation and state-file cleanup passed.");
} finally {
  for (const file of stateFiles) await rm(file, { force: true });
  await prisma.$disconnect();
  // The parent isolated runner owns and drops the entire disposable schema.
}
