import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient(); const origin = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000").origin; const secret = process.env.AUTH_SECRET; if (!secret) throw new Error("AUTH_SECRET is required."); const marker = randomBytes(8).toString("hex"); const password = `Qa-${randomBytes(18).toString("base64url")}!7`; const ids = { users: [], sessions: [], requests: [], quotes: [] };
async function request(path, options = {}, cookie) { const response = await fetch(`${origin}${path}`, { ...options, headers: { Origin: origin, ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" }); const text = await response.text(); return { response, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text, cookie: response.headers.get("set-cookie")?.split(";")[0] }; }
async function sessionFor(user, portal, mfaVerified = false) { const row = await prisma.authSession.create({ data: { userId: user.id, portal, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } }); ids.sessions.push(row.id); const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)); return `crossly_session=${token}; __Host-crossly_session=${token}`; }

try {
  const [agentRole, adminRole, customerRole] = await Promise.all(["sourcing_agent", "admin", "customer_personal"].map((code) => prisma.role.findUniqueOrThrow({ where: { code } })));
  async function user(label, roleId) { const row = await prisma.user.create({ data: { email: `${label.toLowerCase().replaceAll(" ", "-")}-${marker}@example.test`, passwordHash: await bcrypt.hash(password, 12), fullName: label, status: "ACTIVE", roles: { create: { roleId } } } }); ids.users.push(row.id); return row; }
  const agent = await user("Sourcing Agent QA", agentRole.id); const admin = await user("Sourcing Admin QA", adminRole.id); const customer = await user("Sourcing Customer QA", customerRole.id);
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: agent.email, password, portal: "sourcing" }) }); assert.equal(login.response.status, 200); assert.equal(login.body.data.nextAction, "SIGNED_IN"); assert(login.cookie); ids.sessions.push(login.body.data.session.id);
  const adminCookie = await sessionFor(admin, "admin", true); const customerCookie = await sessionFor(customer, "customer");
  const sourcingRequest = await prisma.sourcingRequest.create({ data: { reference: `BS-QA-${marker}`, customerId: customer.id, productUrl: "https://supplier.example.test/product/123", productTitle: "Verified sourcing test product", selectedVariant: "Blue", quantity: 2, sourcePrice: 12, sourceCurrency: "CNY", customerNote: "Please verify availability." } }); ids.requests.push(sourcingRequest.id);
  const queue = await request("/api/v1/sourcing-agent/requests", {}, login.cookie); assert.equal(queue.response.status, 200); assert.equal(queue.body.data.requests[0].customer.email, undefined, "Agent queue exposed customer email."); assert.equal((await request("/api/v1/admin/users", {}, login.cookie)).response.status, 403);
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString(); const draft = await request(`/api/v1/sourcing-agent/requests/${sourcingRequest.id}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productCostBdt: 1000, serviceFeeBdt: 100, estimatedShippingBdt: 200, declaredWeightGrams: 500, fxRate: 16.5, note: "Supplier stock verified for review.", expiresAt }) }, login.cookie); assert.equal(draft.response.status, 201); assert.equal(draft.body.data.quote.status, "DRAFT"); ids.quotes.push(draft.body.data.quote.id);
  const beforeReview = await request("/buy-ship", {}, customerCookie); assert.equal(beforeReview.response.status, 200); assert(!beforeReview.body.includes("1,300") && !beforeReview.body.includes("1300"), "Draft quote leaked to the customer page.");
  const approved = await request(`/api/v1/admin/sourcing-quotes/${draft.body.data.quote.id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVE", note: "Pricing and supplier evidence independently reviewed." }) }, adminCookie); assert.equal(approved.response.status, 200); assert.equal(approved.body.data.quote.status, "SENT"); assert.equal(approved.body.data.quote.reviewedById, admin.id); assert(approved.body.data.quote.reviewedAt);
  const savedRequest = await prisma.sourcingRequest.findUniqueOrThrow({ where: { id: sourcingRequest.id } }); assert.equal(savedRequest.status, "QUOTED"); const afterReview = await request("/buy-ship", {}, customerCookie); assert(afterReview.body.includes("1300") || afterReview.body.includes("1,300"), "Approved quote was not visible to its customer.");
  const revoked = await request(`/api/v1/admin/sourcing-staff/${agent.id}`, { method: "DELETE" }, adminCookie); assert.equal(revoked.response.status, 200); assert(revoked.body.data.revokedSessions >= 1); assert.equal((await request("/api/v1/sourcing-agent/requests", {}, login.cookie)).response.status, 403);
  const grant = () => request("/api/v1/admin/sourcing-staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: agent.email }) }, adminCookie);
  const grants = await Promise.all(Array.from({ length: 4 }, grant));
  assert(grants.every(result => result.response.status === 201));
  assert.equal(await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_granted" } }), 1, "Repeated grants created duplicate transition audits.");
  assert.equal((await grant()).response.status, 201);
  assert.equal(await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_granted" } }), 1);
  const secondLogin = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: agent.email, password, portal: "sourcing" }) });
  assert.equal(secondLogin.response.status, 200); ids.sessions.push(secondLogin.body.data.session.id);
  const removals = await Promise.all(Array.from({ length: 4 }, () => request(`/api/v1/admin/sourcing-staff/${agent.id}`, { method: "DELETE" }, adminCookie)));
  assert.equal(removals.filter(result => result.response.status === 200).length, 1);
  assert.equal(removals.filter(result => result.response.status === 404).length, 3);
  assert.equal(await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_revoked" } }), 2, "Concurrent removal must add exactly one audit after the earlier removal.");
  assert.equal(await prisma.authSession.count({ where: { userId: agent.id, portal: "sourcing", revokedAt: null } }), 0);
  assert.equal((await request("/api/v1/sourcing-agent/requests", {}, secondLogin.cookie)).response.status, 403);
  assert.equal((await request(`/api/v1/admin/sourcing-staff/${agent.id}`, { method: "DELETE" }, adminCookie)).response.status, 404);
  assert.equal(await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_revoked" } }), 2);
  const mixed = await Promise.all([grant(), request(`/api/v1/admin/sourcing-staff/${agent.id}`, { method: "DELETE" }, adminCookie), grant(), request(`/api/v1/admin/sourcing-staff/${agent.id}`, { method: "DELETE" }, adminCookie)]);
  assert(mixed.every(result => [200, 201, 404].includes(result.response.status)), "Competing access changes failed outside the documented outcomes.");
  const grantCount = await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_granted" } });
  const revokeCount = await prisma.auditLog.count({ where: { entityId: agent.id, action: "sourcing.staff_role_revoked" } });
  const assignments = await prisma.userRole.count({ where: { userId: agent.id, roleId: agentRole.id } });
  assert.equal(assignments, 1 + grantCount - revokeCount, "Role state and transition audit history diverged under competing changes.");
  assert.equal(await prisma.authSession.count({ where: { userId: agent.id, portal: "sourcing", revokedAt: null } }), 0);
  console.log("Sourcing portal verification passed: login, isolation, draft privacy, independent publication, concurrent grant/removal, replay audit cardinality and session revocation.");
} finally {
  if (ids.quotes.length) { await prisma.notification.deleteMany({ where: { entityType: "SourcingQuote", entityId: { in: ids.quotes } } }); await prisma.sourcingQuote.deleteMany({ where: { id: { in: ids.quotes } } }); }
  if (ids.requests.length) await prisma.sourcingRequest.deleteMany({ where: { id: { in: ids.requests } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
