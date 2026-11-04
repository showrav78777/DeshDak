import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { canTransitionRma } from "@/modules/rma/policy";
import { returnTrackingSchema } from "@/modules/rma/schemas";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/rmas/[rmaId]/return">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") return apiError("AUTHENTICATION_REQUIRED", "Sign in to update your return.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This update must originate from the protected application.", 403);
  const parsed = returnTrackingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the return tracking number.", 422);
  const { rmaId } = await context.params;
  const current = await prisma.rma.findFirst({ where: { id: rmaId, customerId: session.userId }, select: { id: true, reference: true, status: true, returnRequired: true, returnTrackingNumber: true, version: true } });
  if (!current) return apiError("RMA_NOT_FOUND", "Claim was not found.", 404);
  if (!current.returnRequired || !canTransitionRma(current.status, "RETURN_IN_TRANSIT")) return apiError("RETURN_TRACKING_NOT_ALLOWED", "This claim is not waiting for a physical return.", 409);
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.rma.updateMany({ where: { id: current.id, status: current.status, version: current.version }, data: { status: "RETURN_IN_TRANSIT", returnTrackingNumber: parsed.data.trackingNumber, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    await tx.rmaEvent.create({ data: { rmaId: current.id, fromStatus: current.status, toStatus: "RETURN_IN_TRANSIT", actorId: session.userId, note: "Customer submitted return tracking information.", metadata: { trackingNumber: parsed.data.trackingNumber } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "rma.return_tracking_submitted", entityType: "Rma", entityId: current.id, metadata: { previousTrackingNumberPresent: Boolean(current.returnTrackingNumber) } } });
    await createTransactionalNotification(tx, { userId: session.userId, eventType: "RMA_RETURN_IN_TRANSIT", title: "Return tracking saved", body: `Return tracking for ${current.reference} was recorded.`, deepLink: `/rmas/${current.id}`, entityType: "Rma", entityId: current.id, idempotencyKey: `rma-notification:return:${current.id}:${current.version}` });
    return tx.rma.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, reference: true, status: true, returnTrackingNumber: true, version: true } });
  });
  if (!updated) return apiError("RMA_STATE_CHANGED", "The claim changed while this update was being saved. Refresh and retry.", 409);
  return apiSuccess({ rma: updated }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
