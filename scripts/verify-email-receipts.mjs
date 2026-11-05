import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { loadNotificationWorker, sourceModule } from "./lib/load-notification-worker-for-test.mjs";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
const origin = new URL(process.env.TEST_BASE_URL ?? "http://invalid");
if (![database.hostname, origin.hostname].every(host => ["localhost", "127.0.0.1", "[::1]"].includes(host)) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Email receipt verification requires a generated disposable local schema.");
if (!process.env.RESEND_WEBHOOK_SECRET) throw new Error("Provide a synthetic RESEND_WEBHOOK_SECRET to the isolated runner.");
const prisma = new PrismaClient();
const marker = randomBytes(8).toString("hex");
const fetchOriginal = globalThis.fetch;
const environment = Object.fromEntries(["EMAIL_DELIVERY_ENABLED", "RESEND_API_KEY", "EMAIL_FROM"].map(key => [key, process.env[key]]));
const users = []; const hashes = new Set(); const deliveryIds = [];
const callback = new URL("/api/v1/notifications/email-events", origin);
const key = Buffer.from(process.env.RESEND_WEBHOOK_SECRET.slice(6), "base64");
let send;
function signed(raw, id = `msg_${marker}_${randomUUID()}`, timestamp = Math.floor(Date.now() / 1000), secret = key) {
  return { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${createHmac("sha256", secret).update(`${id}.${timestamp}.${raw}`).digest("base64")}` };
}
function payload(type, reference, occurredAt = new Date()) {
  return JSON.stringify({ type, created_at: occurredAt.toISOString(), data: { email_id: reference, to: [`private-callback-${marker}@example.test`], subject: `PRIVATE_CALLBACK_CONTENT_${marker}` } });
}
async function event(type, reference, { id, occurredAt } = {}) {
  const raw = payload(type, reference, occurredAt); const headers = signed(raw, id);
  const response = await fetchOriginal(callback, { method: "POST", headers, body: raw });
  assert.equal(response.status, 200, await response.text());
  return { raw, headers };
}

try {
  const verification = await import(sourceModule(await readFile(new URL("../src/modules/notifications/webhook-signature.ts", import.meta.url), "utf8")));
  const vector = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const vectorHeaders = new Headers({ "svix-id": "msg_loFOjxBNrRLzqYUf", "svix-timestamp": "1731705121", "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" });
  assert.equal(verification.verifyEmailWebhook(vector, vectorHeaders, verification.emailWebhookKey("whsec_plJ3nmyCDGBKInavdOK15jsl"), 1731705121), "msg_loFOjxBNrRLzqYUf", "Published Svix vector failed.");
  assert.equal(verification.verifyEmailWebhook(vector, vectorHeaders, verification.emailWebhookKey("whsec_plJ3nmyCDGBKInavdOK15jsl"), 1731705422), null);
  const customer = await prisma.user.create({ data: { email: `receipts-${marker}@example.test`, fullName: "Synthetic receipt customer", status: "ACTIVE", passwordHash: "not-used" } }); users.push(customer.id);
  const { runEmailDeliveryWorker, security } = await loadNotificationWorker(prisma, customer.id);
  async function delivery(label, { reference = randomUUID(), recipient = `${label}-${marker}@example.test`, queued = false } = {}) {
    const hash = security.hashEmailRecipient(recipient); hashes.add(hash);
    const notification = await prisma.notification.create({ data: { userId: customer.id, eventType: "SYNTHETIC_RECEIPT", title: "Synthetic receipt", body: "No real message", idempotencyKey: `receipt:${marker}:${label}` } });
    const row = await prisma.notificationDelivery.create({ data: { notificationId: notification.id, channel: "EMAIL", idempotencyKey: `receipt:${marker}:${label}:email`, status: queued ? "QUEUED" : "SENT", nextAttemptAt: queued ? new Date(Date.now() - 1000) : null, attempts: queued ? 0 : 1, providerReference: queued ? null : reference, recipientHash: queued ? null : hash, ...security.encryptOutboxPayload({ recipient }) } });
    deliveryIds.push(row.id);
    return { ...row, reference, recipient, hash };
  }
  const saved = id => prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
  const delivered = await delivery("delivered");
  const receipt = await event("email.delivered", delivered.reference);
  assert.equal((await saved(delivered.id)).status, "DELIVERED"); assert((await saved(delivered.id)).deliveredAt);
  const replay = () => fetchOriginal(callback, { method: "POST", headers: signed(receipt.raw, receipt.headers["svix-id"]), body: receipt.raw });
  assert((await Promise.all([replay(), replay()])).every(response => response.status === 200));
  assert.equal(await prisma.emailWebhookEvent.count({ where: { messageId: receipt.headers["svix-id"] } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "notification.email_receipt_recorded", entityId: delivered.id } }), 1);
  await event("email.sent", delivered.reference, { occurredAt: new Date(Date.now() - 60_000) });
  assert.equal((await saved(delivered.id)).status, "DELIVERED", "Late sent event regressed delivery.");
  for (const headers of [{ "Content-Type": "application/json" }, signed(receipt.raw, undefined, undefined, randomBytes(32)), signed(receipt.raw, undefined, Math.floor(Date.now() / 1000) - 600), signed(receipt.raw, undefined, Math.floor(Date.now() / 1000) + 600)]) assert.equal((await fetchOriginal(callback, { method: "POST", headers, body: receipt.raw })).status, 401);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: receipt.headers, body: `${receipt.raw} ` })).status, 401);
  const conflict = payload("email.failed", delivered.reference);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: signed(conflict, receipt.headers["svix-id"]), body: conflict })).status, 409);
  const rotated = signed(receipt.raw); rotated["svix-signature"] = `v1,${randomBytes(32).toString("base64")} ${rotated["svix-signature"]}`;
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: rotated, body: receipt.raw })).status, 200);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: signed("invalid JSON"), body: "invalid JSON" })).status, 400);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: "compressed" })).status, 415);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(65_537) })).status, 413);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 17; i++) controller.enqueue(new Uint8Array(4096)); controller.close(); } });
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" })).status, 413);
  const ignored = payload("email.opened", delivered.reference); const ignoredHeaders = signed(ignored);
  assert.equal((await fetchOriginal(callback, { method: "POST", headers: ignoredHeaders, body: ignored })).status, 200);
  assert.equal(await prisma.emailWebhookEvent.count({ where: { messageId: ignoredHeaders["svix-id"] } }), 0);

  const bounced = await delivery("bounced"); await event("email.bounced", bounced.reference);
  assert.equal((await saved(bounced.id)).status, "FAILED");
  let suppression = await prisma.emailSuppression.findUniqueOrThrow({ where: { recipientHash: bounced.hash } });
  assert(suppression.active);
  const complained = await delivery("complained"); await event("email.complained", complained.reference);
  await event("email.delivered", complained.reference, { occurredAt: new Date(Date.now() + 1000) });
  assert.equal((await saved(complained.id)).status, "FAILED", "Delivery event cleared a complaint.");
  const providerSuppressed = await delivery("provider-suppressed"); await event("email.suppressed", providerSuppressed.reference);
  assert((await prisma.emailSuppression.findUniqueOrThrow({ where: { recipientHash: providerSuppressed.hash } })).active);
  const failure = await delivery("provider-failed"); await event("email.failed", failure.reference);
  assert.equal((await saved(failure.id)).status, "FAILED"); assert.equal(await prisma.emailSuppression.count({ where: { recipientHash: failure.hash } }), 0);

  process.env.EMAIL_DELIVERY_ENABLED = "true"; process.env.RESEND_API_KEY = "synthetic-no-network-key"; process.env.EMAIL_FROM = "DeshDak <mail@example.test>";
  let sends = 0;
  globalThis.fetch = async (url, options) => { assert.equal(url, "https://api.resend.com/emails"); assert.equal(options.redirect, "error"); sends++; return send(options); };
  const blocked = await delivery("blocked-followup", { queued: true, recipient: bounced.recipient });
  send = () => { throw new Error("Suppressed recipient must never reach provider transport"); };
  assert.equal((await runEmailDeliveryWorker()).suppressed, 1); assert.equal(sends, 0); assert.equal((await saved(blocked.id)).status, "FAILED");
  const early = await delivery("early", { queued: true });
  send = async () => { await event("email.delivered", early.reference); assert.equal((await prisma.emailWebhookEvent.findFirstOrThrow({ where: { providerReference: early.reference } })).processedAt, null); return new Response(JSON.stringify({ id: early.reference })); };
  assert.equal((await runEmailDeliveryWorker()).accepted, 1); assert.equal((await saved(early.id)).status, "DELIVERED");

  const role = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
  const admin = await prisma.user.create({ data: { email: `receipt-admin-${marker}@example.test`, fullName: "Synthetic receipt reviewer", status: "ACTIVE", passwordHash: "not-used", roles: { create: { roleId: role.id } } } }); users.push(admin.id);
  async function token(portal, mfa) {
    const session = await prisma.authSession.create({ data: { userId: admin.id, portal, expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: mfa ? new Date() : null } });
    return new SignJWT({ email: admin.email, name: admin.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(admin.id).setIssuer(process.env.AUTH_ISSUER).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  }
  const adminToken = await token("admin", true); const wrongPortal = await token("customer", true); const noMfa = await token("admin", false);
  const headers = value => ({ ...(value ? { Cookie: `crossly_session=${value}` } : {}), Origin: origin.origin, "Content-Type": "application/json" });
  const listUrl = new URL("/api/v1/admin/email-suppressions", origin);
  for (const value of [null, wrongPortal, noMfa]) assert.equal((await fetchOriginal(listUrl, { headers: headers(value) })).status, 403);
  const listing = await fetchOriginal(listUrl, { headers: headers(adminToken) }); assert.equal(listing.status, 200); assert.match(listing.headers.get("cache-control"), /no-store/);
  const listingText = await listing.text(); assert(!listingText.includes(bounced.hash)); assert(!listingText.includes(bounced.recipient));
  const url = new URL(`/api/v1/admin/email-suppressions/${suppression.id}/release`, origin);
  const review = { version: suppression.version, reason: "Synthetic recipient correction and consent reviewed", evidenceReference: `controlled-evidence-${marker}`, verificationConfirmed: true };
  const release = (body, token = adminToken, extra = {}) => fetchOriginal(url, { method: "POST", headers: { ...headers(token), ...extra }, body: JSON.stringify(body) });
  assert.equal((await release(review, null)).status, 403); assert.equal((await release(review, noMfa)).status, 403);
  assert.equal((await release(review, adminToken, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await release({ ...review, verificationConfirmed: false })).status, 422);
  assert.equal((await release({ ...review, evidenceReference: "secret=must-not-be-recorded" })).status, 422);
  assert.equal((await release(review)).status, 200); assert.equal((await (await release(review)).json()).data.replayed, true);
  assert.equal(await prisma.auditLog.count({ where: { entityId: suppression.id, action: "notification.email_suppression_released" } }), 1);
  await event("email.bounced", bounced.reference, { occurredAt: new Date(Date.now() - 60_000) });
  suppression = await prisma.emailSuppression.findUniqueOrThrow({ where: { id: suppression.id } }); assert.equal(suppression.active, false, "Old replay reactivated a reviewed block.");
  const approved = await delivery("approved-followup", { queued: true, recipient: bounced.recipient });
  send = async () => new Response(JSON.stringify({ id: approved.reference }));
  assert.equal((await runEmailDeliveryWorker()).accepted, 1); assert.equal((await saved(blocked.id)).status, "FAILED", "Release resent a failed historical message.");
  await event("email.bounced", bounced.reference, { occurredAt: new Date(Date.now() + 2000) });
  assert((await prisma.emailSuppression.findUniqueOrThrow({ where: { id: suppression.id } })).active);
  assert.equal((await release({ ...review, version: suppression.version })).status, 409);
  const retained = JSON.stringify(await prisma.emailWebhookEvent.findMany({ where: { messageId: { contains: marker } } }));
  assert(!retained.includes("PRIVATE_CALLBACK_CONTENT_")); assert(!retained.includes(`private-callback-${marker}@example.test`));
  console.log("Email receipt verification passed: published signature vector, authentication/raw bytes/time/replays/body bounds, receipt ordering and early correlation, private recipient suppression, MFA/versioned audited release and safe future-send behavior. All callbacks and sends were synthetic.");
} finally {
  globalThis.fetch = fetchOriginal;
  for (const [name, value] of Object.entries(environment)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await prisma.emailSuppression.deleteMany({ where: { recipientHash: { in: [...hashes] } } });
  await prisma.emailWebhookEvent.deleteMany({ where: { messageId: { contains: marker } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: deliveryIds } }] } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
