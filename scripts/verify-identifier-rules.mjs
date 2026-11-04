import assert from "node:assert/strict";
import { barcodeValue, createPlatformCode, isPlatformCode } from "../src/modules/identifiers/service.ts";

const productCodes = new Set();
const orderCodes = new Set();
const entities = [
  ["PERSON", "PER"],
  ["STORE", "STR"],
  ["WAREHOUSE", "WHS"],
  ["SHIPMENT", "SHP"],
];
for (let index = 0; index < 10_000; index += 1) {
  productCodes.add(createPlatformCode("PRODUCT"));
  orderCodes.add(createPlatformCode("ORDER"));
}

assert.equal(productCodes.size, 10_000, "Generated duplicate product codes.");
assert.equal(orderCodes.size, 10_000, "Generated duplicate order codes.");
assert([...productCodes].every((code) => /^PRD-[A-F0-9]{20}$/.test(code) && isPlatformCode(code)), "Product code format is not barcode-safe.");
assert([...orderCodes].every((code) => /^ORD-[A-F0-9]{20}$/.test(code) && isPlatformCode(code)), "Order code format is not barcode-safe.");
for (const [entity, prefix] of entities) {
  const codes = new Set(Array.from({ length: 2_000 }, () => createPlatformCode(entity)));
  assert.equal(codes.size, 2_000, `Generated duplicate ${entity.toLowerCase()} codes.`);
  assert([...codes].every((code) => new RegExp(`^${prefix}-[A-F0-9]{20}$`).test(code) && isPlatformCode(code)), `${entity} code format is not barcode-safe.`);
}
const productCode = [...productCodes][0];
assert.equal(barcodeValue(productCode), productCode, "Barcode canonical value changed the platform code.");
assert.equal(barcodeValue("ORD-ABCDEF123456"), "ORD-ABCDEF123456", "Existing 12-character order codes lost compatibility.");
assert.equal(barcodeValue(`PRD-${"A".repeat(32)}`), `PRD-${"A".repeat(32)}`, "Backfilled product codes lost compatibility.");
assert.throws(() => barcodeValue("customer@example.com"), /INVALID_PLATFORM_CODE/, "Unsafe arbitrary barcode payload was accepted.");

console.log("Identifier rule verification passed: 20-hex platform codes are unique in sample, namespace-safe, and canonical barcode values.");
