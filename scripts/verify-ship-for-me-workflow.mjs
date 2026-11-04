import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Ship for Me verification.");
const marker = randomBytes(8).toString("hex");
let sourceCode;
const ids = { users: [], sessions: [], countries: [], warehouses: [], assignments: [], lanes: [], requests: [], orders: [], packages: [], exceptions: [], packageServices: [] };
let destinationRestore = null;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal, mfaVerified = false) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Ship for Me verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function call(path, { cookie, method = "GET", body, key, trustedOrigin = true } = {}) {
  if (!key && method === "POST" && path.endsWith("/inspect")) key = `sfm-inspect:${crypto.randomUUID()}`;
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...(trustedOrigin && method !== "GET" ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const [customerRole, workerRole, inspectorRole, adminRole] = await Promise.all([
    prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } }),
    prisma.role.upsert({ where: { code: "warehouse_worker" }, update: {}, create: { code: "warehouse_worker", description: "Warehouse Worker" } }),
    prisma.role.upsert({ where: { code: "inspector" }, update: {}, create: { code: "inspector", description: "Inspector" } }),
    prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Administrator" } }),
  ]);
  for (let first = 0; first < 26 && !sourceCode; first += 1) for (let second = 0; second < 26 && !sourceCode; second += 1) {
    const candidate = String.fromCharCode(65 + first, 65 + second);
    if (candidate !== "BD" && !(await prisma.country.findUnique({ where: { isoCode: candidate }, select: { id: true } }))) sourceCode = candidate;
  }
  if (!sourceCode) throw new Error("No unused two-letter country code is available for isolated verification.");
  const customer = await prisma.user.create({ data: { email: `sfm-customer-${marker}@example.test`, fullName: "Ship For Me Customer", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } }); ids.users.push(customer.id);
  const other = await prisma.user.create({ data: { email: `sfm-other-${marker}@example.test`, fullName: "Other Customer", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } }); ids.users.push(other.id);
  const worker = await prisma.user.create({ data: { email: `sfm-worker-${marker}@example.test`, fullName: "Origin Warehouse Worker", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: workerRole.id } } } }); ids.users.push(worker.id);
  const inspector = await prisma.user.create({ data: { email: `sfm-inspector-${marker}@example.test`, fullName: "Origin Inspector", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: inspectorRole.id } } } }); ids.users.push(inspector.id);
  const admin = await prisma.user.create({ data: { email: `sfm-admin-${marker}@example.test`, fullName: "Shipping Quote Admin", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } }); ids.users.push(admin.id);
  const [customerCookie, otherCookie, workerCookie, inspectorCookie, adminCookie] = await Promise.all([sessionFor(customer, "customer"), sessionFor(other, "customer"), sessionFor(worker, "warehouse"), sessionFor(inspector, "inspector"), sessionFor(admin, "admin", true)]);
  const warehousePolicy = await prisma.warehouseExceptionPolicy.upsert({ where: { key: "GLOBAL" }, update: {}, create: { key: "GLOBAL" } });
  const policyUpdate = await call("/api/v1/admin/warehouse-exception-policy", { cookie: adminCookie, method: "PATCH", body: { expectedParcelAlertHours: warehousePolicy.expectedParcelAlertHours, exceptionResolutionHours: warehousePolicy.exceptionResolutionHours, storageWarningDays: warehousePolicy.storageWarningDays } });
  assert(policyUpdate.response.status === 200, `Admin warehouse warning policy failed: ${JSON.stringify(policyUpdate.body)}`);

  const source = await prisma.country.create({ data: { isoCode: sourceCode, name: `Test Source ${marker}`, defaultCurrency: "CNY", isActive: true } }); ids.countries.push(source.id);
  let destination = await prisma.country.findUnique({ where: { isoCode: "BD" } });
  if (!destination) { destination = await prisma.country.create({ data: { isoCode: "BD", name: "Bangladesh", defaultCurrency: "BDT", isActive: true } }); ids.countries.push(destination.id); }
  else if (!destination.isActive) { destinationRestore = { id: destination.id, isActive: false }; destination = await prisma.country.update({ where: { id: destination.id }, data: { isActive: true } }); }
  const lane = await prisma.shippingLane.create({ data: { originCountryId: source.id, destinationCountryId: destination.id, name: `Ship for Me verification ${marker}`, dimensionalWeightDivisor: 5000, isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true } }); ids.lanes.push(lane.id);
  const warehouse = await prisma.warehouse.create({ data: { name: `Origin Hub ${marker}`, country: sourceCode, type: "ORIGIN", address: `Unit 18, Verification Road, ${sourceCode}` } }); ids.warehouses.push(warehouse.id);
  const assignment = await prisma.warehouseStaffAssignment.create({ data: { userId: worker.id, warehouseId: warehouse.id } }); ids.assignments.push(assignment.id);
  const inspectorAssignment = await prisma.warehouseStaffAssignment.create({ data: { userId: inspector.id, warehouseId: warehouse.id } }); ids.assignments.push(inspectorAssignment.id);

  const restrictedRule = await prisma.restrictedGoodsRule.create({ data: { ruleCode: `SFM-BLOCK-${marker.toUpperCase()}`, name: "Ship for Me verification block", customerMessage: "This item cannot be shipped under the current rules.", action: "BLOCK", status: "ACTIVE", keywords: [`blocked ${marker}`], originCountryCode: sourceCode, destinationCountryCode: "BD", createdById: admin.id, updatedById: admin.id } });
  const restrictedAttempt = await call("/api/v1/ship-for-me/requests", { cookie: customerCookie, method: "POST", key: `sfm-restricted-${marker}`, body: { sourceCountryCode: sourceCode, itemDescription: `Blocked ${marker}`, expectedPackageCount: 1 } });
  assert(restrictedAttempt.response.status === 422 && restrictedAttempt.body.error.code === "RESTRICTED_GOODS_BLOCKED", "Ship for Me issued an address for a known restricted item.");
  assert(!(await prisma.shipForMeRequest.findFirst({ where: { customerId: customer.id, itemDescription: `Blocked ${marker}` } })), "Restricted Ship for Me request persisted operational records.");
  await prisma.restrictedGoodsRule.delete({ where: { id: restrictedRule.id } });

  assert((await call("/api/v1/ship-for-me/requests")).response.status === 401, "Anonymous visitor viewed private Ship for Me requests.");
  const requestKey = `sfm-address-${marker}`;
  const missingOrigin = await call("/api/v1/ship-for-me/requests", { cookie: customerCookie, method: "POST", trustedOrigin: false, key: requestKey, body: { sourceCountryCode: sourceCode, itemDescription: "Verification cotton shirts", expectedPackageCount: 1 } });
  assert(missingOrigin.response.status === 403, "Address issuance accepted an untrusted mutation origin.");
  const created = await call("/api/v1/ship-for-me/requests", { cookie: customerCookie, method: "POST", key: requestKey, body: { sourceCountryCode: sourceCode, itemDescription: "Verification cotton shirts", expectedPackageCount: 2, declaredValue: 125, declaredCurrency: "CNY" } });
  assert(created.response.status === 201 && created.body.data.request.reference.startsWith("SFM-"), `Address issuance failed: ${JSON.stringify(created.body)}`);
  const requestId = created.body.data.request.id; const orderId = created.body.data.request.order.id; ids.requests.push(requestId); ids.orders.push(orderId);
  const addressJson = JSON.stringify(created.body.data.request.warehouseAddress);
  assert(addressJson.includes(created.body.data.request.reference) && addressJson.includes("Verification Road"), "The immutable warehouse address snapshot omitted its customer reference or address.");
  const replay = await call("/api/v1/ship-for-me/requests", { cookie: customerCookie, method: "POST", key: requestKey, body: { sourceCountryCode: sourceCode, itemDescription: "Verification cotton shirts", expectedPackageCount: 2, declaredValue: 125, declaredCurrency: "CNY" } });
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay && replay.body.data.request.id === requestId, "Address issuance was not idempotent.");
  assert((await call(`/api/v1/ship-for-me/requests/${requestId}`, { cookie: otherCookie })).response.status === 404, "Another customer accessed the private inbound request.");
  assert((await call(`/ship-for-me/${requestId}`, { cookie: otherCookie })).response.status === 404, "Another customer accessed the private inbound request page.");

  const trackingKey = `sfm-tracking-${marker}`; const inboundTracking = `IN-${marker.toUpperCase()}-1`; const secondInboundTracking = `IN-${marker.toUpperCase()}-2`; const parcels = [{ inboundCarrier: "Verification Local Courier", inboundTracking }, { inboundCarrier: "Second Verification Courier", inboundTracking: secondInboundTracking }];
  const tracking = await call("/api/v1/ship-for-me/tracking", { cookie: customerCookie, method: "POST", key: trackingKey, body: { requestId, parcels } });
  assert(tracking.response.status === 201 && tracking.body.data.request.status === "TRACKING_SUBMITTED", `Tracking submission failed: ${JSON.stringify(tracking.body)}`);
  const [firstPackage, secondPackage] = tracking.body.data.request.order.packages; const packageId = firstPackage.id; const packageCode = firstPackage.packageCode; ids.packages.push(firstPackage.id, secondPackage.id);
  assert(tracking.body.data.request.order.packages.length === 2, "Tracking submission did not create each expected parcel.");
  assert(tracking.body.data.request.order.packages[0].inboundCarrier === "Verification Local Courier" && tracking.body.data.request.order.packages[1].inboundCarrier === "Second Verification Courier", "Each parcel did not retain its own carrier.");
  const trackingReplay = await call("/api/v1/ship-for-me/tracking", { cookie: customerCookie, method: "POST", key: trackingKey, body: { requestId, parcels } });
  assert(trackingReplay.response.status === 200 && trackingReplay.body.data.idempotentReplay, "Tracking submission was not idempotent.");
  const lookup = await call("/api/v1/operations/packages/lookup", { cookie: workerCookie, method: "POST", body: { code: inboundTracking } });
  assert(lookup.response.status === 200 && lookup.body.data.destination.endsWith(packageCode), "Assigned warehouse could not resolve customer-supplied inbound tracking.");
  const warehouseTask = await call(`/warehouse/packages/${packageCode}`, { cookie: workerCookie });
  assert(warehouseTask.response.status === 200 && warehouseTask.body.includes("Confirm the package is in hand") && !warehouseTask.body.includes(customer.email), "Expected-package receipt screen failed or leaked customer PII.");
  const receiptKey = `sfm-receipt-${marker}`;
  const received = await call("/api/v1/operations/packages/receive", { cookie: workerCookie, method: "POST", key: receiptKey, body: { orderNumber: created.body.data.request.order.orderNumber, warehouseId: warehouse.id, inboundTracking } });
  assert(received.response.status === 201 && received.body.data.package.id === packageId, `Physical receipt did not update the expected package: ${JSON.stringify(received.body)}`);
  const partial = await prisma.shipForMeRequest.findUniqueOrThrow({ where: { id: requestId }, include: { order: true } });
  assert(partial.status === "PARTIALLY_RECEIVED" && partial.order.status === "DRAFT", "The first parcel falsely completed the entire inbound request.");
  const receiptReplay = await call("/api/v1/operations/packages/receive", { cookie: workerCookie, method: "POST", key: receiptKey, body: { orderNumber: created.body.data.request.order.orderNumber, warehouseId: warehouse.id, inboundTracking } });
  assert(receiptReplay.response.status === 200 && receiptReplay.body.data.idempotentReplay && receiptReplay.body.data.package.id === packageId, "A network retry did not return the original physical receipt.");
  const secondReceived = await call("/api/v1/operations/packages/receive", { cookie: workerCookie, method: "POST", key: `sfm-second-receipt-${marker}`, body: { orderNumber: created.body.data.request.order.orderNumber, warehouseId: warehouse.id, inboundTracking: secondInboundTracking } });
  assert(secondReceived.response.status === 201 && secondReceived.body.data.package.id === secondPackage.id, "The second expected parcel was not received independently.");

  const persisted = await prisma.shipForMeRequest.findUniqueOrThrow({ where: { id: requestId }, include: { order: { include: { statusHistory: true } }, customer: true } });
  assert(persisted.status === "WAREHOUSE_RECEIVED" && persisted.warehouseReceivedAt && persisted.order.status === "WAREHOUSE_RECEIVED", "Request and order did not transition atomically after warehouse receipt.");
  assert(persisted.order.statusHistory.some((event) => event.toStatus === "WAREHOUSE_RECEIVED"), "Warehouse receipt did not create immutable customer order history.");
  const [addressNotification, receivedNotification, audit] = await Promise.all([
    prisma.notification.findFirst({ where: { userId: customer.id, eventType: "SHIP_FOR_ME_ADDRESS_ISSUED", entityId: requestId } }),
    prisma.notification.findFirst({ where: { userId: customer.id, eventType: "ORDER_WAREHOUSE_RECEIVED", entityId: orderId } }),
    prisma.auditLog.findFirst({ where: { action: "warehouse.package_received", entityId: packageId } }),
  ]);
  assert(addressNotification && receivedNotification && audit, "The workflow is missing its transactional notification or audit evidence.");
  const inspected = await call(`/api/v1/operations/packages/${packageId}/inspect`, { cookie: inspectorCookie, method: "POST", body: { type: "BASIC", result: "PASSED", notes: "Ship for Me parcel identity and condition verified." } });
  assert(inspected.response.status === 201, `Ship for Me inspection failed: ${JSON.stringify(inspected.body)}`);
  const secondInspected = await call(`/api/v1/operations/packages/${secondPackage.id}/inspect`, { cookie: inspectorCookie, method: "POST", body: { type: "BASIC", result: "PASSED", notes: "Second Ship for Me parcel verified." } });
  assert(secondInspected.response.status === 201, `Second parcel inspection failed: ${JSON.stringify(secondInspected.body)}`);
  const measured = await call(`/api/v1/operations/packages/${packageId}/measure`, { cookie: workerCookie, method: "POST", body: { actualWeightGrams: 1200, lengthMm: 400, widthMm: 300, heightMm: 200 } });
  assert(measured.response.status === 200 && measured.body.data.package.chargeableWeightGrams > 0, `Ship for Me measurement failed: ${JSON.stringify(measured.body)}`);
  assert((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status === "INSPECTION", "One measured parcel falsely completed order measurement.");
  const secondMeasured = await call(`/api/v1/operations/packages/${secondPackage.id}/measure`, { cookie: workerCookie, method: "POST", body: { actualWeightGrams: 800, lengthMm: 300, widthMm: 200, heightMm: 150 } });
  assert(secondMeasured.response.status === 200, `Second parcel measurement failed: ${JSON.stringify(secondMeasured.body)}`);
  const serviceKey = `sfm-consolidate-${marker}`;
  const service = await call("/api/v1/package-services", { cookie: customerCookie, method: "POST", key: serviceKey, body: { orderId, type: "CONSOLIDATE", packageIds: [packageId, secondPackage.id], requestedOutputCount: 1, customerNote: "Combine both verified parcels into one outbound package." } });
  assert(service.response.status === 201 && service.body.data.request.status === "REQUESTED", `Package consolidation request failed: ${JSON.stringify(service.body)}`);
  const serviceId = service.body.data.request.id; ids.packageServices.push(serviceId);
  const serviceReplay = await call("/api/v1/package-services", { cookie: customerCookie, method: "POST", key: serviceKey, body: { orderId, type: "CONSOLIDATE", packageIds: [packageId, secondPackage.id], requestedOutputCount: 1, customerNote: "Combine both verified parcels into one outbound package." } });
  assert(serviceReplay.response.status === 200 && serviceReplay.body.data.idempotentReplay, "Package consolidation request was not idempotent.");
  assert((await call("/api/v1/package-services", { cookie: otherCookie })).body.data.requests.every((item) => item.id !== serviceId), "Another customer viewed the private package-service request.");
  const serviceBlockedQuote = await call(`/api/v1/admin/orders/${orderId}/shipping-quote`, { cookie: adminCookie, method: "POST", body: { shippingLaneId: lane.id, ratePerKgBdt: 1100, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
  assert(serviceBlockedQuote.response.status === 409 && serviceBlockedQuote.body.error.code === "OPEN_PACKAGE_SERVICE", "An open package service did not block the shipping quote.");
  const reviewedService = await call(`/api/v1/admin/package-services/${serviceId}/review`, { cookie: adminCookie, method: "POST", key: `sfm-service-review-${marker}`, body: { action: "APPROVED", adminNote: "Source packages are measured, co-located, and eligible for controlled consolidation.", customerNote: "Your consolidation request is approved and has been sent to the warehouse." } });
  assert(reviewedService.response.status === 200 && reviewedService.body.data.request.status === "APPROVED", `Package service approval failed: ${JSON.stringify(reviewedService.body)}`);
  const [adminServicePage, warehouseServicePage] = await Promise.all([call("/admin/package-services", { cookie: adminCookie }), call("/warehouse/package-services", { cookie: workerCookie })]);
  assert(adminServicePage.response.status === 200 && adminServicePage.body.includes(service.body.data.request.reference), "Admin package service register omitted the request.");
  assert(warehouseServicePage.response.status === 200 && warehouseServicePage.body.includes(service.body.data.request.reference), "Assigned Warehouse queue omitted the approved request.");
  const wrongSourceScan = await call(`/api/v1/operations/package-services/${serviceId}/complete`, { cookie: workerCookie, method: "POST", key: `sfm-service-wrong-scan-${marker}`, body: { scannedPackageCodes: [packageCode, packageCode], warehouseNote: "Duplicate scan must not complete this package handling task." } });
  assert(wrongSourceScan.response.status === 409 && wrongSourceScan.body.error.code === "SOURCE_SCAN_MISMATCH", "Missing or duplicate source scans did not block package-service completion.");
  const completedService = await call(`/api/v1/operations/package-services/${serviceId}/complete`, { cookie: workerCookie, method: "POST", key: `sfm-service-complete-${marker}`, body: { scannedPackageCodes: [packageCode.toLowerCase(), secondPackage.packageCode], warehouseNote: "Both source parcels were scanned, combined, sealed, and the replacement label was attached." } });
  assert(completedService.response.status === 201 && completedService.body.data.resultPackages.length === 1, `Package service completion failed: ${JSON.stringify(completedService.body)}`);
  const replacement = completedService.body.data.resultPackages[0]; ids.packages.push(replacement.id);
  const serviceState = await prisma.packageServiceRequest.findUniqueOrThrow({ where: { id: serviceId }, include: { packages: { include: { package: true } } } });
  assert(serviceState.status === "COMPLETED" && serviceState.packages.filter(({ role }) => role === "SOURCE").every(({ package: pkg }) => !pkg.isOutboundActive) && serviceState.packages.filter(({ role }) => role === "RESULT").every(({ package: pkg }) => pkg.isOutboundActive), "Package service did not preserve inactive sources and active replacement packages.");
  const [inactiveWarehouseLookup, inactiveInspectorLookup, inactiveWarehousePage] = await Promise.all([call("/api/v1/operations/packages/lookup", { cookie: workerCookie, method: "POST", body: { code: packageCode } }), call("/api/v1/operations/inspections/lookup", { cookie: inspectorCookie, method: "POST", body: { code: packageCode } }), call(`/warehouse/packages/${packageCode}`, { cookie: workerCookie })]);
  assert(inactiveWarehouseLookup.response.status === 404 && inactiveInspectorLookup.response.status === 404 && inactiveWarehousePage.response.status === 404, "A replaced source package remained available in an operational queue.");
  const replacementInspected = await call(`/api/v1/operations/packages/${replacement.id}/inspect`, { cookie: inspectorCookie, method: "POST", body: { type: "BASIC", result: "PASSED", notes: "Consolidated replacement package and label verified." } });
  assert(replacementInspected.response.status === 201, `Replacement inspection failed: ${JSON.stringify(replacementInspected.body)}`);
  const replacementMeasured = await call(`/api/v1/operations/packages/${replacement.id}/measure`, { cookie: workerCookie, method: "POST", body: { actualWeightGrams: 1900, lengthMm: 420, widthMm: 320, heightMm: 240 } });
  assert(replacementMeasured.response.status === 200 && (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status === "MEASURED", `Replacement measurement failed: ${JSON.stringify(replacementMeasured.body)}`);
  const activePackageId = replacement.id; const activePackageCode = replacement.packageCode;
  const exceptionKey = `sfm-package-exception-${marker}`;
  const exception = await call("/api/v1/operations/package-exceptions", { cookie: workerCookie, method: "POST", key: exceptionKey, body: { orderNumber: created.body.data.request.order.orderNumber, warehouseId: warehouse.id, packageCode: activePackageCode, type: "TRACKING_MISMATCH", description: "Physical carrier label was checked and required an administrator reconciliation test." } });
  assert(exception.response.status === 201 && exception.body.data.exception.status === "OPEN", `Parcel exception reporting failed: ${JSON.stringify(exception.body)}`); ids.exceptions.push(exception.body.data.exception.id);
  await prisma.packageException.update({ where: { id: exception.body.data.exception.id }, data: { createdAt: new Date(Date.now() - (warehousePolicy.exceptionResolutionHours + 1) * 3_600_000) } });
  const [warehouseExceptionPage, adminExceptionPage] = await Promise.all([call("/warehouse/exceptions", { cookie: workerCookie }), call("/admin/warehouse-exceptions", { cookie: adminCookie })]);
  assert(warehouseExceptionPage.response.status === 200 && warehouseExceptionPage.body.includes(exception.body.data.exception.reference), "Warehouse exception register did not show the reported parcel.");
  assert(adminExceptionPage.response.status === 200 && adminExceptionPage.body.includes(exception.body.data.exception.reference) && adminExceptionPage.body.includes("OVERDUE"), "Admin exception queue did not show the overdue parcel report.");
  const blockedQuote = await call(`/api/v1/admin/orders/${orderId}/shipping-quote`, { cookie: adminCookie, method: "POST", body: { shippingLaneId: lane.id, ratePerKgBdt: 1100, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
  assert(blockedQuote.response.status === 409 && blockedQuote.body.error.code === "OPEN_PACKAGE_EXCEPTION", "An unresolved parcel exception did not block the shipping quote.");
  const resolvedException = await call(`/api/v1/admin/package-exceptions/${exception.body.data.exception.id}/resolve`, { cookie: adminCookie, method: "POST", key: `sfm-package-exception-resolution-${marker}`, body: { action: "RESOLVED", resolutionNote: "Warehouse label evidence matched the corrected carrier manifest and package identity.", customerNote: "Your parcel review is complete and the package is cleared for shipping quotation." } });
  assert(resolvedException.response.status === 200 && resolvedException.body.data.exception.status === "RESOLVED", `Admin exception resolution failed: ${JSON.stringify(resolvedException.body)}`);
  const quote = await call(`/api/v1/admin/orders/${orderId}/shipping-quote`, { cookie: adminCookie, method: "POST", body: { shippingLaneId: lane.id, ratePerKgBdt: 1100, handlingFeeBdt: 100, insuranceFeeBdt: 25, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), note: "Measured Ship for Me international shipping." } });
  assert(quote.response.status === 201 && quote.body.data.approvalRequired && quote.body.data.quote.status === "SENT", `Measured shipping quote failed: ${JSON.stringify(quote.body)}`);
  const accepted = await call(`/api/v1/orders/${orderId}/shipping-quote/accept`, { cookie: customerCookie, method: "POST", key: `sfm-quote-accept-${marker}` });
  assert(accepted.response.status === 200 && accepted.body.data.quote.status === "ACCEPTED", `Customer shipping approval failed: ${JSON.stringify(accepted.body)}`);
  assert(!("createdById" in accepted.body.data.quote) && !("decisionIdempotencyKey" in accepted.body.data.quote), "Customer shipping quote response exposed staff identity or idempotency evidence.");
  await prisma.wallet.create({ data: { userId: customer.id, currency: "BDT", availableBalance: 10000 } });
  const paymentKey = `sfm-shipping-payment-${marker}`;
  const untrustedPayment = await call("/api/v1/payments/shipping/wallet", { cookie: customerCookie, method: "POST", trustedOrigin: false, key: paymentKey, body: { orderId } });
  assert(untrustedPayment.response.status === 403, "Shipping wallet payment accepted an untrusted origin.");
  const paid = await call("/api/v1/payments/shipping/wallet", { cookie: customerCookie, method: "POST", key: paymentKey, body: { orderId } });
  assert(paid.response.status === 201 && paid.body.data.shippingPayment.status === "SUCCEEDED", `Shipping wallet payment failed: ${JSON.stringify(paid.body)}`);
  const paidReplay = await call("/api/v1/payments/shipping/wallet", { cookie: customerCookie, method: "POST", key: paymentKey, body: { orderId } });
  assert(paidReplay.response.status === 200 && paidReplay.body.data.idempotentReplay, "Shipping wallet payment was not idempotent.");
  const mismatchedPaymentReplay = await call("/api/v1/payments/shipping/wallet", { cookie: customerCookie, method: "POST", key: paymentKey, body: { orderId: customer.id } });
  assert(mismatchedPaymentReplay.response.status === 409 && mismatchedPaymentReplay.body.error.code === "IDEMPOTENCY_KEY_REUSED", "A shipping payment key was replayed against a different order.");
  const sharedState = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { shippingPayment: true, shippingQuotes: true, packages: true, statusHistory: { select: { toStatus: true } } } });
  const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId: customer.id, currency: "BDT" } } });
  assert(sharedState.status === "READY_TO_SHIP" && sharedState.shippingApprovalStatus === "ACCEPTED" && sharedState.shippingPayment?.status === "SUCCEEDED" && sharedState.shippingQuotes[0].status === "PAID" && sharedState.packages.filter((item) => item.isOutboundActive).every((item) => item.id === activePackageId && item.status === "READY_TO_SHIP") && sharedState.packages.filter((item) => !item.isOutboundActive).every((item) => item.status !== "READY_TO_SHIP"), "Paid shipping did not unlock only the active outbound package.");
  assert(walletAfter.availableBalance.equals(new Prisma.Decimal(10000).minus(sharedState.shippingPayment.amount)), "Shipping wallet was not debited exactly once.");
  const customerPage = await call("/ship-for-me", { cookie: customerCookie });
  assert(customerPage.response.status === 200 && customerPage.body.includes("Verification cotton shirts") && customerPage.body.includes("All parcels received"), "Customer Ship for Me page did not render verified state.");
  assert(!/Pinduoduo|1688|Alibaba/i.test(customerPage.body), "A private upstream supplier name leaked into the customer workflow.");
  const orderPage = await call(`/orders/${orderId}`, { cookie: customerCookie });
  assert(orderPage.response.status === 200 && orderPage.body.includes("Verification cotton shirts") && orderPage.body.includes("Received at origin hub"), "Ship for Me did not join the normal customer order timeline.");
  const requestDetailsPage = await call(`/ship-for-me/${requestId}`, { cookie: customerCookie });
  assert(requestDetailsPage.response.status === 200 && requestDetailsPage.body.includes(inboundTracking) && requestDetailsPage.body.includes(secondInboundTracking) && requestDetailsPage.body.includes("Second Verification Courier") && requestDetailsPage.body.includes(activePackageCode) && requestDetailsPage.body.includes("REPLACED / INACTIVE"), "Customer request details did not show source and replacement package traceability.");
  assert(requestDetailsPage.body.includes("Your parcel review is complete") && !requestDetailsPage.body.includes("Warehouse label evidence matched"), "Customer request details leaked internal exception evidence or omitted the safe resolution.");
  console.log("Ship for Me verification passed: restricted-goods address gate, multi-parcel receipt, inspection, controlled consolidation with immutable sources and replacement codes, aggregate measurement, parcel exceptions, quote blocking/resolution, separate shipping payment, dispatch readiness, RBAC, notifications, audit, and provider secrecy.");
} finally {
  if (ids.users.length) await prisma.complianceScreeningAttempt.deleteMany({ where: { customerId: { in: ids.users } } });
  if (ids.exceptions.length) await prisma.packageException.deleteMany({ where: { id: { in: ids.exceptions } } });
  if (ids.packageServices.length) { await prisma.packageServicePackage.deleteMany({ where: { requestId: { in: ids.packageServices } } }); await prisma.packageServiceRequest.deleteMany({ where: { id: { in: ids.packageServices } } }); }
  if (ids.packages.length) { await prisma.packageEvent.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.inspection.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.package.deleteMany({ where: { id: { in: ids.packages } } }); }
  if (ids.requests.length) await prisma.shipForMeRequest.deleteMany({ where: { id: { in: ids.requests } } });
  if (ids.orders.length) { const payments = await prisma.shippingPayment.findMany({ where: { orderId: { in: ids.orders } }, select: { id: true, fxSnapshotId: true } }); const transactions = await prisma.walletTransaction.findMany({ where: { sourceType: "SHIPPING_PAYMENT", sourceId: { in: payments.map(({ id }) => id) } }, select: { id: true, journalId: true } }); await prisma.walletTransaction.deleteMany({ where: { id: { in: transactions.map(({ id }) => id) } } }); await prisma.shippingPayment.deleteMany({ where: { id: { in: payments.map(({ id }) => id) } } }); await prisma.financialJournalEntry.deleteMany({ where: { journalId: { in: transactions.map(({ journalId }) => journalId) } } }); await prisma.financialJournal.deleteMany({ where: { id: { in: transactions.map(({ journalId }) => journalId) } } }); await prisma.fxSnapshot.deleteMany({ where: { id: { in: payments.map(({ fxSnapshotId }) => fxSnapshotId) } } }); await prisma.shippingQuote.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.notification.deleteMany({ where: { entityType: "Order", entityId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.users.length) { await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); }
  if (ids.assignments.length) await prisma.warehouseStaffAssignment.deleteMany({ where: { id: { in: ids.assignments } } });
  if (ids.warehouses.length) await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } });
  if (ids.lanes.length) await prisma.shippingLane.deleteMany({ where: { id: { in: ids.lanes } } });
  if (ids.countries.length) await prisma.country.deleteMany({ where: { id: { in: ids.countries } } });
  if (destinationRestore) await prisma.country.update({ where: { id: destinationRestore.id }, data: { isActive: destinationRestore.isActive } });
  if (ids.users.length) { await prisma.userEvent.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.wallet.deleteMany({ where: { userId: { in: ids.users } } }); }
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
