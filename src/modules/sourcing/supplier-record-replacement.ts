import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { supplierOrderRecordSchema, SupplierOrderRecordError } from "./supplier-order-records.ts";
import { supplierRecordLimitReached } from "./supplier-record-limit.ts";

export const supplierRecordReplacementSchema = supplierOrderRecordSchema.pick({ supplierName: true, supplierOrderReference: true, variantDescription: true }).extend({
  reason: supplierOrderRecordSchema.shape.supplierName.min(3).max(120),
  holdHistoryId: supplierOrderRecordSchema.shape.originWarehouseId,
}).strict();

/** Serializable transaction required. Replacement is operational only; the original is never edited. */
export async function replaceSupplierRecord(tx: Prisma.TransactionClient, input: {
  orderId: string; recordId: string; actorId: string; idempotencyKey: string;
  data: ReturnType<typeof supplierRecordReplacementSchema.parse>;
}) {
  const { orderId, recordId, actorId, data } = input;
  const fingerprint = createHash("sha256").update(JSON.stringify({ orderId, recordId, actorId, data })).digest("hex");
  const previous = await tx.supplierOrderRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.orderId !== orderId || previous.requestFingerprint !== fingerprint) throw new SupplierOrderRecordError("IDEMPOTENCY_KEY_REUSED", "This request key belongs to another correction.");
    return { recordId: previous.id, replayed: true };
  }
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, type: true, orderNumber: true, statusHistory: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, fromStatus: true, toStatus: true, actorId: true } } } });
  const hold = order?.statusHistory[0];
  if (order?.status !== "ON_HOLD" || order.type !== "BUY_AND_SHIP" || hold?.id !== data.holdHistoryId || hold.fromStatus !== "SOURCING" || hold.toStatus !== "ON_HOLD") throw new SupplierOrderRecordError("CORRECTION_NOT_READY", "Only the latest supplier-record hold can be resolved here.");
  const locked = await tx.order.updateMany({ where: { id: orderId, status: "ON_HOLD" }, data: { updatedAt: new Date() } });
  if (locked.count !== 1) throw new SupplierOrderRecordError("CORRECTION_NOT_READY", "Order stage changed. Refresh before continuing.");
  const report = await tx.auditLog.findFirst({ where: { entityType: "Order", entityId: orderId, action: "order.purchase_review.place_on_hold", AND: [{ metadata: { path: ["historyId"], equals: hold.id } }, { metadata: { path: ["supplierRecordId"], equals: recordId } }, { metadata: { path: ["correctionRequested"], equals: true } }] }, select: { actorId: true } });
  const original = await tx.supplierOrderRecord.findUnique({ where: { id: recordId }, include: { correction: true } });
  if (!report || !original || original.orderId !== orderId || original.correction) throw new SupplierOrderRecordError("CORRECTION_NOT_READY", "The reported record is not an active record on this order.");
  if (!report.actorId || !hold.actorId || [report.actorId, hold.actorId, original.recordedById].includes(actorId)) throw new SupplierOrderRecordError("INDEPENDENT_ADMIN_REQUIRED", "Another Admin must approve; the recorder and reporter cannot approve their own correction.");
  if (data.supplierName === original.supplierName && data.supplierOrderReference === original.supplierOrderReference && data.variantDescription === original.variantDescription) throw new SupplierOrderRecordError("CORRECTION_UNCHANGED", "Change the mistaken name, reference or variant before approving.");
  if (supplierRecordLimitReached(await tx.supplierOrderRecord.count({ where: { orderId } }))) throw new SupplierOrderRecordError("RECORD_LIMIT", "This order reached its evidence-record limit. Escalate to operations.");
  const supplierReferenceKey = createHash("sha256").update(JSON.stringify([data.supplierName.normalize("NFKC").toLowerCase(), data.supplierOrderReference.normalize("NFKC").toLowerCase()])).digest("hex");
  const duplicate = await tx.supplierOrderRecord.findFirst({ where: { orderId, allocationKey: original.allocationKey, supplierReferenceKey, correction: null, id: { not: recordId } }, select: { id: true } });
  if (duplicate) throw new SupplierOrderRecordError("RECORD_CONFLICT", "Another active record already uses this supplier reference for the item.");
  const replacement = await tx.supplierOrderRecord.create({ data: {
    orderId, orderItemId: original.orderItemId, allocationKey: original.allocationKey,
    supplierName: data.supplierName, supplierOrderReference: data.supplierOrderReference,
    variantDescription: data.variantDescription, supplierReferenceKey,
    quantity: original.quantity, originWarehouseId: original.originWarehouseId,
    originCountryCode: original.originCountryCode, recordedById: actorId, internalNote: data.reason,
    idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
  } });
  await tx.supplierRecordCorrection.create({ data: { originalRecordId: recordId, replacementRecordId: replacement.id, holdHistoryId: hold.id, approvedById: actorId, reason: data.reason } });
  await tx.order.update({ where: { id: orderId }, data: { status: "SOURCING" } });
  const history = await tx.orderStatusHistory.create({ data: { orderId, fromStatus: "ON_HOLD", toStatus: "SOURCING", actorId, note: "Our team completed its review. Your order is back in purchasing preparation." } });
  await tx.auditLog.create({ data: { actorId, action: "supplier_order_record.replaced", entityType: "Order", entityId: orderId, metadata: { originalRecordId: recordId, replacementRecordId: replacement.id, holdHistoryId: hold.id, historyId: history.id, reason: data.reason, financialPosting: false, supplierCancelled: false } } });
  return { recordId: replacement.id, replayed: false, history, orderNumber: order.orderNumber };
}
