import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const marker = randomBytes(8).toString("hex");
const email = `session-owner-${marker}@example.test`;
const otherEmail = `session-other-${marker}@example.test`;
const password = `Session-${marker}-Strong!`;
const testIp = "203.0.113.91";
let userId;
let otherUserId;

function assert(condition, message) { if (!condition) throw new Error(message); }
function rateHash(scope, value) { return createHmac("sha256", process.env.AUTH_SECRET).update(`crossly:rate-limit:${scope}:${value}`).digest("hex"); }
function cookieFrom(response) { return response.headers.get("set-cookie")?.split(";", 1)[0]; }
async function body(response) { return response.json(); }
async function login(userAgent) {
  const response = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": userAgent, "x-forwarded-for": testIp }, body: JSON.stringify({ email, password, portal: "customer" }) });
  const result = await body(response);
  assert(response.status === 200, `Login failed: ${response.status}`);
  const cookie = cookieFrom(response);
  assert(cookie, "Login did not issue a session cookie.");
  return { cookie, sessionId: result.data.session.id };
}
async function mutate(path, method, cookie) {
  return fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin, "x-forwarded-for": testIp } });
}

try {
  const role = await prisma.role.findUnique({ where: { code: "customer_personal" }, select: { id: true } });
  assert(role, "The customer role must be seeded before this verification runs.");
  const passwordHash = await bcrypt.hash(password, 12);
  const owner = await prisma.user.create({ data: { email, fullName: "Session Owner Test", passwordHash, status: "ACTIVE", roles: { create: { roleId: role.id } } } });
  userId = owner.id;
  const other = await prisma.user.create({ data: { email: otherEmail, fullName: "Other Session Test", passwordHash, status: "ACTIVE", roles: { create: { roleId: role.id } } } });
  otherUserId = other.id;

  const first = await login("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36");
  const second = await login("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15");
  const listResponse = await fetch(`${origin}/api/v1/auth/sessions`, { headers: { Cookie: second.cookie } });
  const list = await body(listResponse);
  assert(listResponse.status === 200 && list.data.sessions.length === 2, "Session listing did not return both owned sessions.");
  assert(list.data.sessions.some((item) => item.id === second.sessionId && item.isCurrent), "The API did not identify the current session.");
  assert(list.data.sessions.every((item) => !("ipHash" in item) && !("userAgentHash" in item)), "Internal session fingerprints leaked through the API.");

  const foreign = await prisma.authSession.create({ data: { userId: other.id, portal: "customer", expiresAt: new Date(Date.now() + 60 * 60_000), clientName: "Foreign session", clientType: "WEB" } });
  const foreignAttempt = await mutate(`/api/v1/auth/sessions/${foreign.id}`, "DELETE", second.cookie);
  assert(foreignAttempt.status === 404, "A user could discover or revoke another user's session.");
  assert(!(await prisma.authSession.findUnique({ where: { id: foreign.id } }))?.revokedAt, "Another user's session was modified.");

  const currentAttempt = await mutate(`/api/v1/auth/sessions/${second.sessionId}`, "DELETE", second.cookie);
  assert(currentAttempt.status === 409, "The current-session protection did not reject remote revocation.");
  const revokeFirst = await mutate(`/api/v1/auth/sessions/${first.sessionId}`, "DELETE", second.cookie);
  assert(revokeFirst.status === 200, "A user could not revoke an owned secondary session.");
  const revokedCookieCheck = await fetch(`${origin}/api/v1/users/me`, { headers: { Cookie: first.cookie } });
  assert(revokedCookieCheck.status === 401, "The remotely revoked session remained usable.");

  const third = await login("DUARFlutter/1.0 Dart/3.8 Android");
  const revokeOthers = await mutate("/api/v1/auth/sessions/revoke-others", "POST", third.cookie);
  const revokeOthersBody = await body(revokeOthers);
  assert(revokeOthers.status === 200 && revokeOthersBody.data.revokedCount === 1, "Revoke-all-others did not close the remaining active session.");
  const secondCookieCheck = await fetch(`${origin}/api/v1/users/me`, { headers: { Cookie: second.cookie } });
  const thirdCookieCheck = await fetch(`${origin}/api/v1/users/me`, { headers: { Cookie: third.cookie } });
  assert(secondCookieCheck.status === 401 && thirdCookieCheck.status === 200, "Revoke-all-others did not preserve only the current session.");
  const mobile = await prisma.authSession.findUnique({ where: { id: third.sessionId }, select: { clientName: true, clientType: true, ipHash: true, userAgentHash: true } });
  assert(mobile?.clientName.includes("DeshDak mobile app") && mobile.clientType === "MOBILE_APP" && mobile.ipHash && mobile.userAgentHash, "Mobile-safe session metadata was not recorded correctly.");
  const logoutResponse = await mutate("/api/v1/auth/logout", "POST", third.cookie);
  const logoutBody = await body(logoutResponse);
  assert(logoutResponse.status === 200 && logoutBody.data.loggedOut === true && logoutBody.data.redirectTo === "/", "Logout did not return the public homepage destination.");
  assert(logoutResponse.headers.get("set-cookie")?.includes("Max-Age=0"), "Logout did not expire the browser session cookie.");
  assert(logoutResponse.headers.get("clear-site-data")?.includes("cookies"), "Logout did not request browser credential cleanup.");
  assert((await prisma.authSession.findUnique({ where: { id: third.sessionId } }))?.revokedAt, "Logout did not revoke the server session.");
  assert((await fetch(`${origin}/api/v1/users/me`, { headers: { Cookie: third.cookie } })).status === 401, "The signed-out session remained usable.");
  console.log("Session management verification passed: ownership, current-device protection, remote revocation, revoke-others, fingerprints, mobile client labeling, complete sign-out, and homepage handoff.");
} finally {
  const ids = [userId, otherUserId].filter(Boolean);
  if (ids.length) {
    await prisma.userEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, ...ids.map((id) => ({ entityType: "User", entityId: id }))] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  const rateKeys = [["login:ip", testIp], ["login:account", email]];
  await prisma.securityRateLimit.deleteMany({ where: { OR: rateKeys.map(([scope, value]) => ({ scope, keyHash: rateHash(scope, value) })) } });
  await prisma.$disconnect();
}
