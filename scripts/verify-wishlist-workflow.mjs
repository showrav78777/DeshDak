import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for wishlist verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [], products: [], categories: [], wishlistItems: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, roles = ["customer_personal"]) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal: "customer", clientName: "Wishlist verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function call(path, { cookie, method = "GET", body, trustedOrigin = true } = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(trustedOrigin && method !== "GET" ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  async function user(label, customer = true) {
    const created = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", ...(customer ? { roles: { create: { roleId: customerRole.id } } } : {}) } });
    ids.users.push(created.id);
    return created;
  }
  const owner = await user("wishlist-owner");
  const foreign = await user("wishlist-foreign");
  const nonCustomer = await user("wishlist-staff", false);
  const sellerUser = await user("wishlist-seller", false);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Wishlist Store ${marker}`, storeSlug: `wishlist-store-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } });
  ids.sellers.push(seller.id);
  const category = await prisma.category.create({ data: { slug: `wishlist-${marker}`, nameEn: "Wishlist verification", isActive: true } });
  ids.categories.push(category.id);
  async function product(label) {
    const created = await prisma.product.create({ data: { titleEn: `${label} ${marker}`, status: "ACTIVE", complianceStatus: "CLEAR", categoryId: category.id, sellerProfileId: seller.id, originCountryCode: "BD", isInternationallyAvailable: true, variants: { create: { sku: `WISH-${label}-${marker}`, priceBdt: 350, inventoryQuantity: 5, stockStatus: "IN_STOCK" } } } });
    ids.products.push(created.id);
    return created;
  }
  const firstProduct = await product("Wishlist Product One");
  const secondProduct = await product("Wishlist Product Two");
  const [ownerCookie, foreignCookie, nonCustomerCookie] = await Promise.all([sessionFor(owner), sessionFor(foreign), sessionFor(nonCustomer, [])]);

  assert((await call("/api/v1/wishlist")).response.status === 401, "Anonymous visitor accessed a private wishlist.");
  assert((await call("/api/v1/wishlist", { cookie: nonCustomerCookie })).response.status === 403, "A non-customer account accessed wishlist data.");
  const untrusted = await call("/api/v1/wishlist/items", { cookie: ownerCookie, method: "POST", trustedOrigin: false, body: { productId: firstProduct.id } });
  assert(untrusted.response.status === 403 && untrusted.body.error.code === "UNTRUSTED_ORIGIN", "Wishlist mutation accepted an untrusted browser origin.");
  const missing = await call("/api/v1/wishlist/items", { cookie: ownerCookie, method: "POST", body: { productId: "00000000-0000-4000-8000-000000000000" } });
  assert(missing.response.status === 404 && missing.body.error.code === "PRODUCT_NOT_FOUND", "Wishlist accepted a nonexistent product.");

  const added = await call("/api/v1/wishlist/items", { cookie: ownerCookie, method: "POST", body: { productId: firstProduct.id } });
  assert(added.response.status === 201 && added.body.data.item.productId === firstProduct.id && added.body.data.idempotentReplay === false, `Wishlist add failed: ${JSON.stringify(added.body)}`);
  ids.wishlistItems.push(added.body.data.item.id);
  const replay = await call("/api/v1/wishlist/items", { cookie: ownerCookie, method: "POST", body: { productId: firstProduct.id } });
  assert(replay.response.status === 200 && replay.body.data.item.id === added.body.data.item.id && replay.body.data.idempotentReplay === true, "Repeated wishlist add was not idempotent.");
  const second = await call("/api/v1/wishlist/items", { cookie: ownerCookie, method: "POST", body: { productId: secondProduct.id } });
  assert(second.response.status === 201, "Second wishlist product could not be saved.");
  ids.wishlistItems.push(second.body.data.item.id);

  const list = await call("/api/v1/wishlist?page=1&pageSize=1", { cookie: ownerCookie });
  assert(list.response.status === 200 && list.body.data.items.length === 1 && list.body.data.meta.total === 2 && list.body.data.meta.hasNextPage === true, "Wishlist pagination or total is incorrect.");
  assert(!("userId" in list.body.data.items[0]) && !("sellerProfileId" in list.body.data.items[0].product), "Wishlist response exposed internal owner or seller keys.");
  const foreignRemove = await call(`/api/v1/wishlist/items/${firstProduct.id}`, { cookie: foreignCookie, method: "DELETE" });
  assert(foreignRemove.response.status === 200 && foreignRemove.body.data.removed === false && await prisma.wishlistItem.count({ where: { userId: owner.id, productId: firstProduct.id } }) === 1, "Another customer removed the owner's wishlist item.");

  await prisma.sellerProfile.update({ where: { id: seller.id }, data: { status: "SUSPENDED" } });
  const hidden = await call("/api/v1/wishlist", { cookie: ownerCookie });
  assert(hidden.response.status === 200 && hidden.body.data.items.length === 0 && hidden.body.data.meta.total === 0, "Suspended-seller products remained visible in wishlist.");
  const blocked = await call("/api/v1/wishlist/items", { cookie: foreignCookie, method: "POST", body: { productId: firstProduct.id } });
  assert(blocked.response.status === 404 && blocked.body.error.code === "PRODUCT_NOT_FOUND", "Suspended-seller product could be newly wishlisted.");
  const removeHidden = await call(`/api/v1/wishlist/items/${firstProduct.id}`, { cookie: ownerCookie, method: "DELETE" });
  assert(removeHidden.response.status === 200 && removeHidden.body.data.removed === true, "Customer could not remove a now-hidden saved product.");
  const removeAgain = await call(`/api/v1/wishlist/items/${firstProduct.id}`, { cookie: ownerCookie, method: "DELETE" });
  assert(removeAgain.response.status === 200 && removeAgain.body.data.removed === false, "Repeated wishlist removal was not idempotent.");

  console.log("Wishlist verification passed: authentication, customer access, trusted origin, public visibility, idempotent save/removal, pagination, privacy, and ownership isolation.");
} finally {
  if (ids.users.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  if (ids.wishlistItems.length || ids.users.length) await prisma.wishlistItem.deleteMany({ where: { OR: [{ id: { in: ids.wishlistItems } }, { userId: { in: ids.users } }] } });
  if (ids.products.length) { await prisma.productVariant.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); }
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
