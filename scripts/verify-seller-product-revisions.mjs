import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for seller product revision verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [], products: [], categories: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Seller revision verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
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
  async function user(label, roleId) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId } } } }); ids.users.push(row.id); return row; }
  const sellerUser = await user("revision-seller", sellerRole.id);
  const otherSellerUser = await user("revision-other-seller", sellerRole.id);
  const admin = await user("revision-admin", adminRole.id);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Seller ${marker}`, storeSlug: `seller-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(seller.id);
  const otherSeller = await prisma.sellerProfile.create({ data: { userId: otherSellerUser.id, businessName: `Other ${marker}`, storeSlug: `other-${marker}`, status: "APPROVED", originCountryCode: "BD" } }); ids.sellers.push(otherSeller.id);
  const category = await prisma.category.create({ data: { slug: `revision-${marker}`, nameEn: "Revision verification", isActive: true } }); ids.categories.push(category.id);
  const product = await prisma.product.create({ data: { productCode: `PRD-REV-${marker.toUpperCase()}`, titleEn: "Approved original product", shortDescription: "The currently approved customer summary.", description: "The currently approved product description remains visible while changes are reviewed.", highlights: ["Original approved highlight"], categoryId: category.id, sellerProfileId: seller.id, status: "ACTIVE", originCountryCode: "BD", isInternationallyAvailable: true, minimumOrderQuantity: 1, productionLeadDaysMin: 1, productionLeadDaysMax: 3, sellingUnit: "piece", packageContents: "One product", completenessScore: 75, variants: { create: { sku: `REV-OLD-${marker}`, priceBdt: 1000, inventoryQuantity: 10, stockStatus: "IN_STOCK", weightGrams: 500, lengthMm: 100, widthMm: 100, heightMm: 100 } } } }); ids.products.push(product.id);
  const foreignProduct = await prisma.product.create({ data: { titleEn: "Other seller product", sellerProfileId: otherSeller.id, status: "ACTIVE", originCountryCode: "BD", variants: { create: { priceBdt: 50 } } } }); ids.products.push(foreignProduct.id);

  const [sellerCookie, wrongPortalSellerCookie, otherSellerCookie, adminCookie, wrongPortalAdminCookie] = await Promise.all([sessionFor(sellerUser, "seller"), sessionFor(sellerUser, "customer"), sessionFor(otherSellerUser, "seller"), sessionFor(admin, "admin"), sessionFor(admin, "customer")]);
  assert((await request(`/api/v1/catalog/products/${product.id}`)).response.status === 200, "Approved seller product was not publicly visible.");
  await prisma.sellerProfile.update({ where: { id: seller.id }, data: { status: "SUSPENDED" } });
  const [hiddenDetail, hiddenList, hiddenCategories] = await Promise.all([request(`/api/v1/catalog/products/${product.id}`), request(`/api/v1/catalog/products?q=${product.productCode}`), request("/api/v1/catalog/categories")]);
  const hiddenCategory = hiddenCategories.body.data.categories.find((item) => item.id === category.id);
  assert(hiddenDetail.response.status === 404 && hiddenList.body.data.products.length === 0 && hiddenCategory?.productCount === 0, "A suspended seller's product remained visible through a public catalog boundary.");
  await prisma.sellerProfile.update({ where: { id: seller.id }, data: { status: "APPROVED" } });
  const payload = { baseProductVersion: 1, titleEn: "Moderated updated product", titleBn: "", shortDescription: "A newly proposed customer-facing summary.", description: "A newly proposed product description that must not become public before administrator approval.", highlights: "Updated material\nUpdated benefit", brand: "Verified Brand", modelNumber: "REV-2", categoryId: category.id, sku: `REV-NEW-${marker}`, priceBdt: 1250, inventoryQuantity: 20, stockStatus: "IN_STOCK", weightGrams: 600, lengthMm: 110, widthMm: 105, heightMm: 95, minimumOrderQuantity: 2, productionLeadDaysMin: 2, productionLeadDaysMax: 4, sellingUnit: "piece", packageContents: "One updated product", returnPolicy: "DeshDak reviewed policy applies.", warrantyInfo: "Six month seller warranty.", sampleAvailable: true, customizationAvailable: false, hsCode: "9999.99", isInternationallyAvailable: true };

  const noOrigin = await request(`/api/v1/seller/products/${product.id}/revisions`, sellerCookie, "POST", payload, false);
  assert(noOrigin.response.status === 403 && noOrigin.body.error.code === "UNTRUSTED_ORIGIN", "Seller revision mutation accepted an untrusted origin.");
  assert((await request(`/api/v1/seller/products/${product.id}/revisions`, wrongPortalSellerCookie, "POST", payload)).response.status === 403, "Seller identity submitted a revision from the wrong portal.");
  assert((await request(`/api/v1/seller/products/${foreignProduct.id}/revisions`, sellerCookie, "POST", payload)).response.status === 404, "Seller submitted changes to another seller's product.");
  assert((await request(`/api/v1/seller/products/${product.id}/revisions`, otherSellerCookie, "POST", payload)).response.status === 404, "A different seller accessed the product revision boundary.");

  const submitted = await request(`/api/v1/seller/products/${product.id}/revisions`, sellerCookie, "POST", payload);
  assert(submitted.response.status === 201 && submitted.body.data.revision.status === "PENDING_REVIEW", `Seller revision submission failed: ${JSON.stringify(submitted.body)}`);
  const revision = submitted.body.data.revision;
  const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
  assert(unchanged.titleEn === "Approved original product" && unchanged.status === "ACTIVE" && unchanged.variants[0].priceBdt.toString() === "1000", "A pending seller revision changed the live product.");
  const sellerReviewPage = await request(`/seller/products/${product.id}`, sellerCookie);
  assert(sellerReviewPage.response.status === 200 && sellerReviewPage.body.includes("Moderated updated product") && sellerReviewPage.body.includes("pending proposal"), "Seller could not review their own pending proposal.");
  assert((await request(`/api/v1/seller/products/${product.id}/revisions`, sellerCookie, "POST", payload)).response.status === 409, "A second pending revision was accepted for the same product.");
  assert((await request(`/api/v1/admin/product-revisions/${revision.id}/review`, wrongPortalAdminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Wrong portal", version: revision.version })).response.status === 403, "Admin identity reviewed a revision from the wrong portal.");
  const adminPage = await request("/admin/products", adminCookie);
  assert(adminPage.response.status === 200 && adminPage.body.includes("Moderated updated product") && adminPage.body.includes("Approved original product"), "Admin moderation page did not show the proposed and live listing context.");

  const restrictedRule = await prisma.restrictedGoodsRule.create({ data: { ruleCode: `PRODUCT-BLOCK-${marker.toUpperCase()}`, name: "Product publication verification block", customerMessage: "This product cannot be published under the current rules.", action: "BLOCK", status: "ACTIVE", keywords: ["moderated updated product"], originCountryCode: "BD", createdById: admin.id, updatedById: admin.id } });
  const restrictedApproval = await request(`/api/v1/admin/product-revisions/${revision.id}/review`, adminCookie, "PATCH", { decision: "APPROVED", reviewNote: "This must be stopped by compliance.", version: revision.version });
  assert(restrictedApproval.response.status === 422 && restrictedApproval.body.error.code === "RESTRICTED_GOODS_BLOCKED", "A restricted seller revision became public.");
  assert((await prisma.productRevision.findUniqueOrThrow({ where: { id: revision.id } })).status === "PENDING_REVIEW", "Blocked publication consumed the pending revision.");
  await prisma.restrictedGoodsRule.delete({ where: { id: restrictedRule.id } });
  const approved = await request(`/api/v1/admin/product-revisions/${revision.id}/review`, adminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Catalog and export details verified.", version: revision.version });
  assert(approved.response.status === 200 && approved.body.data.revision.status === "APPROVED", `Admin revision approval failed: ${JSON.stringify(approved.body)}`);
  const changed = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
  assert(changed.titleEn === "Moderated updated product" && changed.version === 2 && changed.variants[0].priceBdt.toString() === "1250", "Approved revision was not atomically applied to product and variant.");
  assert((await request(`/api/v1/admin/product-revisions/${revision.id}/review`, adminCookie, "PATCH", { decision: "APPROVED", reviewNote: "Replay", version: revision.version })).response.status === 409, "A completed revision was reviewed twice.");

  const rejectedSubmission = await request(`/api/v1/seller/products/${product.id}/revisions`, sellerCookie, "POST", { ...payload, baseProductVersion: 2, titleEn: "Rejected proposed title" });
  assert(rejectedSubmission.response.status === 201, "Seller could not submit a later revision after approval.");
  const rejectedRevision = rejectedSubmission.body.data.revision;
  const rejected = await request(`/api/v1/admin/product-revisions/${rejectedRevision.id}/review`, adminCookie, "PATCH", { decision: "REJECTED", reviewNote: "Public title needs correction.", version: rejectedRevision.version });
  assert(rejected.response.status === 200 && rejected.body.data.revision.status === "REJECTED", "Admin could not reject a seller revision.");
  const afterReject = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterReject.titleEn === "Moderated updated product" && afterReject.version === 2, "Rejected revision changed the live listing.");
  const audits = await prisma.auditLog.count({ where: { entityType: "ProductRevision", action: { in: ["seller.product_revision_submitted", "seller.product_revision_approved", "seller.product_revision_rejected"] } } });
  assert(audits >= 4, "Seller revision lifecycle was not fully audited.");
  console.log("Seller product revision verification passed: portal isolation, ownership, CSRF, restricted-goods publication gate, live-listing preservation, Admin moderation, atomic approval, rejection safety, optimistic versions, replay protection, and audit evidence.");
} finally {
  if (ids.users.length) await prisma.complianceScreeningAttempt.deleteMany({ where: { customerId: { in: ids.users } } });
  if (ids.products.length) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: "ProductRevision", metadata: { path: ["productId"], array_contains: ids.products } }, { entityType: "Product", entityId: { in: ids.products } }] } }).catch(() => undefined);
    await prisma.productRevision.deleteMany({ where: { productId: { in: ids.products } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  }
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
