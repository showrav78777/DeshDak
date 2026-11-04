import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for seller store revision verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Store revision verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const sellerRole = await prisma.role.upsert({ where: { code: "seller" }, update: {}, create: { code: "seller", description: "seller" } });
  const adminRole = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "admin" } });
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "customer" } });
  async function user(label, roleId) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId } } } }); ids.users.push(row.id); return row; }
  const sellerUser = await user("store-seller", sellerRole.id);
  const admin = await user("store-admin", adminRole.id);
  const customer = await user("store-customer", customerRole.id);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: "Approved Original Store", storeSlug: `approved-store-${marker}`, storeDescription: "The approved public description remains visible during moderation.", processingDays: 3, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(seller.id);
  const [sellerCookie, wrongPortalSellerCookie, adminCookie, wrongPortalAdminCookie, customerCookie] = await Promise.all([sessionFor(sellerUser, "seller"), sessionFor(sellerUser, "customer"), sessionFor(admin, "admin"), sessionFor(admin, "customer"), sessionFor(customer, "customer")]);
  const payload = { baseSellerVersion: 1, businessName: "Proposed Worldwide Store", storeDescription: "A proposed customer-facing store description that requires administrator moderation before publication.", processingDays: 5 };

  assert((await request("/api/v1/seller/store", customerCookie)).response.status === 403, "A customer accessed protected seller store settings.");
  const sellerIdentity = await request("/api/v1/seller/store", sellerCookie);
  assert(sellerIdentity.response.status === 200 && sellerIdentity.body.data.store.storeCode === seller.storeCode && /^STR-[A-F0-9]{20}$/.test(sellerIdentity.body.data.store.storeCode), "Seller API did not return the immutable store code.");
  assert((await request("/api/v1/seller/store", wrongPortalSellerCookie, "POST", payload)).response.status === 403, "Seller identity changed store settings from the wrong portal.");
  const noOrigin = await request("/api/v1/seller/store", sellerCookie, "POST", payload, false);
  assert(noOrigin.response.status === 403 && noOrigin.body.error.code === "UNTRUSTED_ORIGIN", "Store mutation accepted an untrusted browser origin.");
  const unchangedAttempt = await request("/api/v1/seller/store", sellerCookie, "POST", { baseSellerVersion: 1, businessName: seller.businessName, storeDescription: seller.storeDescription, processingDays: seller.processingDays });
  assert(unchangedAttempt.response.status === 422 && unchangedAttempt.body.error.code === "STORE_DETAILS_UNCHANGED", "An unchanged store proposal created moderation work.");

  const submitted = await request("/api/v1/seller/store", sellerCookie, "POST", payload);
  assert(submitted.response.status === 201 && submitted.body.data.revision.status === "PENDING_REVIEW", `Store proposal submission failed: ${JSON.stringify(submitted.body)}`);
  const revision = submitted.body.data.revision;
  const current = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: seller.id } });
  assert(current.businessName === "Approved Original Store" && current.processingDays === 3 && current.storeSlug === seller.storeSlug, "A pending store proposal changed the approved public profile.");
  assert((await request("/api/v1/seller/store", sellerCookie, "POST", payload)).response.status === 409, "A second pending store proposal was accepted.");
  const sellerPage = await request("/seller/store", sellerCookie);
  assert(sellerPage.response.status === 200 && sellerPage.body.includes("Proposed Worldwide Store") && sellerPage.body.includes("Awaiting Admin review"), "Seller store page did not show the pending proposal.");
  const publicBefore = await request(`/api/v1/catalog/stores/${seller.storeSlug}`);
  assert(publicBefore.response.status === 200 && publicBefore.body.data.store.businessName === "Approved Original Store" && publicBefore.body.data.store.storeCode === seller.storeCode, "Public API exposed an unapproved store proposal or lost the store code.");
  assert((await request(`/api/v1/admin/store-revisions/${revision.id}/review`, wrongPortalAdminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Wrong portal", version: revision.version })).response.status === 403, "Admin identity reviewed a store proposal from the wrong portal.");
  const adminPage = await request("/admin/sellers", adminCookie);
  assert(adminPage.response.status === 200 && adminPage.body.includes("Proposed Worldwide Store") && adminPage.body.includes("Approved Original Store"), "Admin moderation did not show current and proposed store identity.");

  const approved = await request(`/api/v1/admin/store-revisions/${revision.id}/review`, adminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Public identity and preparation time verified.", version: revision.version });
  assert(approved.response.status === 200 && approved.body.data.revision.status === "APPROVED", `Store proposal approval failed: ${JSON.stringify(approved.body)}`);
  const changed = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: seller.id } });
  assert(changed.businessName === "Proposed Worldwide Store" && changed.processingDays === 5 && changed.version === 2 && changed.storeSlug === seller.storeSlug, "Approved store proposal was not atomically published or changed the permanent URL.");
  assert((await request(`/api/v1/admin/store-revisions/${revision.id}/review`, adminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Replay", version: revision.version })).response.status === 409, "A completed store proposal was reviewed twice.");

  const second = await request("/api/v1/seller/store", sellerCookie, "POST", { ...payload, baseSellerVersion: 2, businessName: "Rejected Store Proposal" });
  assert(second.response.status === 201, "Seller could not submit a later store proposal.");
  const rejected = await request(`/api/v1/admin/store-revisions/${second.body.data.revision.id}/review`, adminCookie, "PATCH", { decision: "REJECTED", reviewNote: "Public business name needs supporting verification.", version: second.body.data.revision.version });
  assert(rejected.response.status === 200 && rejected.body.data.revision.status === "REJECTED", "Admin could not reject a store proposal.");
  const afterReject = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: seller.id } });
  assert(afterReject.businessName === "Proposed Worldwide Store" && afterReject.version === 2, "Rejected store proposal changed the approved storefront.");
  const lifecycleAudits = await prisma.auditLog.count({ where: { entityType: "SellerStoreRevision", action: { in: ["seller.store_revision_submitted", "seller.store_revision_approved", "seller.store_revision_rejected"] } } });
  const denialAudits = await prisma.auditLog.count({ where: { actorId: { in: [sellerUser.id, admin.id] }, action: { in: ["seller.store_access_denied", "admin.store_revision_access_denied"] } } });
  assert(lifecycleAudits >= 4 && denialAudits >= 2, "Store moderation or authenticated permission denials were not fully audited.");
  console.log("Seller store revision verification passed: seller/Admin portal isolation, authenticated denial auditing, CSRF, no-op and one-pending guards, approved-store preservation, public API privacy, Admin moderation, atomic publication, permanent URL stability, rejection safety, optimistic versions, and replay protection.");
} finally {
  if (ids.sellers.length) await prisma.sellerStoreRevision.deleteMany({ where: { sellerProfileId: { in: ids.sellers } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
