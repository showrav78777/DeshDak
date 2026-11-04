import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { canReviewPurchase, manualPurchaseActions, PurchaseEvidenceRequired, PurchaseReviewConflict, recordManualPurchaseReview, SupplierCorrectionInvalid } from "@/modules/sourcing/manual-purchase-review";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["APPROVE_FOR_PURCHASE", "MARK_PURCHASED", "PLACE_ON_HOLD"]), note: z.string().trim().min(3).max(500), supplierRecordId: z.string().uuid().optional() }).strict();

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/orders/[orderId]/purchase-review">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Only an administrator can approve or purchase an order.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Use the protected Admin application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose an action and add a short admin note.", 422, z.treeifyError(parsed.error));
  const { orderId } = await context.params;
  const action = manualPurchaseActions[parsed.data.action];
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true, status: true, orderNumber: true } });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  if (!canReviewPurchase(order.status, parsed.data.action)) return apiError("ORDER_NOT_READY", "This action is not available for the order's current stage.", 409);
  try {
  const updated = await prisma.$transaction(async (tx) => {
    const result = await recordManualPurchaseReview(tx, { orderId, orderNumber: order.orderNumber, previousStatus: order.status, action: parsed.data.action, actorId: session.userId, internalNote: parsed.data.note, supplierRecordId: parsed.data.supplierRecordId });
    const notification = orderNotification({ userId: order.customerId, orderId, orderNumber: order.orderNumber, status: result.status, eventId: result.history.id, note: result.publicNote });
    if (notification) await createTransactionalNotification(tx, notification);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  return apiSuccess({ order: updated, message: `Order ${action.label}.` });
  } catch (error) {
    if (error instanceof PurchaseReviewConflict) return apiError("ORDER_NOT_READY", error.message, 409);
    if (error instanceof PurchaseEvidenceRequired) return apiError("SUPPLIER_RECORDS_REQUIRED", error.message, 409);
    if (error instanceof SupplierCorrectionInvalid) return apiError("SUPPLIER_CORRECTION_INVALID", error.message, 409);
    throw error;
  }
}
