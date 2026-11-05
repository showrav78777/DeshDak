import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadNotificationWorker } from "./lib/load-notification-worker-for-test.mjs";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) {
  throw new Error("Notification-worker verification requires a generated disposable local schema.");
}
const prisma = new PrismaClient();
const marker = randomBytes(8).toString("hex");
const originalFetch = globalThis.fetch;
const originalEnvironment = Object.fromEntries(["EMAIL_DELIVERY_ENABLED", "RESEND_API_KEY", "EMAIL_FROM"].map(key => [key, process.env[key]]));
let user;
const calls = [];
let send;

try {
  user = await prisma.user.create({ data: { email: `delivery-${marker}@example.test`, fullName: "Synthetic email worker", status: "ACTIVE", passwordHash: "not-used" } });
  const { runEmailDeliveryWorker, security } = await loadNotificationWorker(prisma, user.id);
  process.env.EMAIL_DELIVERY_ENABLED = "true";
  process.env.RESEND_API_KEY = "synthetic-no-network-key";
  process.env.EMAIL_FROM = "DeshDak <delivery@example.test>";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails", "Unexpected network destination.");
    assert.equal(options.redirect, "error");
    assert(options.signal);
    assert.equal(options.headers.Authorization, "Bearer synthetic-no-network-key");
    calls.push(options.headers["Idempotency-Key"]);
    return send(options);
  };
  async function queued(label, delivery = {}) {
    const notification = await prisma.notification.create({ data: { userId: user.id, eventType: "SYNTHETIC_WORKER", title: "Synthetic update", body: "No real email is sent.", idempotencyKey: `notification:${marker}:${label}` } });
    return prisma.notificationDelivery.create({ data: { notificationId: notification.id, channel: "EMAIL", idempotencyKey: `delivery:${marker}:${label}`, nextAttemptAt: new Date(Date.now() - 1000), ...delivery } });
  }
  const accepted = await queued("accepted");
  send = async () => new Response(JSON.stringify({ id: "synthetic-accepted" }));
  const result = await runEmailDeliveryWorker();
  assert.equal(result.accepted, 1); assert.equal(result.delivered, 0);
  let saved = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: accepted.id } });
  assert.equal(saved.status, "SENT"); assert.equal(saved.providerReference, "synthetic-accepted"); assert.equal(saved.deliveredAt, null);
  await prisma.notificationDelivery.update({ where: { id: accepted.id }, data: { updatedAt: new Date(Date.now() - 60 * 60_000) } });
  const beforeRepeat = calls.length;
  assert.equal((await runEmailDeliveryWorker()).processed, 0); assert.equal(calls.length, beforeRepeat, "Accepted email was resent after aging.");

  const retry = await queued("retry");
  send = async () => { throw new Error("Synthetic provider outage with private diagnostic"); };
  assert.equal((await runEmailDeliveryWorker()).retried, 1);
  saved = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: retry.id } });
  assert.equal(saved.status, "QUEUED"); assert.equal(saved.attempts, 1); assert(saved.nextAttemptAt > new Date()); assert(!saved.lastError.includes("private diagnostic"));
  await prisma.notificationDelivery.update({ where: { id: retry.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  send = async () => new Response(JSON.stringify({ id: "synthetic-retry-accepted" }));
  assert.equal((await runEmailDeliveryWorker()).accepted, 1);
  assert.deepEqual(calls.slice(-2), [retry.idempotencyKey, retry.idempotencyKey]);

  const terminal = await queued("terminal", { attempts: 4, recipientHash: security.hashEmailRecipient(user.email), ...security.encryptOutboxPayload({ recipient: user.email }) });
  send = async () => new Response("unavailable", { status: 503 });
  assert.equal((await runEmailDeliveryWorker()).failed, 1);
  saved = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: terminal.id } });
  assert.equal(saved.status, "FAILED"); assert.equal(saved.attempts, 5); assert.equal(saved.nextAttemptAt, null);
  const expired = await queued("expired-final-lease", { attempts: 5, status: "SENT", updatedAt: new Date(Date.now() - 11 * 60_000) });
  const beforeExpired = calls.length;
  assert.equal((await runEmailDeliveryWorker()).failed, 1);
  assert.equal(calls.length, beforeExpired, "A sixth send attempt was made.");
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: expired.id } })).attempts, 5);
  const purged = await queued("purged-recipient", { attempts: 1, recipientHash: security.hashEmailRecipient(user.email) });
  const beforePurged = calls.length;
  assert.equal((await runEmailDeliveryWorker()).failed, 1);
  assert.equal(calls.length, beforePurged, "A purged recipient snapshot was resent.");
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: purged.id } })).status, "FAILED");

  const simultaneous = await queued("simultaneous");
  send = async () => { await new Promise(resolve => setTimeout(resolve, 100)); return new Response(JSON.stringify({ id: "synthetic-concurrent-accepted" })); };
  const beforeConcurrent = calls.length;
  const concurrent = await Promise.all([runEmailDeliveryWorker(), runEmailDeliveryWorker()]);
  assert.equal(concurrent.reduce((sum, item) => sum + item.accepted, 0), 1);
  assert.equal(calls.length, beforeConcurrent + 1);
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: simultaneous.id } })).attempts, 1);

  for (const completion of ["accepted", "failed"]) {
    const stale = await queued(`stale-${completion}`);
    let release; let reject; let entered;
    const started = new Promise(resolve => { entered = resolve; });
    send = () => { entered(); return new Promise((resolve, fail) => { release = resolve; reject = fail; }); };
    const first = runEmailDeliveryWorker();
    await Promise.race([started, first.then(() => { throw new Error("The stale-worker fixture did not enter its pending send."); })]);
    await prisma.notificationDelivery.update({ where: { id: stale.id }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
    const reference = randomUUID();
    send = async () => new Response(JSON.stringify({ id: reference }));
    assert.equal((await runEmailDeliveryWorker()).accepted, 1);
    if (completion === "accepted") release(new Response(JSON.stringify({ id: "obsolete-reference" })));
    else reject(new Error("Obsolete request failed"));
    const obsolete = await first;
    assert.equal(obsolete.accepted + obsolete.retried + obsolete.failed, 0);
    saved = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: stale.id } });
    assert.equal(saved.providerReference, reference); assert.equal(saved.status, "SENT"); assert.equal(saved.attempts, 2); assert.equal(saved.deliveredAt, null);
  }
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  const beforeDisabled = calls.length;
  assert.equal((await runEmailDeliveryWorker()).configured, false); assert.equal(calls.length, beforeDisabled);
  console.log("Notification-worker verification passed: acceptance is not delivery, accepted messages are not resent, stable idempotency/retry cap, concurrent claims, stale-completion fencing and disabled-provider safety. All provider responses were synthetic.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
