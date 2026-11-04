import { z } from "zod";

export type SslCommerzEnvironment = "sandbox" | "live";
export type SslCommerzConfig = {
  environment: SslCommerzEnvironment;
  storeId: string;
  storePassword: string;
  appBaseUrl: string;
  timeoutMs?: number;
};

export type SslCommerzSessionInput = {
  reference: string;
  internalPaymentId: string;
  amount: string;
  currency: string;
  productName: string;
  productCategory: string;
  itemCount: number;
  customer: { name: string; email: string; phone: string; address: string; city: string; state?: string; postcode?: string; country: string };
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
};

type Fetcher = typeof fetch;

const hosts = {
  sandbox: { api: "https://sandbox.sslcommerz.com", checkout: "sandbox.sslcommerz.com" },
  live: { api: "https://securepay.sslcommerz.com", checkout: "securepay.sslcommerz.com" },
} as const;
const sessionResponseSchema = z.object({
  status: z.string(),
  sessionkey: z.string().min(1).max(255).optional(),
  GatewayPageURL: z.string().url().optional(),
  failedreason: z.string().max(1000).optional(),
}).passthrough();
const validationResponseSchema = z.object({
  status: z.string(),
  tran_id: z.string().min(1).max(30),
  val_id: z.string().min(1).max(100),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().optional(),
  currency_type: z.string().optional(),
  bank_tran_id: z.string().max(100).optional(),
  risk_level: z.union([z.string(), z.number()]).optional(),
  risk_title: z.string().max(255).optional(),
}).passthrough();
const refundInitiationResponseSchema = z.object({
  APIConnect: z.string().max(30),
  bank_tran_id: z.string().max(80).optional(),
  trans_id: z.string().max(30).optional(),
  refund_ref_id: z.string().min(1).max(50).optional(),
  status: z.string().max(30).optional(),
  errorReason: z.string().max(255).optional(),
}).passthrough();
const refundStatusResponseSchema = refundInitiationResponseSchema.extend({
  tran_id: z.string().max(30).optional(),
  initiated_on: z.string().max(40).optional(),
  refunded_on: z.string().max(40).optional(),
});

export class SslCommerzError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SslCommerzError";
    this.code = code;
  }
}

function required(value: string, name: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new SslCommerzError("INVALID_REQUEST", `${name} is invalid.`);
  return normalized;
}

function minorUnits(value: string | number) {
  const normalized = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) throw new SslCommerzError("INVALID_AMOUNT", "Payment amount must be a positive value with at most two decimal places.");
  const [whole, fraction = ""] = normalized.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new SslCommerzError("INVALID_AMOUNT", "Payment amount must be positive.");
  return amount;
}

function callbackUrl(value: string, config: SslCommerzConfig) {
  const callback = new URL(value);
  const application = new URL(config.appBaseUrl);
  if (callback.origin !== application.origin || callback.username || callback.password || callback.hash) throw new SslCommerzError("INVALID_CALLBACK", "Payment callbacks must use the configured DeshDak origin.");
  return callback.toString();
}

function safeGatewayUrl(value: string, environment: SslCommerzEnvironment) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== hosts[environment].checkout || url.username || url.password) throw new SslCommerzError("UNTRUSTED_GATEWAY_URL", "SSLCommerz returned an untrusted checkout location.");
  return url.toString();
}

async function requestJson(url: string, init: RequestInit, config: SslCommerzConfig, fetcher: Fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(config.timeoutMs ?? 10_000, 1_000), 20_000));
  try {
    const response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new SslCommerzError("PROVIDER_UNAVAILABLE", "SSLCommerz did not accept the server request.");
    const text = await response.text();
    if (text.length > 65_536) throw new SslCommerzError("PROVIDER_RESPONSE_TOO_LARGE", "SSLCommerz returned an oversized response.");
    try { return JSON.parse(text) as unknown; } catch { throw new SslCommerzError("INVALID_PROVIDER_RESPONSE", "SSLCommerz returned an invalid response."); }
  } catch (error) {
    if (error instanceof SslCommerzError) throw error;
    if ((error as { name?: string }).name === "AbortError") throw new SslCommerzError("PROVIDER_TIMEOUT", "SSLCommerz did not respond in time.");
    throw new SslCommerzError("PROVIDER_UNAVAILABLE", "SSLCommerz could not be reached securely.");
  } finally { clearTimeout(timeout); }
}

function credentials(config: SslCommerzConfig) {
  return { storeId: required(config.storeId, "SSLCommerz Store ID", 30), storePassword: required(config.storePassword, "SSLCommerz Store Password", 128) };
}

