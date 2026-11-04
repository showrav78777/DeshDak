import type { Prisma, OrderStatus } from "@prisma/client";
import { canTransitionOrder } from "../orders/state-machine.ts";

export const manualPurchaseActions = {
  APPROVE_FOR_PURCHASE: { from: ["PENDING_PURCHASE_REVIEW"], to: "SOURCING", label: "approved for purchase", publicNote: "Your order has been approved for purchasing." },
  MARK_PURCHASED: { from: ["SOURCING"], to: "PURCHASED", label: "marked purchased", publicNote: "The products in your order have been purchased." },
  PLACE_ON_HOLD: { from: ["PENDING_PURCHASE_REVIEW", "SOURCING"], to: "ON_HOLD", label: "placed on hold", publicNote: "Your order is on hold while our team reviews an issue. Support will contact you if action is needed." },
} as const;

export type ManualPurchaseAction = keyof typeof manualPurchaseActions;
export class PurchaseReviewConflict extends Error {
  constructor() { super("Order stage changed. Refresh before submitting another decision."); this.name = "PurchaseReviewConflict"; }
}
export class PurchaseEvidenceRequired extends Error {
  constructor() { super("Record supplier references for every ordered item and quantity before marking purchased."); this.name = "PurchaseEvidenceRequired"; }
}
export class SupplierCorrectionInvalid extends Error {
  constructor() { super("Select a supplier record belonging to this Sourcing-stage order and use Place on hold."); this.name = "SupplierCorrectionInvalid"; }
}

export function canReviewPurchase(status: OrderStatus, action: ManualPurchaseAction): boolean {
  const rule = manualPurchaseActions[action];
  return (rule.from as readonly string[]).includes(status) && canTransitionOrder(status, rule.to);
}

/** Must run inside a database transaction; caller enforces Admin RBAC/MFA. */
export async function recordManualPurchaseReview(tx: Prisma.TransactionClient, input: {
  orderId: string; orderNumber: string; previousStatus: OrderStatus;
  action: ManualPurchaseAction; actorId: string; internalNote: string; supplierRecordId?: string;
}) {
  if (!canReviewPurchase(input.previousStatus, input.action)) throw new PurchaseReviewConflict();
  if (input.supplierRecordId) {
    if (input.action !== "PLACE_ON_HOLD" || input.previousStatus !== "SOURCING") throw new SupplierCorrectionInvalid();
    const record = await tx.supplierOrderRecord.findUnique({ where: { id: input.supplierRecordId }, select: { orderId: true, correction: { select: { originalRecordId: true } } } });
    if (record?.orderId !== input.orderId || record.correction) throw new SupplierCorrectionInvalid();
  }
  if (input.action === "MARK_PURCHASED") {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { items: { select: { id: true, quantity: true } }, sourcingRequest: { select: { quantity: true } } } });
    const records = await tx.supplierOrderRecord.findMany({ where: { orderId: input.orderId, correction: null }, select: { orderItemId: true, quantity: true } });
    const complete = order?.items.length
      ? order.items.every(item => records.filter(record => record.orderItemId === item.id).reduce((sum, record) => sum + record.quantity, 0) === item.quantity)
      : Boolean(order?.sourcingRequest?.quantity && records.filter(record => record.orderItemId === null).reduce((sum, record) => sum + record.quantity, 0) === order.sourcingRequest.quantity);
    if (!complete) throw new PurchaseEvidenceRequired();
  }
  const rule = manualPurchaseActions[input.action];
  const changed = await tx.order.updateMany({ where: { id: input.orderId, status: input.previousStatus }, data: { status: rule.to } });
  if (changed.count !== 1) throw new PurchaseReviewConflict();
  // Supplier references/costs belong only in authorized internal evidence, not this timeline.
  const history = await tx.orderStatusHistory.create({ data: {
    orderId: input.orderId, fromStatus: input.previousStatus, toStatus: rule.to,
    actorId: input.actorId, note: rule.publicNote,
  } });
  await tx.auditLog.create({ data: {
    actorId: input.actorId, action: `order.purchase_review.${input.action.toLowerCase()}`,
    entityType: "Order", entityId: input.orderId,
    metadata: { orderNumber: input.orderNumber, historyId: history.id, fromStatus: input.previousStatus, toStatus: rule.to, note: input.internalNote, ...(input.supplierRecordId ? { supplierRecordId: input.supplierRecordId, correctionRequested: true, supplierCancelled: false, financialPosting: false } : {}) },
  } });
  return { history, publicNote: rule.publicNote, status: rule.to };
}
