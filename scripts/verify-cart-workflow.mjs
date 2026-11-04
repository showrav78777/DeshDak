import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for cart verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [], products: [], categories: [], carts: [], addresses: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal: "customer", clientName: "Cart verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function call(path, { cookie, method = "GET", body, trustedOrigin = true } = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(trustedOrigin && method !== "GET" ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  async function customer(label) { const user = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } }); ids.users.push(user.id); return user; }
  const owner = await customer("cart-owner");
  const foreign = await customer("cart-foreign");
  const sellerUser = await prisma.user.create({ data: { email: `cart-seller-${marker}@example.test`, fullName: `Cart Seller ${marker}`, passwordHash: "not-used", status: "ACTIVE" } }); ids.users.push(sellerUser.id);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Cart Store ${marker}`, storeSlug: `cart-store-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(seller.id);
  const category = await prisma.category.create({ data: { slug: `cart-${marker}`, nameEn: "Cart verification", isActive: true } }); ids.categories.push(category.id);
  const product = await prisma.product.create({ data: { titleEn: `Cart Product ${marker}`, status: "ACTIVE", categoryId: category.id, sellerProfileId: seller.id, originCountryCode: "BD", isInternationallyAvailable: true, variants: { create: { sku: `CART-${marker}`, priceBdt: 250, inventoryQuantity: 3, stockStatus: "IN_STOCK" } } }, include: { variants: true } }); ids.products.push(product.id);
  const variantId = product.variants[0].id;
  const [ownerCookie, foreignCookie] = await Promise.all([sessionFor(owner), sessionFor(foreign)]);

  assert((await call("/api/v1/cart")).response.status === 401, "Anonymous visitor accessed a private cart.");
  const untrusted = await call("/api/v1/cart/items", { cookie: ownerCookie, method: "POST", trustedOrigin: false, body: { productVariantId: variantId, quantity: 2 } });
  assert(untrusted.response.status === 403 && untrusted.body.error.code === "UNTRUSTED_ORIGIN", "Cart mutation accepted an untrusted browser origin.");
  const added = await call("/api/v1/cart/items", { cookie: ownerCookie, method: "POST", body: { productVariantId: variantId, quantity: 2 } });
  assert(added.response.status === 201 && added.body.data.cart.itemCount === 2 && added.body.data.cart.subtotal === "500.00", `Cart item add failed: ${JSON.stringify(added.body)}`);
  ids.carts.push(added.body.data.cart.id);
  const itemId = added.body.data.itemId;
  const savedAddresses = await Promise.all([
    prisma.address.create({ data: { userId: owner.id, label: "Home checkout", fullName: owner.fullName, phone: "+8801700000000", addressLine1: "1 Home Road", city: "Dhaka", district: "Dhaka", countryCode: "BD", isDefault: true } }),
    prisma.address.create({ data: { userId: owner.id, label: "Office checkout", fullName: owner.fullName, phone: "+8801800000000", addressLine1: "2 Office Road", city: "Dhaka", district: "Dhaka", countryCode: "BD" } }),
    prisma.address.create({ data: { userId: owner.id, label: "Unavailable foreign", fullName: owner.fullName, phone: "+12025550123", addressLine1: "3 Foreign Road", city: "New York", district: "New York", countryCode: "US" } }),
  ]);
  ids.addresses.push(...savedAddresses.map((address) => address.id));
  const checkoutPage = await call("/checkout", { cookie: ownerCookie });
  assert(checkoutPage.response.status === 200 && typeof checkoutPage.body === "string" && checkoutPage.body.includes("Choose a saved address") && checkoutPage.body.includes("Home checkout") && checkoutPage.body.includes("Office checkout"), "Checkout did not render eligible saved addresses.");
  assert(!checkoutPage.body.includes("Unavailable foreign"), "Checkout exposed a saved address outside the current fulfillment countries.");
  assert((await call(`/api/v1/cart/items/${itemId}`, { cookie: foreignCookie, method: "PATCH", body: { quantity: 1 } })).response.status === 404, "Another customer changed the cart item.");
  const inventoryBlocked = await call(`/api/v1/cart/items/${itemId}`, { cookie: ownerCookie, method: "PATCH", body: { quantity: 4 } });
  assert(inventoryBlocked.response.status === 409 && inventoryBlocked.body.error.code === "INSUFFICIENT_INVENTORY", "Cart quantity exceeded current inventory.");
  const updated = await call(`/api/v1/cart/items/${itemId}`, { cookie: ownerCookie, method: "PATCH", body: { quantity: 3 } });
  assert(updated.response.status === 200 && updated.body.data.cart.itemCount === 3 && updated.body.data.cart.subtotal === "750.00", "Cart quantity update failed.");

  await prisma.sellerProfile.update({ where: { id: seller.id }, data: { status: "SUSPENDED" } });
  const unavailable = await call("/api/v1/cart", { cookie: ownerCookie });
  assert(unavailable.response.status === 200 && unavailable.body.data.cart.hasUnavailableItems && unavailable.body.data.cart.items[0].isAvailable === false && unavailable.body.data.cart.subtotal === "0.00", "Suspended seller inventory remained available in an existing cart.");
  const blockedAdd = await call("/api/v1/cart/items", { cookie: ownerCookie, method: "POST", body: { productVariantId: variantId, quantity: 1 } });
  assert(blockedAdd.response.status === 409 && blockedAdd.body.error.code === "PRODUCT_OPTION_UNAVAILABLE", "Suspended seller inventory could still be added to cart.");
  await prisma.sellerProfile.update({ where: { id: seller.id }, data: { status: "APPROVED" } });

  assert((await call(`/api/v1/cart/items/${itemId}`, { cookie: foreignCookie, method: "DELETE" })).response.status === 404, "Another customer removed the cart item.");
  const removed = await call(`/api/v1/cart/items/${itemId}`, { cookie: ownerCookie, method: "DELETE" });
  assert(removed.response.status === 200 && removed.body.data.cart.itemCount === 0 && removed.body.data.cart.items.length === 0, "Cart item removal failed.");
  console.log("Cart verification passed: authentication, trusted origin, ownership isolation, checkout address eligibility, inventory limits, totals, suspended-seller blocking, update, and removal.");
} finally {
  if (ids.carts.length) { await prisma.cartItem.deleteMany({ where: { cartId: { in: ids.carts } } }); await prisma.cart.deleteMany({ where: { id: { in: ids.carts } } }); }
  if (ids.addresses.length) await prisma.address.deleteMany({ where: { id: { in: ids.addresses } } });
  if (ids.products.length) { await prisma.productVariant.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); }
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
