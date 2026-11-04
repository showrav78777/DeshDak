import { createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000";
const applicationBaseUrl = process.env.APP_BASE_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000";
const marker = randomBytes(8).toString("hex");
const email = `auth-recovery-${marker}@example.test`;
const unknownEmail = `unknown-${marker}@example.test`;
const oldPassword = `Before-${marker}-Strong!`;
const newPassword = `After-${marker}-Strong!`;
const testIp = "203.0.113.77";
let userId;

function assert(condition, message) { if (!condition) throw new Error(message); }
function encryptionKey() {
  if (process.env.AUTH_OUTBOX_ENCRYPTION_KEY) return Buffer.from(process.env.AUTH_OUTBOX_ENCRYPTION_KEY, "base64");
  return createHash("sha256").update(`crossly:auth-outbox:development:${process.env.AUTH_SECRET}`).digest();
}
function decrypt(delivery) {
  assert(delivery.securePayloadCiphertext && delivery.securePayloadIv && delivery.securePayloadTag, "Protected email payload was not encrypted.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(delivery.securePayloadIv, "base64"));
  decipher.setAuthTag(Buffer.from(delivery.securePayloadTag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(delivery.securePayloadCiphertext, "base64")), decipher.final()]).toString("utf8"));
}
async function post(path, body, cookie) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": testIp, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" });
}
async function json(response) { return response.json(); }
function fragmentToken(actionUrl) { return new URLSearchParams(new URL(actionUrl).hash.slice(1)).get("token"); }
function rateHash(scope, value) { return createHmac("sha256", process.env.AUTH_SECRET).update(`crossly:rate-limit:${scope}:${value}`).digest("hex"); }

try {
  const registration = await post("/api/v1/auth/register", { fullName: "Auth Recovery Test", email, phone: `+8801${Date.now().toString().slice(-9)}`, residenceCountryCode: "BD", password: oldPassword });
  const registrationBody = await json(registration);
  assert(registration.status === 201 && registrationBody.data?.nextAction === "VERIFY_EMAIL", `Registration failed: ${registration.status}`);
  userId = registrationBody.data.user.id;
  const verificationDelivery = await prisma.notificationDelivery.findFirst({ where: { notification: { userId, eventType: "EMAIL_VERIFICATION_REQUESTED" } }, include: { notification: true }, orderBy: { createdAt: "desc" } });
  assert(verificationDelivery && !verificationDelivery.notification.body.includes("token=") && !verificationDelivery.notification.body.includes(applicationBaseUrl), "Verification secret leaked into visible notification content.");
  const verificationPayload = decrypt(verificationDelivery);
  const verificationToken = fragmentToken(verificationPayload.variables.actionUrl);
  assert(verificationToken, "Verification token was not present in the protected email payload.");

  const verification = await post("/api/v1/auth/email-verification/confirm", { token: verificationToken });
  assert(verification.status === 200, `Email verification failed: ${verification.status}`);
  const verifiedUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  assert(verifiedUser?.status === "ACTIVE", "Email verification did not activate the account.");

  const login = await post("/api/v1/auth/login", { email, password: oldPassword, portal: "customer" });
  assert(login.status === 200, `Verified account login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Login did not issue the protected session cookie.");

  const resetRequest = await post("/api/v1/auth/password-reset/request", { email });
  const resetRequestBody = await json(resetRequest);
  assert(resetRequest.status === 202 && resetRequestBody.data?.accepted, `Reset request failed: ${resetRequest.status}`);
  const resetDelivery = await prisma.notificationDelivery.findFirst({ where: { notification: { userId, eventType: "PASSWORD_RESET_REQUESTED" } }, include: { notification: true }, orderBy: { createdAt: "desc" } });
  assert(resetDelivery && !resetDelivery.notification.body.includes("token=") && !resetDelivery.notification.body.includes(applicationBaseUrl), "Reset secret leaked into visible notification content.");
  const resetPayload = decrypt(resetDelivery);
  const resetToken = fragmentToken(resetPayload.variables.actionUrl);
  assert(resetToken, "Reset token was not present in the protected email payload.");

  const reset = await post("/api/v1/auth/password-reset/confirm", { token: resetToken, password: newPassword, confirmPassword: newPassword });
  assert(reset.status === 200, `Password reset failed: ${reset.status}`);
  const replay = await post("/api/v1/auth/password-reset/confirm", { token: resetToken, password: newPassword, confirmPassword: newPassword });
  assert(replay.status === 422, "A single-use reset token was accepted twice.");
  const oldSession = await fetch(`${baseUrl}/api/v1/users/me`, { headers: { Cookie: cookie } });
  assert(oldSession.status === 401, "Password reset did not revoke the existing session.");
  const oldLogin = await post("/api/v1/auth/login", { email, password: oldPassword, portal: "customer" });
  assert(oldLogin.status === 401, "The previous password remained valid after reset.");
  const newLogin = await post("/api/v1/auth/login", { email, password: newPassword, portal: "customer" });
  assert(newLogin.status === 200, "The new password could not sign in.");

  const unknownRequest = await post("/api/v1/auth/password-reset/request", { email: unknownEmail });
  const unknownBody = await json(unknownRequest);
  assert(unknownRequest.status === resetRequest.status && unknownBody.data?.message === resetRequestBody.data?.message, "Reset request disclosed whether an account exists.");
  console.log("Auth recovery verification passed: encrypted delivery, email verification, one-time reset, session revocation, and anti-enumeration.");
} finally {
  if (userId) {
    await prisma.userEvent.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: userId }, { entityType: "User", entityId: userId }] } });
    await prisma.user.deleteMany({ where: { id: userId, email } });
  }
  const rateKeys = [
    ["email-verification-confirm:ip", testIp], ["password-reset-request:ip", testIp], ["password-reset-request:account", email], ["password-reset-request:account", unknownEmail], ["password-reset-confirm:ip", testIp], ["login:ip", testIp], ["login:account", email],
  ];
  await prisma.securityRateLimit.deleteMany({ where: { OR: rateKeys.map(([scope, value]) => ({ scope, keyHash: rateHash(scope, value) })) } });
  await prisma.$disconnect();
}
