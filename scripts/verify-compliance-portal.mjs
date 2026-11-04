import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000").origin;
const password = `Qa-${randomBytes(18).toString("base64url")}!7`;
let userId;

function decodeBase32(input) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const character of input) bits += alphabet.indexOf(character).toString(2).padStart(5, "0"); const bytes = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2)); return Buffer.from(bytes); }
function totp(secret) { const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30))); const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; const value = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255); return String(value % 1_000_000).padStart(6, "0"); }
async function request(path, options = {}, cookie) { const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { Origin: baseUrl, ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" }); const text = await response.text(); return { response, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text, cookie: response.headers.get("set-cookie")?.split(";")[0] }; }

try {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "compliance" } });
  const email = `qa-compliance-${Date.now()}@example.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), fullName: "Compliance MFA QA", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); userId = user.id;
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal: "compliance" }) });
  assert.equal(login.response.status, 200); assert.equal(login.body.data.nextAction, "MFA_ENROLLMENT"); assert(login.cookie);
  assert.equal((await request("/api/v1/compliance/screenings", {}, login.cookie)).response.status, 403, "Password-only Compliance session received queue access.");
  assert.equal((await request("/api/v1/admin/compliance/rules", {}, login.cookie)).response.status, 403, "Compliance identity entered Admin rule management.");
  const setup = await request("/api/v1/auth/mfa/setup", { method: "POST" }, login.cookie); assert.equal(setup.response.status, 200); assert(setup.body.data.secret);
  const confirm = await request("/api/v1/auth/mfa/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totp(setup.body.data.secret) }) }, login.cookie); assert.equal(confirm.response.status, 200); assert.equal(confirm.body.data.recoveryCodes.length, 10);
  assert.equal((await request("/api/v1/compliance/screenings", {}, login.cookie)).response.status, 200, "MFA-verified Compliance session could not open the queue.");
  assert.equal((await request("/compliance", {}, login.cookie)).response.status, 200, "Compliance application did not render after MFA.");
  const returning = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal: "compliance" }) }); assert.equal(returning.body.data.nextAction, "MFA_CHALLENGE");
  const recovery = await request("/api/v1/auth/mfa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: confirm.body.data.recoveryCodes[0] }) }, returning.cookie); assert.equal(recovery.response.status, 200); assert.equal(recovery.body.data.recoveryCodeUsed, true);
  console.log("Compliance portal verification passed: portal isolation, mandatory MFA enrollment/challenge, recovery codes, queue authorization, and application rendering.");
} finally {
  if (userId) { await prisma.userEvent.deleteMany({ where: { userId } }); await prisma.auditLog.deleteMany({ where: { actorId: userId } }); await prisma.user.delete({ where: { id: userId } }); }
  await prisma.$disconnect();
}
