import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["RESOLVED", "CANCELLED"]), resolutionNote: z.string().trim().min(10).max(2000), customerNote: z.string().trim().min(3).max(500) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/admin/package-exceptions/[exceptionId]/resolve">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This resolution must originate from the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide an internal resolution and a customer-safe update.", 422);
  const { exceptionId } = await context.params;
  const current = await prisma.packageException.findUnique({ where: { id: exceptionId }, include: { order: { select: { id: true, orderNumber: true, customerId: true, shipForMeRequest: { select: { id: true } } } } } });
  if (!current) return apiError("PACKAGE_EXCEPTION_NOT_FOUND", "Parcel exception was not found.", 404);
  if (current.status !== "OPEN") return apiSuccess({ exception: { id: current.id, reference: current.reference, status: current.status }, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const resolved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.packageException.updateMany({ where: { id: current.id, status: "OPEN" }, data: { status: parsed.data.action, resolutionNote: parsed.data.resolutionNote, customerNote: parsed.data.customerNote, resolvedById: session.userId, resolvedAt: new Date() } });
    if (claimed.count !== 1) return null;
    await createTransactionalNotification(tx, { userId: current.order.customerId, eventType: "PACKAGE_EXCEPTION_RESOLVED", title: `Parcel review updated · ${current.order.orderNumber}`, body: parsed.data.customerNote, deepLink: current.order.shipForMeRequest ? `/ship-for-me/${current.order.shipForMeRequest.id}` : `/orders/${current.order.id}`, entityType: "PackageException", entityId: current.id, priority: "HIGH", channels: ["IN_APP", "EMAIL"], idempotencyKey: `package-exception-resolution:${current.id}` });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "admin.package_exception_resolved", entityType: "PackageException", entityId: current.id, metadata: { action: parsed.data.action, idempotencyKey } } });
    return tx.packageException.findUniqueOrThrow({ where: { id: current.id } });
  });
  if (!resolved) return apiError("EXCEPTION_STATE_CHANGED", "This exception changed while it was being resolved.", 409);
  return apiSuccess({ exception: { id: resolved.id, reference: resolved.reference, status: resolved.status }, idempotentReplay: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