export async function createSslCommerzSession(input: SslCommerzSessionInput, config: SslCommerzConfig, fetcher: Fetcher = fetch) {
  const auth = credentials(config);
  const reference = required(input.reference, "Payment reference", 30);
  const amount = minorUnits(input.amount);
  if (input.currency !== "BDT") throw new SslCommerzError("UNSUPPORTED_CURRENCY", "The initial SSLCommerz adapter accepts BDT only.");
  const form = new URLSearchParams({
    store_id: auth.storeId,
    store_passwd: auth.storePassword,
    total_amount: `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`,
    currency: "BDT",
    tran_id: reference,
    success_url: callbackUrl(input.successUrl, config),
    fail_url: callbackUrl(input.failUrl, config),
    cancel_url: callbackUrl(input.cancelUrl, config),
    ipn_url: callbackUrl(input.ipnUrl, config),
    product_name: required(input.productName, "Product name", 255),
    product_category: required(input.productCategory, "Product category", 50),
    product_profile: "general",
    num_of_item: String(Math.min(Math.max(Math.trunc(input.itemCount), 1), 9999)),
    value_a: required(input.internalPaymentId, "Internal payment ID", 100),
    shipping_method: "YES",
    cus_name: required(input.customer.name, "Customer name", 50),
    cus_email: required(input.customer.email, "Customer email", 50),
    cus_add1: required(input.customer.address, "Customer address", 50),
    cus_city: required(input.customer.city, "Customer city", 50),
    cus_state: input.customer.state?.trim().slice(0, 50) || input.customer.city.trim().slice(0, 50),
    cus_postcode: input.customer.postcode?.trim().slice(0, 20) || "0000",
    cus_country: required(input.customer.country, "Customer country", 50),
    cus_phone: required(input.customer.phone, "Customer phone", 20),
    ship_name: required(input.customer.name, "Shipping name", 50),
    ship_add1: required(input.customer.address, "Shipping address", 50),
    ship_city: required(input.customer.city, "Shipping city", 50),
    ship_state: input.customer.state?.trim().slice(0, 50) || input.customer.city.trim().slice(0, 50),
    ship_postcode: input.customer.postcode?.trim().slice(0, 20) || "0000",
    ship_country: required(input.customer.country, "Shipping country", 50),
    ship_phone: required(input.customer.phone, "Shipping phone", 20),
  });
  const endpoint = `${hosts[config.environment].api}/gwprocess/v4/api.php`;
  const parsed = sessionResponseSchema.safeParse(await requestJson(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() }, config, fetcher));
  if (!parsed.success || parsed.data.status.toUpperCase() !== "SUCCESS" || !parsed.data.GatewayPageURL || !parsed.data.sessionkey) throw new SslCommerzError("SESSION_REJECTED", "SSLCommerz did not create a checkout session.");
  return { redirectUrl: safeGatewayUrl(parsed.data.GatewayPageURL, config.environment), sessionKey: parsed.data.sessionkey };
}

export async function validateSslCommerzTransaction(input: { validationId: string; expectedReference: string; expectedAmount: string; expectedCurrency: string }, config: SslCommerzConfig, fetcher: Fetcher = fetch) {
  const auth = credentials(config);
  const expectedReference = required(input.expectedReference, "Payment reference", 30);
  const expectedAmount = minorUnits(input.expectedAmount);
  if (input.expectedCurrency !== "BDT") throw new SslCommerzError("UNSUPPORTED_CURRENCY", "The initial SSLCommerz adapter validates BDT only.");
  const endpoint = new URL(`${hosts[config.environment].api}/validator/api/validationserverAPI.php`);
  endpoint.search = new URLSearchParams({ val_id: required(input.validationId, "Validation ID", 100), store_id: auth.storeId, store_passwd: auth.storePassword, v: "1", format: "json" }).toString();
  const parsed = validationResponseSchema.safeParse(await requestJson(endpoint.toString(), { method: "GET", headers: { Accept: "application/json" } }, config, fetcher));
  if (!parsed.success) throw new SslCommerzError("INVALID_PROVIDER_RESPONSE", "SSLCommerz validation evidence is incomplete.");
  const data = parsed.data;
  if (!new Set(["VALID", "VALIDATED"]).has(data.status.toUpperCase())) throw new SslCommerzError("PAYMENT_NOT_VALID", "SSLCommerz did not validate this transaction.");
  if (data.tran_id !== expectedReference) throw new SslCommerzError("REFERENCE_MISMATCH", "The validated transaction reference does not match.");
  if (minorUnits(data.amount) !== expectedAmount) throw new SslCommerzError("AMOUNT_MISMATCH", "The validated payment amount does not match.");
  const currency = (data.currency ?? data.currency_type ?? "").toUpperCase();
  if (currency !== input.expectedCurrency) throw new SslCommerzError("CURRENCY_MISMATCH", "The validated payment currency does not match.");
  const reviewRequired = String(data.risk_level ?? "0") === "1";
  return {
    outcome: reviewRequired ? "REVIEW_REQUIRED" as const : "VALID" as const,
    evidence: { validationId: data.val_id, bankTransactionId: data.bank_tran_id ?? null, providerStatus: data.status.toUpperCase(), riskLevel: reviewRequired ? 1 : 0, riskTitle: data.risk_title ?? null },
  };
}

