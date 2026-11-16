import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { Prisma, PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Security cleanup tests require a generated disposable local schema.");
const prisma = new PrismaClient();
const SECURITY_CLEANUP_KEY = "security_cleanup";
const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000";
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname), "Security cleanup tests require a local application.");
const maintenanceSecret = process.env.MAINTENANCE_JOB_SECRET;
const marker = randomBytes(8).toString("hex");
const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60_000);
const futureLock = new Date(Date.now() + 5 * 60_000);
let userId; let productId; let orderId; let notificationId; let reservationId; let auditId; let rateId; let aiConversationId; const runIds = [];
const originalConfiguration = await prisma.maintenanceConfiguration.findUnique({ where: { key: SECURITY_CLEANUP_KEY } });
const originalState = await prisma.maintenanceJobState.findUnique({ where: { jobKey: SECURITY_CLEANUP_KEY } });

function assert(condition, message) { if (!condition) throw new Error(message); }
async function invokeCleanup() {
  assert(maintenanceSecret?.length >= 32, "Set a temporary MAINTENANCE_JOB_SECRET of at least 32 characters for the server and this test.");
  const response = await fetch(`${baseUrl}/api/v1/internal/maintenance/security-cleanup`, { method: "POST", headers: { Authorization: `Bearer ${maintenanceSecret}` } });
  const result = await response.json();
  assert(response.status === 200, `Protected cleanup endpoint failed: ${response.status}`);
  return result.data;
}

async function verifyAdminControls(userId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
  const session = await prisma.authSession.create({ data: { userId, portal: "admin", expiresAt: new Date(Date.now() + 600_000), mfaVerifiedAt: new Date(), clientType: "WEB", clientName: "Synthetic cleanup test" } });
  const jwt = await new SignJWT({ roles: ["admin"] })
    .setProtectedHeader({ alg: "HS256" }).setSubject(userId).setJti(session.id)
    .setIssuer(process.env.AUTH_ISSUER ?? baseUrl).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = { Cookie: `crossly_session=${jwt}; __Host-crossly_session=${jwt}`, Origin: baseUrl, "Content-Type": "application/json" };
  const adminUrl = `${baseUrl}/api/v1/admin/maintenance`;
  const savePolicy = inventoryBatchSize => fetch(`${adminUrl}/configuration`, {
    method: "PATCH", headers, body: JSON.stringify({ securityTokenRetentionDays: 365, rateLimitRetentionHours: 720, mfaEnrollmentRetentionHours: 168, inventoryBatchSize }),
  });
  const runCleanup = () => fetch(`${adminUrl}/run`, { method: "POST", headers });
  const loadPolicy = () => prisma.maintenanceConfiguration.findUniqueOrThrow({ where: { key: SECURITY_CLEANUP_KEY } });
  const loadState = () => prisma.maintenanceJobState.findUniqueOrThrow({ where: { jobKey: SECURITY_CLEANUP_KEY } });
  const saved = await savePolicy(101);
  assert(saved.status === 200 && (await saved.json()).data.configuration.inventoryBatchSize === 101, `Admin policy save failed: ${saved.status}`);
  assert((await loadPolicy()).updatedById === userId, "Policy save did not record the Admin.");
  await prisma.maintenanceJobState.update({ where: { jobKey: SECURITY_CLEANUP_KEY }, data: { lockedUntil: null } });
  const token = await prisma.securityToken.create({ data: { userId, purpose: "PASSWORD_RESET", tokenHash: randomBytes(32).toString("hex"), expiresAt: oldDate } });
  const findToken = () => prisma.securityToken.findUnique({ where: { id: token.id } });

  // Inject a run-record insertion failure to check that claiming rolls back.
  const fault = `cleanup_test_${marker}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger AS $$ BEGIN IF NEW."triggeredById" = '${userId}' THEN RAISE EXCEPTION 'SYNTHETIC_CLEANUP_CLAIM_FAILURE'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "MaintenanceJobRun" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
    try {
      assert((await runCleanup()).status === 500, "The injected claim failure was not reported.");
      assert((await loadState()).lockedUntil === null, "The failed run insert stranded the lease.");
      assert(await findToken(), "The failed claim deleted cleanup data.");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${fault}" ON "MaintenanceJobRun"`);
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
  }

  const completed = await runCleanup();
  assert(completed.status === 200, `Authorized Admin cleanup failed: ${completed.status}`);
  const outcome = (await completed.json()).data;
  runIds.push(outcome.runId);
  assert(outcome.status === "SUCCEEDED" && !(await findToken()), "Authorized cleanup did not remove the expired fixture.");
  assert(await prisma.auditLog.count({ where: { actorId: userId, entityId: outcome.runId, action: "maintenance.security_cleanup_completed" } }) === 1, "Admin cleanup audit was missing.");
  await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  assert((await runCleanup()).status === 403 && (await savePolicy(102)).status === 403, "Revoked Admin session could still use maintenance controls.");
  assert((await loadPolicy()).inventoryBatchSize === 101 && (await loadState()).lockedUntil === null, "Rejected requests changed maintenance state.");
}

