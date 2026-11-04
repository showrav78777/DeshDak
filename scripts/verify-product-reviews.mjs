import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for product review verification.");
const marker = randomBytes(8).toString("hex").toUpperCase();
const ids = { users: [], sessions: [], products: [], orders: [], reviews: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Review verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, idempotencyKey, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const roles = {};
  for (const code of ["customer_personal", "admin"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, roleCode) { const row = await prisma.user.create({ data: { email: `${label}-${marker.toLowerCase()}@example.test`, fullName: `${label} Person`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: roles[roleCode].id } } } }); ids.users.push(row.id); return row; }
  const customer = await user("review-customer", "customer_personal"); const foreign = await user("review-foreign", "customer_personal"); const admin = await user("review-admin", "admin");
  const [customerCookie, wrongPortalCustomerCookie, adminCookie, wrongPortalAdminCookie] = await Promise.all([sessionFor(customer, "customer"), sessionFor(customer, "seller"), sessionFor(admin, "admin"), sessionFor(admin, "customer")]);
  const category = await prisma.category.upsert({ where: { slug: `review-${marker.toLowerCase()}` }, update: {}, create: { slug: `review-${marker.toLowerCase()}`, nameEn: "Review Verification", isActive: true } });
  const product = await prisma.product.create({ data: { titleEn: `Review Product ${marker}`, status: "ACTIVE", categoryId: category.id, variants: { create: { sku: `REV-${marker}`, priceBdt: 100, inventoryQuantity: 10, stockStatus: "IN_STOCK" } } }, include: { variants: true } }); ids.products.push(product.id);
  async function orderFor(owner, status) { const order = await prisma.order.create({ data: { orderNumber: `ORD-${randomBytes(10).toString("hex").toUpperCase()}`, customerId: owner.id, status, grandTotal: 100, items: { create: { productId: product.id, productVariantId: product.variants[0].id, productTitle: product.titleEn, quantity: 1, unitPrice: 100, total: 100 } } }, include: { items: true } }); ids.orders.push(order.id); return order; }
  const delivered = await orderFor(customer, "DELIVERED"); const deliveredSecond = await orderFor(customer, "DELIVERED"); const pending = await orderFor(customer, "PAID"); const foreignDelivered = await orderFor(foreign, "DELIVERED");
  const path = `/api/v1/catalog/products/${product.id}/reviews`;
  const payload = { orderItemId: delivered.items[0].id, rating: 5, title: "Excellent verified product", body: "The delivered product matched its approved description." };
  assert((await request(path, null, "POST", payload, `anon-review-${marker}`)).response.status === 403, "Anonymous review submission was accepted.");
  assert((await request(path, wrongPortalCustomerCookie, "POST", payload, `wrong-portal-${marker}`)).response.status === 403, "Customer identity submitted from another portal.");
  assert((await request(path, customerCookie, "POST", payload, `untrusted-review-${marker}`, false)).response.status === 403, "Review mutation accepted an untrusted origin.");
  assert((await request(path, customerCookie, "POST", { ...payload, orderItemId: pending.items[0].id }, `pending-review-${marker}`)).response.status === 403, "An undelivered item was reviewed.");
  assert((await request(path, customerCookie, "POST", { ...payload, orderItemId: foreignDelivered.items[0].id }, `foreign-review-${marker}`)).response.status === 403, "Another customer's delivered item was reviewed.");
  const key = `product-review-${marker}`; const created = await request(path, customerCookie, "POST", payload, key); assert(created.response.status === 201 && created.body.data.review.status === "PENDING_MODERATION" && created.body.data.review.verifiedPurchase, `Eligible review submission failed: ${JSON.stringify(created.body)}`); ids.reviews.push(created.body.data.review.id);
  const submittedJson = JSON.stringify(created.body.data.review); assert(!submittedJson.includes(key) && !("customerId" in created.body.data.review) && !("orderItemId" in created.body.data.review) && !("requestFingerprint" in created.body.data.review), "Review submission response exposed private identity or mutation evidence.");
  const replay = await request(path, customerCookie, "POST", payload, key); assert(replay.response.status === 200 && replay.body.data.idempotentReplay, "Exact review retry was not idempotent.");
  assert((await request(path, customerCookie, "POST", { ...payload, rating: 4 }, key)).response.status === 409, "Changed review reused an idempotency key.");
  assert((await request(path, customerCookie, "POST", payload, `duplicate-review-${marker}`)).response.status === 409, "A delivered item received two reviews.");
  const privatePublic = await request(path); assert(privatePublic.response.status === 200 && privatePublic.body.data.summary.count === 0, "Pending review leaked publicly.");
  const adminQueue = await request("/admin/reviews", adminCookie); assert(adminQueue.response.status === 200 && adminQueue.body.includes(payload.body) && adminQueue.body.includes(customer.personCode), "Admin review queue omitted moderation evidence.");
  assert((await request(`/api/v1/admin/reviews/${ids.reviews[0]}`, wrongPortalAdminCookie, "PATCH", { decision: "PUBLISHED", version: 1 })).response.status === 403, "Admin identity moderated from the wrong portal.");
  assert((await request(`/api/v1/admin/reviews/${ids.reviews[0]}`, adminCookie, "PATCH", { decision: "REJECTED", version: 1 })).response.status === 422, "Rejection without a reason was accepted.");
  const published = await request(`/api/v1/admin/reviews/${ids.reviews[0]}`, adminCookie, "PATCH", { decision: "PUBLISHED", version: 1 }); assert(published.response.status === 200 && published.body.data.review.status === "PUBLISHED", "Admin could not publish a verified review.");
  assert((await request(`/api/v1/admin/reviews/${ids.reviews[0]}`, adminCookie, "PATCH", { decision: "PUBLISHED", version: 1 })).response.status === 409, "A moderation decision was replayed.");
  const publicResult = await request(path); const serialized = JSON.stringify(publicResult.body); assert(publicResult.response.status === 200 && publicResult.body.data.summary.count === 1 && publicResult.body.data.summary.averageRating === 5 && publicResult.body.data.reviews[0].verifiedPurchase, "Published review aggregate failed."); assert(!serialized.includes(customer.email) && !serialized.includes(customer.personCode) && !serialized.includes(delivered.orderNumber) && !serialized.includes(key), "Public review response exposed private identity or operational data.");
  const productPage = await request(`/products/${product.id}`); assert(productPage.response.status === 200 && productPage.body.includes(payload.body) && !productPage.body.includes(customer.email) && !productPage.body.includes(customer.personCode), "Public product review UI or privacy boundary failed.");
  const secondPayload = { orderItemId: deliveredSecond.items[0].id, rating: 2, title: "Moderation test", body: "This second delivered-item review is used to verify rejection." }; const second = await request(path, customerCookie, "POST", secondPayload, `second-review-${marker}`); assert(second.response.status === 201, "Second delivered item could not be reviewed."); ids.reviews.push(second.body.data.review.id);
  const rejected = await request(`/api/v1/admin/reviews/${ids.reviews[1]}`, adminCookie, "PATCH", { decision: "REJECTED", reason: "Content requires revision before publication.", version: 1 }); assert(rejected.response.status === 200 && rejected.body.data.review.status === "REJECTED", "Admin could not reject a review with reason.");
  const removed = await request(`/api/v1/admin/reviews/${ids.reviews[0]}`, adminCookie, "PATCH", { decision: "REMOVED", reason: "Removed during lifecycle verification.", version: 2 }); assert(removed.response.status === 200 && removed.body.data.review.status === "REMOVED", "Published review could not be removed with audit reason.");
  const afterRemoval = await request(path); assert(afterRemoval.body.data.summary.count === 0, "Removed review remained public.");
  const moderationRows = await prisma.productReviewModeration.count({ where: { reviewId: { in: ids.reviews } } }); const audits = await prisma.auditLog.count({ where: { entityType: "ProductReview", entityId: { in: ids.reviews } } }); assert(moderationRows === 3 && audits >= 5, "Review moderation history or audit evidence is incomplete.");
  console.log("Product review verification passed: delivered-item eligibility, ownership, portal/CSRF guards, idempotency, one-per-item integrity, moderation states, immutable decision history, public aggregates, UI, and PII minimization.");
} finally {
  if (ids.reviews.length) { await prisma.productReviewModeration.deleteMany({ where: { reviewId: { in: ids.reviews } } }); await prisma.productReview.deleteMany({ where: { id: { in: ids.reviews } } }); }
  if (ids.orders.length) { await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.products.length) { await prisma.productVariant.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); }
  await prisma.category.deleteMany({ where: { slug: `review-${marker.toLowerCase()}` } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
