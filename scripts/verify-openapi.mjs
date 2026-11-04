import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildOpenApiDocument, discoverOperations } from "./openapi-contract.mjs";

const target = join(process.cwd(), "public", "openapi.yaml");
const committedText = readFileSync(target, "utf8");
const committed = JSON.parse(committedText);
const expected = buildOpenApiDocument();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(committed.openapi === "3.0.3", "The published contract must use OpenAPI 3.0.3.");
assert(JSON.stringify(committed) === JSON.stringify(expected), "OpenAPI drift detected. Run npm run api:generate and review the contract.");

const operations = discoverOperations();
assert(operations.length > 0, "No API operations were discovered.");
for (const operation of operations) {
  const published = committed.paths[operation.path]?.[operation.method];
  assert(published, `Missing contract operation: ${operation.method.toUpperCase()} ${operation.path}`);
  assert(Array.isArray(published.security), `Missing explicit security declaration: ${operation.method.toUpperCase()} ${operation.path}`);
  assert(published.responses?.["500"]?.$ref, `Missing safe server-error contract: ${operation.method.toUpperCase()} ${operation.path}`);
  if (operation.source.includes('headers.get("Idempotency-Key")')) {
    assert(published.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), `Missing Idempotency-Key contract: ${operation.method.toUpperCase()} ${operation.path}`);
  }
  if (operation.source.includes("getRequestSession")) {
    assert(published["x-crossly-access"] !== "public", `Session-aware operation was incorrectly published as public: ${operation.method.toUpperCase()} ${operation.path}`);
  }
  const providerProtocol = operation.path === "/payments/sslcommerz/ipn" || operation.path === "/payments/sslcommerz/return/{outcome}";
  const browserOauthRedirect = operation.path === "/auth/oauth/google/start" || operation.path === "/auth/oauth/google/callback";
  const usesEnvelope = operation.source.includes("apiSuccess") || operation.source.includes("apiError") || operation.path === "/auth/logout";
  assert(usesEnvelope || providerProtocol || browserOauthRedirect, `JSON API operation does not use the standard envelope helpers: ${operation.method.toUpperCase()} ${operation.path}`);
  if (providerProtocol) assert(published["x-crossly-access"].startsWith("external-provider-"), `Provider callback is missing explicit external-protocol access metadata: ${operation.path}`);
  if (browserOauthRedirect) assert(published["x-crossly-access"] === "browser-oauth-redirect" && published.responses?.["303"], `OAuth redirect is missing explicit browser-redirect contract metadata: ${operation.path}`);
}

const exactOrderContracts = [
  ["/admin/orders/{orderId}/supplier-records/{recordId}/dispatch", "post", "SupplierDispatchRequest", "SupplierDispatchResponse"],
  ["/operations/packages/receive", "post", "WarehouseReceiptRequest", "WarehouseReceiptResponse"],
  ["/admin/orders/{orderId}/supplier-records", "get", null, "SupplierOrderRecordListResponse"],
  ["/admin/orders/{orderId}/supplier-records", "post", "SupplierOrderRecordRequest", "SupplierOrderRecordResponse"],
  ["/admin/orders/{orderId}/supplier-records/{recordId}/correction", "post", "SupplierRecordReplacementRequest", "SupplierOrderRecordResponse"],
  ["/orders", "post", "OrderCheckoutRequest", "OrderCheckoutResponse"],
  ["/orders/{orderId}/timeline", "get", null, "OrderTimelineResponse"],
  ["/orders/{orderId}/shipping-quote/accept", "post", null, "ShippingQuoteDecisionResponse"],
  ["/orders/{orderId}/shipping-quote/reject", "post", null, "ShippingQuoteDecisionResponse"],
  ["/admin/orders/{orderId}/purchase-review", "patch", "PurchaseReviewRequest", null],
  ["/admin/orders/{orderId}/shipping-quote", "post", "AdminShippingQuoteRequest", null],
  ["/admin/orders/{orderId}/status", "patch", "AdminOrderStatusRequest", null],
];

