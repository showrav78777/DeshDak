import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET is required for restricted-goods verification.");
const marker = randomBytes(8).toString("hex").toUpperCase();
const phrase = `risk ${marker}`;
const ids = { users: [], sessions: [], rules: [], screenings: [], products: [], categories: [], carts: [], orders: [], maintenanceRuns: [] };
const address = { label: "Home", fullName: "Compliance Customer", phone: "+8801700000000", addressLine1: "12 Verification Road", city: "Dhaka", district: "Dhaka", countryCode: "BD" };

async function sessionFor(user, portal, mfaVerified = true) { const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Compliance verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } }); ids.sessions.push(row.id); return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)); }
async function call(path, token, method = "GET", body, headers = {}) { const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { Origin: origin } : {}), ...(token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" }); const text = await response.text(); return { response, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text }; }
async function addToCart(customerId, variantId) { const cart = await prisma.cart.upsert({ where: { userId_currency: { userId: customerId, currency: "BDT" } }, update: {}, create: { userId: customerId, currency: "BDT" } }); if (!ids.carts.includes(cart.id)) ids.carts.push(cart.id); await prisma.cartItem.upsert({ where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variantId } }, update: { quantity: 1 }, create: { cartId: cart.id, productVariantId: variantId, quantity: 1 } }); return cart.id; }

