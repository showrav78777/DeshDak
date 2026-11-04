import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Admin audit-log verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], audits: [] };

async function tokenFor(user, roles, portal, mfaVerified = false) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Audit-log verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, token) {
  const response = await fetch(`${origin}${path}`, { headers: token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}, redirect: "manual" });
  const text = await response.text();
  return { response, text, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}

try {
  const [adminRole, customerRole] = await Promise.all([
    prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } }),
    prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } }),
  ]);
  const admin = await prisma.user.create({ data: { email: `audit-admin-${marker}@example.test`, fullName: `Audit Admin ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  const customer = await prisma.user.create({ data: { email: `audit-customer-${marker}@example.test`, fullName: `Audit Customer ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: customerRole.id } } } });
  ids.users.push(admin.id, customer.id);
  const [adminToken, customerToken] = await Promise.all([tokenFor(admin, ["admin"], "admin", true), tokenFor(customer, ["customer_personal"], "customer")]);
  const action = `verification.audit_${marker}`;
  const secretValue = `secret-${marker}`;
  const audit = await prisma.auditLog.create({ data: { actorId: admin.id, action, entityType: "VerificationRecord", entityId: marker, metadata: { result: "allowed", accessToken: secretValue, nested: { password: secretValue }, longText: "x".repeat(500) } } });
  ids.audits.push(audit.id);

  assert.equal((await request("/api/v1/admin/audit-logs")).response.status, 403, "Anonymous audit API access was not denied.");
  assert.equal((await request("/api/v1/admin/audit-logs", customerToken)).response.status, 403, "Customer audit API access was not denied.");
  const api = await request(`/api/v1/admin/audit-logs?action=${encodeURIComponent(action)}&entityType=VerificationRecord&pageSize=10`, adminToken);
  assert.equal(api.response.status, 200, `Admin audit API failed: ${api.text}`);
  assert.equal(api.response.headers.get("cache-control"), "private, no-store, max-age=0", "Audit API may be cached.");
  assert.equal(api.body.data.pagination.total, 1, "Audit filters did not isolate the expected record.");
  assert.equal(api.body.data.events[0].actor.id, admin.id, "Audit actor attribution was lost.");
  assert.equal(api.body.data.events[0].metadata.accessToken, "[REDACTED]", "Sensitive metadata was not redacted.");
  assert.equal(api.body.data.events[0].metadata.nested.password, "[REDACTED]", "Nested sensitive metadata was not redacted.");
  assert(!api.text.includes(secretValue) && api.body.data.events[0].metadata.longText.endsWith("…"), "Audit response leaked or failed to bound metadata.");

  const page = await request(`/admin/audit-logs?action=${encodeURIComponent(action)}`, adminToken);
  assert.equal(page.response.status, 200, "Admin audit page did not render.");
  assert(page.text.includes("Audit log.") && page.text.includes(action) && page.text.includes("[REDACTED]") && !page.text.includes(secretValue), "Admin audit page omitted evidence or leaked a secret.");
  console.log("Admin audit-log verification passed: RBAC, no-store delivery, filtering, pagination, actor evidence, recursive redaction, bounded metadata, and protected page rendering.");
} finally {
  if (ids.audits.length) await prisma.auditLog.deleteMany({ where: { id: { in: ids.audits } } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
