import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for seller catalog import verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], sellers: [], products: [], imports: [], categories: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function createUser(label, roleId) {
  const user = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId } } } });
  ids.users.push(user.id); return user;
}

async function sessionFor(user, portal) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Catalog import verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

const headers = ["titleEn", "titleBn", "categorySlug", "shortDescription", "description", "highlights", "brand", "modelNumber", "sku", "priceBdt", "inventoryQuantity", "stockStatus", "weightGrams", "lengthMm", "widthMm", "heightMm", "minimumOrderQuantity", "productionLeadDaysMin", "productionLeadDaysMax", "sellingUnit", "packageContents", "sampleAvailable", "customizationAvailable", "returnPolicy", "warrantyInfo", "hsCode", "isInternationallyAvailable"];
const mapping = Object.fromEntries(headers.map((header) => [header, header]));
function productRow(title, sku, categorySlug) { return [title, "", categorySlug, "A complete short catalog summary.", "A complete product description suitable for worldwide customers.", "Durable construction|Export-ready packaging", "DeshDak QA", "MODEL-1", sku, "1250.50", "25", "IN_STOCK", "800", "300", "200", "100", "1", "2", "5", "piece", "One product and protective packaging", "yes", "no", "", "", "1234.56", "true"]; }

try {
  const [sellerRole, customerRole, adminRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { code: "seller" } }), prisma.role.findUniqueOrThrow({ where: { code: "customer_personal" } }), prisma.role.findUniqueOrThrow({ where: { code: "admin" } })]);
  const [sellerUser, otherSellerUser, customer, admin] = await Promise.all([createUser("import-seller", sellerRole.id), createUser("other-import-seller", sellerRole.id), createUser("import-customer", customerRole.id), createUser("import-admin", adminRole.id)]);
  const seller = await prisma.sellerProfile.create({ data: { userId: sellerUser.id, businessName: `Import Seller ${marker}`, storeSlug: `import-seller-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(seller.id);
  const otherSeller = await prisma.sellerProfile.create({ data: { userId: otherSellerUser.id, businessName: `Other Seller ${marker}`, storeSlug: `other-import-seller-${marker}`, status: "APPROVED", originCountryCode: "BD", shipsInternationally: true } }); ids.sellers.push(otherSeller.id);
  const category = await prisma.category.create({ data: { slug: `import-category-${marker}`, nameEn: "Import verification category", isActive: true } }); ids.categories.push(category.id);
  const [sellerCookie, wrongPortalCookie, otherSellerCookie, customerCookie, adminCookie] = await Promise.all([sessionFor(sellerUser, "seller"), sessionFor(sellerUser, "customer"), sessionFor(otherSellerUser, "seller"), sessionFor(customer, "customer"), sessionFor(admin, "admin")]);
  const validPayload = { originalFilename: "catalog.csv", headers, mapping, rows: [productRow(`Imported Product A ${marker}`, `IMPORT-A-${marker}`, category.slug), productRow(`Imported Product B ${marker}`, `IMPORT-B-${marker}`, category.slug)] };
  const manualProduct = await request("/api/v1/seller/products", sellerCookie, "POST", { titleEn: `Manual Regression ${marker}`, titleBn: "", categoryId: category.id, shortDescription: "A complete short catalog summary.", description: "A complete product description suitable for worldwide customers.", highlights: "Durable construction\nExport-ready packaging", brand: "DeshDak QA", modelNumber: "MODEL-1", sku: `MANUAL-${marker}`, priceBdt: 900, inventoryQuantity: 10, stockStatus: "IN_STOCK", weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 80, minimumOrderQuantity: 1, productionLeadDaysMin: 2, productionLeadDaysMax: 4, sellingUnit: "piece", packageContents: "One product and protective packaging", sampleAvailable: false, customizationAvailable: false, returnPolicy: "", warrantyInfo: "", hsCode: "1234.56", isInternationallyAvailable: true });
  assert(manualProduct.response.status === 201 && manualProduct.body.data.product.status === "PENDING_REVIEW", "Shared product-creation refactor broke manual seller submission.");
  ids.products.push(manualProduct.body.data.product.id);

  assert((await request("/api/v1/seller/catalog-imports", customerCookie, "POST", validPayload)).response.status === 403, "Customer accessed seller catalog imports.");
  assert((await request("/api/v1/seller/catalog-imports", wrongPortalCookie, "POST", validPayload)).response.status === 403, "Seller identity imported from the wrong portal.");
  const csrf = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", validPayload, false);
  assert(csrf.response.status === 403 && csrf.body.error.code === "UNTRUSTED_ORIGIN", "Catalog import preview bypassed browser-origin protection.");
  const badMapping = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", { ...validPayload, mapping: { titleEn: "titleEn" } });
  assert(badMapping.response.status === 422 && badMapping.body.error.code === "INVALID_COLUMN_MAPPING", "Incomplete column mapping was accepted.");

  const invalidRows = [productRow(`Invalid Product ${marker}`, `INVALID-${marker}`, category.slug)]; invalidRows[0][4] = "Use https://seller.example.invalid to bypass DeshDak."; invalidRows[0][9] = "-5";
  const invalidPreview = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", { ...validPayload, originalFilename: "invalid.csv", rows: invalidRows });
  assert(invalidPreview.response.status === 201 && invalidPreview.body.data.catalogImport.invalidRows === 1, "Invalid row was not reported in preview.");
  assert(invalidPreview.body.data.catalogImport.rows[0].validationErrors.some((item) => item.message.includes("External URLs")) && invalidPreview.body.data.catalogImport.rows[0].validationErrors.some((item) => item.message.includes("formulas")), "CSV URL/formula injection controls were not reported.");
  ids.imports.push(invalidPreview.body.data.catalogImport.id);
  const blocked = await request(`/api/v1/seller/catalog-imports/${invalidPreview.body.data.catalogImport.id}/confirm`, sellerCookie, "POST", { version: 1, confirmation: "IMPORT_VALIDATED_CATALOG" });
  assert(blocked.response.status === 409 && blocked.body.error.code === "CATALOG_IMPORT_HAS_ERRORS", "Import with invalid rows was partially confirmed.");

  const preview = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", validPayload);
  assert(preview.response.status === 201 && preview.body.data.catalogImport.validRows === 2 && preview.body.data.catalogImport.invalidRows === 0, `Valid preview failed: ${JSON.stringify(preview.body)}`);
  const importId = preview.body.data.catalogImport.id; ids.imports.push(importId);
  const repeatedPreview = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", validPayload);
  assert(repeatedPreview.response.status === 200 && repeatedPreview.body.data.reused === true && repeatedPreview.body.data.catalogImport.id === importId, "Retry created a duplicate active preview.");
  assert((await request(`/api/v1/seller/catalog-imports/${importId}/confirm`, otherSellerCookie, "POST", { version: 1, confirmation: "IMPORT_VALIDATED_CATALOG" })).response.status === 404, "Another seller accessed the import preview.");
  assert((await request(`/api/v1/seller/catalog-imports/${importId}/confirm`, wrongPortalCookie, "POST", { version: 1, confirmation: "IMPORT_VALIDATED_CATALOG" })).response.status === 403, "Wrong-portal seller confirmed the import.");
  assert((await request(`/api/v1/seller/catalog-imports/${importId}/confirm`, sellerCookie, "POST", { version: 99, confirmation: "IMPORT_VALIDATED_CATALOG" })).response.status === 409, "Stale preview version was confirmed.");
  const beforeCount = await prisma.product.count({ where: { sellerProfileId: seller.id } });
  const confirmed = await request(`/api/v1/seller/catalog-imports/${importId}/confirm`, sellerCookie, "POST", { version: 1, confirmation: "IMPORT_VALIDATED_CATALOG" });
  assert(confirmed.response.status === 200 && confirmed.body.data.products.length === 2, `Atomic catalog confirmation failed: ${JSON.stringify(confirmed.body)}`);
  const importedIds = confirmed.body.data.products.map((product) => product.id); ids.products.push(...importedIds);
  const importedProducts = await prisma.product.findMany({ where: { id: { in: importedIds } }, include: { catalogImportRow: true, variants: true } });
  assert(importedProducts.length === 2 && importedProducts.every((product) => product.status === "PENDING_REVIEW" && product.productCode && product.catalogImportRow?.status === "IMPORTED"), "Imported products did not enter the private Admin review queue with provenance.");
  assert(new Set(importedProducts.map((product) => product.productCode)).size === 2, "Imported products did not receive unique DeshDak codes.");
  const replay = await request(`/api/v1/seller/catalog-imports/${importId}/confirm`, sellerCookie, "POST", { version: 1, confirmation: "IMPORT_VALIDATED_CATALOG" });
  assert(replay.response.status === 200 && replay.body.data.alreadyCompleted === true, "Confirmation retry was not idempotent.");
  assert(await prisma.product.count({ where: { sellerProfileId: seller.id } }) === beforeCount + 2, "Confirmation retry duplicated imported products.");
  const duplicate = await request("/api/v1/seller/catalog-imports", sellerCookie, "POST", validPayload);
  assert(duplicate.response.status === 409 && duplicate.body.error.code === "CATALOG_FILE_ALREADY_IMPORTED", "An identical completed catalog was imported twice.");
  const sellerPage = await request("/seller/products/import", sellerCookie);
  assert(sellerPage.response.status === 200 && sellerPage.body.includes("Import products from CSV") && sellerPage.body.includes("catalog.csv"), "Seller import page or history did not render.");
  const adminPage = await request("/admin/products", adminCookie);
  assert(adminPage.response.status === 200 && adminPage.body.includes(`Imported Product A ${marker}`) && adminPage.body.includes(`Imported Product B ${marker}`), "Imported products were absent from Admin moderation.");
  const publicCatalog = await request("/api/v1/catalog/products");
  assert(publicCatalog.response.status === 200 && !publicCatalog.body.data.products.some((product) => ids.products.includes(product.id)), "Pending imported products leaked into the public catalog.");
  const audits = await prisma.auditLog.count({ where: { actorId: sellerUser.id, action: { in: ["seller.catalog_import_previewed", "seller.catalog_import_completed", "seller.product_submitted"] } } });
  assert(audits >= 5, "Catalog preview, confirmation, or product audit evidence is incomplete.");
  console.log("Seller catalog import verification passed: portal/ownership isolation, CSRF, strict mapping, row errors, no partial import, preview idempotency, stale-version protection, atomic confirmation, unique product codes, replay safety, duplicate-file prevention, Admin moderation, public privacy, and audit evidence.");
} finally {
  if (ids.sellers.length) await prisma.product.deleteMany({ where: { sellerProfileId: { in: ids.sellers } } });
  if (ids.imports.length) await prisma.sellerCatalogImport.deleteMany({ where: { id: { in: ids.imports } } });
  if (ids.sellers.length) await prisma.sellerProfile.deleteMany({ where: { id: { in: ids.sellers } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  await prisma.$disconnect();
}