try {
  const adminRole = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  const complianceRole = await prisma.role.upsert({ where: { code: "compliance" }, update: {}, create: { code: "compliance", description: "Compliance review officer" } });
  const admin = await prisma.user.create({ data: { email: `compliance-admin-${marker.toLowerCase()}@example.test`, fullName: "Compliance Administrator", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  const customer = await prisma.user.create({ data: { email: `compliance-customer-${marker.toLowerCase()}@example.test`, fullName: "Compliance Customer", passwordHash: "not-used", status: "ACTIVE", phone: "+8801700000000", phoneVerifiedAt: new Date(), kycStatus: "VERIFIED", roles: { create: { roleId: customerRole.id } } } });
  const reviewer = await prisma.user.create({ data: { email: `compliance-reviewer-${marker.toLowerCase()}@example.test`, fullName: "Compliance Reviewer", passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: complianceRole.id } } } });
  ids.users.push(admin.id, customer.id, reviewer.id);
  const [adminToken, customerToken, reviewerToken, unverifiedReviewerToken] = await Promise.all([sessionFor(admin, "admin"), sessionFor(customer, "customer"), sessionFor(reviewer, "compliance"), sessionFor(reviewer, "compliance", false)]);
  assert.equal((await call("/api/v1/compliance/screenings", unverifiedReviewerToken)).response.status, 403, "Compliance queue was accessible before MFA.");
  const category = await prisma.category.create({ data: { slug: `compliance-${marker.toLowerCase()}`, nameEn: "Compliance verification", isActive: true } }); ids.categories.push(category.id);
  const product = await prisma.product.create({ data: { titleEn: `pre${phrase.replace(" ", "")}post`, status: "ACTIVE", categoryId: category.id, originCountryCode: "CN", variants: { create: { sku: `CMP-${marker}`, priceBdt: 500, stockStatus: "IN_STOCK" } } }, include: { variants: true } }); ids.products.push(product.id);
  const cartId = await addToCart(customer.id, product.variants[0].id);
  const rulePayload = { ruleCode: `CMP-${marker}`, name: "Manual compliance verification", customerMessage: "This product requires a compliance review before checkout can continue.", action: "MANUAL_REVIEW", keywords: [phrase], hsCodePrefixes: [], originCountryCode: "", destinationCountryCode: "", legalReference: "Automated verification only" };
  assert((await call("/api/v1/admin/compliance/rules", customerToken, "POST", rulePayload)).response.status === 403, "Customer created a compliance rule.");
  assert((await call("/api/v1/admin/compliance/rules", reviewerToken, "POST", rulePayload)).response.status === 403, "Compliance reviewer changed Admin-owned rules.");
  const withoutOrigin = await fetch(`${origin}/api/v1/admin/compliance/rules`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `crossly_session=${adminToken}; __Host-crossly_session=${adminToken}` }, body: JSON.stringify(rulePayload) }); assert.equal(withoutOrigin.status, 403, "Admin mutation accepted a missing Origin header.");
  const draft = await call("/api/v1/admin/compliance/rules", adminToken, "POST", rulePayload); assert.equal(draft.response.status, 201, `Rule creation failed: ${JSON.stringify(draft.body)}`); ids.rules.push(draft.body.data.rule.id);
  const active = await call(`/api/v1/admin/compliance/rules/${ids.rules[0]}`, adminToken, "PATCH", { status: "ACTIVE", version: 1 }); assert.equal(active.response.status, 200, "Rule activation failed.");
  const clearCheckout = await call("/api/v1/orders", customerToken, "POST", { cartId, saveAddress: false, address }, { "Idempotency-Key": `boundary-${marker}` }); assert.equal(clearCheckout.response.status, 201, `Phrase-boundary-safe checkout failed: ${JSON.stringify(clearCheckout.body)}`); ids.orders.push(clearCheckout.body.data.order.id);
  await prisma.product.update({ where: { id: product.id }, data: { titleEn: `Product with ${phrase}` } }); await addToCart(customer.id, product.variants[0].id);
  const flagged = await call("/api/v1/orders", customerToken, "POST", { cartId, saveAddress: false, address }, { "Idempotency-Key": `review-${marker}` }); assert.equal(flagged.response.status, 409, "Ambiguous product was not held for review."); assert.equal(flagged.body.error?.code, "COMPLIANCE_REVIEW_REQUIRED"); ids.screenings.push(flagged.body.error.details.screeningReference);
  const queue = await call("/api/v1/compliance/screenings", reviewerToken); assert.equal(queue.response.status, 200, "MFA-verified Compliance reviewer could not open the queue."); assert(queue.body.data.screenings.some((item) => item.id === ids.screenings[0]), "Flagged screening was absent from the Compliance queue.");
  const decision = await call(`/api/v1/compliance/screenings/${ids.screenings[0]}`, reviewerToken, "PATCH", { decision: "APPROVED", note: "Verified for this exact customer, route, product, and active rule version.", version: 1 }); assert.equal(decision.response.status, 200, "Compliance officer approval failed.");
  const approvedRetry = await call("/api/v1/orders", customerToken, "POST", { cartId, saveAddress: false, address }, { "Idempotency-Key": `approved-${marker}` }); assert.equal(approvedRetry.response.status, 201, `Approved exact retry did not continue: ${JSON.stringify(approvedRetry.body)}`); ids.orders.push(approvedRetry.body.data.order.id);
  const blockPayload = { ...rulePayload, ruleCode: `BLOCK-${marker}`, name: "Hard block verification", action: "BLOCK", customerMessage: "This product cannot be ordered or shipped under the current rules." };
  const hardDraft = await call("/api/v1/admin/compliance/rules", adminToken, "POST", blockPayload); assert.equal(hardDraft.response.status, 201); ids.rules.push(hardDraft.body.data.rule.id); assert.equal((await call(`/api/v1/admin/compliance/rules/${ids.rules[1]}`, adminToken, "PATCH", { status: "ACTIVE", version: 1 })).response.status, 200); await addToCart(customer.id, product.variants[0].id);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).complianceStatus, "BLOCKED", "Rule activation did not withdraw a matching active product from public discovery.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 404, "Compliance-blocked product remained publicly accessible.");
  const blocked = await call("/api/v1/orders", customerToken, "POST", { cartId, saveAddress: false, address }, { "Idempotency-Key": `blocked-${marker}` }); assert.equal(blocked.response.status, 422, "Known restricted product was not hard-blocked."); assert.equal(blocked.body.error?.code, "RESTRICTED_GOODS_BLOCKED"); ids.screenings.push(blocked.body.error.details.screeningReference);
  assert.equal((await call(`/api/v1/admin/compliance/rules/${ids.rules[1]}`, adminToken, "PATCH", { status: "PAUSED", version: 2 })).response.status, 200, "Hard-block rule could not be paused.");
  const publicationReview = await prisma.complianceScreeningAttempt.findFirstOrThrow({ where: { subject: "PRODUCT_PUBLICATION", subjectReference: product.id, outcome: "REVIEW_REQUIRED" }, orderBy: { createdAt: "desc" } });
  assert.equal((await call(`/api/v1/admin/compliance/screenings/${publicationReview.id}`, adminToken, "PATCH", { decision: "APPROVED", note: "Exact catalog content reviewed after the hard block was removed.", version: publicationReview.version })).response.status, 200, "Catalog compliance review could not be approved.");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).complianceStatus, "CLEAR", "Approved exact catalog review did not restore public visibility.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 200, "Approved product did not return to public discovery.");
  await prisma.restrictedGoodsRule.update({ where: { id: ids.rules[1] }, data: { status: "ACTIVE", effectiveTo: new Date(Date.now() - 60_000) } });
  await prisma.product.update({ where: { id: product.id }, data: { complianceStatus: "BLOCKED", complianceRuleCodes: [blockPayload.ruleCode] } });
  assert.equal((await call("/api/v1/admin/compliance/rescreen", customerToken, "POST")).response.status, 403, "Customer ran compliance maintenance.");
  const maintenance = await call("/api/v1/admin/compliance/rescreen", adminToken, "POST"); assert.equal(maintenance.response.status, 200, `Compliance maintenance failed: ${JSON.stringify(maintenance.body)}`); ids.maintenanceRuns.push(maintenance.body.data.runId);
  assert.equal((await prisma.restrictedGoodsRule.findUniqueOrThrow({ where: { id: ids.rules[1] } })).status, "PAUSED", "Expired active rule was not paused.");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).complianceStatus, "CLEAR", "Product visibility was not restored after rule expiry.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 200, "Expired rule left the product hidden.");
  const scheduledPayload = { ...blockPayload, ruleCode: `SCHEDULED-${marker}`, name: "Scheduled hard block verification", effectiveFrom: new Date(Date.now() + 3_600_000).toISOString() };
  const scheduledDraft = await call("/api/v1/admin/compliance/rules", adminToken, "POST", scheduledPayload); assert.equal(scheduledDraft.response.status, 201); ids.rules.push(scheduledDraft.body.data.rule.id);
  const scheduled = await call(`/api/v1/admin/compliance/rules/${scheduledDraft.body.data.rule.id}`, adminToken, "PATCH", { status: "ACTIVE", version: 1 }); assert.equal(scheduled.response.status, 200); assert.equal(scheduled.body.data.rule.status, "SCHEDULED", "Future rule did not enter the scheduled state.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 200, "Future rule affected the catalog before its effective time.");
  await prisma.restrictedGoodsRule.update({ where: { id: scheduledDraft.body.data.rule.id }, data: { effectiveFrom: new Date(Date.now() - 60_000) } });
  const scheduledMaintenance = await call("/api/v1/admin/compliance/rescreen", adminToken, "POST"); assert.equal(scheduledMaintenance.response.status, 200, `Scheduled activation maintenance failed: ${JSON.stringify(scheduledMaintenance.body)}`); ids.maintenanceRuns.push(scheduledMaintenance.body.data.runId);
  assert.equal((await prisma.restrictedGoodsRule.findUniqueOrThrow({ where: { id: scheduledDraft.body.data.rule.id } })).status, "ACTIVE", "Due scheduled rule was not activated.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 404, "Due scheduled hard block did not withdraw the product.");
  assert.equal((await call(`/api/v1/admin/compliance/rules/${scheduledDraft.body.data.rule.id}`, adminToken, "PATCH", { status: "PAUSED", version: 3 })).response.status, 200, "Automatically activated rule could not be paused.");
  assert.equal((await call(`/api/v1/catalog/products/${product.id}`, null)).response.status, 200, "Pausing the scheduled rule did not restore the product.");
  const adminPage = await call("/admin/compliance", adminToken); assert.equal(adminPage.response.status, 200); assert.match(adminPage.body, new RegExp(`BLOCK-${marker}`)); assert.doesNotMatch(JSON.stringify(blocked.body), /legalReference|keywords|hsCodePrefixes|internalDescription/, "Customer response exposed internal rule criteria.");
  const compliancePage = await call("/compliance", reviewerToken); assert.equal(compliancePage.response.status, 200, "Compliance portal did not render for an MFA-verified officer."); assert.doesNotMatch(compliancePage.body, /Create rule draft|Catalog maintenance|legalReference/, "Compliance portal exposed Admin-only configuration.");
  assert.equal((await call("/api/v1/admin/compliance-staff", customerToken)).response.status, 403, "Customer listed Compliance staff.");
  const staff = await call("/api/v1/admin/compliance-staff", adminToken); assert.equal(staff.response.status, 200); assert(staff.body.data.staff.some((item) => item.id === reviewer.id), "Admin could not see the Compliance workforce.");
  const revoked = await call(`/api/v1/admin/compliance-staff/${reviewer.id}`, adminToken, "DELETE"); assert.equal(revoked.response.status, 200, "Admin could not revoke Compliance access."); assert(revoked.body.data.revokedSessions >= 1, "Compliance sessions were not revoked with the role.");
  assert.equal((await call("/api/v1/compliance/screenings", reviewerToken)).response.status, 403, "Revoked Compliance session retained queue access.");
  const sourcingRoute = await readFile(new URL("../src/app/api/v1/sourcing/requests/route.ts", import.meta.url), "utf8"); assert.match(sourcingRoute, /screenRestrictedGoods/); assert.match(sourcingRoute, /RESTRICTED_GOODS_BLOCKED/);
  const evidence = await prisma.complianceScreeningAttempt.count({ where: { customerId: customer.id } }); assert(evidence >= 4, "Compliance screening evidence was not retained.");
  console.log("Restricted-goods verification passed: Admin/Compliance role separation, mandatory MFA boundary, access revocation, immediate and scheduled activation, phrase-safe matching, atomic public-catalog withdrawal/restoration, checkout hard block, manual review/approved exact retry, time-based expiry maintenance, sourcing enforcement, audit evidence, and customer-response privacy.");
} finally {
  if (ids.orders.length) { await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids.orders } } }); await prisma.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids.orders } } }); await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }); }
  if (ids.carts.length) { await prisma.cartItem.deleteMany({ where: { cartId: { in: ids.carts } } }); await prisma.cart.deleteMany({ where: { id: { in: ids.carts } } }); }
  if (ids.users.length) { await prisma.complianceScreeningAttempt.deleteMany({ where: { customerId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); }
  if (ids.rules.length) await prisma.restrictedGoodsRule.deleteMany({ where: { id: { in: ids.rules } } });
  if (ids.maintenanceRuns.length) { await prisma.auditLog.deleteMany({ where: { entityType: "MaintenanceJobRun", entityId: { in: ids.maintenanceRuns } } }); await prisma.maintenanceJobRun.deleteMany({ where: { id: { in: ids.maintenanceRuns } } }); }
  if (ids.products.length) { await prisma.productVariant.deleteMany({ where: { productId: { in: ids.products } } }); await prisma.product.deleteMany({ where: { id: { in: ids.products } } }); }
  if (ids.categories.length) await prisma.category.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
