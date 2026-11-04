import assert from "node:assert/strict";
import { supplierRecordLimitReached } from "../src/modules/sourcing/supplier-record-limit.ts";
import { supplierOrderRecordSchema, createSupplierOrderRecord } from "../src/modules/sourcing/supplier-order-records.ts";
import { supplierRecordReplacementSchema, replaceSupplierRecord } from "../src/modules/sourcing/supplier-record-replacement.ts";
import { recordSupplierDispatch, supplierDispatchSchema } from "../src/modules/sourcing/supplier-inbound-dispatch.ts";
import { procurementGuidance } from "../src/modules/sourcing/procurement-guidance.ts";
import { supplierRecordPage, supplierRecordPagination } from "../src/modules/sourcing/supplier-record-pagination.ts";
const input = { supplierName: "Fixture supplier", supplierOrderReference: "REF-1", variantDescription: "Blue / standard", quantity: 2, originWarehouseId: "11111111-1111-4111-8111-111111111111" };
const data = supplierOrderRecordSchema.parse(input);
for (const patch of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: "2" }, { quantity: 1000001 }, { supplierName: "<script>" }, { originalAmount: "123" }, { orderItemId: "other" }]) assert.equal(supplierOrderRecordSchema.safeParse({ ...input, ...patch }).success, false);
let state = "SOURCING";
const records = [], audits = [];
const tx = {
  order: { findUnique: async () => ({ id: "order", status: state, type: "BUY_AND_SHIP", originCountryCode: "CN", items: [], sourcingRequest: { quantity: 2, sourceCountryCode: "CN" } }), updateMany: async () => ({ count: state === "SOURCING" ? 1 : 0 }) },
  warehouse: { findUnique: async ({ where }) => where.id === input.originWarehouseId ? { country: "CN", type: "ORIGIN" } : { country: "BD", type: "DESTINATION" } },
  supplierOrderRecord: { findUnique: async ({ where }) => records.find(record => record.idempotencyKey === where.idempotencyKey) ?? null, findMany: async () => records, create: async ({ data }) => { const record = { ...data, id: "record-1" }; records.push(record); return record; } },
  auditLog: { create: async ({ data }) => { audits.push(data); } },
};
const request = { orderId: "order", actorId: "admin", idempotencyKey: "fixture-key-123456", data };
tx.supplierOrderRecord.count = async () => records.length;
assert.deepEqual(await createSupplierOrderRecord(tx, request), { recordId: "record-1", replayed: false });
assert.deepEqual(await createSupplierOrderRecord(tx, request), { recordId: "record-1", replayed: true });
assert.equal(records.length, 1); assert.equal(audits.length, 1); assert.equal(state, "SOURCING");
await assert.rejects(createSupplierOrderRecord(tx, { ...request, data: { ...data, quantity: 1 } }), { code: "IDEMPOTENCY_KEY_REUSED" });
await assert.rejects(createSupplierOrderRecord(tx, { ...request, idempotencyKey: "another-key", data: { ...data, quantity: 1 } }), { code: "QUANTITY_EXCEEDED" });
await assert.rejects(createSupplierOrderRecord(tx, { ...request, idempotencyKey: "foreign-item", data: { ...data, orderItemId: "other" } }), { code: "ORDER_ITEM_REQUIRED" });
await assert.rejects(createSupplierOrderRecord(tx, { ...request, idempotencyKey: "foreign-warehouse", data: { ...data, originWarehouseId: "22222222-2222-4222-8222-222222222222" } }), { code: "ORIGIN_WAREHOUSE_REQUIRED" });
state = "PURCHASED";
assert.equal((await createSupplierOrderRecord(tx, request)).replayed, true);
await assert.rejects(createSupplierOrderRecord(tx, { ...request, idempotencyKey: "after-stage-change" }), { code: "ORDER_NOT_READY" });
assert.equal(audits[0].metadata.financialPosting, false);
for (const total of [0, 99]) assert.equal(supplierRecordLimitReached(total), false);
for (const total of [100, 101]) {
  assert.equal(supplierRecordLimitReached(total), true);
  state = "SOURCING";
  tx.supplierOrderRecord.count = async () => total;
  await assert.rejects(createSupplierOrderRecord(tx, { ...request, idempotencyKey: `capacity-${total}` }), { code: "RECORD_LIMIT" });
}
assert.equal(records.length, 1);
assert.equal(audits.length, 1);
tx.supplierOrderRecord.count = async () => records.length;
console.log("Supplier record policy checks passed: allocation limits, replay, wrong item/warehouse, stage guards and no financial posting (mock transaction).");
const correctionData = { supplierName: "Fixture supplier", supplierOrderReference: "REF-1", variantDescription: "Corrected blue", reason: "Verified confirmation", holdHistoryId: input.originWarehouseId };
assert.equal(supplierRecordReplacementSchema.safeParse(correctionData).success, true);
for (const patch of [{ quantity: 3 }, { originWarehouseId: input.originWarehouseId }, { reason: "<script>" }, { holdHistoryId: "invalid" }, { originalAmount: "10" }]) assert.equal(supplierRecordReplacementSchema.safeParse({ ...correctionData, ...patch }).success, false);
let correctionStage = "ON_HOLD";
const original = { id: "original", orderId: "order", orderItemId: null, allocationKey: "SOURCING_REQUEST", supplierName: "Fixture supplier", supplierOrderReference: "REF-1", variantDescription: "Wrong blue", quantity: 2, originWarehouseId: input.originWarehouseId, originCountryCode: "CN", recordedById: "recorder", correction: null };
const replacementRecords = [], correctionLinks = [], correctionHistory = [], correctionAudits = [];
const correctionTx = {
  order: { findUnique: async () => ({ status: correctionStage, type: "BUY_AND_SHIP", orderNumber: "ORD-fixture", statusHistory: [{ id: input.originWarehouseId, fromStatus: "SOURCING", toStatus: "ON_HOLD", actorId: "reporter" }] }), updateMany: async () => ({ count: 1 }), update: async ({ data }) => { correctionStage = data.status; } },
  auditLog: { findFirst: async () => ({ actorId: "reporter" }), create: async ({ data }) => correctionAudits.push(data) },
  supplierOrderRecord: { findUnique: async ({ where }) => where.id === "original" ? original : replacementRecords.find(record => record.idempotencyKey === where.idempotencyKey), count: async () => 1, findFirst: async () => null, create: async ({ data }) => { const saved = { ...data, id: "replacement" }; replacementRecords.push(saved); return saved; } },
  supplierRecordCorrection: { create: async ({ data }) => correctionLinks.push(data) },
  orderStatusHistory: { create: async ({ data }) => { correctionHistory.push(data); return { ...data, id: "history" }; } },
};
const replacementInput = { orderId: "order", recordId: "original", actorId: "reviewer", idempotencyKey: "correction-fixture-key", data: correctionData };
for (const actorId of ["recorder", "reporter"]) await assert.rejects(replaceSupplierRecord(correctionTx, { ...replacementInput, actorId }), { code: "INDEPENDENT_ADMIN_REQUIRED" });
await assert.rejects(replaceSupplierRecord(correctionTx, { ...replacementInput, data: { ...correctionData, holdHistoryId: "stale-hold" } }), { code: "CORRECTION_NOT_READY" });
assert.equal(replacementRecords.length, 0);
for (const total of [100, 101]) {
  correctionTx.supplierOrderRecord.count = async () => total;
  await assert.rejects(replaceSupplierRecord(correctionTx, replacementInput), { code: "RECORD_LIMIT" });
  assert.equal(correctionStage, "ON_HOLD");
  assert.equal(replacementRecords.length, 0);
  assert.equal(correctionLinks.length, 0);
  assert.equal(correctionHistory.length, 0);
  assert.equal(correctionAudits.length, 0);
  assert.equal(original.variantDescription, "Wrong blue");
}
correctionTx.supplierOrderRecord.count = async () => 99;
const replacementResult = await replaceSupplierRecord(correctionTx, replacementInput);
assert.equal(replacementResult.replayed, false);
assert.equal(correctionStage, "SOURCING");
assert.equal(original.variantDescription, "Wrong blue");
assert.equal(replacementRecords[0].quantity, original.quantity);
assert.equal(replacementRecords[0].originWarehouseId, original.originWarehouseId);
assert.equal(correctionLinks.length, 1);
assert.equal(correctionHistory.length, 1);
assert.equal(correctionAudits[0].metadata.financialPosting, false);
correctionTx.supplierOrderRecord.count = async () => 100;
assert.equal((await replaceSupplierRecord(correctionTx, replacementInput)).replayed, true);
await assert.rejects(replaceSupplierRecord(correctionTx, { ...replacementInput, data: { ...correctionData, reason: "Changed retry" } }), { code: "IDEMPOTENCY_KEY_REUSED" });
assert.equal(replacementRecords.length, 1);
console.log("Supplier correction checks passed: independent approval, latest hold, immutable original, fixed allocations and retry replay (mock transaction).");
const dispatchData = supplierDispatchSchema.parse({ carrierName: "Fixture carrier", trackingNumber: "parcel-1234" });
assert.equal(dispatchData.trackingNumber, "PARCEL-1234");
for (const patch of [{ trackingNumber: "https://supplier.test/secret" }, { physicallyReceived: true }, { price: 10 }, { carrierName: "<script>" }]) assert.equal(supplierDispatchSchema.safeParse({ ...dispatchData, ...patch }).success, false);
let dispatchStage = "PURCHASED", legacyPackages = 0;
let dispatchWarehouseCountry = "CN";
const manifestRecords = ["a", "b"].map(id => ({ id, orderItemId: null, quantity: 1, originWarehouseId: input.originWarehouseId, inboundDispatch: null }));
const manifests = [], expectedPackages = [], dispatchHistory = [], dispatchAudits = [];
const dispatchTx = {
  supplierInboundDispatch: { findUnique: async ({ where }) => manifests.find(record => record.idempotencyKey === where.idempotencyKey), create: async ({ data }) => { const created = { ...data, id: `dispatch-${manifests.length}` }; manifests.push(created); manifestRecords.find(record => record.id === data.supplierRecordId).inboundDispatch = { id: created.id }; return created; } },
  order: { findUnique: async () => ({ status: dispatchStage, type: "BUY_AND_SHIP", orderNumber: "ORD-fixture", customerId: "customer", originCountryCode: "CN", items: [], sourcingRequest: { quantity: 2 }, supplierOrderRecords: manifestRecords }), updateMany: async () => ({ count: 1 }), update: async ({ data }) => { dispatchStage = data.status; } },
  warehouse: { findUnique: async () => ({ type: "ORIGIN", country: dispatchWarehouseCountry }) },
  package: { count: async () => legacyPackages, findFirst: async ({ where }) => expectedPackages.find(pkg => pkg.inboundTracking === where.inboundTracking.equals), create: async ({ data }) => { const created = { ...data, id: `package-${expectedPackages.length}` }; expectedPackages.push(created); return created; } },
  orderStatusHistory: { create: async ({ data }) => { dispatchHistory.push(data); return { ...data, id: "dispatch-history" }; } },
  auditLog: { create: async ({ data }) => dispatchAudits.push(data) },
};
const dispatchInput = { orderId: "order", recordId: "a", actorId: "admin", idempotencyKey: "dispatch-first-key", data: dispatchData };
legacyPackages = 1;
await assert.rejects(recordSupplierDispatch(dispatchTx, dispatchInput), { code: "LEGACY_PACKAGE_REVIEW_REQUIRED" });
assert.equal(expectedPackages.length, 0);
legacyPackages = 0;
dispatchWarehouseCountry = "BD";
await assert.rejects(recordSupplierDispatch(dispatchTx, dispatchInput), { code: "ORIGIN_WAREHOUSE_REQUIRED" });
dispatchWarehouseCountry = "CN";
await assert.rejects(recordSupplierDispatch(dispatchTx, { ...dispatchInput, recordId: "foreign" }), { code: "SUPPLIER_RECORD_NOT_READY" });
await recordSupplierDispatch(dispatchTx, dispatchInput);
assert.equal(dispatchStage, "PURCHASED");
assert.equal(expectedPackages[0].status, "EXPECTED");
assert.equal(dispatchHistory.length, 0);
assert.equal((await recordSupplierDispatch(dispatchTx, dispatchInput)).replayed, true);
await assert.rejects(recordSupplierDispatch(dispatchTx, { ...dispatchInput, data: { ...dispatchData, trackingNumber: "CHANGED-TRACKING" } }), { code: "IDEMPOTENCY_KEY_REUSED" });
await assert.rejects(recordSupplierDispatch(dispatchTx, { ...dispatchInput, recordId: "b", idempotencyKey: "dispatch-second-key" }), { code: "TRACKING_ALREADY_USED" });
await recordSupplierDispatch(dispatchTx, { ...dispatchInput, recordId: "b", idempotencyKey: "dispatch-second-key", data: { ...dispatchData, trackingNumber: "PARCEL-5678" } });
assert.equal(dispatchStage, "SUPPLIER_SHIPPED");
assert.equal(dispatchHistory.length, 1);
assert.equal(expectedPackages.length, 2);
assert.equal(expectedPackages.every(pkg => pkg.status === "EXPECTED"), true);
assert.equal((await recordSupplierDispatch(dispatchTx, dispatchInput)).replayed, true);
assert.equal(dispatchAudits.every(audit => audit.metadata.physicallyReceived === false && audit.metadata.financialPosting === false), true);
console.log("Supplier dispatch policy checks passed: expected-only parcels, coverage/duplicate guards, replay and completion after every supplier record (mock transaction).");

