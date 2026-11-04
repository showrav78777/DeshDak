import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for warehouse portal verification.");

const marker = randomBytes(8).toString("hex").toUpperCase();
const emailMarker = marker.toLowerCase();
const countryA = `W${marker.slice(0, 5)}`;
const countryB = `V${marker.slice(5, 10)}`;
const ids = { users: [], sessions: [], assignments: [], warehouses: [], locations: [], countries: [], lane: undefined, orders: [], packages: [] };
function assert(condition, message) { if (!condition) throw new Error(message); }

async function sessionFor(user, portal, mfaVerified = false) {
  const created = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Warehouse workflow verification", clientType: "WEB", expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(created.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(created.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, options = {}) {
  return fetch(`${origin}${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json", Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(options.headers ?? {}) }, redirect: options.redirect ?? "follow" });
}
async function post(path, cookie, body) { return request(path, cookie, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": `warehouse-test:${crypto.randomUUID()}` } }); }

try {
  const [customerRole, workerRole, inspectorRole, adminRole] = await Promise.all([
    prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } }),
    prisma.role.upsert({ where: { code: "warehouse_worker" }, update: {}, create: { code: "warehouse_worker", description: "Warehouse Worker" } }),
    prisma.role.upsert({ where: { code: "inspector" }, update: {}, create: { code: "inspector", description: "Inspector" } }),
    prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Administrator" } }),
  ]);
  const customer = await prisma.user.create({ data: { email: `warehouse-customer-${emailMarker}@example.test`, fullName: "Private Warehouse Customer", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } }); ids.users.push(customer.id);
  const workerA = await prisma.user.create({ data: { email: `warehouse-a-${emailMarker}@example.test`, fullName: "Warehouse Worker A", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: workerRole.id } } } }); ids.users.push(workerA.id);
  const workerB = await prisma.user.create({ data: { email: `warehouse-b-${emailMarker}@example.test`, fullName: "Warehouse Worker B", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: workerRole.id } } } }); ids.users.push(workerB.id);
  const inspector = await prisma.user.create({ data: { email: `warehouse-inspector-${emailMarker}@example.test`, fullName: "Warehouse Inspector", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: inspectorRole.id } } } }); ids.users.push(inspector.id);
  const admin = await prisma.user.create({ data: { email: `warehouse-admin-${emailMarker}@example.test`, fullName: "Warehouse Test Admin", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } }); ids.users.push(admin.id);
  const workerACookie = await sessionFor(workerA, "warehouse");
  const workerBCookie = await sessionFor(workerB, "warehouse");
  const customerCookie = await sessionFor(customer, "customer");
  const inspectorCookie = await sessionFor(inspector, "inspector");
  const adminCookie = await sessionFor(admin, "admin", true);

  const source = await prisma.country.create({ data: { isoCode: countryA, name: `Warehouse Test Source ${marker}`, defaultCurrency: "CNY", isActive: true } }); ids.countries.push(source.id);
  const destination = await prisma.country.create({ data: { isoCode: countryB, name: `Warehouse Test Destination ${marker}`, defaultCurrency: "BDT", isActive: true } }); ids.countries.push(destination.id);
  const lane = await prisma.shippingLane.create({ data: { originCountryId: source.id, destinationCountryId: destination.id, name: `Warehouse verification ${marker}`, dimensionalWeightDivisor: 5000, isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true } }); ids.lane = lane.id;
  const warehouseA = await prisma.warehouse.create({ data: { name: `Assigned Warehouse A ${marker}`, country: countryA, type: "ORIGIN" } }); ids.warehouses.push(warehouseA.id);
  const warehouseB = await prisma.warehouse.create({ data: { name: `Assigned Warehouse B ${marker}`, country: countryA, type: "ORIGIN" } }); ids.warehouses.push(warehouseB.id);
  const locationA = await prisma.warehouseLocation.create({ data: { warehouseId: warehouseA.id, code: `BIN-${marker.slice(0, 6)}`, type: "BIN" } }); ids.locations.push(locationA.id);
  const assignmentB = await prisma.warehouseStaffAssignment.create({ data: { userId: workerB.id, warehouseId: warehouseB.id } }); ids.assignments.push(assignmentB.id);
  const forbiddenAssignment = await post("/api/v1/admin/warehouse-staff", customerCookie, { email: workerA.email, warehouseId: warehouseA.id });
  assert(forbiddenAssignment.status === 403, "Customer assigned Warehouse Worker access.");
  const assignedByAdmin = await post("/api/v1/admin/warehouse-staff", adminCookie, { email: workerA.email, warehouseId: warehouseA.id });
  const assignedByAdminBody = await assignedByAdmin.json();
  assert(assignedByAdmin.status === 201 && assignedByAdminBody.data.assignment.isActive, "Admin could not assign the Warehouse Worker through the web API.");
  ids.assignments.push(assignedByAdminBody.data.assignment.id);
  const inspectorAssignment = await post("/api/v1/admin/warehouse-staff", adminCookie, { email: inspector.email, warehouseId: warehouseA.id, roleCode: "inspector" });
  const inspectorAssignmentBody = await inspectorAssignment.json();
  assert(inspectorAssignment.status === 201 && inspectorAssignmentBody.data.assignment.roleCode === "inspector", "Admin could not assign the Inspector through the web API.");
  ids.assignments.push(inspectorAssignmentBody.data.assignment.id);
  const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: customer.id, status: "SUPPLIER_SHIPPED", grandTotal: 100, originCountryCode: countryA, destinationCountryCode: countryB, shippingLaneId: lane.id } }); ids.orders.push(order.id);

  const warehouseHome = await request("/warehouse", workerACookie);
  const warehouseHtml = await warehouseHome.text();
  assert(warehouseHome.status === 200 && warehouseHtml.includes("Good work starts with a scan"), "Warehouse Worker dashboard did not load.");
  assert(!warehouseHtml.includes(customer.email), "Warehouse dashboard exposed customer email.");
  const customerPortalAttempt = await request("/warehouse", customerCookie, { redirect: "manual" });
  assert([307, 308].includes(customerPortalAttempt.status) && customerPortalAttempt.headers.get("location")?.endsWith("/warehouse/login"), "Customer session entered the Warehouse Worker portal.");

  const receive = await post("/api/v1/operations/packages/receive", workerACookie, { orderNumber: order.orderNumber, warehouseId: warehouseA.id, inboundTracking: `IN-${marker}` });
  const receiveBody = await receive.json();
  assert(receive.status === 201, `Assigned worker could not receive package: ${JSON.stringify(receiveBody)}`);
  const packageId = receiveBody.data.package.id; const packageCode = receiveBody.data.package.packageCode; ids.packages.push(packageId);

  const foreignLookup = await request(`/api/v1/operations/packages/lookup?code=${encodeURIComponent(packageCode)}`, workerBCookie);
  assert(foreignLookup.status === 404, "Worker from another warehouse resolved the package.");
  const assignedLookup = await post("/api/v1/operations/packages/lookup", workerACookie, { code: packageCode });
  const assignedLookupBody = await assignedLookup.json();
  assert(assignedLookup.status === 200 && assignedLookupBody.data.destination.endsWith(packageCode), "Assigned package scan did not resolve.");
  assert(!JSON.stringify(assignedLookupBody).includes(customer.email), "Scan lookup exposed customer PII.");

  const unauthorizedInspection = await post(`/api/v1/operations/packages/${packageId}/inspect`, workerACookie, { type: "BASIC", result: "PASSED", notes: "Worker must not inspect." });
  assert(unauthorizedInspection.status === 403, "Warehouse Worker performed the separate Inspector role.");
  const inspection = await post(`/api/v1/operations/packages/${packageId}/inspect`, inspectorCookie, { type: "BASIC", result: "PASSED", notes: "Package condition verified." });
  assert(inspection.status === 201, "Inspector could not complete inspection.");
  const measurement = await post(`/api/v1/operations/packages/${packageId}/measure`, workerACookie, { actualWeightGrams: 1200, lengthMm: 400, widthMm: 300, heightMm: 200 });
  assert(measurement.status === 200, `Assigned worker could not measure package: ${await measurement.text()}`);
  const putAway = await post(`/api/v1/operations/packages/${packageId}/put-away`, workerACookie, { warehouseLocationId: locationA.id });
  assert(putAway.status === 200, "Assigned worker could not put away measured package.");
  const note = await post(`/api/v1/operations/packages/${packageId}/note`, workerACookie, { note: "Stored upright after measurement." });
  assert(note.status === 201, "Assigned worker could not add an operational note.");
  const printLog = await post(`/api/v1/operations/packages/${packageId}/label/print-log`, workerACookie, {});
  assert(printLog.status === 200, "Assigned worker could not log the label print.");

  const detail = await request(`/warehouse/packages/${packageCode}`, workerACookie);
  const detailHtml = await detail.text();
  assert(detail.status === 200 && detailHtml.includes(packageCode) && detailHtml.includes("Stored upright after measurement"), "Warehouse package detail/activity failed.");
  assert(!detailHtml.includes(customer.email), "Warehouse package detail exposed customer email.");
  const foreignDetail = await request(`/warehouse/packages/${packageCode}`, workerBCookie);
  assert(foreignDetail.status === 404, "Worker from another warehouse opened package detail.");
  const label = await request(`/warehouse/packages/${packageCode}/label`, workerACookie);
  const labelHtml = await label.text();
  assert(label.status === 200 && labelHtml.includes(packageCode) && labelHtml.includes("80 mm"), "Warehouse 80 mm label did not render.");
  assert(!labelHtml.includes(customer.email), "Warehouse label exposed customer email.");

  const eventTypes = (await prisma.packageEvent.findMany({ where: { packageId }, select: { eventType: true }, orderBy: { occurredAt: "asc" } })).map(({ eventType }) => eventType);
  for (const required of ["RECEIVED", "SCANNED", "INSPECTED", "MEASURED", "PUT_AWAY", "NOTE_ADDED", "LABEL_PRINTED"]) assert(eventTypes.includes(required), `Missing immutable package event: ${required}`);
  console.log("Warehouse portal verification passed: assigned-only scan/receive/measure/put-away/note/label workflow, Inspector separation, immutable events, and PII minimization.");
} finally {
  if (ids.packages.length) { await prisma.packageEvent.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.inspection.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.package.deleteMany({ where: { id: { in: ids.packages } } }); }
  if (ids.orders.length) { await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.notification.deleteMany({ where: { entityType: "Order", entityId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.assignments.length) await prisma.warehouseStaffAssignment.deleteMany({ where: { id: { in: ids.assignments } } });
  if (ids.locations.length) await prisma.warehouseLocation.deleteMany({ where: { id: { in: ids.locations } } });
  if (ids.warehouses.length) await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } });
  if (ids.lane) await prisma.shippingLane.deleteMany({ where: { id: ids.lane } });
  if (ids.countries.length) await prisma.country.deleteMany({ where: { id: { in: ids.countries } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
