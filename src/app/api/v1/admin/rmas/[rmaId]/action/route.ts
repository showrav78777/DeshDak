import { Prisma, type RmaStatus } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { canTransitionRma, rmaStatusLabel } from "@/modules/rma/policy";
import { adminRmaActionSchema } from "@/modules/rma/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/rmas/[rmaId]/action">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This decision must originate from the protected Admin application.", 403);
  const parsed = adminRmaActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the claim decision.", 422);
  const { rmaId } = await context.params; const input = parsed.data;
  const current = await prisma.rma.findUnique({ where: { id: rmaId }, include: { order: { select: { orderNumber: true, grandTotal: true, currency: true } } } });
  if (!current) return apiError("RMA_NOT_FOUND", "Claim was not found.", 404);
  if (current.version !== input.version) return apiError("RMA_STATE_CHANGED", "This claim changed after the page loaded. Refresh before deciding.", 409);

  let nextStatus: RmaStatus = current.status;
  const data: Prisma.RmaUncheckedUpdateManyInput = { version: { increment: 1 }, adminNotes: input.note };
  if (input.action === "APPROVE") {
    nextStatus = "RETURN_APPROVED";
    data.returnRequired = input.returnRequired ?? false; data.returnInstructions = input.returnRequired ? input.returnInstructions : null; data.firstResponseAt = current.firstResponseAt ?? new Date();
  } else if (input.action === "REJECT") {
    nextStatus = "RETURN_REJECTED"; data.decision = "REJECT"; data.firstResponseAt = current.firstResponseAt ?? new Date(); data.resolvedAt = new Date();
  } else if (input.action === "MARK_RETURN_RECEIVED") {
    nextStatus = "RETURN_RECEIVED";
    if (!current.returnRequired) return apiError("RETURN_NOT_REQUIRED", "This claim does not require a physical return.", 409);
  } else if (input.action === "APPROVE_REFUND") {
    if (current.returnRequired && current.status !== "INSPECTED") return apiError("INSPECTION_REQUIRED", "A required physical return must be inspected before a refund is approved.", 409);
    nextStatus = "INSPECTED";
    const approved = new Prisma.Decimal(input.approvedRefundAmount!);
    data.approvedRefundAmount = approved; data.decision = approved.greaterThanOrEqualTo(current.order.grandTotal) ? "FULL_REFUND" : "PARTIAL_REFUND"; data.liabilityParty = input.liabilityParty!; data.refundDecisionById = session.userId; data.refundDecisionAt = new Date();
  } else if (input.action === "APPROVE_REPLACEMENT") {
    if (current.returnRequired && current.status !== "INSPECTED") return apiError("INSPECTION_REQUIRED", "A required physical return must be inspected before replacement approval.", 409);
    nextStatus = "REPLACED"; data.decision = "REPLACEMENT"; data.liabilityParty = input.liabilityParty!; data.resolvedAt = new Date();
  } else if (input.action === "CLOSE") {
    nextStatus = "CLOSED"; data.resolvedAt = new Date();
  }
  const sameStatusDecision = input.action === "APPROVE_REFUND" && current.status === "INSPECTED";
  if (!sameStatusDecision && !canTransitionRma(current.status, nextStatus)) return apiError("INVALID_RMA_TRANSITION", `Claim cannot move from ${rmaStatusLabel(current.status)} to ${rmaStatusLabel(nextStatus)}.`, 409);
  data.status = nextStatus;

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.rma.updateMany({ where: { id: current.id, status: current.status, version: current.version }, data });
    if (changed.count !== 1) return null;
    await tx.rmaEvent.create({ data: { rmaId: current.id, fromStatus: current.status, toStatus: nextStatus, actorId: session.userId, note: input.note, metadata: { action: input.action, returnRequired: input.returnRequired, liabilityParty: input.liabilityParty, approvedRefundAmount: input.approvedRefundAmount, refundDecisionById: input.action === "APPROVE_REFUND" ? session.userId : undefined } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `rma.${input.action.toLowerCase()}`, entityType: "Rma", entityId: current.id, metadata: { fromStatus: current.status, toStatus: nextStatus, version: current.version, returnRequired: input.returnRequired, liabilityParty: input.liabilityParty, approvedRefundAmount: input.approvedRefundAmount } } });
    await createTransactionalNotification(tx, { userId: current.customerId, eventType: `RMA_${nextStatus}`, title: `${current.reference}: ${rmaStatusLabel(nextStatus)}`, body: input.action === "APPROVE_REFUND" ? `A ${current.order.currency} ${input.approvedRefundAmount?.toFixed(2)} refund was approved and is waiting for secure financial processing.` : input.note.slice(0, 400), deepLink: `/rmas/${current.id}`, entityType: "Rma", entityId: current.id, priority: "HIGH", idempotencyKey: `rma-notification:action:${current.id}:${current.version}` });
    return tx.rma.findUniqueOrThrow({ where: { id: current.id } });
  });
  if (!updated) return apiError("RMA_STATE_CHANGED", "The claim changed while the decision was saved. Refresh and review the current state.", 409);
  return apiSuccess({ rma: { id: updated.id, reference: updated.reference, status: updated.status, decision: updated.decision, approvedRefundAmount: updated.approvedRefundAmount, version: updated.version } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