const pendingRecord = { correction: null, inboundDispatch: null };
const expectedRecord = { correction: null, inboundDispatch: { package: { status: "EXPECTED", isOutboundActive: true } } };
const receivedRecord = { correction: null, inboundDispatch: { package: { status: "RECEIVED", isOutboundActive: true } } };
const guidanceInput = { status: "SOURCING", records: [pendingRecord], totalRecords: 1, remainingQuantities: [0] };
assert.equal(procurementGuidance({ ...guidanceInput, remainingQuantities: [1] }).step, 0);
assert.equal(procurementGuidance(guidanceInput).step, 1);
assert.equal(procurementGuidance({ ...guidanceInput, status: "PURCHASED" }).step, 2);
assert.equal(procurementGuidance({ ...guidanceInput, status: "PURCHASED", remainingQuantities: [-1] }).step, null);
assert.equal(procurementGuidance({ ...guidanceInput, remainingQuantities: [] }).step, 0);
const shippedGuidance = procurementGuidance({ ...guidanceInput, status: "SUPPLIER_SHIPPED", records: [expectedRecord, receivedRecord], totalRecords: 2 });
assert.equal(shippedGuidance.step, 3);
assert.deepEqual(shippedGuidance.counts, { active: 2, dispatched: 2, awaiting: 1, received: 1 });
assert.equal(procurementGuidance({ ...guidanceInput, status: "SUPPLIER_SHIPPED", records: [pendingRecord] }).step, null);
assert.equal(procurementGuidance({ ...guidanceInput, status: "ON_HOLD" }).step, null);
assert.equal(procurementGuidance({ ...guidanceInput, status: "DELIVERED" }).step, null);
const truncated = procurementGuidance({ ...guidanceInput, totalRecords: 101 });
assert.equal(truncated.step, null);
assert.equal(truncated.counts, null);
assert.match(truncated.message, /more records/);
const superseded = procurementGuidance({ ...guidanceInput, records: [pendingRecord, { ...expectedRecord, correction: { replacementRecordId: "replacement" } }], totalRecords: 2 });
assert.equal(superseded.counts.active, 1);
assert.equal(superseded.counts.dispatched, 0);
assert.equal(procurementGuidance({ ...guidanceInput, records: [{ correction: null, inboundDispatch: { package: { status: "EXPECTED", isOutboundActive: false } } }] }).step, null);
console.log("Procurement guidance checks passed: stage-specific tasks, partial receipt counts, held/inactive orders, superseded evidence and incomplete-list safety.");
assert.equal(supplierRecordPage(undefined), 1);
for (const value of ["1", "2", "10000"]) assert.equal(supplierRecordPage(value), Number(value));
for (const value of ["", "0", "01", "-1", "1.5", "1e3", "10001", " 2", ["1", "2"], 2]) assert.equal(supplierRecordPage(value), null);
assert.deepEqual(supplierRecordPagination(2, 101, 100), { page: 2, pageSize: 100, total: 101, pages: 2, skip: 100 });
assert.deepEqual(supplierRecordPagination(6, 101, 20), { page: 6, pageSize: 20, total: 101, pages: 6, skip: 100 });
assert.equal(supplierRecordPagination(1, 0, 100).pages, 1);
console.log("Supplier record pagination checks passed: strict bounded page values, stable offsets and empty/final page metadata.");
