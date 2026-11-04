import assert from "node:assert/strict";
import { validateSupplierCandidate } from "../src/modules/sourcing/product-candidate.ts";

const policy = { allowedImageHosts: ["images.example.com"], allowedCurrencies: ["CNY"] };
const candidate = {
  externalProductId: "fixture-1", originalTitle: "测试产品", currency: "CNY",
  originalPrice: "19.990001", imageUrls: ["https://images.example.com/item.png"],
  inventoryQuantity: null, declaredWeightGrams: 580,
  dimensionsMm: { length: 300, width: 200, height: 50 },
};
const validated = validateSupplierCandidate(candidate, policy);
assert.equal(validated.originalPrice, "19.990001");
assert.equal(validated.originalTitle, "测试产品");
assert.equal(validated.publishable, false);
assert.equal(validated.reviewStatus, "PENDING");
assert.equal(validated.stockConfirmed, false);
assert.equal(validateSupplierCandidate({ ...candidate, inventoryQuantity: 3 }, policy).stockConfirmed, true);
assert.equal(validateSupplierCandidate({ ...candidate, inventoryQuantity: 0 }, policy).stockConfirmed, false);
for (const originalPrice of [0, 19.99, "0", "0.000000", "-1", "NaN", "Infinity", "1e3", "01.00", "1.0000001", "9999999999999"]) {
  assert.throws(() => validateSupplierCandidate({ ...candidate, originalPrice }, policy), { name: "SupplierCandidateError" });
}
for (const url of ["http://images.example.com/a", "https://images.example.com.evil.com/a", "https://user:secret@images.example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://images.example.com:444/a", "https://images.example.com/a#secret", "file:///tmp/a", "data:image/png;base64,test"]) {
  assert.throws(() => validateSupplierCandidate({ ...candidate, imageUrls: [url] }, policy), { name: "SupplierCandidateError" });
}
for (const patch of [{ currency: "USD" }, { inventoryQuantity: -1 }, { inventoryQuantity: 1.5 }, { declaredWeightGrams: 0 }, { dimensionsMm: { length: 1 } }, { originalTitle: "<script>secret</script>" }, { secret: "private-token" }, { publishable: true }]) {
  assert.throws(() => validateSupplierCandidate({ ...candidate, ...patch }, policy), (error) => error.name === "SupplierCandidateError" && !String(error).includes("secret") && !String(error).includes("private-token"));
}
assert.throws(() => validateSupplierCandidate(candidate, { ...policy, allowedImageHosts: [] }), { name: "SupplierCandidateError" });
assert.equal(validateSupplierCandidate({ ...candidate, imageUrls: [candidate.imageUrls[0], candidate.imageUrls[0]] }, policy).imageUrls.length, 1);
assert.equal(candidate.imageUrls.length, 1);
console.log("Supplier candidate validation checks passed; synthetic fixtures only, no products published.");
