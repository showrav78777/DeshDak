import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { verifyInspectionCapture } from "./lib/inspection-capture-acceptance.mjs";
const capabilitySource = await readFile(new URL("../src/modules/operations/inspection-upload-capabilities.ts", import.meta.url), "utf8");
const { inspectionUploadCapabilities } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(capabilitySource)).toString("base64")}`);
for (const [env, configured, photos, videos, mode] of [
  [{ NODE_ENV: "production" }, false, false, false, "UNAVAILABLE"],
  [{ NODE_ENV: "production", ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS: "true" }, false, false, false, "UNAVAILABLE"],
  [{ NODE_ENV: "production", PRIVATE_PHOTO_STORAGE_ENABLED: "true" }, true, true, false, "PRIVATE_PHOTOS"],
  [{ NODE_ENV: "development", ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS: "true" }, false, true, true, "DEVELOPMENT"],
  [{ NODE_ENV: "development", ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS: "true", PRIVATE_PHOTO_STORAGE_ENABLED: "true" }, false, false, false, "UNAVAILABLE"],
  [{ NODE_ENV: "development", ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS: "true", PRIVATE_PHOTO_STORAGE_ENABLED: "true" }, true, true, false, "PRIVATE_PHOTOS"],
]) {
  const value = inspectionUploadCapabilities(env, configured);
  if (value.photos !== photos || value.videos !== videos || value.mode !== mode) throw new Error("Inspection upload capability policy failed");
}

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Inspector portal verification.");
const marker = randomBytes(8).toString("hex").toUpperCase();
const ids = { users: [], sessions: [], assignments: [], warehouses: [], orders: [], packages: [], shipments: [] };
function assert(condition, message) { if (!condition) throw new Error(message); }

async function sessionFor(user, portal, mfaVerified = false) {
  const created = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Inspector verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(created.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(created.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}
async function request(path, cookie, options = {}) { return fetch(`${origin}${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json", Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(options.headers ?? {}) }, redirect: options.redirect ?? "follow" }); }
async function post(path, cookie, body, headers = {}) { return request(path, cookie, { method: "POST", body: JSON.stringify(body), headers: { ...(path.endsWith("/inspect") ? { "Idempotency-Key": `inspector-test:${crypto.randomUUID()}` } : {}), ...headers } }); }

try {
  const roles = {};
  for (const code of ["customer_personal", "warehouse_worker", "inspector", "logistics_worker", "admin"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, role) { const created = await prisma.user.create({ data: { email: `${label}-${marker.toLowerCase()}@example.test`, fullName: label, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: roles[role].id } } } }); ids.users.push(created.id); return created; }
  const customer = await user("inspector-customer", "customer_personal"); const worker = await user("inspector-worker", "warehouse_worker"); const inspectorA = await user("inspector-a", "inspector"); const inspectorB = await user("inspector-b", "inspector"); const logistics = await user("inspector-logistics", "logistics_worker"); const admin = await user("inspector-admin", "admin");
  const [workerCookie, inspectorACookie, inspectorBCookie, logisticsCookie, customerCookie, adminCookie] = await Promise.all([sessionFor(worker, "warehouse"), sessionFor(inspectorA, "inspector"), sessionFor(inspectorB, "inspector"), sessionFor(logistics, "logistics"), sessionFor(customer, "customer"), sessionFor(admin, "admin", true)]);
  const warehouseA = await prisma.warehouse.create({ data: { name: `Inspector A ${marker}`, country: "CN", type: "ORIGIN" } }); const warehouseB = await prisma.warehouse.create({ data: { name: `Inspector B ${marker}`, country: "CN", type: "ORIGIN" } }); ids.warehouses.push(warehouseA.id, warehouseB.id);
  const assignment = await post("/api/v1/admin/warehouse-staff", adminCookie, { email: inspectorA.email, warehouseId: warehouseA.id, roleCode: "inspector" }); const assignmentBody = await assignment.json(); assert(assignment.status === 201 && assignmentBody.data.assignment.roleCode === "inspector", "Admin Inspector assignment failed."); ids.assignments.push(assignmentBody.data.assignment.id);
  for (const [userId, warehouseId] of [[inspectorB.id, warehouseB.id], [worker.id, warehouseA.id], [logistics.id, warehouseA.id]]) { const row = await prisma.warehouseStaffAssignment.create({ data: { userId, warehouseId, assignedById: admin.id } }); ids.assignments.push(row.id); }
  const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: customer.id, status: "WAREHOUSE_RECEIVED", grandTotal: 100 } }); ids.orders.push(order.id);
  const pkg = await prisma.package.create({ data: { orderId: order.id, warehouseId: warehouseA.id, packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, inboundTracking: `IN-${marker}`, status: "RECEIVED" } }); ids.packages.push(pkg.id);
  const summary = await request(`/api/v1/orders/${order.id}/summary`, customerCookie);
  assert(summary.status === 200 && summary.headers.get("content-type") === "application/pdf" && Buffer.from(await summary.arrayBuffer()).subarray(0, 5).toString() === "%PDF-", "Owner order PDF download failed.");
  assert((await request(`/api/v1/orders/${order.id}/summary`, inspectorACookie)).status === 403, "Inspector accessed customer financial PDF.");
  const demoInvoice = await request(`/api/v1/orders/${order.id}/summary?template=demo-invoice`, customerCookie);
  assert(demoInvoice.status === 200 && demoInvoice.headers.get("content-disposition").includes("demo-invoice.pdf") && Buffer.from(await demoInvoice.arrayBuffer()).subarray(0, 5).toString() === "%PDF-", "Owner demo invoice preview failed.");
  assert((await request(`/api/v1/orders/${order.id}/summary?template=demo-invoice`, inspectorACookie)).status === 403, "Inspector accessed another customer's demo invoice.");
  assert((await request("/api/v1/finance/reports?format=pdf", customerCookie)).status === 403, "Customer accessed finance PDF.");
  const home = await request("/inspector", inspectorACookie); const homeHtml = await home.text(); assert(home.status === 200 && homeHtml.includes("Quality decisions begin with a scan") && !homeHtml.includes(customer.email), "Inspector dashboard or PII boundary failed.");
  const customerAttempt = await request("/inspector", customerCookie, { redirect: "manual" }); assert([307, 308].includes(customerAttempt.status) && customerAttempt.headers.get("location")?.endsWith("/inspector/login"), "Customer entered Inspector portal.");
  const lookup = await post("/api/v1/operations/inspections/lookup", inspectorACookie, { code: pkg.packageCode }); const lookupBody = await lookup.json(); assert(lookup.status === 200 && lookupBody.data.destination.endsWith(pkg.packageCode) && !JSON.stringify(lookupBody).includes(customer.email), "Assigned Inspector scan or PII boundary failed.");
  assert((await post("/api/v1/operations/inspections/lookup", inspectorBCookie, { code: pkg.packageCode })).status === 404, "Foreign Inspector resolved package.");
  assert((await request(`/api/v1/operations/packages/${pkg.id}/inspection-evidence`, customerCookie)).status === 403, "Customer accessed staff upload configuration.");
  assert((await request(`/api/v1/operations/packages/${pkg.id}/inspection-evidence`, inspectorBCookie)).status === 404, "Foreign inspector accessed package upload configuration.");
  await verifyInspectionCapture({ origin, pkg, inspectorCookie: inspectorACookie, workerCookie, capabilities: inspectionUploadCapabilities(process.env, false) });
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, workerCookie, { type: "BASIC", result: "PASSED" })).status === 403, "Warehouse Worker inspected package.");
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorBCookie, { type: "BASIC", result: "PASSED" })).status === 404, "Foreign Inspector inspected package.");
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorACookie, { type: "PHOTO", result: "PASSED" })).status === 422, "Photo inspection lacked evidence.");
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorACookie, { type: "BASIC", result: "FAILED" })).status === 422, "Failed inspection lacked notes.");
  if (process.env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS === "true") {
    const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#176780" } }).png().toBuffer();
    // Use fetch directly so multipart boundaries are generated by the client.
    async function multipart(cookie, bytes = photo, trusted = true) {
      const form = new FormData(); form.set("media", new Blob([bytes], { type: "image/png" }), "condition.png");
      return fetch(`${origin}/api/v1/operations/packages/${pkg.id}/inspection-evidence`, { method: "POST", body: form, headers: { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}`, Origin: trusted ? origin : "https://untrusted.example" } });
    }
    assert((await multipart(customerCookie)).status === 403, "Customer uploaded staff evidence.");
    assert((await multipart(inspectorBCookie)).status === 404, "Unassigned Inspector uploaded evidence.");
    assert((await multipart(inspectorACookie, photo, false)).status === 403, "Untrusted evidence mutation accepted.");
    assert((await multipart(inspectorACookie, Buffer.from("not an image"))).status === 422, "Invalid media signature accepted.");
    const uploaded = await multipart(workerCookie); const body = await uploaded.json();
    assert(uploaded.status === 201 && body.data.evidence.id, `Warehouse evidence capture failed: ${JSON.stringify(body)}`);
    const evidence = body.data.evidence;
    assert(!JSON.stringify(body).includes("ciphertext"), "Upload response exposed encrypted payload.");
    const stored = await prisma.inspectionEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert(stored.ciphertext !== photo.toString("base64"), "Evidence was stored without encryption.");
    const view = await request(`/api/v1/operations/inspection-evidence/${evidence.id}`, customerCookie);
    assert(view.status === 200 && view.headers.get("cache-control").includes("no-store"), "Owner could not view private evidence.");
    assert((await request(`/api/v1/operations/inspection-evidence/${evidence.id}`, inspectorBCookie)).status === 403, "Unassigned staff viewed private evidence.");
    assert((await request(`/api/v1/operations/inspection-evidence/${evidence.id}`, logisticsCookie)).status === 403, "Logistics accessed inspection evidence.");
    assert((await request(`/api/v1/operations/inspection-evidence/${evidence.id}`, null)).status === 401, "Anonymous evidence access accepted.");
    const orderPage = await request(`/orders/${order.id}`, customerCookie);
    assert(orderPage.status === 200 && (await orderPage.text()).includes(evidence.id), "Customer order omitted uploaded evidence.");
    console.log("Private evidence capture passed: camera upload, validation, encryption, CSRF, assigned staff and owner-only delivery.");
  }
  const outstanding = await prisma.package.create({ data: { packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, orderId: order.id, warehouseId: warehouseA.id, status: "EXPECTED" } }); ids.packages.push(outstanding.id);
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorACookie, { type: "BASIC", result: "PASSED" })).status === 409, "Order label bypassed an outstanding expected parcel.");
  await prisma.package.delete({ where: { id: outstanding.id } }); // Only this event-free disposable fixture.
  const racePackage = await prisma.package.create({ data: { packageCode: `PKG-${randomBytes(6).toString("hex").toUpperCase()}`, orderId: order.id, warehouseId: warehouseA.id, status: "RECEIVED" } }); ids.packages.push(racePackage.id);
  const racePath = `/api/v1/operations/packages/${racePackage.id}/inspect`;
  const racePayload = { type: "BASIC", result: "PASSED", notes: "Synthetic concurrency check" };
  const raceKeys = [`inspection-race-a-${marker}`, `inspection-race-b-${marker}`];
  const raceResults = await Promise.all(raceKeys.map(key => post(racePath, inspectorACookie, racePayload, { "Idempotency-Key": key })));
  assert(raceResults.map(response => response.status).sort().join(",") === "201,409", "Competing inspections were not serialized.");
  const winningKey = raceKeys[raceResults.findIndex(response => response.status === 201)];
  const replayed = await post(racePath, inspectorACookie, racePayload, { "Idempotency-Key": winningKey });
  const replayBody = await replayed.json();
  assert(replayed.status === 200 && replayBody.data.idempotentReplay && !JSON.stringify(replayBody).includes("requestFingerprint") && !JSON.stringify(replayBody).includes("idempotencyKey"), "Inspection replay or response privacy failed.");
  assert((await post(racePath, adminCookie, racePayload, { "Idempotency-Key": winningKey })).status === 409, "A different actor replayed an Inspector decision.");
  assert((await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorACookie, racePayload, { "Idempotency-Key": winningKey })).status === 409, "Inspection key was reused for another package.");
  assert(await prisma.inspection.count({ where: { packageId: racePackage.id } }) === 1 && await prisma.packageEvent.count({ where: { packageId: racePackage.id, eventType: "INSPECTED" } }) === 1 && await prisma.auditLog.count({ where: { entityId: racePackage.id, action: "inspection.package_completed" } }) === 1, "Concurrent inspection produced duplicate evidence/events/audits.");
  const inspected = await post(`/api/v1/operations/packages/${pkg.id}/inspect`, inspectorACookie, { type: "BASIC", result: "PASSED", notes: "Condition and quantity verified." }); assert(inspected.status === 201, `Inspection failed: ${await inspected.text()}`);
  assert((await post(`/api/v1/operations/packages/${pkg.id}/measure`, inspectorACookie, { actualWeightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 })).status === 403, "Inspector measured package.");
  const shipment = await prisma.shipment.create({ data: { trackingNumber: `TRK-${marker}`, status: "CREATED", originWarehouseId: warehouseA.id } }); ids.shipments.push(shipment.id);
  assert((await post(`/api/v1/operations/shipments/${shipment.id}/events`, inspectorACookie, { status: "IN_TRANSIT" })).status === 403, "Inspector updated shipment.");
  assert((await post(`/api/v1/operations/shipments/${shipment.id}/events`, logisticsCookie, { status: "PICKUP_PENDING", location: "Origin" }, { "Idempotency-Key": `inspector-logistics-${marker}` })).status === 200, "Logistics role boundary failed.");
  const detail = await request(`/inspector/packages/${pkg.packageCode}`, inspectorACookie); const html = await detail.text(); assert(detail.status === 200 && html.includes("Condition and quantity verified") && !html.includes(customer.email), "Inspector detail/history or PII boundary failed.");
  assert((await request(`/inspector/packages/${pkg.packageCode}`, inspectorBCookie)).status === 404, "Foreign Inspector opened detail.");
  const eventTypes = (await prisma.packageEvent.findMany({ where: { packageId: pkg.id }, select: { eventType: true } })).map((item) => item.eventType); assert(eventTypes.includes("SCANNED") && eventTypes.includes("INSPECTED"), "Immutable Inspector events missing.");
  console.log("Inspector portal verification passed: assignment, portal and warehouse isolation, scan, validation, immutable events, PII minimization, and Warehouse/Logistics separation.");
} finally {
  if (ids.packages.length) await prisma.inspectionEvidence.deleteMany({ where: { packageId: { in: ids.packages } } });
  if (ids.shipments.length) { await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: ids.shipments } } }); await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } }); }
  if (ids.packages.length) { await prisma.packageEvent.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.inspection.deleteMany({ where: { packageId: { in: ids.packages } } }); await prisma.package.deleteMany({ where: { id: { in: ids.packages } } }); }
  if (ids.orders.length) { await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.assignments.length) await prisma.warehouseStaffAssignment.deleteMany({ where: { id: { in: ids.assignments } } });
  if (ids.warehouses.length) await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
