import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { supplierRecordLimitReached } from "./supplier-record-limit.ts";

const plainText = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[<>\u0000-\u001f\u007f]/u.test(value));
export const supplierOrderRecordSchema = z.object({
  orderItemId: z.string().uuid().nullable().default(null),
  supplierName: plainText(120), supplierOrderReference: plainText(120),
  variantDescription: plainText(300), quantity: z.number().int().min(1).max(1_000_000),
  originWarehouseId: z.string().uuid(), internalNote: z.string().trim().max(500).default(""),
}).strict();
export type SupplierOrderRecordInput = z.infer<typeof supplierOrderRecordSchema>;
export const supplierOrderRecordSelect = {
  id: true, orderId: true, orderItemId: true, supplierName: true, supplierOrderReference: true,
  variantDescription: true, quantity: true, originWarehouseId: true, originCountryCode: true,
  internalNote: true, createdAt: true,
  correction: { select: { replacementRecordId: true } },
  inboundDispatch: { select: { carrierName: true, trackingNumber: true, package: { select: { packageCode: true, status: true } } } },
} as const;
export class SupplierOrderRecordError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function supplierRecordFingerprint(orderId: string, data: SupplierOrderRecordInput) {
  return createHash("sha256").update(JSON.stringify({ orderId, orderItemId: data.orderItemId, supplierName: data.supplierName, supplierOrderReference: data.supplierOrderReference, variantDescription: data.variantDescription, quantity: data.quantity, originWarehouseId: data.originWarehouseId, internalNote: data.internalNote })).digest("hex");
}

/** Serializable transaction required: immutable evidence only, no financial or status posting. */
export async function createSupplierOrderRecord(tx: Prisma.TransactionClient, input: { orderId: string; actorId: string; idempotencyKey: string; data: SupplierOrderRecordInput }) {
  const { orderId, data } = input;
  const fingerprint = supplierRecordFingerprint(orderId, data);
  const previous = await tx.supplierOrderRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.orderId !== orderId || previous.requestFingerprint !== fingerprint) throw new SupplierOrderRecordError("IDEMPOTENCY_KEY_REUSED", "This request key belongs to a different record. Refresh before continuing.");
    return { recordId: previous.id, replayed: true };
  }
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, originCountryCode: true, type: true, sourcingRequest: { select: { quantity: true, sourceCountryCode: true } }, items: { select: { id: true, quantity: true } } } });
  if (!order) throw new SupplierOrderRecordError("ORDER_NOT_FOUND", "Order was not found.");
  if (order.status !== "SOURCING" || order.type !== "BUY_AND_SHIP") throw new SupplierOrderRecordError("ORDER_NOT_READY", "Record supplier evidence only for an approved Buy & Ship purchase in the Sourcing stage.");
  const locked = await tx.order.updateMany({ where: { id: orderId, status: "SOURCING" }, data: { updatedAt: new Date() } });
  if (locked.count !== 1) throw new SupplierOrderRecordError("ORDER_NOT_READY", "Order stage changed. Refresh before continuing.");
  const item = order.items.find(item => item.id === data.orderItemId);
  if ((order.items.length && !item) || (!order.items.length && data.orderItemId !== null)) throw new SupplierOrderRecordError("ORDER_ITEM_REQUIRED", "Select an item belonging to this order.");
  const expected = item?.quantity ?? order.sourcingRequest?.quantity;
  if (!expected) throw new SupplierOrderRecordError("ORDER_QUANTITY_REQUIRED", "This order has no verified item quantity. Resolve the order data before recording evidence.");
  const originCountryCode = order.originCountryCode ?? order.sourcingRequest?.sourceCountryCode;
  const warehouse = await tx.warehouse.findUnique({ where: { id: data.originWarehouseId }, select: { country: true, type: true } });
  if (!warehouse || warehouse.type !== "ORIGIN" || warehouse.country !== originCountryCode) throw new SupplierOrderRecordError("ORIGIN_WAREHOUSE_REQUIRED", "Select an origin warehouse in the order's source country.");
  const records = await tx.supplierOrderRecord.findMany({ where: { orderId, correction: null }, select: { allocationKey: true, quantity: true, supplierReferenceKey: true } });
  if (supplierRecordLimitReached(await tx.supplierOrderRecord.count({ where: { orderId } }))) throw new SupplierOrderRecordError("RECORD_LIMIT", "This order reached its evidence-record limit. Ask operations to review it.");
  const allocationKey = data.orderItemId ?? "SOURCING_REQUEST";
  const recorded = records.filter(record => record.allocationKey === allocationKey).reduce((total, record) => total + record.quantity, 0);
  if (recorded + data.quantity > expected) throw new SupplierOrderRecordError("QUANTITY_EXCEEDED", "Recorded supplier quantities would exceed the ordered item quantity.");
  const supplierReferenceKey = createHash("sha256").update(JSON.stringify([data.supplierName.normalize("NFKC").toLowerCase(), data.supplierOrderReference.normalize("NFKC").toLowerCase()])).digest("hex");
  if (records.some(record => record.allocationKey === allocationKey && record.supplierReferenceKey === supplierReferenceKey)) throw new SupplierOrderRecordError("RECORD_CONFLICT", "An active record already uses this supplier reference for the item.");
  const created = await tx.supplierOrderRecord.create({ data: { ...data, orderId, allocationKey, originCountryCode: warehouse.country, supplierReferenceKey, recordedById: input.actorId, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint } });
  await tx.auditLog.create({ data: { actorId: input.actorId, action: "supplier_order_record.created", entityType: "SupplierOrderRecord", entityId: created.id, metadata: { orderId, orderItemId: data.orderItemId, quantity: data.quantity, originWarehouseId: data.originWarehouseId, mode: "MANUAL", financialPosting: false } } });
  return { recordId: created.id, replayed: false };
}
