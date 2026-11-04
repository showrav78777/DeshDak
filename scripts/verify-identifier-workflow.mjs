import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for identifier workflow verification.");

const marker = randomBytes(10).toString("hex").toUpperCase();
const productCode = `PRD-${marker}`;
const pendingProductCode = `PRD-${randomBytes(10).toString("hex").toUpperCase()}`;
const orderNumber = `ORD-${randomBytes(10).toString("hex").toUpperCase()}`;
const ids = { users: [], sessions: [], products: [], order: undefined, category: undefined, sellerProfile: undefined };

function assert(condition, message) { if (!condition) throw new Error(message); }

async function sessionFor(user, portal = "customer") {
  const created = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Identifier workflow verification", clientType: "WEB", expiresAt: new Date(Date.now() + 60 * 60_000) } });
  ids.sessions.push(created.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: ["customer_personal"] }).setProtectedHeader({ alg: "HS256" }).setJti(created.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function get(path, cookie, redirect = "follow") {
  return fetch(`${origin}${path}`, { headers: cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}, redirect });
}

try {
  const role = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  const sellerRole = await prisma.role.upsert({ where: { code: "seller" }, update: {}, create: { code: "seller", description: "Bangladesh seller" } });
  const category = await prisma.category.create({ data: { slug: `identifier-${marker.toLowerCase()}`, nameEn: "Identifier verification", isActive: true } }); ids.category = category.id;
  const product = await prisma.product.create({ data: { productCode, titleEn: "Public identifier verification product", status: "ACTIVE", categoryId: category.id, variants: { create: { sku: `SKU-${marker}`, priceBdt: 125, inventoryQuantity: 5, stockStatus: "IN_STOCK" } } } }); ids.products.push(product.id);
  const owner = await prisma.user.create({ data: { email: `identifier-owner-${marker}@example.test`, fullName: "Identifier Owner", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(owner.id);
  const stranger = await prisma.user.create({ data: { email: `identifier-stranger-${marker}@example.test`, fullName: "Identifier Stranger", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(stranger.id);
  const seller = await prisma.user.create({ data: { email: `identifier-seller-${marker}@example.test`, fullName: "Identifier Seller", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: sellerRole.id } } } }); ids.users.push(seller.id);
  const sellerProfile = await prisma.sellerProfile.create({ data: { userId: seller.id, businessName: "Identifier Seller Store", storeSlug: `identifier-seller-${marker.toLowerCase()}`, status: "APPROVED" } }); ids.sellerProfile = sellerProfile.id;
  const pendingProduct = await prisma.product.create({ data: { productCode: pendingProductCode, titleEn: "Private seller identifier verification product", status: "PENDING_REVIEW", categoryId: category.id, sellerProfileId: sellerProfile.id, originCountryCode: "BD", variants: { create: { sku: `SELLER-SKU-${marker}`, priceBdt: 250, inventoryQuantity: 2, stockStatus: "IN_STOCK" } } } }); ids.products.push(pendingProduct.id);
  const ownerCookie = await sessionFor(owner);
  const strangerCookie = await sessionFor(stranger);
  const sellerCookie = await sessionFor(seller, "seller");
  const order = await prisma.order.create({ data: { orderNumber, customerId: owner.id, status: "PENDING_PAYMENT", grandTotal: 125 } }); ids.order = order.id;

  const productLookup = await get(`/api/v1/identifiers/products/${productCode}`);
  const productBody = await productLookup.json();
  assert(productLookup.status === 200 && productBody.data.product.productCode === productCode, "Approved product code lookup failed.");
  assert(!JSON.stringify(productBody).includes(owner.email), "Product lookup exposed customer data.");

  const exactSearch = await get(`/api/v1/catalog/products?q=${productCode}`);
  const searchBody = await exactSearch.json();
  assert(exactSearch.status === 200 && searchBody.data.products.length === 1 && searchBody.data.products[0].productCode === productCode, "Exact product-code search failed.");

  for (const kind of ["qr", "barcode"]) {
    const asset = await get(`/api/v1/identifiers/products/${productCode}/${kind}`);
    const svg = await asset.text();
    assert(asset.status === 200 && asset.headers.get("content-type")?.startsWith("image/svg+xml") && svg.startsWith("<svg"), `Public product ${kind} SVG failed.`);
    assert(asset.headers.get("cache-control")?.startsWith("public"), `Public product ${kind} is not cacheable.`);
    assert(!svg.includes(product.id) && !svg.includes(owner.email), `Public product ${kind} exposed private/internal data.`);
  }

  const anonymousPending = await get(`/api/v1/identifiers/products/${pendingProductCode}`);
  assert(anonymousPending.status === 404, "An anonymous visitor resolved a pending seller product.");
  const sellerPending = await get(`/api/v1/identifiers/products/${pendingProductCode}`, sellerCookie);
  const sellerPendingBody = await sellerPending.json();
  assert(sellerPending.status === 200 && sellerPendingBody.data.product.productCode === pendingProductCode, "Seller could not resolve their pending product code.");
  for (const kind of ["qr", "barcode"]) {
    const asset = await get(`/api/v1/identifiers/products/${pendingProductCode}/${kind}`, sellerCookie);
    assert(asset.status === 200 && asset.headers.get("cache-control") === "private, no-store, max-age=0", `Pending seller product ${kind} was not private.`);
  }

  const anonymousOrder = await get(`/api/v1/identifiers/orders/${orderNumber}`);
  assert(anonymousOrder.status === 401, "Anonymous order-code lookup was not rejected.");
  const strangerOrder = await get(`/api/v1/identifiers/orders/${orderNumber}`, strangerCookie);
  assert(strangerOrder.status === 404, "Unrelated customer learned that an order code exists.");
  const ownerOrder = await get(`/api/v1/identifiers/orders/${orderNumber}`, ownerCookie);
  const ownerOrderBody = await ownerOrder.json();
  assert(ownerOrder.status === 200 && ownerOrderBody.data.order.orderNumber === orderNumber, "Order owner could not resolve their order code.");
  assert(!JSON.stringify(ownerOrderBody).includes(owner.email), "Order identifier response exposed customer PII.");

  for (const kind of ["qr", "barcode"]) {
    const asset = await get(`/api/v1/identifiers/orders/${orderNumber}/${kind}`, ownerCookie);
    const svg = await asset.text();
    assert(asset.status === 200 && svg.startsWith("<svg"), `Authorized order ${kind} SVG failed.`);
    assert(asset.headers.get("cache-control") === "private, no-store, max-age=0", `Private order ${kind} could be cached.`);
    assert(!svg.includes(order.id) && !svg.includes(owner.email), `Order ${kind} exposed internal or personal data.`);
  }

  const publicScan = await get(`/scan/products/${productCode}`, undefined, "manual");
  assert([307, 308].includes(publicScan.status) && publicScan.headers.get("location")?.endsWith(`/products/${product.id}`), "Public product scan did not resolve safely.");
  const anonymousScan = await get(`/scan/orders/${orderNumber}`, undefined, "manual");
  assert([307, 308].includes(anonymousScan.status) && anonymousScan.headers.get("location")?.includes("/login?next="), "Anonymous order scan did not require login.");
  const ownerScan = await get(`/scan/orders/${orderNumber}`, ownerCookie, "manual");
  assert([307, 308].includes(ownerScan.status) && ownerScan.headers.get("location")?.endsWith(`/orders/${order.id}`), "Authorized order scan did not resolve to the owner view.");
  const strangerScan = await get(`/scan/orders/${orderNumber}`, strangerCookie, "manual");
  assert(strangerScan.status === 404, "Unrelated customer resolved a private order scan.");

  const productPage = await get(`/products/${product.id}`);
  const productPageHtml = await productPage.text();
  assert(productPage.status === 200 && productPageHtml.includes(productCode) && productPageHtml.includes("QR &amp; barcode"), "Public product page did not render its identifiers.");
  const productPrint = await get(`/print/products/${productCode}`);
  const productPrintHtml = await productPrint.text();
  assert(productPrint.status === 200 && productPrintHtml.includes(productCode) && productPrintHtml.includes("identifier-print-sheet"), "Public 80 mm product print view failed.");
  const anonymousPendingPrint = await get(`/print/products/${pendingProductCode}`);
  assert(anonymousPendingPrint.status === 404, "Anonymous visitor opened a pending seller product print view.");
  const sellerPendingPrint = await get(`/print/products/${pendingProductCode}`, sellerCookie);
  assert(sellerPendingPrint.status === 200 && (await sellerPendingPrint.text()).includes(pendingProductCode), "Seller could not print their pending product identifiers.");
  const anonymousOrderPrint = await get(`/print/orders/${orderNumber}`, undefined, "manual");
  assert([307, 308].includes(anonymousOrderPrint.status) && anonymousOrderPrint.headers.get("location")?.includes("/login?next="), "Anonymous order print did not require login.");
  const ownerOrderPrint = await get(`/print/orders/${orderNumber}`, ownerCookie);
  const ownerOrderPrintHtml = await ownerOrderPrint.text();
  assert(ownerOrderPrint.status === 200 && ownerOrderPrintHtml.includes(orderNumber) && ownerOrderPrintHtml.includes("identifier-print-sheet"), "Order owner could not open the 80 mm print view.");

  console.log("Identifier workflow verification passed: public and seller-private product assets, secure order ownership, scan redirects, page rendering, and protected 80 mm print views.");
} finally {
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.order) await prisma.order.deleteMany({ where: { id: ids.order } });
  if (ids.products.length) await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  if (ids.sellerProfile) await prisma.sellerProfile.deleteMany({ where: { id: ids.sellerProfile } });
  if (ids.category) await prisma.category.deleteMany({ where: { id: ids.category } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.$disconnect();
}
