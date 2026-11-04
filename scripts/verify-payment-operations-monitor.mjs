import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient(); const marker = randomBytes(8).toString("hex"); const origin = process.env.TEST_BASE_URL ?? "http://localhost:3000"; const secret = process.env.MAINTENANCE_JOB_SECRET;
if (!secret || secret.length < 32) throw new Error("A temporary MAINTENANCE_JOB_SECRET is required.");
const ids = { users: [], payments: [], run: null };
try {
  const roles = await Promise.all(["admin", "finance"].map((code) => prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } })));
  for (const [index, role] of roles.entries()) { const user = await prisma.user.create({ data: { email: `payment-monitor-${index}-${marker}@example.test`, fullName: `Payment Monitor ${index}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(user.id); }
  const staleAt = new Date(Date.now() - 2 * 60 * 60_000);
  const stuck = await prisma.paymentIntent.create({ data: { reference: `MON-STUCK-${marker}`, idempotencyKey: `monitor-stuck-${marker}`, provider: "SSLCOMMERZ", amount: 100, currency: "BDT", status: "PENDING", updatedAt: staleAt } }); ids.payments.push(stuck.id);
  const risk = await prisma.paymentIntent.create({ data: { reference: `MON-RISK-${marker}`, idempotencyKey: `monitor-risk-${marker}`, provider: "SSLCOMMERZ", amount: 200, currency: "BDT", status: "PENDING", gatewayPayload: { reviewRequired: true }, updatedAt: staleAt } }); ids.payments.push(risk.id);
  const unauthorized = await fetch(`${origin}/api/v1/internal/maintenance/payment-operations`, { method: "POST", headers: { Authorization: "Bearer wrong" } }); assert.equal(unauthorized.status, 401);
  const response = await fetch(`${origin}/api/v1/internal/maintenance/payment-operations`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } }); const body = await response.json(); assert.equal(response.status, 200); ids.run = body.data.runId;
  assert(body.data.summary.byType.PAYMENT_PROCESSING_STUCK >= 1); assert(body.data.summary.byType.PAYMENT_RISK_REVIEW_OVERDUE >= 1);
  const alerts = await prisma.notification.count({ where: { entityType: "PaymentIntent", entityId: { in: ids.payments } } }); assert(alerts >= 4, "Admin and Finance alerts were not created for both issues.");
  console.log("Payment operations monitor verification passed: scheduler authentication, stuck/risk classification, role alerts, and bounded no-state-change monitoring.");
} finally {
  await prisma.notification.deleteMany({ where: { entityType: "PaymentIntent", entityId: { in: ids.payments } } });
  if (ids.run) { await prisma.auditLog.deleteMany({ where: { entityType: "MaintenanceJobRun", entityId: ids.run } }); await prisma.maintenanceJobRun.deleteMany({ where: { id: ids.run } }); }
  await prisma.paymentIntent.deleteMany({ where: { id: { in: ids.payments } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); await prisma.$disconnect();
}
