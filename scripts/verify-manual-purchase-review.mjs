import assert from "node:assert/strict";
import { canReviewPurchase, recordManualPurchaseReview } from "../src/modules/sourcing/manual-purchase-review.ts";

assert.equal(canReviewPurchase("PENDING_PURCHASE_REVIEW", "APPROVE_FOR_PURCHASE"), true);
assert.equal(canReviewPurchase("SOURCING", "MARK_PURCHASED"), true);
for (const status of ["DRAFT", "PENDING_PAYMENT", "PAID", "PURCHASED", "DELIVERED", "CANCELLED", "ON_HOLD"]) {
  for (const action of ["APPROVE_FOR_PURCHASE", "MARK_PURCHASED", "PLACE_ON_HOLD"]) assert.equal(canReviewPurchase(status, action), false);
}
let state = "SOURCING";
const history = [], audits = [];
let supplierRecords = [];
let orderedItems = [];
const tx = {
  supplierOrderRecord: { findMany: async ({ where }) => { assert.equal(where.correction, null, "Superseded evidence must not count toward purchase coverage"); return supplierRecords; }, findUnique: async ({ where }) => where.id === "owned-record" ? { orderId: "fixture-order" } : { orderId: "other-order" } },
  order: { findUnique: async () => ({ items: orderedItems, sourcingRequest: { quantity: 2 } }), updateMany: async ({ where, data }) => {
    assert.equal(where.id, "fixture-order");
    if (where.status !== state) return { count: 0 };
    state = data.status; return { count: 1 };
  } },
  orderStatusHistory: { create: async ({ data }) => { history.push(data); return { ...data, id: "fixture-history" }; } },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
};
const input = { orderId: "fixture-order", orderNumber: "ORD-FIXTURE", previousStatus: "SOURCING", action: "MARK_PURCHASED", actorId: "fixture-admin", internalNote: "Private supplier reference and internal cost fixture" };
await assert.rejects(recordManualPurchaseReview(tx, input), { name: "PurchaseEvidenceRequired" });
assert.equal(history.length, 0);
orderedItems = [{ id: "item-a", quantity: 2 }, { id: "item-b", quantity: 1 }];
supplierRecords = [{ orderItemId: "item-a", quantity: 3 }];
await assert.rejects(recordManualPurchaseReview(tx, input), { name: "PurchaseEvidenceRequired" });
supplierRecords = [{ orderItemId: "item-a", quantity: 2 }, { orderItemId: "item-b", quantity: 2 }];
await assert.rejects(recordManualPurchaseReview(tx, input), { name: "PurchaseEvidenceRequired" });
assert.equal(history.length, 0);
orderedItems = [];
supplierRecords = [{ orderItemId: null, quantity: 2 }];
const results = await Promise.allSettled([recordManualPurchaseReview(tx, input), recordManualPurchaseReview(tx, input)]);
assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
assert.equal(results.filter(result => result.status === "rejected" && result.reason.name === "PurchaseReviewConflict").length, 1);
assert.equal(history.length, 1);
assert.equal(audits.length, 1);
assert.equal(state, "PURCHASED");
assert.equal(audits[0].metadata.note, input.internalNote);
assert.equal(JSON.stringify(history).includes(input.internalNote), false);
const success = results.find(result => result.status === "fulfilled").value;
assert.equal(success.publicNote.includes("Private"), false);
assert.equal(success.history.note, success.publicNote);
await assert.rejects(recordManualPurchaseReview(tx, { ...input, previousStatus: "DELIVERED" }), { name: "PurchaseReviewConflict" });
assert.equal(history.length, 1);
for (const previousStatus of ["PENDING_PURCHASE_REVIEW", "SOURCING"]) assert.equal(canReviewPurchase(previousStatus, "PLACE_ON_HOLD"), true);
state = "SOURCING";
await assert.rejects(recordManualPurchaseReview(tx, { ...input, supplierRecordId: "owned-record" }), { name: "SupplierCorrectionInvalid" });
await assert.rejects(recordManualPurchaseReview(tx, { ...input, action: "PLACE_ON_HOLD", supplierRecordId: "foreign-record" }), { name: "SupplierCorrectionInvalid" });
assert.equal(history.length, 1);
const correction = await recordManualPurchaseReview(tx, { ...input, action: "PLACE_ON_HOLD", supplierRecordId: "owned-record", internalNote: "PRIVATE correction: wrong variant" });
assert.equal(state, "ON_HOLD");
assert.equal(correction.history.note.includes("PRIVATE"), false);
assert.equal(audits[1].metadata.supplierRecordId, "owned-record");
assert.equal(audits[1].metadata.correctionRequested, true);
assert.equal(audits[1].metadata.supplierCancelled, false);
await assert.rejects(recordManualPurchaseReview(tx, { ...input, action: "PLACE_ON_HOLD", supplierRecordId: "owned-record" }), { name: "PurchaseReviewConflict" });
assert.equal(audits.length, 2);
console.log("Manual purchase review policy checks passed: conditional transitions, duplicate rejection and private-note separation (mock transaction).");
