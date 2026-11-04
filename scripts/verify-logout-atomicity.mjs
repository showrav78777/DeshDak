import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// Fault injection is permitted only inside the disposable launch schema.
const database = new URL(process.env.DATABASE_URL);
const schema = database.searchParams.get("schema");
assert(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert.match(schema ?? "", /^crossly_launch_verify_[a-f0-9]{16}$/);
const origin = new URL(process.env.TEST_BASE_URL).origin;
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
const prisma = new PrismaClient();
const marker = randomBytes(8).toString("hex");
const functionName = `logout_probe_${marker}`;
const target = `"${schema}"."AuditLog"`;
const probe = `"${schema}"."${functionName}"`;
let userId;
let triggerCreated = false;
try {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "customer_personal" } });
  const password = `Logout-${marker}-Strong!`;
  const user = await prisma.user.create({ data: { email: `logout-${marker}@example.test`, fullName: "Synthetic logout fixture", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId: role.id } } } });
  userId = user.id;
  assert.match(userId, /^[a-f0-9-]{36}$/i);
  const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: user.email, password, portal: "customer" }) });
  assert.equal(login.status, 200);
  const sessionId = (await login.json()).data.session.id;
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie);
  const logout = () => fetch(`${origin}/api/v1/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin }, signal: AbortSignal.timeout(30_000) });
  const evidence = async () => ({
    audit: await prisma.auditLog.count({ where: { entityId: sessionId, action: "auth.session_revoked" } }),
    activity: await prisma.userEvent.count({ where: { authSessionId: sessionId, eventType: "AUTH_LOGOUT" } }),
  });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${probe}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic logout audit failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" BEFORE INSERT ON ${target} FOR EACH ROW WHEN (NEW."actorId" = '${userId}' AND NEW."action" = 'auth.session_revoked') EXECUTE FUNCTION ${probe}()`);
  triggerCreated = true;
  const failed = await logout();
  assert.equal(failed.status, 500, "Audit failure must not report successful logout.");
  assert(!failed.headers.get("set-cookie")?.includes("Max-Age=0"), "Failed commit cleared the session cookie.");
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt, null, "Failed audit did not roll back session revocation.");
  assert.deepEqual(await evidence(), { audit: 0, activity: 0 });

  // Exceed the former 5-second interactive transaction timeout deterministically.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${probe}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(6); RETURN NEW; END $$`);
  const started = Date.now();
  const success = await logout();
  assert.equal(success.status, 200, "Slow atomic logout failed.");
  assert(Date.now() - started >= 6_000, "Slow-database probe did not execute.");
  assert.equal((await success.json()).data.loggedOut, true);
  assert(success.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert(success.headers.get("clear-site-data")?.includes("cookies"));
  assert((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt);
  assert.deepEqual(await evidence(), { audit: 1, activity: 1 });
  assert.equal((await fetch(`${origin}/api/v1/users/me`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await logout()).status, 200, "An already revoked cookie must permit safe repeat logout.");
  assert.deepEqual(await evidence(), { audit: 1, activity: 1 }, "Repeat logout duplicated committed evidence.");
  console.log("Logout atomicity passed: audit failure rolls back all writes without clearing cookies; a six-second database delay commits revocation/audit/activity together; revoked-session replay is denied and repeated logout is safe.");
} finally {
  if (triggerCreated) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${functionName}" ON ${target}`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${probe}()`);
  if (userId) {
    await prisma.userEvent.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
}
