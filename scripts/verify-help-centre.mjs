import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Help Centre verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], categories: [], articles: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Help Centre verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const adminRole = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "admin" } });
  const customerRole = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "customer_personal" } });
  async function user(label, roleId) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId } } } }); ids.users.push(row.id); return row; }
  const admin = await user("help-admin", adminRole.id);
  const customer = await user("help-customer", customerRole.id);
  const [adminCookie, wrongPortalAdminCookie, customerCookie] = await Promise.all([sessionFor(admin, "admin"), sessionFor(admin, "customer"), sessionFor(customer, "customer")]);

  const categoryPayload = { slug: `orders-${marker}`, nameEn: "Orders and tracking", nameBn: "অর্ডার ও ট্র্যাকিং", descriptionEn: "Approved guidance about orders and tracking.", descriptionBn: "অর্ডার ও ট্র্যাকিং সম্পর্কিত নির্দেশনা।", sortOrder: 10 };
  assert((await request("/api/v1/admin/help/categories", customerCookie, "POST", categoryPayload)).response.status === 403, "A customer created a Help Centre category.");
  assert((await request("/api/v1/admin/help/categories", wrongPortalAdminCookie, "POST", categoryPayload)).response.status === 403, "An Admin identity changed Help Centre content from the wrong portal.");
  const noOrigin = await request("/api/v1/admin/help/categories", adminCookie, "POST", categoryPayload, false);
  assert(noOrigin.response.status === 403 && noOrigin.body.error.code === "UNTRUSTED_ORIGIN", "Help Centre mutation accepted an untrusted origin.");
  const categoryCreated = await request("/api/v1/admin/help/categories", adminCookie, "POST", categoryPayload);
  assert(categoryCreated.response.status === 201 && !categoryCreated.body.data.category.isActive, `Private Help Centre category creation failed: ${JSON.stringify(categoryCreated.body)}`);
  const category = categoryCreated.body.data.category; ids.categories.push(category.id);

  const articlePayload = { slug: `track-order-${marker}`, categoryId: category.id, titleEn: "How to track a DeshDak order", titleBn: "ক্রসলি অর্ডার ট্র্যাক করার নিয়ম", summaryEn: "Follow verified order and shipment updates from your account.", summaryBn: "আপনার অ্যাকাউন্ট থেকে যাচাইকৃত অর্ডার আপডেট দেখুন।", bodyEn: "Open your account and select My orders. Choose the order to review its verified timeline.\n\nA warehouse update is shown only after DeshDak records it. <script>alert('unsafe')</script>", bodyBn: "আপনার অ্যাকাউন্ট খুলে অর্ডার নির্বাচন করুন। যাচাইকৃত টাইমলাইন সেখানে দেখা যাবে।", keywords: ["tracking", "warehouse"], sortOrder: 5 };
  const articleCreated = await request("/api/v1/admin/help/articles", adminCookie, "POST", articlePayload);
  assert(articleCreated.response.status === 201 && articleCreated.body.data.article.status === "DRAFT", `Draft Help Centre article creation failed: ${JSON.stringify(articleCreated.body)}`);
  const article = articleCreated.body.data.article; ids.articles.push(article.id);

  const privateList = await request(`/api/v1/help/articles?q=warehouse`);
  assert(privateList.response.status === 200 && !JSON.stringify(privateList.body).includes(article.slug), "A draft Help Centre article leaked through public search.");
  assert((await request(`/api/v1/help/articles/${article.slug}`)).response.status === 404, "A draft Help Centre article leaked through its public API URL.");
  const prematurePublish = await request(`/api/v1/admin/help/articles/${article.id}`, adminCookie, "PATCH", { status: "PUBLISHED", version: article.version });
  assert(prematurePublish.response.status === 409 && prematurePublish.body.error.code === "HELP_CATEGORY_NOT_PUBLIC", "An article was published under a private category.");

  const activated = await request(`/api/v1/admin/help/categories/${category.id}`, adminCookie, "PATCH", { isActive: true, version: category.version });
  assert(activated.response.status === 200 && activated.body.data.category.isActive && activated.body.data.category.version === 2, "Admin could not activate the reviewed Help Centre category.");
  const staleCategory = await request(`/api/v1/admin/help/categories/${category.id}`, adminCookie, "PATCH", { nameEn: "Stale overwrite", version: category.version });
  assert(staleCategory.response.status === 409 && staleCategory.body.error.code === "HELP_CATEGORY_CHANGED", "A stale category update overwrote current content.");
  const published = await request(`/api/v1/admin/help/articles/${article.id}`, adminCookie, "PATCH", { status: "PUBLISHED", isFeatured: true, version: article.version });
  assert(published.response.status === 200 && published.body.data.article.status === "PUBLISHED" && published.body.data.article.publishedAt, `Help article publication failed: ${JSON.stringify(published.body)}`);

  const publicList = await request(`/api/v1/help/articles?q=warehouse&category=${category.slug}&locale=en`);
  assert(publicList.response.status === 200 && publicList.body.data.total === 1 && JSON.stringify(publicList.body).includes(article.slug), "Published article was not searchable through the public API.");
  assert(!JSON.stringify(publicList.body).includes(admin.email) && !JSON.stringify(publicList.body).includes("createdById"), "Public Help Centre search exposed staff data.");
  const publicDetail = await request(`/api/v1/help/articles/${article.slug}`);
  assert(publicDetail.response.status === 200 && publicDetail.body.data.article.bodyEn.includes("verified timeline"), "Published article detail API failed.");
  const publicPage = await request(`/help/${article.slug}?lang=bn`);
  assert(publicPage.response.status === 200 && publicPage.body.includes("ক্রসলি অর্ডার ট্র্যাক") && !publicPage.body.includes("<script>alert"), "Bilingual Help Centre page failed or rendered stored markup unsafely.");
  const helpIndex = await request(`/help?q=warehouse&category=${category.slug}`);
  assert(helpIndex.response.status === 200 && helpIndex.body.includes("How to track a DeshDak order"), "Public Help Centre search page did not show published guidance.");
  const adminPage = await request("/admin/help", adminCookie);
  assert(adminPage.response.status === 200 && adminPage.body.includes("How to track a DeshDak order"), "Admin Help Centre page did not show managed content.");

  const archived = await request(`/api/v1/admin/help/articles/${article.id}`, adminCookie, "PATCH", { status: "ARCHIVED", version: published.body.data.article.version });
  assert(archived.response.status === 200 && archived.body.data.article.status === "ARCHIVED", "Admin could not archive obsolete guidance.");
  assert((await request(`/api/v1/help/articles/${article.slug}`)).response.status === 404, "Archived guidance remained publicly accessible.");
  const archivedEdit = await request(`/api/v1/admin/help/articles/${article.id}`, adminCookie, "PATCH", { titleEn: "Silently rewritten archive", version: archived.body.data.article.version });
  assert(archivedEdit.response.status === 409 && archivedEdit.body.error.code === "HELP_ARTICLE_ARCHIVED", "Archived guidance was rewritten.");
  const audits = await prisma.auditLog.count({ where: { actorId: admin.id, entityId: { in: [category.id, article.id] }, action: { startsWith: "help." } } });
  assert(audits >= 5, "Help Centre lifecycle changes were not fully audited.");
  console.log("Help Centre verification passed: Admin portal and trusted-origin enforcement, private drafts, active-category publication gate, optimistic concurrency, bilingual public search/detail, staff-data minimization, safe plain-text rendering, immutable archive, audit evidence, and Admin/public pages.");
} finally {
  if (ids.articles.length) await prisma.helpArticle.deleteMany({ where: { id: { in: ids.articles } } });
  if (ids.categories.length) await prisma.helpCategory.deleteMany({ where: { id: { in: ids.categories } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
