import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for notification-preference verification.");
const marker = randomBytes(8).toString("hex");
let userId;
let sessionId;

async function request(path, token, method = "GET", body, trustedOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(trustedOrigin && method !== "GET" ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await response.text();
  return { response, text, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}

try {
  const role = await prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } });
  const user = await prisma.user.create({ data: { email: `notification-preferences-${marker}@example.test`, fullName: `Notification Customer ${marker}`, passwordHash: "not-used", status: "ACTIVE", locale: "bn", roles: { create: { roleId: role.id } } } });
  userId = user.id;
  const session = await prisma.authSession.create({ data: { userId, portal: "customer", clientName: "Notification preference verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000) } });
  sessionId = session.id;
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: ["customer_personal"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));

  assert.equal((await request("/api/v1/notifications/preferences")).response.status, 401, "Anonymous notification preferences were exposed.");
  const initial = await request("/api/v1/notifications/preferences", token);
  assert.equal(initial.response.status, 200, `Preference listing failed: ${initial.text}`);
  assert.equal(initial.response.headers.get("cache-control"), "private, no-store, max-age=0", "Preference list may be cached.");
  assert.equal(initial.body.data.items.length, 15, "The complete category/channel preference matrix was not returned.");
  const securityEmail = initial.body.data.items.find((item) => item.category === "SECURITY" && item.channel === "EMAIL");
  const push = initial.body.data.items.find((item) => item.category === "TRANSACTIONAL" && item.channel === "PUSH");
  assert(securityEmail.enabled && securityEmail.locked && securityEmail.deliveryState === (securityEmail.available ? "ACTIVE" : "QUEUED_UNTIL_PROVIDER"), "Essential security email policy is incorrect.");
  assert(!push.enabled && !push.available && push.deliveryState === "NOT_AVAILABLE", "Unconnected push delivery was presented as active.");

  const untrusted = await request("/api/v1/notifications/preferences", token, "PATCH", { category: "MARKETING", channel: "EMAIL", enabled: true, locale: "bn" }, false);
  assert.equal(untrusted.response.status, 403, "Preference mutation accepted an untrusted browser origin.");
  const essential = await request("/api/v1/notifications/preferences", token, "PATCH", { category: "SECURITY", channel: "EMAIL", enabled: false, locale: "bn" });
  assert.equal(essential.response.status, 409); assert.equal(essential.body.error.code, "ESSENTIAL_NOTIFICATION_REQUIRED");
  const unavailable = await request("/api/v1/notifications/preferences", token, "PATCH", { category: "TRANSACTIONAL", channel: "PUSH", enabled: true, locale: "bn" });
  assert.equal(unavailable.response.status, 409); assert.equal(unavailable.body.error.code, "NOTIFICATION_CHANNEL_UNAVAILABLE");
  const marketingEmail = initial.body.data.items.find((item) => item.category === "MARKETING" && item.channel === "EMAIL");
  if (!marketingEmail.available) {
    const disconnectedEmail = await request("/api/v1/notifications/preferences", token, "PATCH", { category: "MARKETING", channel: "EMAIL", enabled: true, locale: "bn" });
    assert.equal(disconnectedEmail.response.status, 409, "Unconnected marketing email was enabled.");
    assert.equal(disconnectedEmail.body.error.code, "NOTIFICATION_CHANNEL_UNAVAILABLE");
  }
  const enabled = await request("/api/v1/notifications/preferences", token, "PATCH", { category: "MARKETING", channel: "IN_APP", enabled: true, locale: "bn" });
  assert.equal(enabled.response.status, 200, `Available preference update failed: ${enabled.text}`);
  assert(enabled.body.data.preference.enabled && enabled.body.data.preference.locale === "bn");
  assert(await prisma.auditLog.count({ where: { actorId: userId, action: "notification.preference_updated" } }) === 1, "Preference change audit evidence is missing or duplicated.");

  const page = await request("/notifications", token);
  assert.equal(page.response.status, 200, "Notification settings page did not render.");
  assert(page.text.includes("Choose how DeshDak contacts you."), "Notification settings page omitted its preference heading.");
  assert(page.text.includes("WhatsApp"), "Notification settings page omitted unavailable-channel readiness.");
  assert(page.text.includes("Language:") && page.text.includes("বাংলা"), "Notification settings page omitted the Bangla profile language.");
  console.log("Notification-preference verification passed: privacy, complete defaults, essential locks, unavailable-channel fail-closed behavior, trusted mutation, audit evidence, and customer page rendering.");
} finally {
  if (userId) { await prisma.notificationPreference.deleteMany({ where: { userId } }); await prisma.auditLog.deleteMany({ where: { actorId: userId } }); }
  if (sessionId) await prisma.authSession.deleteMany({ where: { id: sessionId } });
  if (userId) { await prisma.userRole.deleteMany({ where: { userId } }); await prisma.user.delete({ where: { id: userId } }); }
  await prisma.$disconnect();
}