const auditOperation = committed.paths["/admin/audit-logs"]?.get;
const inspectionOperation = committed.paths["/operations/packages/{packageId}/inspect"]?.post;
assert(inspectionOperation?.requestBody?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/PackageInspectionRequest", "Missing strict package inspection request contract.");
for (const status of ["200", "201"]) assert(inspectionOperation.responses[status]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/PackageInspectionResponse", "Missing package inspection replay/create contract.");
const supplierRecordsOperation = committed.paths["/admin/orders/{orderId}/supplier-records"]?.get;
assert(supplierRecordsOperation.parameters.some(parameter => parameter.name === "page" && parameter.schema.maximum === 10000), "Supplier records must document bounded page navigation.");
assert(committed.components.schemas.SupplierOrderRecordListResponse.properties.data.properties.pagination, "Supplier records must document additive pagination metadata.");
assert(auditOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/AdminAuditLogResponse", "Missing exact Admin audit-log response contract.");
for (const parameterName of ["q", "action", "entityType", "from", "to", "page", "pageSize"]) assert(auditOperation.parameters.some((parameter) => parameter.name === parameterName), `Admin audit-log query is missing ${parameterName}.`);
const notificationPreferenceContracts = [
  ["get", null, "NotificationPreferencesResponse"],
  ["patch", "NotificationPreferenceUpdateRequest", "NotificationPreferenceResponse"],
];
for (const [method, requestSchema, successSchema] of notificationPreferenceContracts) {
  const operation = committed.paths["/notifications/preferences"]?.[method];
  assert(operation, `Missing exact notification-preference contract: ${method.toUpperCase()}.`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, "Wrong notification-preference request schema.");
  assert(operation.responses["200"]?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, "Wrong notification-preference response schema.");
}
const marketingCampaignContracts = [
  ["get", null, "MarketingCampaignPreviewResponse"],
  ["post", "MarketingCampaignSendRequest", "MarketingCampaignSendResponse"],
];
for (const [method, requestSchema, successSchema] of marketingCampaignContracts) {
  const operation = committed.paths["/admin/marketing-campaigns"]?.[method];
  assert(operation, `Missing exact marketing-campaign contract: ${method.toUpperCase()}.`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, "Marketing campaign errors are not inventoried.");
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, "Wrong marketing-campaign request schema.");
  assert((operation.responses["200"] ?? operation.responses["201"])?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, "Wrong marketing-campaign response schema.");
}
assert(committed.paths["/admin/marketing-campaigns"].post.parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), "Marketing campaign send is missing its idempotency header.");
const marketingReportOperation = committed.paths["/admin/marketing-campaigns/{campaignId}"]?.get;
assert(marketingReportOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/MarketingCampaignReportResponse", "Missing exact marketing campaign report response contract.");
for (const parameterName of ["campaignId", "q", "page"]) assert(marketingReportOperation.parameters.some((parameter) => parameter.name === parameterName), `Marketing campaign report is missing ${parameterName}.`);
const marketingCancelOperation = committed.paths["/admin/marketing-campaigns/{campaignId}"]?.patch;
assert(marketingCancelOperation?.requestBody?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/MarketingCampaignCancelRequest", "Missing exact scheduled-campaign cancellation request contract.");
assert(marketingCancelOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/MarketingCampaignCancelResponse", "Missing exact scheduled-campaign cancellation response contract.");
for (const path of ["/admin/marketing-campaigns/run", "/internal/maintenance/marketing-campaigns"]) assert(committed.paths[path]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/MarketingCampaignRunResponse", `Missing exact scheduled-campaign runner contract: ${path}.`);
assert(committed.paths["/internal/maintenance/marketing-campaigns"].post["x-crossly-access"] === "scheduler", "Scheduled campaign maintenance endpoint is not scheduler-protected.");
for (const [path, method, requestSchema, successSchema] of exactOrderContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact order contract: ${method.toUpperCase()} ${path}`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, `Missing business-error inventory: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong request schema for ${method.toUpperCase()} ${path}`);
  else assert(!operation.requestBody, `Bodyless operation must not require a request body: ${method.toUpperCase()} ${path}`);
  if (successSchema) {
    const success = operation.responses["200"] ?? operation.responses["201"];
    assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong success schema for ${method.toUpperCase()} ${path}`);
  }
}

const exactPaymentContracts = [
  ["/payments/providers", "get", null, "PaymentProvidersResponse"],
  ["/payments/checkout", "post", "PaymentCheckoutRequest", "PaymentIntentResponse"],
  ["/payments/wallet", "post", "WalletPaymentRequest", "WalletPaymentResponse"],
  ["/payments/shipping/wallet", "post", "ShippingWalletPaymentRequest", "ShippingPaymentResponse"],
  ["/wallet", "get", null, "WalletResponse"],
];
for (const [path, method, requestSchema, successSchema] of exactPaymentContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact payment contract: ${method.toUpperCase()} ${path}`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, `Missing payment error inventory: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong payment request schema for ${method.toUpperCase()} ${path}`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong payment success schema for ${method.toUpperCase()} ${path}`);
}
for (const parameterName of ["country", "amount"]) assert(committed.paths["/payments/providers"].get.parameters.some((parameter) => parameter.name === parameterName && parameter.required), `Payment providers query is missing required ${parameterName}.`);
const riskDecision = committed.paths["/admin/payment-risk/{paymentId}/decision"]?.post;
assert(riskDecision?.requestBody?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/PaymentRiskDecisionRequest", "Missing exact payment-risk decision request contract.");
assert(riskDecision?.responses?.["201"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/PaymentRiskDecisionResponse", "Missing exact payment-risk decision response contract.");
assert(riskDecision?.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), "Payment-risk decision is missing its idempotency header.");
const reconciliationContracts = [
  ["/finance/payment-reconciliation", "get", null, "PaymentSettlementListResponse"],
  ["/finance/payment-reconciliation", "post", "PaymentSettlementImportRequest", "PaymentSettlementImportResponse"],
  ["/finance/payment-reconciliation/{entryId}/proposals", "post", "PaymentSettlementResolutionProposalRequest", "PaymentSettlementResolutionProposalResponse"],
  ["/finance/payment-reconciliation/proposals/{proposalId}/decision", "post", "PaymentSettlementResolutionDecisionRequest", "PaymentSettlementResolutionDecisionResponse"],
];
for (const [path, method, requestSchema, successSchema] of reconciliationContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact reconciliation contract: ${method.toUpperCase()} ${path}.`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong reconciliation request schema for ${path}.`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong reconciliation response schema for ${path}.`);
}
for (const path of ["/finance/payment-reconciliation", "/finance/payment-reconciliation/{entryId}/proposals", "/finance/payment-reconciliation/proposals/{proposalId}/decision"]) {
  const operation = committed.paths[path].post;
  assert(operation.parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), `Reconciliation mutation is missing its idempotency header: ${path}.`);
}
for (const hidden of ["idempotencyKey", "requestFingerprint", "sourceFingerprint", "evidenceFingerprint", "paymentIntentId", "importedById", "proposedById", "reviewedById"]) {
  assert(!JSON.stringify(committed.components.schemas.PaymentSettlementBatch).includes(`\"${hidden}\"`), `Settlement API schema exposed internal field ${hidden}.`);
  assert(!JSON.stringify(committed.components.schemas.PaymentSettlementResolutionProposal).includes(`\"${hidden}\"`), `Settlement proposal schema exposed internal field ${hidden}.`);
  assert(!JSON.stringify(committed.components.schemas.PaymentSettlementResolutionDecision).includes(`\"${hidden}\"`), `Settlement decision schema exposed internal field ${hidden}.`);
}
const sslCommerzIpn = committed.paths["/payments/sslcommerz/ipn"]?.post;
assert(sslCommerzIpn?.requestBody?.content?.["application/x-www-form-urlencoded"], "SSLCommerz IPN contract is missing its provider form payload.");
assert(sslCommerzIpn?.["x-crossly-access"] === "external-provider-callback", "SSLCommerz IPN is not explicitly classified as a provider callback.");
for (const parameterName of ["currency", "cursor", "limit"]) assert(committed.paths["/wallet"].get.parameters.some((parameter) => parameter.name === parameterName || parameter.$ref?.endsWith(`/${parameterName[0].toUpperCase()}${parameterName.slice(1)}`)), `Wallet query is missing ${parameterName}.`);

const exactCatalogContracts = [
  ["/catalog/categories", "get", null, "CatalogCategoriesResponse"],
  ["/catalog/destinations", "get", null, "CatalogDestinationsResponse"],
  ["/catalog/products", "get", null, "CatalogProductsResponse"],
  ["/catalog/products/{productId}", "get", null, "CatalogProductDetailResponse"],
  ["/catalog/products/{productId}/reviews", "get", null, "ProductReviewsResponse"],
  ["/catalog/products/{productId}/reviews", "post", "ProductReviewSubmissionRequest", "ProductReviewSubmissionResponse"],
  ["/catalog/stores", "get", null, "CatalogStoresResponse"],
  ["/catalog/stores/{storeSlug}", "get", null, "CatalogStoreDetailResponse"],
];
for (const [path, method, requestSchema, successSchema] of exactCatalogContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact catalog contract: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong catalog request schema for ${method.toUpperCase()} ${path}`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong catalog success schema for ${method.toUpperCase()} ${path}`);
}
for (const parameterName of ["q", "category", "page", "pageSize"]) assert(committed.paths["/catalog/products"].get.parameters.some((parameter) => parameter.name === parameterName), `Catalog products query is missing ${parameterName}.`);
for (const privateField of ["customerId", "orderItemId", "idempotencyKey", "requestFingerprint", "moderatedById"]) assert(!(privateField in committed.components.schemas.SubmittedProductReview.properties), `Submitted review schema exposed ${privateField}.`);

const exactCartContracts = [
  ["/cart", "get", null, "CartResponse"],
  ["/cart/items", "post", "CartItemSaveRequest", "CartItemSaveResponse"],
  ["/cart/items/{itemId}", "patch", "CartItemQuantityRequest", "CartResponse"],
  ["/cart/items/{itemId}", "delete", null, "CartResponse"],
];
for (const [path, method, requestSchema, successSchema] of exactCartContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact cart contract: ${method.toUpperCase()} ${path}`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, `Missing cart error inventory: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong cart request schema for ${method.toUpperCase()} ${path}`);
  else assert(!operation.requestBody, `Bodyless cart operation must not require a request body: ${method.toUpperCase()} ${path}`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong cart success schema for ${method.toUpperCase()} ${path}`);
}

const exactCustomerAccountContracts = [
  ["/users/me", "get", null, "CustomerProfileGetResponse"],
  ["/users/me", "patch", "CustomerProfileUpdateRequest", "CustomerProfileUpdateResponse"],
  ["/users/me/addresses", "get", null, "SavedAddressListResponse"],
  ["/users/me/addresses", "post", "SavedAddressCreateRequest", "SavedAddressResponse"],
  ["/users/me/addresses/{addressId}", "patch", "SavedAddressUpdateRequest", "SavedAddressResponse"],
  ["/users/me/addresses/{addressId}", "delete", null, "SavedAddressDeleteResponse"],
  ["/users/me/privacy", "get", null, "CustomerPrivacyResponse"],
  ["/users/me/privacy", "patch", "CustomerPrivacyUpdateRequest", "CustomerPrivacyResponse"],
];
for (const [path, method, requestSchema, successSchema] of exactCustomerAccountContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact customer-account contract: ${method.toUpperCase()} ${path}`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, `Missing customer-account error inventory: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong customer-account request schema for ${method.toUpperCase()} ${path}`);
  else assert(!operation.requestBody, `Bodyless customer-account operation must not require a request body: ${method.toUpperCase()} ${path}`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong customer-account success schema for ${method.toUpperCase()} ${path}`);
}
for (const privateField of ["userId", "deletedAt", "createdAt", "updatedAt"]) assert(!(privateField in committed.components.schemas.SavedAddress.properties), `Saved address schema exposed ${privateField}.`);

const exactWishlistContracts = [
  ["/wishlist", "get", null, "WishlistResponse"],
  ["/wishlist/items", "post", "WishlistSaveRequest", "WishlistSaveResponse"],
  ["/wishlist/items/{productId}", "delete", null, "WishlistRemoveResponse"],
];
for (const [path, method, requestSchema, successSchema] of exactWishlistContracts) {
  const operation = committed.paths[path]?.[method];
  assert(operation, `Missing exact wishlist contract: ${method.toUpperCase()} ${path}`);
  assert(Array.isArray(operation["x-crossly-error-codes"]) && operation["x-crossly-error-codes"].length > 0, `Missing wishlist error inventory: ${method.toUpperCase()} ${path}`);
  if (requestSchema) assert(operation.requestBody?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${requestSchema}`, `Wrong wishlist request schema for ${method.toUpperCase()} ${path}`);
  else assert(!operation.requestBody, `Bodyless wishlist operation must not require a request body: ${method.toUpperCase()} ${path}`);
  const success = operation.responses["200"] ?? operation.responses["201"];
  assert(success?.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${successSchema}`, `Wrong wishlist success schema for ${method.toUpperCase()} ${path}`);
}
for (const privateField of ["userId", "sellerProfileId", "deletedAt", "complianceRuleCodes"]) assert(!(privateField in committed.components.schemas.WishlistProduct.properties), `Wishlist product schema exposed ${privateField}.`);

console.log(`OpenAPI verification passed: ${operations.length} operations are documented with explicit security, envelopes, errors, and idempotency headers.`);
