import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for coupon workflow verification.");
const marker = randomBytes(8).toString("hex").toUpperCase();
const ids = { users: [], sessions: [], coupons: [], orders: [], carts: [], products: [], categories: [], addresses: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, roles, portal, mfaVerified = false) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Coupon verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, token, method, body, headers = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, Cookie: `crossly_session=${token}; __Host-crossly_session=${token}`, ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : { error: { message: `Empty ${response.status} response` } } };
}

async function addCartItem(customerId, variantId) {
  const cart = await prisma.cart.upsert({ where: { userId_currency: { userId: customerId, currency: "BDT" } }, update: {}, create: { userId: customerId, currency: "BDT" } });
  if (!ids.carts.includes(cart.id)) ids.carts.push(cart.id);
  await prisma.cartItem.upsert({ where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variantId } }, update: { quantity: 2 }, create: { cartId: cart.id, productVariantId: variantId, quantity: 2 } });
  return cart.id;
}

const address = { label: "Home", fullName: "Coupon Customer", phone: "+8801700000000", addressLine1: "12 Verification Road", city: "Dhaka", district: "Dhaka", countryCode: "BD" };

try {
  const adminRole = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  const admin = await prisma.user.create({ data: { email: `coupon-admin-${marker.toLowerCase()}@example.test`, fullName: "Coupon Administrator", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  // Checkout now correctly requires phone and identity verification before pricing rules run.
  // Seed a verified customer so this suite can exercise the coupon gate itself.
  const customer = await prisma.user.create({ data: { email: `coupon-customer-${marker.toLowerCase()}@example.test`, fullName: "Coupon Customer", passwordHash: "not-used", status: "ACTIVE", phone: "+8801700000000", phoneVerifiedAt: new Date(), kycStatus: "VERIFIED", roles: { create: { roleId: customerRole.id } } } });
  ids.users.push(admin.id, customer.id);
  const [adminToken, customerToken] = await Promise.all([sessionFor(admin, ["admin"], "admin", true), sessionFor(customer, ["customer_personal"], "customer")]);

  const category = await prisma.category.create({ data: { slug: `coupon-${marker.toLowerCase()}`, nameEn: "Coupon verification", isActive: true } }); ids.categories.push(category.id);
  const product = await prisma.product.create({ data: { titleEn: "Coupon verification product", status: "ACTIVE", categoryId: category.id, originCountryCode: "CN", variants: { create: { sku: `COUPON-${marker}`, priceBdt: 500, stockStatus: "IN_STOCK" } } }, include: { variants: true } }); ids.products.push(product.id);
  const variant = product.variants[0];
  const cartId = await addCartItem(customer.id, variant.id);

  const couponPayload = { code: `SAVE10-${marker}`, name: "Ten percent verification", description: "Automated test coupon", discountType: "PERCENTAGE", discountValue: 10, minimumOrderAmount: 500, maximumDiscount: 150, totalUsageLimit: 10, perCustomerLimit: 1, perDayLimit: 5, eligibleAccountType: "PERSONAL", firstOrderOnly: false, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() };
  const unauthorized = await request("/api/v1/admin/coupons", customerToken, "POST", couponPayload); assert(unauthorized.response.status === 403, "Customer created an Admin coupon.");
  const created = await request("/api/v1/admin/coupons", adminToken, "POST", couponPayload); assert(created.response.status === 201 && created.body.data.coupon.status === "DRAFT", `Coupon draft creation failed: ${JSON.stringify(created.body)}`); ids.coupons.push(created.body.data.coupon.id);

  const checkoutPayload = { cartId, saveAddress: true, address, couponCode: couponPayload.code };
  const draftCheckout = await request("/api/v1/orders", customerToken, "POST", checkoutPayload, { "Idempotency-Key": `draft-checkout-${marker}` });
  assert(draftCheckout.response.status === 409 && draftCheckout.body.error?.code === "COUPON_NOT_ACTIVE", "Draft coupon was accepted at checkout.");
  const activated = await request(`/api/v1/admin/coupons/${created.body.data.coupon.id}`, adminToken, "PATCH", { status: "ACTIVE", version: 1 }); assert(activated.response.status === 200 && activated.body.data.coupon.status === "ACTIVE", "Coupon activation failed.");

  const key = `coupon-checkout-${marker}`;
  const checkout = await request("/api/v1/orders", customerToken, "POST", checkoutPayload, { "Idempotency-Key": key });
  assert(checkout.response.status === 201 && checkout.body.data.order.grandTotal === "900", `Percentage coupon checkout failed: ${JSON.stringify(checkout.body)}`); ids.orders.push(checkout.body.data.order.id);
  const replay = await request("/api/v1/orders", customerToken, "POST", checkoutPayload, { "Idempotency-Key": key }); assert(replay.response.status === 200 && replay.body.data.idempotentReplay === true && replay.body.data.order.id === checkout.body.data.order.id, "Identical coupon checkout did not replay safely.");
  assert(await prisma.address.count({ where: { userId: customer.id, deletedAt: null } }) === 1, "Idempotent checkout replay duplicated a saved address.");
  const mismatch = await request("/api/v1/orders", customerToken, "POST", { ...checkoutPayload, address: { ...address, city: "Chattogram" } }, { "Idempotency-Key": key }); assert(mismatch.response.status === 409 && mismatch.body.error?.code === "IDEMPOTENCY_KEY_REUSED", "Changed checkout payload reused an idempotency key.");

  const saved = await prisma.order.findUniqueOrThrow({ where: { id: checkout.body.data.order.id }, include: { couponRedemption: true } });
  assert(saved.productTotal.toString() === "1000" && saved.discountTotal.toString() === "100" && saved.grandTotal.toString() === "900", "Order did not preserve the coupon financial breakdown.");
  assert(saved.couponRedemption?.couponCodeSnapshot === couponPayload.code && saved.couponRedemption.discountAmount.toString() === "100", "Immutable redemption evidence was not stored.");
  assert((await prisma.coupon.findUniqueOrThrow({ where: { id: created.body.data.coupon.id } })).redeemedCount === 1, "Coupon redemption counter is incorrect.");

  await addCartItem(customer.id, variant.id);
  const limited = await request("/api/v1/orders", customerToken, "POST", checkoutPayload, { "Idempotency-Key": `coupon-limit-${marker}` });
  assert(limited.response.status === 409 && limited.body.error?.code === "COUPON_CUSTOMER_LIMIT_REACHED", "Per-customer coupon limit was bypassed.");

  const fixedPayload = { ...couponPayload, code: `FIXED75-${marker}`, name: "Fixed amount verification", discountType: "FIXED_AMOUNT", discountValue: 75, maximumDiscount: "", totalUsageLimit: 2, perDayLimit: 2 };
  const fixedDraft = await request("/api/v1/admin/coupons", adminToken, "POST", fixedPayload); assert(fixedDraft.response.status === 201, "Fixed coupon draft creation failed."); ids.coupons.push(fixedDraft.body.data.coupon.id);
  assert((await request(`/api/v1/admin/coupons/${fixedDraft.body.data.coupon.id}`, adminToken, "PATCH", { status: "ACTIVE", version: 1 })).response.status === 200, "Fixed coupon activation failed.");
  const fixedCheckout = await request("/api/v1/orders", customerToken, "POST", { ...checkoutPayload, address: { ...address, label: "Office", addressLine1: "34 Verification Avenue" }, couponCode: fixedPayload.code }, { "Idempotency-Key": `fixed-checkout-${marker}` });
  assert(fixedCheckout.response.status === 201 && fixedCheckout.body.data.order.grandTotal === "925", `Fixed coupon checkout failed: ${JSON.stringify(fixedCheckout.body)}`); ids.orders.push(fixedCheckout.body.data.order.id);
  const checkoutAddresses = await prisma.address.findMany({ where: { userId: customer.id, deletedAt: null }, select: { id: true, addressLine1: true } });
  ids.addresses.push(...checkoutAddresses.map((savedAddress) => savedAddress.id));
  assert(checkoutAddresses.length === 2 && checkoutAddresses.some((savedAddress) => savedAddress.addressLine1 === "34 Verification Avenue"), "Checkout did not retain a distinct second address in the same country.");
  console.log("Coupon workflow verification passed: Admin RBAC, draft activation gate, percentage and fixed calculations, immutable redemption evidence, payload-bound checkout replay, non-duplicating saved addresses, audit-ready totals, and serialized usage-limit abuse controls.");
} finally {
  if (ids.orders.length) { await prisma.couponRedemption.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.carts.length) { await prisma.cartItem.deleteMany({ where: { cartId: { in: ids.carts } } }); await prisma.cart.deleteMany({ where: { id: { in: ids.carts } } }); }
  if (ids.users.length) await prisma.address.deleteMany({ where: { userId: { in: ids.users } } });
  if (ids.coupons.length) { await prisma.auditLog.deleteMany({ where: { entityType: "Coupon", entityId: { in: ids.coupons } } }); await prisma.coupon.deleteMany({ where: { id: { in: ids.coupons } } }); }
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