export async function initiateSslCommerzRefund(input: { bankTransactionId: string; refundTransactionId: string; amount: string; remarks: string; reference?: string }, config: SslCommerzConfig, fetcher: Fetcher = fetch) {
  const auth = credentials(config);
  const amount = minorUnits(input.amount);
  const endpoint = new URL(`${hosts[config.environment].api}/validator/api/merchantTransIDvalidationAPI.php`);
  endpoint.search = new URLSearchParams({
    bank_tran_id: required(input.bankTransactionId, "Bank transaction ID", 80),
    refund_trans_id: required(input.refundTransactionId, "Refund transaction ID", 30),
    refund_amount: `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`,
    refund_remarks: required(input.remarks, "Refund remarks", 255),
    ...(input.reference ? { refe_id: required(input.reference, "Refund reference", 50) } : {}),
    store_id: auth.storeId,
    store_passwd: auth.storePassword,
    v: "1",
    format: "json",
  }).toString();
  const parsed = refundInitiationResponseSchema.safeParse(await requestJson(endpoint.toString(), { method: "GET", headers: { Accept: "application/json" } }, config, fetcher));
  if (!parsed.success) throw new SslCommerzError("INVALID_PROVIDER_RESPONSE", "SSLCommerz refund evidence is incomplete.");
  const providerStatus = parsed.data.status?.toLowerCase();
  if (parsed.data.APIConnect.toUpperCase() !== "DONE" || !providerStatus || !new Set(["success", "processing"]).has(providerStatus) || !parsed.data.refund_ref_id) {
    throw new SslCommerzError("REFUND_REJECTED", "SSLCommerz did not accept the refund request.");
  }
  return { outcome: providerStatus === "success" ? "INITIATED" as const : "PROCESSING" as const, providerStatus, providerRefundReference: parsed.data.refund_ref_id, bankTransactionId: parsed.data.bank_tran_id ?? input.bankTransactionId, providerTransactionId: parsed.data.trans_id ?? null };
}

export async function querySslCommerzRefund(input: { providerRefundReference: string }, config: SslCommerzConfig, fetcher: Fetcher = fetch) {
  const auth = credentials(config);
  const endpoint = new URL(`${hosts[config.environment].api}/validator/api/merchantTransIDvalidationAPI.php`);
  endpoint.search = new URLSearchParams({ refund_ref_id: required(input.providerRefundReference, "Provider refund reference", 50), store_id: auth.storeId, store_passwd: auth.storePassword, format: "json" }).toString();
  const parsed = refundStatusResponseSchema.safeParse(await requestJson(endpoint.toString(), { method: "GET", headers: { Accept: "application/json" } }, config, fetcher));
  if (!parsed.success || parsed.data.APIConnect.toUpperCase() !== "DONE" || !parsed.data.status) throw new SslCommerzError("REFUND_STATUS_UNAVAILABLE", "SSLCommerz did not return valid refund status evidence.");
  const providerStatus = parsed.data.status.toLowerCase();
  if (!new Set(["refunded", "processing", "cancelled"]).has(providerStatus)) throw new SslCommerzError("INVALID_PROVIDER_RESPONSE", "SSLCommerz returned an unknown refund status.");
  return { outcome: providerStatus === "refunded" ? "SUCCEEDED" as const : providerStatus === "cancelled" ? "FAILED" as const : "PROCESSING" as const, providerStatus, providerRefundReference: parsed.data.refund_ref_id ?? input.providerRefundReference, bankTransactionId: parsed.data.bank_tran_id ?? null, providerTransactionId: parsed.data.tran_id ?? parsed.data.trans_id ?? null, initiatedOn: parsed.data.initiated_on ?? null, refundedOn: parsed.data.refunded_on ?? null };
}