try {
  await prisma.maintenanceConfiguration.upsert({ where: { key: SECURITY_CLEANUP_KEY }, update: { securityTokenRetentionDays: 365, rateLimitRetentionHours: 720, mfaEnrollmentRetentionHours: 168, inventoryBatchSize: 100 }, create: { key: SECURITY_CLEANUP_KEY, securityTokenRetentionDays: 365, rateLimitRetentionHours: 720, mfaEnrollmentRetentionHours: 168, inventoryBatchSize: 100 } });
  await prisma.maintenanceJobState.upsert({ where: { jobKey: SECURITY_CLEANUP_KEY }, update: { lockedUntil: null }, create: { jobKey: SECURITY_CLEANUP_KEY } });
  const user = await prisma.user.create({ data: { email: `cleanup-${marker}@example.test`, fullName: "Cleanup Test", passwordHash: "not-a-login-password", status: "ACTIVE" } }); userId = user.id;
  const product = await prisma.product.create({ data: { titleEn: `Cleanup product ${marker}`, status: "DRAFT", variants: { create: { sku: `CLEAN-${marker}`, inventoryQuantity: 0, stockStatus: "OUT_OF_STOCK" } } }, include: { variants: true } }); productId = product.id;
  const order = await prisma.order.create({ data: { orderNumber: `CLEAN-${marker}`, customerId: user.id, status: "PENDING_PAYMENT", grandTotal: 0 } }); orderId = order.id;
  const reservation = await prisma.inventoryReservation.create({ data: { orderId: order.id, productVariantId: product.variants[0].id, quantity: 3, status: "ACTIVE", expiresAt: oldDate } }); reservationId = reservation.id;
  const token = await prisma.securityToken.create({ data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash: randomBytes(32).toString("hex"), expiresAt: oldDate } });
  const notification = await prisma.notification.create({ data: { userId: user.id, eventType: "CLEANUP_TEST", category: "SECURITY", title: "Cleanup test", body: "No secret content", idempotencyKey: `cleanup-notification-${marker}`, deliveries: { create: { channel: "EMAIL", status: "QUEUED", idempotencyKey: `security-token:${token.id}:email`, nextAttemptAt: oldDate, securePayloadCiphertext: "encrypted", securePayloadIv: "iv", securePayloadTag: "tag" } } } }); notificationId = notification.id;
  const rate = await prisma.securityRateLimit.create({ data: { scope: `cleanup-${marker}`, keyHash: randomBytes(32).toString("hex"), attempts: 1, windowStartedAt: oldDate, createdAt: oldDate, updatedAt: oldDate } }); rateId = rate.id;
  const mfa = await prisma.mfaEnrollment.create({ data: { userId: user.id, secretCiphertext: "encrypted", secretIv: "iv", secretTag: "tag", expiresAt: oldDate } });
  const aiConversation = await prisma.aiConversation.create({ data: { tokenHash: randomBytes(32).toString("hex"), expiresAt: oldDate, messages: { create: [{ turnKey: crypto.randomUUID(), role: "USER", body: "Expired anonymous support question" }, { turnKey: crypto.randomUUID(), role: "ASSISTANT", body: "Expired public response" }] } } }); aiConversationId = aiConversation.id;
  const audit = await prisma.auditLog.create({ data: { actorId: user.id, action: "cleanup.test_history_must_remain", entityType: "User", entityId: user.id } }); auditId = audit.id;

  const result = await invokeCleanup(); runIds.push(result.runId);
  assert(!result.skipped, "The cleanup unexpectedly skipped its available lock.");
  assert(!(await prisma.securityToken.findUnique({ where: { id: token.id } })), "The retained expired token was not deleted.");
  const delivery = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: `security-token:${token.id}:email` } });
  assert(delivery?.status === "FAILED" && !delivery.securePayloadCiphertext && !delivery.securePayloadIv && !delivery.securePayloadTag, "Expired protected email material was not wiped and failed closed.");
  assert(!(await prisma.securityRateLimit.findUnique({ where: { id: rate.id } })), "The stale rate-limit row was not deleted.");
  assert(!(await prisma.mfaEnrollment.findUnique({ where: { id: mfa.id } })), "The expired MFA enrollment was not deleted.");
  assert(!(await prisma.aiConversation.findUnique({ where: { id: aiConversation.id } })), "The expired anonymous AI transcript was not deleted.");
  const [released, variant, retainedAudit] = await Promise.all([prisma.inventoryReservation.findUnique({ where: { id: reservation.id } }), prisma.productVariant.findUnique({ where: { id: product.variants[0].id } }), prisma.auditLog.findUnique({ where: { id: audit.id } })]);
  assert(released?.status === "EXPIRED" && variant?.inventoryQuantity === 3, "Expired inventory was not released atomically.");
  assert(retainedAudit, "Cleanup deleted protected audit history.");

  await prisma.maintenanceJobState.update({ where: { jobKey: SECURITY_CLEANUP_KEY }, data: { lockedUntil: futureLock } });
  const skipped = await invokeCleanup(); runIds.push(skipped.runId);
  assert(skipped.skipped && skipped.status === "SKIPPED", "The overlap lock allowed a concurrent cleanup run.");
  await verifyAdminControls(userId);
  console.log("Security cleanup verification passed: Admin policy save, run claim rollback, authorized cleanup and audit, revoked-session rejection, encrypted payload purge, bounded security/AI retention, inventory release, audit preservation, and overlap lock.");
} finally {
  if (runIds.length) await prisma.maintenanceJobRun.deleteMany({ where: { id: { in: runIds } } });
  if (reservationId) await prisma.auditLog.deleteMany({ where: { entityType: "InventoryReservation", entityId: reservationId } });
  if (reservationId) await prisma.inventoryReservation.deleteMany({ where: { id: reservationId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (notificationId) await prisma.notification.deleteMany({ where: { id: notificationId } });
  if (auditId) await prisma.auditLog.deleteMany({ where: { id: auditId } });
  if (rateId) await prisma.securityRateLimit.deleteMany({ where: { id: rateId } });
  if (aiConversationId) await prisma.aiConversation.deleteMany({ where: { id: aiConversationId } });
  if (userId) await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  if (originalConfiguration) await prisma.maintenanceConfiguration.update({ where: { key: SECURITY_CLEANUP_KEY }, data: { securityTokenRetentionDays: originalConfiguration.securityTokenRetentionDays, rateLimitRetentionHours: originalConfiguration.rateLimitRetentionHours, mfaEnrollmentRetentionHours: originalConfiguration.mfaEnrollmentRetentionHours, inventoryBatchSize: originalConfiguration.inventoryBatchSize, updatedById: originalConfiguration.updatedById } });
  else await prisma.maintenanceConfiguration.deleteMany({ where: { key: SECURITY_CLEANUP_KEY } });
  if (originalState) await prisma.maintenanceJobState.update({ where: { jobKey: SECURITY_CLEANUP_KEY }, data: { lockedUntil: originalState.lockedUntil, lastStartedAt: originalState.lastStartedAt, lastFinishedAt: originalState.lastFinishedAt, lastStatus: originalState.lastStatus, lastSummary: originalState.lastSummary === null ? Prisma.DbNull : originalState.lastSummary, lastErrorCode: originalState.lastErrorCode } });
  else await prisma.maintenanceJobState.deleteMany({ where: { jobKey: SECURITY_CLEANUP_KEY } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
