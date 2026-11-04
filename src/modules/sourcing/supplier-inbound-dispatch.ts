import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { createReference } from "../../lib/reference.ts";
import { SupplierOrderRecordError } from "./supplier-order-records.ts";

export const supplierDispatchSchema = z.object({
  carrierName: z.string().trim().min(2).max(80).refine(value => !/[<>\u0000-\u001f\u007f]/u.test(value)),
  trackingNumber: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{3,79}$/).transform(value => value.toUpperCase()),
}).strict();
export const supplierDispatchSelect = { id: true, supplierRecordId: true, carrierName: true, trackingNumber: true, createdAt: true, package: { select: { id: true, packageCode: true, status: true, warehouseId: true } } } as const;

/** Serializable transaction required. Manual dispatch evidence is not physical receipt. */
export async function recordSupplierDispatch(tx: Prisma.TransactionClient, input: { orderId: string; recordId: string; actorId: string; idempotencyKey: string; data: z.infer<typeof supplierDispatchSchema> }) {
  const { orderId, recordId, actorId, data } = input;
  const fingerprint = createHash("sha256").update(JSON.stringify({ orderId, recordId, actorId, data })).digest("hex");
  const previous = await tx.supplierInboundDispatch.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.supplierRecordId !== recordId || previous.requestFingerprint !== fingerprint) throw new SupplierOrderRecordError("IDEMPOTENCY_KEY_REUSED", "This key belongs to a different dispatch request.");
    return { dispatchId: previous.id, replayed: true };
  }
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, type: true, orderNumber: true, customerId: true, originCountryCode: true, items: { select: { id: true, quantity: true } }, sourcingRequest: { select: { quantity: true, sourceCountryCode: true } }, supplierOrderRecords: { where: { correction: null }, select: { id: true, orderItemId: true, quantity: true, originWarehouseId: true, inboundDispatch: { select: { id: true } } } } } });
  if (!order || order.type !== "BUY_AND_SHIP" || order.status !== "PURCHASED") throw new SupplierOrderRecordError("DISPATCH_NOT_READY", "Record dispatch only after purchase confirmation and before all parcels have been dispatched.");
  const locked = await tx.order.updateMany({ where: { id: orderId, status: "PURCHASED" }, data: { updatedAt: new Date() } });
  if (locked.count !== 1) throw new SupplierOrderRecordError("DISPATCH_NOT_READY", "Order stage changed. Refresh before continuing.");
  const records = order.supplierOrderRecords;
  const record = records.find(record => record.id === recordId);
  if (!record || record.inboundDispatch) throw new SupplierOrderRecordError("SUPPLIER_RECORD_NOT_READY", "Choose an active, undispatched record belonging to this order.");
  const complete = order.items.length ? order.items.every(item => records.filter(record => record.orderItemId === item.id).reduce((sum, record) => sum + record.quantity, 0) === item.quantity) : Boolean(order.sourcingRequest?.quantity && records.filter(record => !record.orderItemId).reduce((sum, record) => sum + record.quantity, 0) === order.sourcingRequest.quantity);
  if (!complete) throw new SupplierOrderRecordError("SUPPLIER_RECORDS_REQUIRED", "Supplier records must cover the full ordered quantity before dispatch.");
  if (await tx.package.count({ where: { orderId, supplierDispatch: null } })) throw new SupplierOrderRecordError("LEGACY_PACKAGE_REVIEW_REQUIRED", "Existing unlinked packages need operations review before dispatch records can be added.");
  const warehouse = await tx.warehouse.findUnique({ where: { id: record.originWarehouseId }, select: { type: true, country: true } });
  if (!warehouse || warehouse.type !== "ORIGIN" || warehouse.country !== (order.originCountryCode ?? order.sourcingRequest?.sourceCountryCode)) throw new SupplierOrderRecordError("ORIGIN_WAREHOUSE_REQUIRED", "Review the supplier record's origin warehouse before dispatch.");
  if (await tx.package.findFirst({ where: { inboundTracking: { equals: data.trackingNumber, mode: "insensitive" } }, select: { id: true } })) throw new SupplierOrderRecordError("TRACKING_ALREADY_USED", "This tracking reference is already linked to a parcel. Review existing records.");
  const pkg = await tx.package.create({ data: { orderId, warehouseId: record.originWarehouseId, packageCode: createReference("PKG"), inboundTracking: data.trackingNumber, inboundCarrier: data.carrierName, status: "EXPECTED" } });
  const dispatch = await tx.supplierInboundDispatch.create({ data: { supplierRecordId: recordId, packageId: pkg.id, ...data, createdById: actorId, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint } });
  const allDispatched = records.every(item => item.id === recordId || item.inboundDispatch);
  let history;
  if (allDispatched) {
    await tx.order.update({ where: { id: orderId }, data: { status: "SUPPLIER_SHIPPED" } });
    history = await tx.orderStatusHistory.create({ data: { orderId, fromStatus: "PURCHASED", toStatus: "SUPPLIER_SHIPPED", actorId, note: "Dispatch details have been recorded for all expected parcels. Physical warehouse receipt is still pending." } });
  }
  await tx.auditLog.create({ data: { actorId, action: "supplier_inbound_dispatch.recorded", entityType: "Order", entityId: orderId, metadata: { supplierRecordId: recordId, dispatchId: dispatch.id, packageId: pkg.id, allDispatched, physicallyReceived: false, financialPosting: false, mode: "MANUAL" } } });
  return { dispatchId: dispatch.id, replayed: false, history, customerId: order.customerId, orderNumber: order.orderNumber };
}
