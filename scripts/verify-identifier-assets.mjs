import assert from "node:assert/strict";

import { renderBarcodeSvg, renderQrSvg, scanPath, scanUrl, svgResponse } from "../src/modules/identifiers/assets.ts";

const productCode = "PRD-0123456789ABCDEF0123";
const orderCode = "ORD-ABCDEF0123456789ABCD";
const requestOrigin = "http://untrusted-request-origin.test";
const applicationOrigin = new URL(process.env.APP_BASE_URL?.trim() || requestOrigin).origin;

assert.equal(scanPath("PRODUCT", productCode), `/scan/products/${productCode}`);
assert.equal(scanPath("ORDER", orderCode), `/scan/orders/${orderCode}`);
assert.equal(scanUrl("PRODUCT", productCode, requestOrigin), `${applicationOrigin}/scan/products/${productCode}`);
assert.throws(() => scanPath("PRODUCT", "customer@example.com"), /INVALID_PLATFORM_CODE/);

const barcode = renderBarcodeSvg(productCode);
const secondBarcode = renderBarcodeSvg("PRD-FFFFFFFFFFFFFFFFFFFF");
assert(barcode.startsWith("<svg") && barcode.includes("<path") && barcode.includes("viewBox="), "Code 128 SVG did not contain rendered barcode geometry.");
assert.notEqual(barcode, secondBarcode, "Different platform codes produced identical barcode geometry.");
assert(!barcode.includes("script") && !barcode.includes("customer@example.com"), "Barcode SVG contains unsafe content.");

const qr = await renderQrSvg("ORDER", orderCode, requestOrigin);
assert(qr.startsWith("<svg") && !qr.includes("customer") && !qr.includes("@"), "QR SVG was not rendered safely.");

const publicResponse = svgResponse(qr, productCode, "qr", "public");
assert.equal(publicResponse.headers.get("content-type"), "image/svg+xml; charset=utf-8");
assert(publicResponse.headers.get("cache-control")?.startsWith("public"), "Public product asset is not cacheable.");
assert(publicResponse.headers.get("content-security-policy")?.includes("sandbox"), "SVG response is missing its restrictive CSP.");
const privateResponse = svgResponse(qr, orderCode, "qr", "private");
assert.equal(privateResponse.headers.get("cache-control"), "private, no-store, max-age=0", "Private order asset could be cached.");

console.log("Identifier asset verification passed: first-party scan URLs, Code 128 and QR SVG generation, CSP, and public/private cache boundaries.");
