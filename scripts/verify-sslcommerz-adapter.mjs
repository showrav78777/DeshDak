import assert from "node:assert/strict";
import { createSslCommerzSession, initiateSslCommerzRefund, querySslCommerzRefund, SslCommerzError, validateSslCommerzTransaction } from "../src/modules/payments/sslcommerz.ts";

const config = { environment: "sandbox", storeId: "sandbox-store", storePassword: "sandbox-password", appBaseUrl: "http://localhost:3000", timeoutMs: 2000 };
const customer = { name: "Test Customer", email: "customer@example.test", phone: "01700000000", address: "Test address", city: "Dhaka", postcode: "1200", country: "Bangladesh" };
const callbacks = { successUrl: "http://localhost:3000/payments/sslcommerz/success", failUrl: "http://localhost:3000/payments/sslcommerz/fail", cancelUrl: "http://localhost:3000/payments/sslcommerz/cancel", ipnUrl: "http://localhost:3000/api/v1/payments/sslcommerz/ipn" };
const orderDetails = { internalPaymentId: "550e8400-e29b-41d4-a716-446655440000", itemCount: 2 };

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
async function rejectsCode(run, code) { await assert.rejects(run, (error) => error instanceof SslCommerzError && error.code === code); }

let sessionRequest;
const checkout = await createSslCommerzSession({ reference: "PAY-ABC123", amount: "1250.50", currency: "BDT", productName: "DeshDak order", productCategory: "ecommerce", customer, ...orderDetails, ...callbacks }, config, async (url, init) => {
  sessionRequest = { url: String(url), init, body: new URLSearchParams(String(init?.body)) };
  return response({ status: "SUCCESS", sessionkey: "SESSION-123", GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/test" });
});
assert.equal(checkout.redirectUrl, "https://sandbox.sslcommerz.com/EasyCheckOut/test");
assert.equal(checkout.sessionKey, "SESSION-123");
assert.equal(sessionRequest.url, "https://sandbox.sslcommerz.com/gwprocess/v4/api.php");
assert.equal(sessionRequest.init.method, "POST");
assert.equal(sessionRequest.body.get("total_amount"), "1250.50");
assert.equal(sessionRequest.body.get("tran_id"), "PAY-ABC123");
assert.equal(sessionRequest.body.get("ipn_url"), callbacks.ipnUrl);
assert.equal(sessionRequest.body.get("num_of_item"), "2");
assert.equal(sessionRequest.body.get("value_a"), orderDetails.internalPaymentId);
assert.equal(JSON.stringify(checkout).includes(config.storePassword), false, "Checkout result exposed the store password.");

await rejectsCode(() => createSslCommerzSession({ reference: "PAY-BAD", amount: "10", currency: "BDT", productName: "Order", productCategory: "ecommerce", customer, ...orderDetails, ...callbacks }, config, async () => response({ status: "SUCCESS", sessionkey: "SESSION", GatewayPageURL: "https://evil.example/checkout" })), "UNTRUSTED_GATEWAY_URL");
await rejectsCode(() => createSslCommerzSession({ reference: "PAY-BAD", amount: "10", currency: "BDT", productName: "Order", productCategory: "ecommerce", customer, ...orderDetails, ...callbacks, successUrl: "https://evil.example/callback" }, config, async () => response({})), "INVALID_CALLBACK");

const validPayload = { status: "VALID", tran_id: "PAY-ABC123", val_id: "VAL-123", amount: "1250.50", currency: "BDT", bank_tran_id: "BANK-123", risk_level: "0" };
let validationRequest;
const valid = await validateSslCommerzTransaction({ validationId: "VAL-123", expectedReference: "PAY-ABC123", expectedAmount: "1250.50", expectedCurrency: "BDT" }, config, async (url, init) => { validationRequest = { url: new URL(String(url)), init }; return response(validPayload); });
assert.equal(valid.outcome, "VALID");
assert.deepEqual(valid.evidence, { validationId: "VAL-123", bankTransactionId: "BANK-123", providerStatus: "VALID", riskLevel: 0, riskTitle: null });
assert.equal(validationRequest.url.hostname, "sandbox.sslcommerz.com");
assert.equal(validationRequest.url.searchParams.get("val_id"), "VAL-123");
assert.equal(validationRequest.init.method, "GET");

const risk = await validateSslCommerzTransaction({ validationId: "VAL-RISK", expectedReference: "PAY-ABC123", expectedAmount: "1250.50", expectedCurrency: "BDT" }, config, async () => response({ ...validPayload, val_id: "VAL-RISK", risk_level: 1, risk_title: "Manual review" }));
assert.equal(risk.outcome, "REVIEW_REQUIRED");
await rejectsCode(() => validateSslCommerzTransaction({ validationId: "VAL-123", expectedReference: "PAY-ABC123", expectedAmount: "1250.51", expectedCurrency: "BDT" }, config, async () => response(validPayload)), "AMOUNT_MISMATCH");
await rejectsCode(() => validateSslCommerzTransaction({ validationId: "VAL-123", expectedReference: "PAY-DIFFERENT", expectedAmount: "1250.50", expectedCurrency: "BDT" }, config, async () => response(validPayload)), "REFERENCE_MISMATCH");
await rejectsCode(() => validateSslCommerzTransaction({ validationId: "VAL-123", expectedReference: "PAY-ABC123", expectedAmount: "1250.50", expectedCurrency: "BDT" }, config, async () => response({ ...validPayload, currency: "USD" })), "CURRENCY_MISMATCH");
await rejectsCode(() => validateSslCommerzTransaction({ validationId: "VAL-123", expectedReference: "PAY-ABC123", expectedAmount: "1250.50", expectedCurrency: "BDT" }, config, async () => response({ ...validPayload, status: "FAILED" })), "PAYMENT_NOT_VALID");

let refundRequest;
const initiated = await initiateSslCommerzRefund({ bankTransactionId: "BANK-123", refundTransactionId: "RFD-ABC123", amount: "250.50", remarks: "Approved return", reference: "RFD-ABC123" }, config, async (url, init) => {
  refundRequest = { url: new URL(String(url)), init };
  return response({ APIConnect: "DONE", bank_tran_id: "BANK-123", trans_id: "PAY-ABC123", refund_ref_id: "PROVIDER-RFD-123", status: "success", errorReason: "" });
});
assert.equal(initiated.outcome, "INITIATED");
assert.equal(initiated.providerRefundReference, "PROVIDER-RFD-123");
assert.equal(refundRequest.url.protocol, "https:");
assert.equal(refundRequest.url.hostname, "sandbox.sslcommerz.com");
assert.equal(refundRequest.url.searchParams.get("refund_trans_id"), "RFD-ABC123");
assert.equal(refundRequest.url.searchParams.get("refund_amount"), "250.50");
assert.equal(refundRequest.init.redirect, "error");
assert.equal(JSON.stringify(initiated).includes(config.storePassword), false, "Refund result exposed the store password.");
await rejectsCode(() => initiateSslCommerzRefund({ bankTransactionId: "BANK-123", refundTransactionId: "RFD-FAIL", amount: "10", remarks: "Approved return" }, config, async () => response({ APIConnect: "DONE", status: "failed", errorReason: "Rejected" })), "REFUND_REJECTED");

let statusRequest;
const refundStatus = await querySslCommerzRefund({ providerRefundReference: "PROVIDER-RFD-123" }, config, async (url, init) => {
  statusRequest = { url: new URL(String(url)), init };
  return response({ APIConnect: "DONE", bank_tran_id: "BANK-123", tran_id: "PAY-ABC123", refund_ref_id: "PROVIDER-RFD-123", status: "refunded", initiated_on: "2026-09-08 10:00:00", refunded_on: "2026-09-08 12:00:00" });
});
assert.equal(refundStatus.outcome, "SUCCEEDED");
assert.equal(statusRequest.url.searchParams.get("refund_ref_id"), "PROVIDER-RFD-123");
assert.equal(statusRequest.url.searchParams.has("bank_tran_id"), false);
const cancelled = await querySslCommerzRefund({ providerRefundReference: "PROVIDER-RFD-456" }, config, async () => response({ APIConnect: "DONE", refund_ref_id: "PROVIDER-RFD-456", status: "cancelled" }));
assert.equal(cancelled.outcome, "FAILED", "Cancelled provider refunds must not be treated as paid back.");

console.log("SSLCommerz adapter verification passed: fixed TLS endpoints, server-side form, same-origin callbacks, strict redirect allowlist, exact payment validation, risk hold, original-method refund initiation/status, conservative cancellation, and redacted results.");
