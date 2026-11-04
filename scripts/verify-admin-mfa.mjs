import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const password = `Qa-${randomBytes(18).toString("base64url")}!7`;
const email = `qa-mfa-${Date.now()}@example.test`;
let userId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeBase32(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of input) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(value % 1_000_000).padStart(6, "0");
}

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { Origin: baseUrl, ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const body = await response.json();
  return { response, body, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

try {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
  const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), fullName: "MFA QA Administrator", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  userId = user.id;

  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal: "admin" }) });
  assert(login.response.status === 200 && login.body.data?.nextAction === "MFA_ENROLLMENT" && login.cookie, `Password login did not require MFA enrollment (status ${login.response.status}, next action ${login.body.data?.nextAction ?? "none"}, cookie ${login.cookie ? "present" : "missing"}).`);
  const beforeMfa = await request("/api/v1/admin/users", {}, login.cookie);
  assert(beforeMfa.response.status === 403, "Password-only session unexpectedly received admin access.");

  const setup = await request("/api/v1/auth/mfa/setup", { method: "POST" }, login.cookie);
  assert(setup.response.status === 200 && setup.body.data.secret && setup.body.data.qrCodeDataUrl.startsWith("data:image/png"), "MFA setup did not return a valid authenticator payload.");
  const repeatedSetups = await Promise.all([1, 2].map(() => request("/api/v1/auth/mfa/setup", { method: "POST" }, login.cookie)));
  assert(repeatedSetups.every((result) => result.response.status === 200 && result.body.data.secret === setup.body.data.secret && result.body.data.expiresAt === setup.body.data.expiresAt), "Repeated MFA setup rotated a pending authenticator secret or extended its lifetime.");
  const confirm = await request("/api/v1/auth/mfa/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totp(setup.body.data.secret) }) }, login.cookie);
  assert(confirm.response.status === 200 && confirm.body.data.recoveryCodes.length === 10, "MFA confirmation or recovery-code generation failed.");
  const afterMfa = await request("/api/v1/admin/users", {}, login.cookie);
  assert(afterMfa.response.status === 200, "MFA-verified session did not receive admin access.");

  const secondLogin = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal: "admin" }) });
  assert(secondLogin.response.status === 200 && secondLogin.body.data.nextAction === "MFA_CHALLENGE" && secondLogin.cookie, "Returning administrator did not receive an MFA challenge.");
  const recovery = await request("/api/v1/auth/mfa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: confirm.body.data.recoveryCodes[0] }) }, secondLogin.cookie);
  assert(recovery.response.status === 200 && recovery.body.data.recoveryCodeUsed === true, "One-time recovery-code verification failed.");
  const secondAfterMfa = await request("/api/v1/admin/users", {}, secondLogin.cookie);
  assert(secondAfterMfa.response.status === 200, "Recovery-verified session did not receive admin access.");

  console.log("Admin MFA verification passed: enrollment, authorization boundary, QR setup, recovery codes, and returning-login challenge.");
} finally {
  if (userId) {
    await prisma.userEvent.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
}
