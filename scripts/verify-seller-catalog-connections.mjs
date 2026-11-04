import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for seller catalog connection verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [], connections: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function createUser(label, roleId) {
  const user = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId } } } });
  ids.users.push(user.id); return user;
}

async function sessionFor(user, portal) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Seller connection verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

const requestPayload = {
  systemName: `Seller ERP ${marker}`,
  apiBaseUrl: `https://api-${marker}.seller.example.com/v1`,
  apiDocumentationUrl: `https://docs-${marker}.seller.example.com/catalog`,
  authMethod: "API_KEY",
  requestedCapabilities: ["PRODUCTS", "VARIANTS", "INVENTORY", "PRICES", "MEDIA"],
  expectedProductCount: 450,
  requestedSyncFrequencyMinutes: 60,
  sellerNote: "Official read-only catalog API. Technical contact is available after approval.",
  consent: "AUTHORIZE_READ_ONLY_CATALOG_REVIEW",
};

try {
  const [sellerRole, customerRole, adminRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { code: "seller" } }), prisma.role.findUniqueOrThrow({ where: { code: "customer_personal" } }), prisma.role.findUniqueOrThrow({ where: { code: "admin" } })]);
  const [sellerUser, otherSellerUser, customer, admin] = await Promise.all([createUser("connection-seller", sellerRole.id), createUser("connection-other-seller", sellerRole.id), createUser("connection-customer", customerRole.id), createUser("connection-admin", adminRole.id)]);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Connection Seller ${marker}`, storeSlug: `connection-seller-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(seller.id);
  const otherSeller = await prisma.sellerProfile.create({ data: { userId: otherSellerUser.id, businessName: `Other Connection Seller ${marker}`, storeSlug: `other-connection-seller-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(otherSeller.id);
  const [sellerCookie, wrongPortalCookie, otherSellerCookie, customerCookie, adminCookie] = await Promise.all([sessionFor(sellerUser, "seller"), sessionFor(sellerUser, "customer"), sessionFor(otherSellerUser, "seller"), sessionFor(customer, "customer"), sessionFor(admin, "admin")]);

  assert((await request("/api/v1/seller/catalog-connections", null)).response.status === 403, "Anonymous visitor read seller connection records.");
  assert((await request("/api/v1/seller/catalog-connections", customerCookie, "POST", requestPayload)).response.status === 403, "Customer created a seller catalog connection.");
  assert((await request("/api/v1/seller/catalog-connections", wrongPortalCookie, "POST", requestPayload)).response.status === 403, "Seller identity used the wrong portal.");
  const csrf = await request("/api/v1/seller/catalog-connections", sellerCookie, "POST", requestPayload, false);
  assert(csrf.response.status === 403 && csrf.body.error.code === "UNTRUSTED_ORIGIN", "Seller connection creation bypassed origin protection.");
  for (const unsafeUrl of ["http://seller.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.2.3.4/v1", "https://user:password@seller.example.com/v1", "https://seller.example.com:8443/v1", "https://seller.example.com/v1?key=secret"]) {
    const unsafe = await request("/api/v1/seller/catalog-connections", sellerCookie, "POST", { ...requestPayload, systemName: `Unsafe ${unsafeUrl}`, apiBaseUrl: unsafeUrl });
    assert(unsafe.response.status === 422, `Unsafe API URL was accepted: ${unsafeUrl}`);
  }

  const created = await request("/api/v1/seller/catalog-connections", sellerCookie, "POST", requestPayload);
  assert(created.response.status === 201 && created.body.data.connection.status === "PENDING_REVIEW" && created.body.data.activationLocked === true, `Valid request failed: ${JSON.stringify(created.body)}`);
  const connectionId = created.body.data.connection.id; ids.connections.push(connectionId);
  assert(!("secretReference" in created.body.data.connection) && !("adapterKey" in created.body.data.connection), "Seller response exposed Admin-only connection configuration.");
  const duplicate = await request("/api/v1/seller/catalog-connections", sellerCookie, "POST", { ...requestPayload, systemName: requestPayload.systemName.toUpperCase() });
  assert(duplicate.response.status === 409 && duplicate.body.error.code === "CATALOG_CONNECTION_EXISTS", "Case-insensitive duplicate request was accepted.");
  assert((await request(`/api/v1/seller/catalog-connections/${connectionId}/revoke`, otherSellerCookie, "POST", { version: 1, confirmation: "REVOKE_CATALOG_ACCESS" })).response.status === 404, "Another seller accessed the connection.");
  assert((await request("/api/v1/admin/seller-catalog-connections", sellerCookie)).response.status === 403, "Seller accessed the Admin connection queue.");
  const adminQueue = await request("/api/v1/admin/seller-catalog-connections?status=PENDING_REVIEW&limit=10", adminCookie);
  assert(adminQueue.response.status === 200 && adminQueue.body.data.connections.some((item) => item.id === connectionId), "Connection was absent from the Admin API queue.");
  assert(!JSON.stringify(adminQueue.body).includes("secret://crossly/sellers/"), "Admin list leaked an unredacted secret reference.");
  const sellerPage = await request("/seller/integrations", sellerCookie);
  const adminPage = await request("/admin/seller-integrations", adminCookie);
  assert(sellerPage.response.status === 200 && sellerPage.body.includes(requestPayload.systemName), "Seller connection workspace did not render the request.");
  assert(adminPage.response.status === 200 && adminPage.body.includes(requestPayload.systemName), "Admin connection review page did not render the request.");

  const staleReview = await request(`/api/v1/admin/seller-catalog-connections/${connectionId}`, adminCookie, "PATCH", { decision: "REQUEST_CHANGES", version: 99, reviewNote: "Please clarify the official ownership evidence." });
  assert(staleReview.response.status === 409 && staleReview.body.error.code === "CATALOG_CONNECTION_CHANGED", "Stale Admin review was accepted.");
  const changes = await request(`/api/v1/admin/seller-catalog-connections/${connectionId}`, adminCookie, "PATCH", { decision: "REQUEST_CHANGES", version: 1, reviewNote: "Please confirm the official API owner and read-only product scope." });
  assert(changes.response.status === 200 && changes.body.data.connection.status === "CHANGES_REQUESTED", "Admin could not request changes.");
  assert((await request(`/api/v1/seller/catalog-connections/${connectionId}`, sellerCookie, "PATCH", { ...requestPayload, version: 1 })).response.status === 409, "Seller overwrote a newer review version.");
  const resubmitted = await request(`/api/v1/seller/catalog-connections/${connectionId}`, sellerCookie, "PATCH", { ...requestPayload, sellerNote: "Ownership confirmed. Official API owner is the approved seller business.", version: 2 });
  assert(resubmitted.response.status === 200 && resubmitted.body.data.connection.status === "PENDING_REVIEW" && resubmitted.body.data.connection.version === 3, "Seller resubmission failed.");

  const secretReference = `secret://crossly/sellers/${marker}`;
  const configured = await request(`/api/v1/admin/seller-catalog-connections/${connectionId}`, adminCookie, "PATCH", { decision: "SAVE_CONFIGURATION", version: 3, reviewNote: "Terms, read-only access, media rights and security controls reviewed. Adapter implementation remains locked.", adapterKey: `SELLER_${marker.toUpperCase()}`, secretReference, dataUseApproved: true, mediaRightsApproved: true, securityApproved: true });
  assert(configured.response.status === 200 && configured.body.data.connection.status === "CONFIGURATION_SAVED" && configured.body.data.connection.secretReference === "secret://••••••••" && configured.body.data.activationLocked === true, `Safe configuration failed: ${JSON.stringify(configured.body)}`);
  assert(!JSON.stringify(configured.body).includes(secretReference), "Admin mutation response exposed the complete secret reference.");
  const stored = await prisma.sellerCatalogConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert(stored.secretReference === secretReference && stored.dataUseApproved && stored.mediaRightsApproved && stored.securityApproved, "Reviewed configuration was not stored correctly.");
  const sellerView = await request("/api/v1/seller/catalog-connections", sellerCookie);
  assert(sellerView.response.status === 200 && !JSON.stringify(sellerView.body).includes("secretReference") && !JSON.stringify(sellerView.body).includes("adapterKey"), "Seller API exposed internal adapter or secret metadata.");
  const adminConfiguredPage = await request("/admin/seller-integrations", adminCookie);
  assert(adminConfiguredPage.response.status === 200 && !adminConfiguredPage.body.includes(secretReference) && adminConfiguredPage.body.includes("live synchronization: locked"), "Admin page exposed the secret reference or omitted the activation lock.");
  const publicCatalog = await request("/api/v1/catalog/products");
  assert(publicCatalog.response.status === 200 && !JSON.stringify(publicCatalog.body).includes(requestPayload.apiBaseUrl) && !JSON.stringify(publicCatalog.body).includes(requestPayload.systemName), "Seller connection data leaked to the public catalog.");

  const revoked = await request(`/api/v1/seller/catalog-connections/${connectionId}/revoke`, sellerCookie, "POST", { version: 4, confirmation: "REVOKE_CATALOG_ACCESS" });
  assert(revoked.response.status === 200 && revoked.body.data.connection.status === "REVOKED", "Seller could not revoke consent.");
  const cleared = await prisma.sellerCatalogConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert(cleared.consentRevokedAt && !cleared.secretReference && !cleared.adapterKey && !cleared.dataUseApproved && !cleared.mediaRightsApproved && !cleared.securityApproved, "Revocation did not clear credential references and approvals.");
  const replay = await request(`/api/v1/seller/catalog-connections/${connectionId}/revoke`, sellerCookie, "POST", { version: 4, confirmation: "REVOKE_CATALOG_ACCESS" });
  assert(replay.response.status === 200 && replay.body.data.alreadyRevoked === true, "Revocation retry was not idempotent.");
  const postRevokeAdmin = await request(`/api/v1/admin/seller-catalog-connections/${connectionId}`, adminCookie, "PATCH", { decision: "REQUEST_CHANGES", version: 5, reviewNote: "Should remain blocked." });
  assert(postRevokeAdmin.response.status === 409 && postRevokeAdmin.body.error.code === "CATALOG_CONNECTION_REVOKED", "Admin changed a revoked connection.");
  const audits = await prisma.auditLog.count({ where: { entityType: "SellerCatalogConnection", entityId: connectionId, action: { in: ["seller.catalog_connection_requested", "seller.catalog_connection_changes_requested", "seller.catalog_connection_resubmitted", "seller.catalog_connection_configuration_saved", "seller.catalog_connection_revoked"] } } });
  assert(audits === 5, `Expected five lifecycle audit records, found ${audits}.`);
  const notification = await prisma.notification.findFirst({ where: { userId: sellerUser.id, entityType: "SellerCatalogConnection", entityId: connectionId, eventType: "SELLER_CATALOG_CONNECTION_CONFIGURATION_SAVED" } });
  assert(notification?.deepLink === "/seller/integrations", "Seller review notification was not created with a safe deep link.");
  console.log("Seller catalog connection verification passed: role/portal/ownership isolation, CSRF, SSRF-safe URL intake, duplicate protection, consent, Admin review, version conflicts, redaction, fail-closed configuration, notification, public privacy, revocation clearing/idempotency, terminal-state guard, and audit evidence.");
} finally {
  if (ids.connections.length) await prisma.sellerCatalogConnection.deleteMany({ where: { id: { in: ids.connections } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
