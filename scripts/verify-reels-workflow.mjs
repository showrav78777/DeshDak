import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { reelRankingScore } from "../src/modules/reels/ranking.ts";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Reel workflow verification.");
const marker = randomBytes(8).toString("hex").toUpperCase();
const ids = { users: [], sessions: [], reels: [], comments: [], products: [], sellers: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal, roles) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Reel verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, token, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { Origin: origin } : {}), ...(token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  return { response, body: type.includes("json") ? await response.json() : await response.text() };
}

try {
  const roles = {};
  for (const code of ["seller", "customer_personal", "admin"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, roleCode, consent = false) { const row = await prisma.user.create({ data: { email: `${label}-${marker.toLowerCase()}@example.test`, fullName: `${label} Person`, passwordHash: "not-used", status: "ACTIVE", analyticsConsent: consent, analyticsConsentAt: consent ? new Date() : null, roles: { create: { roleId: roles[roleCode].id } } } }); ids.users.push(row.id); return row; }
  const sellerUser = await user("reel-seller", "seller"); const customer = await user("reel-customer", "customer_personal", true); const admin = await user("reel-admin", "admin");
  const [sellerToken, wrongSellerPortal, customerToken, adminToken] = await Promise.all([sessionFor(sellerUser, "seller", ["seller"]), sessionFor(sellerUser, "customer", ["seller"]), sessionFor(customer, "customer", ["customer_personal"]), sessionFor(admin, "admin", ["admin"])]);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Reel Store ${marker}`, storeSlug: `reel-store-${marker.toLowerCase()}`, status: "APPROVED" } }); ids.sellers.push(seller.id);
  const category = await prisma.category.create({ data: { slug: `reel-${marker.toLowerCase()}`, nameEn: "Reel verification", isActive: true } });
  const product = await prisma.product.create({ data: { titleEn: `Reel Product ${marker}`, status: "ACTIVE", complianceStatus: "CLEAR", sellerProfileId: seller.id, categoryId: category.id, isInternationallyAvailable: true, variants: { create: { sku: `REEL-${marker}`, priceBdt: 750, priceCurrency: "BDT", inventoryQuantity: 20, stockStatus: "IN_STOCK" } }, media: { create: { kind: "VIDEO", status: "READY", storageKey: `private/reels/${marker.toLowerCase()}.mp4`, originalFilename: "seller-video.mp4", mimeType: "video/mp4", sizeBytes: 2048, checksumSha256: marker.toLowerCase().padEnd(64, "0"), altText: "Verification product demonstration" } } }, include: { media: true } }); ids.products.push(product.id);

  const baseline = reelRankingScore({ viewCount: 10000, completedViewCount: 0, totalWatchTimeMs: 0, likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, productClickCount: 0, publishedAt: new Date(), affinity: 0, explorationSeed: 0 });
  const quality = reelRankingScore({ viewCount: 100, completedViewCount: 90, totalWatchTimeMs: 2_500_000, likeCount: 10, commentCount: 5, shareCount: 4, saveCount: 8, productClickCount: 7, publishedAt: new Date(), affinity: 0.5, explorationSeed: 0.5 });
  assert(quality > baseline, "Raw views dominate quality and conversion signals.");

  const payload = { productId: product.id, mediaId: product.media[0].id, caption: "A moderated product demonstration Reel." };
  assert((await request("/api/v1/seller/reels", null, "POST", payload)).response.status === 403, "Anonymous Reel submission was accepted.");
  assert((await request("/api/v1/seller/reels", wrongSellerPortal, "POST", payload)).response.status === 403, "Seller submitted from the wrong portal.");
  const created = await request("/api/v1/seller/reels", sellerToken, "POST", payload); assert(created.response.status === 201 && created.body.data.reel.status === "PENDING_REVIEW", `Seller Reel submission failed: ${JSON.stringify(created.body)}`); const reelId = created.body.data.reel.id; ids.reels.push(reelId);
  assert((await request("/api/v1/seller/reels", sellerToken, "POST", payload)).response.status === 409, "One video was accepted for multiple Reels.");
  const beforePublish = await request("/api/v1/reels"); assert(beforePublish.response.status === 200 && !JSON.stringify(beforePublish.body).includes(reelId), "Pending Reel leaked publicly.");
  const sellerPage = await request("/seller/reels", sellerToken); assert(sellerPage.response.status === 200 && sellerPage.body.includes(created.body.data.reel.reelCode), "Seller Reel manager did not render the submission.");
  const adminPage = await request("/admin/reels", adminToken); assert(adminPage.response.status === 200 && adminPage.body.includes(created.body.data.reel.reelCode), "Admin Reel queue omitted the submission.");
  assert((await request(`/api/v1/admin/reels/${reelId}`, adminToken, "PATCH", { decision: "REJECT", version: 1 })).response.status === 422, "Reel rejection without a reason was accepted.");
  const published = await request(`/api/v1/admin/reels/${reelId}`, adminToken, "PATCH", { decision: "PUBLISH", version: 1 }); assert(published.response.status === 200 && published.body.data.reel.status === "ACTIVE", "Admin could not publish the Reel.");
  assert((await request(`/api/v1/admin/reels/${reelId}`, adminToken, "PATCH", { decision: "PUBLISH", version: 1 })).response.status === 409, "Stale Reel moderation was accepted.");
  const feed = await request("/api/v1/reels"); const feedJson = JSON.stringify(feed.body); assert(feed.response.status === 200 && feedJson.includes(reelId) && feedJson.includes(product.id), "Published Reel did not appear in the feed."); assert(!feedJson.includes(product.media[0].storageKey) && !feedJson.includes(product.media[0].checksumSha256) && !feedJson.includes(sellerUser.email), "Public Reel feed exposed private media, identity, or integrity data.");
  const reelPage = await request("/reels"); assert(reelPage.response.status === 200 && reelPage.body.includes("Product Reels"), "Public Reels page did not render.");

  const eventKey = randomUUID(); const view = { type: "VIEW", idempotencyKey: eventKey, watchTimeMs: 28000, durationMs: 30000, completionPercent: 93 };
  const recorded = await request(`/api/v1/reels/${reelId}/engagements`, null, "POST", view); assert(recorded.response.status === 201 && recorded.body.data.recorded, "Anonymous Reel view was not recorded.");
  const replay = await request(`/api/v1/reels/${reelId}/engagements`, null, "POST", view); assert(replay.response.status === 200 && replay.body.data.idempotentReplay, "Reel event retry was not idempotent.");
  const afterView = await prisma.reel.findUniqueOrThrow({ where: { id: reelId } }); assert(afterView.viewCount === 1 && afterView.completedViewCount === 1 && afterView.totalWatchTimeMs === 28000n, "Reel view aggregates were not exactly-once.");
  assert((await request(`/api/v1/reels/${reelId}/reactions`, null, "PUT", { type: "LIKE", active: true })).response.status === 401, "Anonymous Like was accepted.");
  await request(`/api/v1/reels/${reelId}/reactions`, customerToken, "PUT", { type: "LIKE", active: true });
  await request(`/api/v1/reels/${reelId}/reactions`, customerToken, "PUT", { type: "LIKE", active: true });
  const afterLike = await prisma.reel.findUniqueOrThrow({ where: { id: reelId } }); assert(afterLike.likeCount === 1, "Repeated Like changed the counter twice.");

  assert((await request(`/api/v1/reels/${reelId}/comments`, null, "POST", { body: "Public spam" })).response.status === 401, "Anonymous comment was accepted.");
  const comment = await request(`/api/v1/reels/${reelId}/comments`, customerToken, "POST", { body: "This product demonstration is helpful." }); assert(comment.response.status === 201 && comment.body.data.comment.status === "PENDING_MODERATION", "Customer comment did not enter moderation."); const commentId = comment.body.data.comment.id; ids.comments.push(commentId);
  const hiddenComment = await request(`/api/v1/reels/${reelId}/comments`); assert(hiddenComment.body.data.meta.total === 0, "Pending Reel comment leaked publicly.");
  const commentPublished = await request(`/api/v1/admin/reel-comments/${commentId}`, adminToken, "PATCH", { decision: "PUBLISH", version: 1 }); assert(commentPublished.response.status === 200 && commentPublished.body.data.comment.status === "PUBLISHED", "Admin could not publish a Reel comment.");
  const publicComments = await request(`/api/v1/reels/${reelId}/comments`); const commentJson = JSON.stringify(publicComments.body); assert(publicComments.body.data.meta.total === 1 && commentJson.includes("helpful") && !commentJson.includes(customer.email) && !commentJson.includes(customer.personCode), "Published comment or its privacy boundary failed.");
  const archived = await request(`/api/v1/admin/reels/${reelId}`, adminToken, "PATCH", { decision: "ARCHIVE", reason: "Lifecycle verification complete.", version: 2 }); assert(archived.response.status === 200 && archived.body.data.reel.status === "ARCHIVED", "Published Reel could not be archived.");
  const afterArchive = await request("/api/v1/reels"); assert(!JSON.stringify(afterArchive.body).includes(reelId), "Archived Reel remained public.");
  const audits = await prisma.auditLog.count({ where: { OR: [{ entityType: "Reel", entityId: reelId }, { entityType: "ReelComment", entityId: commentId }] } }); assert(audits >= 4, "Reel submission/moderation audit history is incomplete.");
  console.log("Reels verification passed: seller ownership, scanned-video eligibility, moderation, public feed privacy, quality-weighted ranking, idempotent views, authenticated reactions, moderated comments, counters, archive state, pages, and audit evidence.");
} finally {
  if (ids.reels.length) { await prisma.reelEngagement.deleteMany({ where: { reelId: { in: ids.reels } } }); await prisma.reelReaction.deleteMany({ where: { reelId: { in: ids.reels } } }); await prisma.reelComment.deleteMany({ where: { reelId: { in: ids.reels } } }); await prisma.reel.deleteMany({ where: { id: { in: ids.reels } } }); }
  if (ids.products.length) { await prisma.productMedia.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.productVariant.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); }
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  await prisma.category.deleteMany({ where: { slug: `reel-${marker.toLowerCase()}` } });
  await prisma.securityRateLimit.deleteMany({ where: { scope: { in: ["reels:engagement", "reels:comment"] } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
