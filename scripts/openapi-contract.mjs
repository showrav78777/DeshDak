import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const HTTP_METHOD_PATTERN = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const API_ROOT = join(process.cwd(), "src", "app", "api", "v1");
const OPTIONAL_SESSION_PATHS = new Set(["/payments/providers"]);
const OPTIONAL_SESSION_PREFIXES = ["/identifiers/products/"];
const EXACT_OPERATIONS = {
  "post /account/phone-verification/request": { summary: "Generate an explicit local development code; live SMS delivery is unavailable", successSchema: "PhoneVerificationRequestResponse", successStatuses: ["200"], unavailable: true, errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "PHONE_REQUIRED", "SMS_PROVIDER_NOT_CONFIGURED", "TOO_MANY_REQUESTS"] },
  "post /account/phone-verification/confirm": { summary: "Confirm a local development code; reject while live SMS verification is unavailable", requestSchema: "PhoneCodeRequest", successSchema: "PhoneVerifiedResponse", successStatuses: ["200"], unavailable: true, errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "PHONE_CODE_INVALID", "SMS_PROVIDER_NOT_CONFIGURED", "TOO_MANY_REQUESTS"] },
  "post /notifications/email-events": {
    summary: "Verify exact-byte email callback signatures, deduplicate receipts and update delivery/suppression evidence",
    externalProtocol: "signed-email-webhook", requestSchema: "EmailReceiptWebhookRequest", successSchema: "EmailReceiptWebhookResponse", successStatuses: ["200"],
    parameters: [{ name: "svix-id", in: "header", required: true, schema: { type: "string", maxLength: 200 } }, { name: "svix-timestamp", in: "header", required: true, schema: { type: "string", pattern: "^[0-9]{1,12}$" } }],
    errors: ["EMAIL_WEBHOOK_UNAVAILABLE", "UNSUPPORTED_PAYLOAD", "PAYLOAD_TOO_LARGE", "INVALID_PAYLOAD", "INVALID_WEBHOOK_SIGNATURE", "WEBHOOK_EVENT_CONFLICT", "EMAIL_WEBHOOK_RETRY"],
  },
  "get /admin/private-photos": { summary: "List redacted private-photo reservation and quarantine metadata with Admin MFA", parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }, { name: "state", in: "query", schema: { type: "string", enum: ["all", "quarantined"], default: "all" } }], errors: ["ADMIN_MFA_REQUIRED", "VALIDATION_ERROR", "PHOTO_QUEUE_UNAVAILABLE"] },
  "post /admin/private-photos/{uploadId}/quarantine/rescans": { summary: "Verify and rescan the exact stored copy without releasing quarantine", requestSchema: "PrivatePhotoRescanRequest", successStatuses: ["200", "202"], errors: ["ADMIN_MFA_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PRIVATE_RESCAN_SETUP_REQUIRED", "PRIVATE_RESCAN_DENIED", "PRIVATE_RESCAN_CONFLICT", "PRIVATE_RESCAN_UNAVAILABLE"] },
  "get /admin/private-photos/{uploadId}/quarantine/reviews": { summary: "Read immutable quarantine review history with Admin MFA", parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }], errors: ["ADMIN_MFA_REQUIRED", "VALIDATION_ERROR", "PHOTO_REVIEW_DENIED", "PHOTO_REVIEW_UNAVAILABLE"] },
  "post /admin/private-photos/{uploadId}/quarantine/reviews": { summary: "Record a version-checked quarantine review without releasing or certifying the photo", requestSchema: "PrivatePhotoReviewRequest", errors: ["ADMIN_MFA_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PHOTO_REVIEW_CONFLICT", "PHOTO_REVIEW_DENIED", "PHOTO_REVIEW_UNAVAILABLE"] },
  "post /admin/private-photos/{uploadId}/quarantine": { summary: "Permanently quarantine a private photo without deleting evidence or history", requestSchema: "PrivatePhotoQuarantineRequest", errors: ["ADMIN_MFA_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PHOTO_QUARANTINE_CONFLICT", "PHOTO_QUARANTINE_DENIED", "PHOTO_QUARANTINE_UNAVAILABLE"] },
  "get /admin/email-suppressions": { summary: "List private recipient-block review records with MFA and pagination", parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }, { name: "state", in: "query", schema: { type: "string", enum: ["active", "released"], default: "active" } }], errors: ["ADMIN_MFA_REQUIRED", "VALIDATION_ERROR"] },
  "post /admin/email-suppressions/{suppressionId}/release": { summary: "Version-safely release a reviewed recipient block without resending failed mail", requestSchema: "EmailSuppressionReviewRequest", errors: ["ADMIN_MFA_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "SUPPRESSION_NOT_FOUND", "SUPPRESSION_VERSION_CONFLICT", "SUPPRESSION_RETRY_REQUIRED"] },
  "post /operations/packages/{packageId}/inspect": { summary: "Record one assigned package inspection with actor-bound retry identity and transactional stage guards", requestSchema: "PackageInspectionRequest", successSchema: "PackageInspectionResponse", successStatuses: ["200", "201"], errors: ["INSPECTION_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PACKAGE_NOT_FOUND", "INVALID_EVIDENCE", "IDEMPOTENCY_KEY_CONFLICT", "PACKAGE_NOT_READY_FOR_INSPECTION"] },
  "post /admin/orders/{orderId}/supplier-records/{recordId}/dispatch": { summary: "Record manual dispatch and create an expected parcel, never physical receipt", requestSchema: "SupplierDispatchRequest", successSchema: "SupplierDispatchResponse", successStatuses: ["200", "201"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "IDEMPOTENCY_KEY_REUSED", "DISPATCH_NOT_READY", "SUPPLIER_RECORD_NOT_READY", "SUPPLIER_RECORDS_REQUIRED", "LEGACY_PACKAGE_REVIEW_REQUIRED", "ORIGIN_WAREHOUSE_REQUIRED", "TRACKING_ALREADY_USED", "DISPATCH_CONFLICT"] },
  "post /operations/packages/receive": { summary: "Idempotently receive a physically checked parcel under an assigned origin warehouse", requestSchema: "WarehouseReceiptRequest", successSchema: "WarehouseReceiptResponse", successStatuses: ["200", "201"], errors: ["WAREHOUSE_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PACKAGE_NOT_FOUND", "IDEMPOTENCY_KEY_CONFLICT", "ORDER_OR_WAREHOUSE_NOT_FOUND", "ORDER_NOT_READY_FOR_RECEIVING", "ORIGIN_WAREHOUSE_REQUIRED", "WAREHOUSE_COUNTRY_MISMATCH", "WAREHOUSE_ASSIGNMENT_MISMATCH", "RECEIPT_CONFLICT"] },
  "post /admin/orders/{orderId}/supplier-records/{recordId}/correction": { summary: "Independent Admin replaces reported supplier text and releases its latest Sourcing hold", requestSchema: "SupplierRecordReplacementRequest", successSchema: "SupplierOrderRecordResponse", successStatuses: ["200", "201"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "CORRECTION_NOT_READY", "INDEPENDENT_ADMIN_REQUIRED", "CORRECTION_UNCHANGED", "IDEMPOTENCY_KEY_REUSED", "RECORD_LIMIT", "RECORD_CONFLICT"] },
  "get /admin/orders/{orderId}/supplier-records": { summary: "List private supplier reference and item-allocation records", successSchema: "SupplierOrderRecordListResponse", successStatuses: ["200"], parameters: [{ name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }], errors: ["ADMIN_ACCESS_REQUIRED", "ORDER_NOT_FOUND", "VALIDATION_ERROR"] },
  "post /admin/orders/{orderId}/supplier-records": { summary: "Idempotently append private operational supplier evidence without financial posting", requestSchema: "SupplierOrderRecordRequest", successSchema: "SupplierOrderRecordResponse", successStatuses: ["200", "201"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "ORDER_NOT_FOUND", "ORDER_NOT_READY", "ORDER_ITEM_REQUIRED", "ORDER_QUANTITY_REQUIRED", "ORIGIN_WAREHOUSE_REQUIRED", "QUANTITY_EXCEEDED", "RECORD_LIMIT", "RECORD_CONFLICT", "IDEMPOTENCY_KEY_REUSED"] },
  "get /admin/kam-staff": { summary: "List KAM staff and active assignment/session counts", successStatuses: ["200"], errors: ["ADMIN_ACCESS_REQUIRED"] },
  "post /admin/kam-staff": { summary: "Grant the KAM role to an existing verified staff account", requestSchema: "KamStaffRequest", successStatuses: ["201"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "ACTIVE_USER_NOT_FOUND", "ROLE_CONFIGURATION_MISSING"] },
  "delete /admin/kam-staff/{staffId}": { summary: "Revoke KAM access, assignments, and Sales sessions", successStatuses: ["200"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "KAM_STAFF_NOT_FOUND"] },
  "get /admin/business-accounts": { summary: "List protected Business accounts and KAM assignments", successStatuses: ["200"], errors: ["ADMIN_ACCESS_REQUIRED"] },
  "post /admin/business-accounts": { summary: "Create or reassign a verified Business customer account", requestSchema: "BusinessAccountAssignmentRequest", successStatuses: ["201"], errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "BUSINESS_CUSTOMER_NOT_FOUND", "KAM_NOT_FOUND"] },
  "get /sales/accounts": { summary: "List Business accounts assigned to the signed-in KAM", successSchema: "SalesAccountListResponse", successStatuses: ["200"], errors: ["KAM_ACCESS_REQUIRED"] },
  "get /sales/accounts/{accountId}": { summary: "Get an assigned Business account relationship view without Finance-only fields", successStatuses: ["200"], errors: ["KAM_ACCESS_REQUIRED", "ACCOUNT_NOT_FOUND"] },
  "post /sales/accounts/{accountId}/activities": { summary: "Idempotently record immutable activity for an assigned Business account", requestSchema: "AccountActivityRequest", successSchema: "AccountActivityResponse", successStatuses: ["200", "201"], errors: ["KAM_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "ACCOUNT_NOT_FOUND", "RFQ_ACCOUNT_MISMATCH", "IDEMPOTENCY_KEY_REUSED"] },
  "get /sales/accounts/{accountId}/opportunities": { summary: "List opportunities for an assigned Business account", successStatuses: ["200"], errors: ["KAM_ACCESS_REQUIRED", "ACCOUNT_NOT_FOUND"] },
  "post /sales/accounts/{accountId}/opportunities": { summary: "Idempotently create an opportunity linked to an optional owned RFQ", requestSchema: "SalesOpportunityCreateRequest", successStatuses: ["200", "201"], errors: ["KAM_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "ACCOUNT_NOT_FOUND", "RFQ_ACCOUNT_MISMATCH", "RFQ_ALREADY_LINKED", "IDEMPOTENCY_KEY_REUSED"] },
  "patch /sales/opportunities/{opportunityId}": { summary: "Version-safely advance an assigned opportunity and append immutable stage history", requestSchema: "SalesOpportunityStageRequest", successStatuses: ["200"], errors: ["KAM_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "OPPORTUNITY_NOT_FOUND", "OPPORTUNITY_VERSION_CONFLICT", "OPPORTUNITY_STAGE_UNCHANGED", "OPPORTUNITY_TERMINAL", "OPPORTUNITY_ORDER_REQUIRED", "IDEMPOTENCY_KEY_REUSED"] },
  "get /reels": {
    summary: "List the ranked public product Reel feed with optional customer personalization",
    optionalSession: true,
    parameters: [
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 20, default: 10 } },
      { name: "productId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    ],
    successSchema: "ReelsFeedResponse",
    successStatuses: ["200"],
  },
  "post /reels/{reelId}/engagements": {
    summary: "Idempotently record a rate-limited public Reel view, share, or product click",
    optionalSession: true,
    requestSchema: "ReelEngagementRequest",
    successSchema: "ReelEngagementResponse",
    successStatuses: ["200", "201"],
    errors: ["RATE_LIMITED", "VALIDATION_ERROR", "REEL_NOT_FOUND", "IDEMPOTENCY_KEY_IN_USE"],
  },
  "put /reels/{reelId}/reactions": {
    summary: "Idempotently add or remove an authenticated customer's Reel like or save",
    requestSchema: "ReelReactionRequest",
    successSchema: "ReelReactionResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "VALIDATION_ERROR", "REEL_NOT_FOUND"],
  },
  "get /reels/{reelId}/comments": {
    summary: "List moderated public comments for one Reel",
    optionalSession: true,
    parameters: [
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    ],
    successSchema: "ReelCommentsResponse",
    successStatuses: ["200"],
    errors: ["REEL_NOT_FOUND"],
  },
  "post /reels/{reelId}/comments": {
    summary: "Submit an authenticated customer Reel comment for moderation",
    requestSchema: "ReelCommentRequest",
    successSchema: "ReelCommentSubmissionResponse",
    successStatuses: ["201"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "RATE_LIMITED", "VALIDATION_ERROR", "REEL_NOT_FOUND"],
  },
  "get /seller/reels": {
    summary: "List Reels belonging to the authenticated seller",
    successStatuses: ["200"],
    errors: ["SELLER_ACCESS_REQUIRED", "SELLER_NOT_FOUND"],
  },
  "post /seller/reels": {
    summary: "Submit an approved product video as a Reel for moderation",
    requestSchema: "ReelSubmissionRequest",
    successStatuses: ["201"],
    errors: ["SELLER_ACCESS_REQUIRED", "SELLER_NOT_FOUND", "SELLER_NOT_APPROVED", "VALIDATION_ERROR", "PRODUCT_NOT_AVAILABLE", "VIDEO_NOT_READY", "VIDEO_ALREADY_SUBMITTED"],
  },
  "patch /seller/reels/{reelId}": {
    summary: "Version-safely edit, resubmit, or archive an owned seller Reel",
    requestSchema: "ReelSellerUpdateRequest",
    successStatuses: ["200"],
    errors: ["SELLER_ACCESS_REQUIRED", "VALIDATION_ERROR", "REEL_NOT_FOUND", "REEL_VERSION_CONFLICT", "REEL_STATE_CONFLICT", "REEL_CONTENT_UNAVAILABLE"],
  },
  "patch /admin/reels/{reelId}": {
    summary: "Version-safely publish, reject, or archive a Reel",
    requestSchema: "ReelModerationRequest",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "REEL_NOT_FOUND", "REEL_VERSION_CONFLICT", "REEL_STATE_CONFLICT", "REEL_CONTENT_UNAVAILABLE"],
  },
  "patch /admin/reel-comments/{commentId}": {
    summary: "Version-safely publish, reject, or remove a Reel comment",
    requestSchema: "ReelCommentModerationRequest",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "COMMENT_NOT_FOUND", "COMMENT_VERSION_CONFLICT", "COMMENT_STATE_CONFLICT"],
  },
  "post /payments/sslcommerz/ipn": {
    summary: "Receive an SSLCommerz IPN and validate it server to server before processing",
    externalProtocol: "provider-ipn",
    errors: ["INVALID_PAYLOAD", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_PAYLOAD", "GATEWAY_UNAVAILABLE", "VALIDATION_REJECTED", "VALIDATION_UNAVAILABLE"],
  },
  "get /payments/sslcommerz/return/{outcome}": {
    summary: "Return the customer from SSLCommerz without treating the browser redirect as payment proof",
    externalProtocol: "provider-return",
  },
  "post /payments/sslcommerz/return/{outcome}": {
    summary: "Return the customer from SSLCommerz POST without treating it as payment proof",
    externalProtocol: "provider-return",
  },
  "post /auth/register": {
    summary: "Register a customer in an enabled country and begin email verification",
    requestSchema: "RegisterRequest",
    successStatuses: ["201"],
    errors: ["VALIDATION_ERROR", "HUMAN_VERIFICATION_FAILED", "MARKET_NOT_AVAILABLE", "EMAIL_OR_PHONE_IN_USE"],
  },
  "get /auth/oauth/google/start": {
    summary: "Start the public Google OAuth authorization-code flow with PKCE",
    externalProtocol: "browser-oauth-redirect",
  },
  "get /auth/oauth/google/callback": {
    summary: "Complete the Google OAuth callback and redirect the browser without exposing provider details",
    externalProtocol: "browser-oauth-redirect",
  },
  "get /admin/audit-logs": {
    summary: "Search the protected administrator audit log with redacted metadata",
    parameters: [
      { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 120 } },
      { name: "action", in: "query", required: false, schema: { type: "string", maxLength: 100 } },
      { name: "entityType", in: "query", required: false, schema: { type: "string", maxLength: 80 } },
      { name: "from", in: "query", required: false, schema: { type: "string", format: "date" } },
      { name: "to", in: "query", required: false, schema: { type: "string", format: "date" } },
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 10, maximum: 100, default: 25 } },
    ],
    successSchema: "AdminAuditLogResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED"],
  },
  "get /admin/launch-readiness": {
    summary: "List protected launch gates, owners, blockers, and reviewed evidence",
    successSchema: "LaunchReadinessListResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED"],
  },
  "post /admin/launch-readiness": {
    summary: "Add a custom launch requirement without storing credentials",
    requestSchema: "LaunchReadinessCreateRequest",
    successSchema: "LaunchReadinessItemResponse",
    successStatuses: ["201"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR"],
  },
  "patch /admin/launch-readiness/{itemId}": {
    summary: "Record versioned launch evidence, blockers, ownership, and verification",
    requestSchema: "LaunchReadinessUpdateRequest",
    successSchema: "LaunchReadinessItemResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "LAUNCH_READINESS_NOT_FOUND", "VERSION_CONFLICT"],
  },
  "get /notifications/preferences": {
    summary: "List the authenticated user's effective notification preferences and channel readiness",
    successSchema: "NotificationPreferencesResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED"],
  },
  "get /admin/marketing-campaigns": {
    summary: "Preview explicitly opted-in marketing recipients after audience and frequency controls",
    parameters: [
      { name: "targetUserId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
      { name: "accountType", in: "query", required: false, schema: { type: "string", enum: ["PERSONAL", "BUSINESS"] } },
      { name: "locale", in: "query", required: false, schema: { type: "string", enum: ["en", "bn"] } },
    ],
    successSchema: "MarketingCampaignPreviewResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "VALIDATION_ERROR"],
  },
  "post /admin/marketing-campaigns": {
    summary: "Idempotently deliver one consent-controlled in-app marketing campaign",
    requestSchema: "MarketingCampaignSendRequest",
    successSchema: "MarketingCampaignSendResponse",
    successStatuses: ["200", "201"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "IDEMPOTENCY_KEY_REUSED", "CAMPAIGN_TOO_LARGE", "NO_ELIGIBLE_RECIPIENTS", "CAMPAIGN_RETRY_REQUIRED"],
  },
  "get /admin/marketing-campaigns/{campaignId}": {
    summary: "Inspect one campaign's recipients, consent snapshots, and in-app delivery state",
    parameters: [
      { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 120 } },
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
    ],
    successSchema: "MarketingCampaignReportResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "VALIDATION_ERROR", "CAMPAIGN_NOT_FOUND"],
  },
  "patch /admin/marketing-campaigns/{campaignId}": {
    summary: "Cancel one campaign that is still waiting for scheduled delivery",
    requestSchema: "MarketingCampaignCancelRequest",
    successSchema: "MarketingCampaignCancelResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "CAMPAIGN_NOT_CANCELLABLE"],
  },
  "post /admin/marketing-campaigns/run": {
    summary: "Process the next bounded batch of due scheduled campaigns from Admin",
    successSchema: "MarketingCampaignRunResponse",
    successStatuses: ["200"],
    errors: ["ADMIN_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "CAMPAIGN_DELIVERY_RUN_FAILED"],
  },
  "post /internal/maintenance/marketing-campaigns": {
    summary: "Process due scheduled campaigns from an authenticated scheduler",
    successSchema: "MarketingCampaignRunResponse",
    successStatuses: ["200"],
    errors: ["MAINTENANCE_NOT_CONFIGURED", "UNAUTHORIZED", "CAMPAIGN_DELIVERY_RUN_FAILED"],
  },
  "patch /notifications/preferences": {
    summary: "Update one available, non-locked notification preference",
    requestSchema: "NotificationPreferenceUpdateRequest",
    successSchema: "NotificationPreferenceResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "NOTIFICATION_CHANNEL_UNAVAILABLE", "ESSENTIAL_NOTIFICATION_REQUIRED"],
  },
  "get /wishlist": {
    summary: "List the authenticated customer's visible saved products",
    parameters: [
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 48, default: 24 } },
    ],
    successSchema: "WishlistResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED"],
  },
  "post /wishlist/items": {
    summary: "Idempotently save an approved public product to the customer wishlist",
    requestSchema: "WishlistSaveRequest",
    successSchema: "WishlistSaveResponse",
    successStatuses: ["200", "201"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "PRODUCT_NOT_FOUND"],
  },
  "delete /wishlist/items/{productId}": {
    summary: "Idempotently remove a product from the customer wishlist",
    successSchema: "WishlistRemoveResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN"],
  },
  "get /users/me": {
    summary: "Get the authenticated customer's profile and current session summary",
    successSchema: "CustomerProfileGetResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED"],
  },
  "patch /users/me": {
    summary: "Update the authenticated customer's profile",
    requestSchema: "CustomerProfileUpdateRequest",
    successSchema: "CustomerProfileUpdateResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "MARKET_NOT_AVAILABLE", "PHONE_IN_USE"],
  },
  "get /users/me/addresses": {
    summary: "List the authenticated customer's active saved delivery addresses",
    successSchema: "SavedAddressListResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED"],
  },
  "post /users/me/addresses": {
    summary: "Create a saved delivery address",
    requestSchema: "SavedAddressCreateRequest",
    successSchema: "SavedAddressResponse",
    successStatuses: ["201"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "ADDRESS_RETRY_REQUIRED"],
  },
  "patch /users/me/addresses/{addressId}": {
    summary: "Edit an owned delivery address or make it the default",
    requestSchema: "SavedAddressUpdateRequest",
    successSchema: "SavedAddressResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "ADDRESS_NOT_FOUND", "DEFAULT_ADDRESS_REQUIRED", "ADDRESS_RETRY_REQUIRED"],
  },
  "delete /users/me/addresses/{addressId}": {
    summary: "Soft-delete an owned delivery address and promote a replacement default",
    successSchema: "SavedAddressDeleteResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "ADDRESS_NOT_FOUND", "ADDRESS_RETRY_REQUIRED"],
  },
  "get /users/me/privacy": {
    summary: "Get the authenticated customer's optional analytics consent",
    successSchema: "CustomerPrivacyResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED"],
  },
  "patch /users/me/privacy": {
    summary: "Grant or withdraw optional analytics consent",
    requestSchema: "CustomerPrivacyUpdateRequest",
    successSchema: "CustomerPrivacyResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR"],
  },
  "get /cart": {
    summary: "Get the authenticated customer's private cart summary",
    successSchema: "CartResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED"],
  },
  "post /cart/items": {
    summary: "Add or replace a product-option quantity in the customer cart",
    requestSchema: "CartItemSaveRequest",
    successSchema: "CartItemSaveResponse",
    successStatuses: ["201"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "PRODUCT_OPTION_UNAVAILABLE", "INSUFFICIENT_INVENTORY", "MIXED_FULFILLMENT_CART"],
  },
  "patch /cart/items/{itemId}": {
    summary: "Update the quantity of an owned cart item",
    requestSchema: "CartItemQuantityRequest",
    successSchema: "CartResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "CART_ITEM_NOT_FOUND", "PRODUCT_OPTION_UNAVAILABLE", "INSUFFICIENT_INVENTORY"],
  },
  "delete /cart/items/{itemId}": {
    summary: "Remove an owned cart item",
    successSchema: "CartResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "CART_ITEM_NOT_FOUND"],
  },
  "get /catalog/categories": {
    summary: "List active public product categories",
    successSchema: "CatalogCategoriesResponse",
    successStatuses: ["200"],
  },
  "get /catalog/destinations": {
    summary: "List checkout-ready destinations and shipping lanes for an origin",
    parameters: [{ name: "origin", in: "query", required: false, schema: { type: "string", pattern: "^[A-Z]{2}$", default: "BD" } }],
    successSchema: "CatalogDestinationsResponse",
    successStatuses: ["200"],
    errors: ["INVALID_ORIGIN_COUNTRY"],
  },
  "post /catalog/market": {
    summary: "Persist an anonymous visitor's product-ranking market",
    requestSchema: "MarketCountryPreferenceRequest",
    successSchema: "MarketCountryPreferenceResponse",
    successStatuses: ["200"],
    errors: ["UNTRUSTED_ORIGIN", "VALIDATION_ERROR", "MARKET_NOT_AVAILABLE"],
  },
  "get /catalog/products": {
    summary: "Search and paginate approved public products",
    parameters: [
      { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 100 } },
      { name: "category", in: "query", required: false, schema: { type: "string", maxLength: 80 } },
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 48, default: 24 } },
    ],
    successSchema: "CatalogProductsResponse",
    successStatuses: ["200"],
    errors: ["INVALID_QUERY"],
  },
  "get /catalog/products/{productId}": {
    summary: "Get one approved public product",
    successSchema: "CatalogProductDetailResponse",
    successStatuses: ["200"],
    errors: ["PRODUCT_NOT_FOUND"],
  },
  "get /catalog/products/{productId}/reviews": {
    summary: "List published reviews and rating summary for a public product",
    parameters: [
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
    ],
    successSchema: "ProductReviewsResponse",
    successStatuses: ["200"],
    errors: ["PRODUCT_NOT_FOUND"],
  },
  "post /catalog/products/{productId}/reviews": {
    summary: "Submit a verified-purchase review for moderation",
    requestSchema: "ProductReviewSubmissionRequest",
    successSchema: "ProductReviewSubmissionResponse",
    successStatuses: ["200", "201"],
    errors: ["CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "IDEMPOTENCY_KEY_CONFLICT", "REVIEW_NOT_ELIGIBLE", "REVIEW_ALREADY_SUBMITTED", "REVIEW_SUBMISSION_CONFLICT"],
  },
  "get /catalog/stores": {
    summary: "Search and paginate approved Bangladesh stores",
    parameters: [
      { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 100 } },
      { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 48, default: 18 } },
    ],
    successSchema: "CatalogStoresResponse",
    successStatuses: ["200"],
    errors: ["INVALID_QUERY"],
  },
  "get /catalog/stores/{storeSlug}": {
    summary: "Get an approved Bangladesh store and its public products",
    successSchema: "CatalogStoreDetailResponse",
    successStatuses: ["200"],
    errors: ["STORE_NOT_FOUND"],
  },
  "get /payments/providers": {
    summary: "List runtime-ready payment methods for a destination and amount",
    parameters: [
      { name: "country", in: "query", required: true, schema: { type: "string", pattern: "^[A-Z]{2}$" } },
      { name: "baseCurrency", in: "query", required: false, schema: { type: "string", pattern: "^[A-Z]{3}$" }, description: "Required unless the legacy currency alias is supplied." },
      { name: "currency", in: "query", required: false, deprecated: true, schema: { type: "string", pattern: "^[A-Z]{3}$" } },
      { name: "amount", in: "query", required: true, schema: { type: "number", exclusiveMinimum: true, minimum: 0, maximum: 999999999 } },
    ],
    successSchema: "PaymentProvidersResponse",
    successStatuses: ["200"],
    errors: ["VALIDATION_ERROR"],
  },
  "post /payments/checkout": {
    summary: "Create or safely replay an external-gateway payment intent",
    requestSchema: "PaymentCheckoutRequest",
    successSchema: "PaymentIntentResponse",
    successStatuses: ["200", "201"],
    errors: ["CUSTOMER_ACCESS_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PAYMENT_NOT_AVAILABLE", "PAYMENT_METHOD_UNAVAILABLE", "PAYMENT_PROFILE_INCOMPLETE", "PAYMENT_ADAPTER_NOT_IMPLEMENTED", "PAYMENT_GATEWAY_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED"],
  },
  "post /admin/payment-risk/{paymentId}/decision": {
    summary: "Record one immutable MFA-protected administrator decision for a held SSLCommerz payment",
    requestSchema: "PaymentRiskDecisionRequest",
    successSchema: "PaymentRiskDecisionResponse",
    successStatuses: ["200", "201"],
    errors: ["ADMIN_MFA_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PAYMENT_NOT_FOUND", "PAYMENT_RISK_STATE_CONFLICT", "IDEMPOTENCY_KEY_REUSED", "PAYMENT_RETRY_REQUIRED"],
  },
  "get /finance/payment-reconciliation": {
    summary: "List protected gateway settlement reports and their resolution history",
    successSchema: "PaymentSettlementListResponse",
    successStatuses: ["200"],
    errors: ["FINANCE_ACCESS_REQUIRED"],
  },
  "post /finance/payment-reconciliation": {
    summary: "Import and exactly reconcile one immutable gateway settlement report",
    requestSchema: "PaymentSettlementImportRequest",
    successSchema: "PaymentSettlementImportResponse",
    successStatuses: ["200", "201"],
    errors: ["FINANCE_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "SETTLEMENT_TOTAL_INVALID", "IDEMPOTENCY_KEY_REUSED", "SETTLEMENT_BATCH_EXISTS", "SETTLEMENT_EVIDENCE_EXISTS", "SETTLEMENT_RETRY_REQUIRED"],
  },
  "post /finance/payment-reconciliation/{entryId}/proposals": {
    summary: "Propose an immutable evidence-based settlement exception resolution",
    requestSchema: "PaymentSettlementResolutionProposalRequest",
    successSchema: "PaymentSettlementResolutionProposalResponse",
    successStatuses: ["200", "201"],
    errors: ["FINANCE_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "SETTLEMENT_NOT_FOUND", "SETTLEMENT_NOT_RESOLVABLE", "SETTLEMENT_PENDING_PROPOSAL", "SETTLEMENT_INVALID_CORRECTED_PAYMENT", "SETTLEMENT_ALREADY_RESOLVED", "IDEMPOTENCY_KEY_REUSED", "SETTLEMENT_RETRY_REQUIRED", "SETTLEMENT_PROPOSAL_CONFLICT"],
  },
  "post /finance/payment-reconciliation/proposals/{proposalId}/decision": {
    summary: "Independently approve or reject a settlement exception resolution proposal",
    requestSchema: "PaymentSettlementResolutionDecisionRequest",
    successSchema: "PaymentSettlementResolutionDecisionResponse",
    successStatuses: ["200", "201"],
    errors: ["FINANCE_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "SETTLEMENT_NOT_FOUND", "SETTLEMENT_INDEPENDENT_REVIEW_REQUIRED", "SETTLEMENT_ALREADY_REVIEWED", "SETTLEMENT_ALREADY_RESOLVED", "IDEMPOTENCY_KEY_REUSED", "SETTLEMENT_RETRY_REQUIRED", "SETTLEMENT_DECISION_CONFLICT"],
  },
  "post /payments/wallet": {
    summary: "Pay for an order or accepted sourcing quote from the customer wallet",
    requestSchema: "WalletPaymentRequest",
    successSchema: "WalletPaymentResponse",
    successStatuses: ["200", "201"],
    errors: ["CUSTOMER_ACCESS_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "PAYMENT_NOT_AVAILABLE", "INSUFFICIENT_WALLET_BALANCE", "IDEMPOTENCY_KEY_REUSED", "PAYMENT_RETRY_REQUIRED"],
  },
  "post /payments/shipping/wallet": {
    summary: "Pay an accepted measured shipping quote from the customer wallet",
    requestSchema: "ShippingWalletPaymentRequest",
    successSchema: "ShippingPaymentResponse",
    successStatuses: ["200", "201"],
    errors: ["CUSTOMER_ACCESS_REQUIRED", "UNTRUSTED_ORIGIN", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "SHIPPING_PAYMENT_NOT_AVAILABLE", "INSUFFICIENT_WALLET_BALANCE", "IDEMPOTENCY_KEY_REUSED", "PAYMENT_RETRY_REQUIRED"],
  },
  "get /wallet": {
    summary: "Get a private wallet balance and cursor-paginated ledger",
    parameters: [
      { name: "currency", in: "query", required: false, schema: { type: "string", pattern: "^[A-Z]{3}$", default: "BDT" } },
      { $ref: "#/components/parameters/Cursor" },
      { $ref: "#/components/parameters/Limit" },
    ],
    successSchema: "WalletResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "VALIDATION_ERROR"],
  },
  "post /orders": {
    summary: "Create an order from the authenticated customer's cart",
    requestSchema: "OrderCheckoutRequest",
    successSchema: "OrderCheckoutResponse",
    successStatuses: ["200", "201"],
    errors: ["AUTHENTICATION_REQUIRED", "CUSTOMER_ACCESS_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR", "CHECKOUT_NOT_AVAILABLE", "CART_ITEM_UNAVAILABLE", "INSUFFICIENT_INVENTORY", "MIXED_FULFILLMENT_CART", "MIXED_ORIGIN_CART", "SELLER_NOT_APPROVED", "SHIPPING_LANE_REQUIRED", "DESTINATION_NOT_AVAILABLE", "RESTRICTED_GOODS_BLOCKED", "COMPLIANCE_REVIEW_REQUIRED", "IDEMPOTENCY_KEY_REUSED", "CHECKOUT_RETRY_REQUIRED"],
  },
  "get /orders/{orderId}/timeline": {
    summary: "Get the authenticated customer's order, package, and shipment timeline",
    successSchema: "OrderTimelineResponse",
    successStatuses: ["200"],
    errors: ["CUSTOMER_ACCESS_REQUIRED", "ORDER_NOT_FOUND"],
  },
  "post /orders/{orderId}/shipping-quote/accept": {
    summary: "Accept the latest measured shipping quote",
    successSchema: "ShippingQuoteDecisionResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "ORDER_NOT_FOUND", "SHIPPING_QUOTE_NOT_FOUND", "SHIPPING_QUOTE_NOT_ACTIONABLE", "SHIPPING_QUOTE_EXPIRED", "IDEMPOTENCY_KEY_REUSED"],
  },
  "post /orders/{orderId}/shipping-quote/reject": {
    summary: "Reject the latest measured shipping quote and place shipping on hold",
    successSchema: "ShippingQuoteDecisionResponse",
    successStatuses: ["200"],
    errors: ["AUTHENTICATION_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "ORDER_NOT_FOUND", "SHIPPING_QUOTE_NOT_FOUND", "SHIPPING_QUOTE_NOT_ACTIONABLE", "SHIPPING_QUOTE_EXPIRED", "IDEMPOTENCY_KEY_REUSED"],
  },
  "patch /admin/orders/{orderId}/purchase-review": {
    summary: "Record an administrator purchase-review decision",
    requestSchema: "PurchaseReviewRequest",
    errors: ["ADMIN_ACCESS_REQUIRED", "VALIDATION_ERROR", "ORDER_NOT_FOUND", "ORDER_NOT_READY", "SUPPLIER_RECORDS_REQUIRED", "SUPPLIER_CORRECTION_INVALID", "UNTRUSTED_ORIGIN"],
  },
  "post /admin/orders/{orderId}/shipping-quote": {
    summary: "Issue the final measured shipping quote",
    requestSchema: "AdminShippingQuoteRequest",
    errors: ["ADMIN_ACCESS_REQUIRED", "VALIDATION_ERROR", "QUOTE_EXPIRY_INVALID", "ORDER_NOT_FOUND", "ORDER_NOT_MEASURED", "OPEN_PACKAGE_EXCEPTION", "OPEN_PACKAGE_SERVICE", "PACKAGE_MEASUREMENT_REQUIRED", "ORDER_LANE_MISMATCH", "ACTIVE_SHIPPING_LANE_REQUIRED"],
  },
  "patch /admin/orders/{orderId}/status": {
    summary: "Move an order through an allowed operational stage",
    requestSchema: "AdminOrderStatusRequest",
    errors: ["ADMIN_ACCESS_REQUIRED", "VALIDATION_ERROR", "ORDER_NOT_FOUND", "PURCHASE_REVIEW_REQUIRED", "SELLER_WORKFLOW_REQUIRED", "DESTINATION_STAGE_MISMATCH", "DEDICATED_WORKFLOW_REQUIRED", "SHIPPING_PAYMENT_REQUIRED", "NEW_SHIPPING_QUOTE_REQUIRED", "INVALID_ORDER_TRANSITION", "DISPATCH_RECORDS_REQUIRED", "WAREHOUSE_RECEIPT_REQUIRED"],
  },
};

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.isFile() && entry.name === "route.ts" ? [absolute] : [];
  });
}

function openApiPath(file) {
  const segments = relative(API_ROOT, file).split(sep).slice(0, -1).map((segment) => {
    const catchAll = segment.match(/^\[\[?\.\.\.(.+?)\]?\]$/);
    if (catchAll) return `{${catchAll[1]}}`;
    const dynamic = segment.match(/^\[(.+)\]$/);
    return dynamic ? `{${dynamic[1]}}` : segment;
  });
  return `/${segments.join("/")}`;
}

function operationId(method, path) {
  const name = path.replace(/[{}]/g, "").split("/").filter(Boolean).join("_").replace(/[^A-Za-z0-9_]/g, "_");
  return `${method.toLowerCase()}_${name || "root"}`;
}

function accessFor(path, source, exact) {
  if (exact?.externalProtocol === "signed-email-webhook") return { security: [{ emailWebhookSignature: [] }], access: "external-provider-callback" };
  if (exact?.externalProtocol === "provider-ipn") return { security: [], access: "external-provider-callback" };
  if (exact?.externalProtocol === "provider-return") return { security: [], access: "external-provider-return" };
  if (exact?.externalProtocol === "browser-oauth-redirect") return { security: [], access: "browser-oauth-redirect" };
  if (source.includes("verifyMaintenanceJobSecret")) return { security: [{ schedulerBearer: [] }], access: "scheduler" };
  if (path === "/admin/setup") return { security: [], access: "one-time-bootstrap" };
  if (exact?.optionalSession || OPTIONAL_SESSION_PATHS.has(path) || OPTIONAL_SESSION_PREFIXES.some((prefix) => path.startsWith(prefix))) return { security: [{}, { cookieSession: [] }], access: "optional-session" };
  if (source.includes("getRequestSession")) return { security: [{ cookieSession: [] }], access: "authenticated" };
  return { security: [], access: "public" };
}

function parameterList(method, path, source, exact) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  if (["post", "put", "patch", "delete"].includes(method) && source.includes('headers.get("Idempotency-Key")')) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  if (exact?.parameters) parameters.push(...exact.parameters);
  return parameters;
}

function requestBody(method, path, source, exact) {
  if (!["post", "put", "patch"].includes(method)) return undefined;
  if (exact?.externalProtocol === "provider-ipn") return { required: true, content: { "application/x-www-form-urlencoded": { schema: { type: "object", required: ["tran_id", "val_id"], properties: { tran_id: { type: "string", maxLength: 30 }, val_id: { type: "string", maxLength: 100 } }, additionalProperties: true } } } };
  if (path === "/search/image") return {
    required: true,
    content: { "multipart/form-data": { schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" } } } } },
  };
  if (!source.includes("request.json(")) return undefined;
  const schema = exact?.requestSchema
    ? { $ref: `#/components/schemas/${exact.requestSchema}` }
    : path === "/auth/register"
    ? { $ref: "#/components/schemas/RegisterRequest" }
    : path === "/auth/login"
      ? { $ref: "#/components/schemas/LoginRequest" }
      : { type: "object", additionalProperties: true };
  return { required: true, content: { "application/json": { schema } } };
}

function responsesFor(method, source, exact) {
  if (exact?.externalProtocol === "provider-ipn") return {
    "200": { description: "Acknowledged, held, or safely ignored provider notification.", content: { "text/plain": { schema: { type: "string" } } } },
    "400": { $ref: "#/components/responses/ProviderPlainTextError" },
    "413": { $ref: "#/components/responses/ProviderPlainTextError" },
    "415": { $ref: "#/components/responses/ProviderPlainTextError" },
    "500": { $ref: "#/components/responses/ProviderPlainTextError" },
    "503": { $ref: "#/components/responses/ProviderPlainTextError" },
  };
  if (exact?.externalProtocol === "provider-return") return {
    "303": { description: "Redirect to the protected DeshDak orders page.", headers: { Location: { description: "Same-origin DeshDak destination.", schema: { type: "string", format: "uri" } } } },
    "500": { $ref: "#/components/responses/ProviderPlainTextError" },
  };
  if (exact?.externalProtocol === "browser-oauth-redirect") return {
    "303": { description: "Browser redirect to Google or back to the same-origin customer authentication page.", headers: { Location: { description: "OAuth provider or same-origin DeshDak destination.", schema: { type: "string", format: "uri" } } } },
    "500": { $ref: "#/components/responses/ServerError" },
  };
  const responses = {
    "400": { $ref: "#/components/responses/BadRequest" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
    "422": { $ref: "#/components/responses/Unprocessable" },
    "429": { $ref: "#/components/responses/RateLimited" },
    "500": { $ref: "#/components/responses/ServerError" },
  };
  if (exact?.unavailable) responses["503"] = { $ref: "#/components/responses/ServerError" };
  if (source.includes("svgResponse(")) responses["200"] = { $ref: "#/components/responses/SvgAsset" };
  else if (exact?.successSchema) {
    for (const status of exact.successStatuses ?? ["200"]) responses[status] = {
      description: status === "201" ? "Resource created." : "Successful response.",
      headers: { "x-request-id": { $ref: "#/components/headers/RequestId" } },
      content: { "application/json": { schema: { $ref: `#/components/schemas/${exact.successSchema}` } } },
    };
  } else {
    responses["200"] = { $ref: "#/components/responses/Success" };
    if (method === "post") responses["201"] = { $ref: "#/components/responses/Created" };
  }
  return responses;
}

export function discoverOperations() {
  return routeFiles(API_ROOT).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const path = openApiPath(file);
    return [...source.matchAll(HTTP_METHOD_PATTERN)].map((match) => ({ file, source, path, method: match[1].toLowerCase() }));
  }).sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

export function buildOpenApiDocument() {
  const paths = {};
  for (const operation of discoverOperations()) {
    const exact = EXACT_OPERATIONS[`${operation.method} ${operation.path}`];
    const access = accessFor(operation.path, operation.source, exact);
    const parameters = parameterList(operation.method, operation.path, operation.source, exact);
    const body = requestBody(operation.method, operation.path, operation.source, exact);
    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = {
      operationId: operationId(operation.method, operation.path),
      tags: [operation.path.split("/").filter(Boolean)[0] ?? "system"],
      summary: exact?.summary ?? `${operation.method.toUpperCase()} ${operation.path}`,
      security: access.security,
      "x-crossly-access": access.access,
      ...(exact?.errors ? { "x-crossly-error-codes": exact.errors } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(body ? { requestBody: body } : {}),
      responses: responsesFor(operation.method, operation.source, exact),
    };
  }

  const errorResponse = (description) => ({ description, headers: { "x-request-id": { $ref: "#/components/headers/RequestId" } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } });
  const successResponse = (description) => ({ description, headers: { "x-request-id": { $ref: "#/components/headers/RequestId" } }, content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } } });

  return {
    openapi: "3.0.3",
    info: {
      title: "DeshDak API",
      version: "1.0.0",
      description: "Versioned contract shared by the DeshDak web application and future mobile clients. External supplier identities, credentials, private costs, and internal configuration are not part of public responses.",
    },
    servers: [{ url: "/api/v1", description: "Current origin" }, { url: "http://localhost:3000/api/v1", description: "Local development" }],
    paths,
    components: {
      securitySchemes: {
        emailWebhookSignature: { type: "apiKey", in: "header", name: "svix-signature", description: "HMAC-SHA256 over svix-id, svix-timestamp and the exact raw body. Signing secret stays server-side; timestamp tolerance is five minutes." },
        cookieSession: { type: "apiKey", in: "cookie", name: "crossly_session", description: "Secure HttpOnly browser session. Production uses the __Host- prefixed cookie." },
        schedulerBearer: { type: "http", scheme: "bearer", bearerFormat: "opaque", description: "Dedicated secret for protected scheduler endpoints; never a customer access token." },
      },
      headers: {
        RequestId: { description: "Validated request correlation identifier.", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" } },
      },
      parameters: {
        IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, description: "Unique retry key for a consequential mutation.", schema: { type: "string", minLength: 16, maxLength: 255 } },
        Cursor: { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        Limit: { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        AcceptLanguage: { name: "Accept-Language", in: "header", required: false, schema: { type: "string", enum: ["en", "bn"] } },
      },
      schemas: {
        PhoneCodeRequest: { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" } }, additionalProperties: false },
        PhoneVerifiedResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["verified"], properties: { verified: { type: "boolean", enum: [true] } }, additionalProperties: false } }, additionalProperties: false },
        PhoneVerificationRequestResponse: { type: "object", required: ["data"], properties: { data: { oneOf: [{ type: "object", required: ["verified"], properties: { verified: { type: "boolean", enum: [true] } }, additionalProperties: false }, { type: "object", required: ["requested", "expiresAt", "developmentCode", "deliveryStatus"], properties: { requested: { type: "boolean", enum: [true] }, expiresAt: { type: "string", format: "date-time" }, developmentCode: { type: "string", pattern: "^[0-9]{6}$", description: "Explicit non-production testing only; never available in production." }, deliveryStatus: { type: "string", enum: ["DEVELOPMENT_ONLY"] } }, additionalProperties: false }] } }, additionalProperties: false },
        EmailReceiptWebhookRequest: { type: "object", required: ["type", "created_at", "data"], properties: { type: { type: "string", description: "Supported email delivery events are processed; other signed event types are acknowledged without action." }, created_at: { type: "string", format: "date-time" }, data: { type: "object", required: ["email_id"], properties: { email_id: { type: "string", minLength: 1, maxLength: 255 } }, additionalProperties: true } }, additionalProperties: true },
        EmailReceiptWebhookResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["received"], properties: { received: { type: "boolean", const: true } }, additionalProperties: false } }, additionalProperties: false },
        PrivatePhotoRescanRequest: { type: "object", required: ["expectedSequence", "blockedConfirmed"], properties: { expectedSequence: { type: "integer", minimum: 1, maximum: 1000000 }, blockedConfirmed: { type: "boolean", const: true } }, additionalProperties: false },
        PrivatePhotoReviewRequest: { type: "object", required: ["decision", "caseReference", "expectedSequence", "blockedConfirmed"], properties: { decision: { type: "string", enum: ["KEEP_BLOCKED", "RESCAN_REQUIRED", "REPLACEMENT_REQUIRED"] }, caseReference: { type: "string", minLength: 8, maxLength: 80, pattern: "^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$" }, expectedSequence: { type: "integer", minimum: 0, maximum: 1000000 }, blockedConfirmed: { type: "boolean", const: true } }, additionalProperties: false },
        PrivatePhotoQuarantineRequest: { type: "object", required: ["reason", "confirmed"], properties: { reason: { type: "string", enum: ["SUSPECTED_MALWARE", "PRIVACY_REVIEW", "INTEGRITY_FAILURE"] }, confirmed: { type: "boolean", const: true } }, additionalProperties: false },
        EmailSuppressionReviewRequest: { type: "object", required: ["version", "reason", "evidenceReference", "verificationConfirmed"], properties: { version: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 10, maxLength: 500 }, evidenceReference: { type: "string", minLength: 10, maxLength: 500 }, verificationConfirmed: { type: "boolean", const: true } }, additionalProperties: false },
        KamStaffRequest: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } }, additionalProperties: false },
        BusinessAccountAssignmentRequest: { type: "object", required: ["customerEmail", "kamEmail", "organizationName"], properties: { customerEmail: { type: "string", format: "email" }, kamEmail: { type: "string", format: "email" }, organizationName: { type: "string", minLength: 2, maxLength: 160 } }, additionalProperties: false },
        AccountActivityRequest: { type: "object", required: ["type", "subject", "note", "occurredAt"], properties: { type: { type: "string", enum: ["CALL", "MEETING", "EMAIL", "NOTE", "FOLLOW_UP"] }, subject: { type: "string", minLength: 2, maxLength: 160 }, note: { type: "string", minLength: 2, maxLength: 2000 }, occurredAt: { type: "string", format: "date-time" }, followUpAt: { type: "string", format: "date-time" }, sourcingRequestId: { type: "string", format: "uuid" } }, additionalProperties: false },
        AccountActivity: { type: "object", required: ["id", "activityCode", "accountId", "authorId", "type", "subject", "note", "occurredAt", "idempotencyKey", "createdAt"], properties: { id: { type: "string", format: "uuid" }, activityCode: { type: "string", pattern: "^ACT-[A-F0-9]{20}$" }, accountId: { type: "string", format: "uuid" }, authorId: { type: "string", format: "uuid" }, type: { type: "string", enum: ["CALL", "MEETING", "EMAIL", "NOTE", "FOLLOW_UP"] }, subject: { type: "string" }, note: { type: "string" }, occurredAt: { type: "string", format: "date-time" }, followUpAt: { type: "string", format: "date-time", nullable: true }, sourcingRequestId: { type: "string", format: "uuid", nullable: true }, idempotencyKey: { type: "string", format: "uuid" }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        AccountActivityResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["activity"], properties: { activity: { $ref: "#/components/schemas/AccountActivity" } }, additionalProperties: false } }, additionalProperties: false },
        SalesOpportunityCreateRequest: { type: "object", required: ["title"], properties: { title: { type: "string", minLength: 2, maxLength: 180 }, sourcingRequestId: { type: "string", format: "uuid" }, estimatedValue: { type: "number", exclusiveMinimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, expectedCloseAt: { type: "string", format: "date-time" }, note: { type: "string", maxLength: 2000 } }, additionalProperties: false },
        SalesOpportunityStageRequest: { type: "object", required: ["stage", "version"], properties: { stage: { type: "string", enum: ["DISCOVERY", "QUALIFIED", "QUOTED", "NEGOTIATION", "WON", "LOST"] }, version: { type: "integer", minimum: 1 }, note: { type: "string", maxLength: 1000 } }, additionalProperties: false },
        SalesAccountSummary: { type: "object", required: ["id", "accountCode", "organizationName", "status", "owner", "nextFollowUpAt", "followUpOverdue"], properties: { id: { type: "string", format: "uuid" }, accountCode: { type: "string", pattern: "^ACC-[A-F0-9]{20}$" }, organizationName: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "CLOSED"] }, owner: { type: "object", additionalProperties: true }, nextFollowUpAt: { type: "string", format: "date-time", nullable: true }, followUpOverdue: { type: "boolean" } }, additionalProperties: true },
        SalesAccountListResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["accounts"], properties: { accounts: { type: "array", items: { $ref: "#/components/schemas/SalesAccountSummary" } } }, additionalProperties: false } }, additionalProperties: false },
        ReelSubmissionRequest: { type: "object", required: ["productId", "mediaId", "caption"], properties: { productId: { type: "string", format: "uuid" }, mediaId: { type: "string", format: "uuid" }, caption: { type: "string", minLength: 1, maxLength: 500 } }, additionalProperties: false },
        ReelSellerUpdateRequest: { type: "object", required: ["caption", "action", "version"], properties: { caption: { type: "string", minLength: 1, maxLength: 500 }, action: { type: "string", enum: ["SAVE", "RESUBMIT", "ARCHIVE"] }, version: { type: "integer", minimum: 1 } }, additionalProperties: false },
        ReelModerationRequest: { type: "object", required: ["decision", "version"], properties: { decision: { type: "string", enum: ["PUBLISH", "REJECT", "ARCHIVE"] }, reason: { type: "string", maxLength: 500 }, version: { type: "integer", minimum: 1 } }, additionalProperties: false },
        ReelEngagementRequest: { type: "object", required: ["type", "idempotencyKey"], properties: { type: { type: "string", enum: ["VIEW", "SHARE", "PRODUCT_CLICK"] }, idempotencyKey: { type: "string", format: "uuid" }, watchTimeMs: { type: "integer", minimum: 0, maximum: 3600000 }, durationMs: { type: "integer", minimum: 1, maximum: 3600000 }, completionPercent: { type: "integer", minimum: 0, maximum: 100 } }, additionalProperties: false },
        ReelEngagementResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["recorded", "idempotentReplay"], properties: { recorded: { type: "boolean" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
        ReelReactionRequest: { type: "object", required: ["type", "active"], properties: { type: { type: "string", enum: ["LIKE", "SAVE"] }, active: { type: "boolean" } }, additionalProperties: false },
        ReelReactionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["active", "type", "counts"], properties: { active: { type: "boolean" }, type: { type: "string", enum: ["LIKE", "SAVE"] }, counts: { type: "object", required: ["likes", "saves"], properties: { likes: { type: "integer", minimum: 0 }, saves: { type: "integer", minimum: 0 } }, additionalProperties: false } }, additionalProperties: false } }, additionalProperties: false },
        ReelCommentRequest: { type: "object", required: ["body"], properties: { body: { type: "string", minLength: 2, maxLength: 500 } }, additionalProperties: false },
        ReelCommentModerationRequest: { type: "object", required: ["decision", "version"], properties: { decision: { type: "string", enum: ["PUBLISH", "REJECT", "REMOVE"] }, reason: { type: "string", maxLength: 500 }, version: { type: "integer", minimum: 1 } }, additionalProperties: false },
        ReelCommentSubmissionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["comment", "message"], properties: { comment: { type: "object", required: ["id", "status", "createdAt", "version"], properties: { id: { type: "string", format: "uuid" }, status: { type: "string", enum: ["PENDING_MODERATION"] }, createdAt: { type: "string", format: "date-time" }, version: { type: "integer", minimum: 1 } }, additionalProperties: false }, message: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
        ReelPublicComment: { type: "object", required: ["id", "body", "publishedAt", "author"], properties: { id: { type: "string", format: "uuid" }, body: { type: "string" }, publishedAt: { type: "string", format: "date-time" }, author: { type: "object", required: ["fullName"], properties: { fullName: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
        ReelCommentsResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["comments", "meta"], properties: { comments: { type: "array", items: { $ref: "#/components/schemas/ReelPublicComment" } }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false } }, additionalProperties: false },
        ReelPublicItem: { type: "object", required: ["id", "reelCode", "media", "product", "store", "engagement", "viewer"], properties: { id: { type: "string", format: "uuid" }, reelCode: { type: "string", pattern: "^REL-[A-F0-9]{20}$" }, caption: { type: "string", nullable: true }, publishedAt: { type: "string", format: "date-time" }, media: { type: "object", properties: { url: { type: "string", format: "uri", nullable: true }, mimeType: { type: "string" }, altText: { type: "string", nullable: true }, caption: { type: "string", nullable: true } }, additionalProperties: false }, product: { type: "object", additionalProperties: true }, store: { type: "object", additionalProperties: true }, engagement: { type: "object", additionalProperties: true }, viewer: { type: "object", required: ["liked", "saved"], properties: { liked: { type: "boolean" }, saved: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
        ReelsFeedResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["reels", "meta"], properties: { reels: { type: "array", items: { $ref: "#/components/schemas/ReelPublicItem" } }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false } }, additionalProperties: false },
        SuccessEnvelope: { type: "object", required: ["data"], properties: { data: {}, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        ErrorEnvelope: { type: "object", required: ["error"], properties: { error: { $ref: "#/components/schemas/Error" } }, additionalProperties: false },
        Error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", pattern: "^[A-Z0-9_]+$" }, message: { type: "string" }, details: { type: "object", additionalProperties: true } }, additionalProperties: false },
        AdminAuditActor: { type: "object", required: ["id", "personCode", "fullName", "email"], properties: { id: { type: "string", format: "uuid" }, personCode: { type: "string" }, fullName: { type: "string" }, email: { type: "string", format: "email" } }, additionalProperties: false },
        AdminAuditEvent: { type: "object", required: ["id", "action", "entityType", "createdAt"], properties: { id: { type: "string", format: "uuid" }, action: { type: "string" }, entityType: { type: "string" }, entityId: { type: "string", nullable: true }, metadata: { type: "object", additionalProperties: true, nullable: true }, actor: { allOf: [{ $ref: "#/components/schemas/AdminAuditActor" }], nullable: true }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        AdminAuditPagination: { type: "object", required: ["page", "pageSize", "total", "pages"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 10, maximum: 100 }, total: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 1 } }, additionalProperties: false },
        AdminAuditLogResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["events", "entityTypes", "pagination"], properties: { events: { type: "array", items: { $ref: "#/components/schemas/AdminAuditEvent" } }, entityTypes: { type: "array", maxItems: 200, items: { type: "string" } }, pagination: { $ref: "#/components/schemas/AdminAuditPagination" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        LaunchReadinessCategory: { type: "string", enum: ["INFRASTRUCTURE", "PAYMENTS", "IDENTITY_DELIVERY", "MEDIA", "LEGAL_COMPLIANCE", "OPERATIONS", "STAFFING", "SECURITY", "AUTOMATION", "OTHER"] },
        LaunchReadinessStatus: { type: "string", enum: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "EVIDENCE_RECORDED", "VERIFIED"] },
        LaunchReadinessActor: { type: "object", required: ["fullName", "personCode"], properties: { fullName: { type: "string" }, personCode: { type: "string" } }, additionalProperties: false },
        LaunchReadinessEvent: { type: "object", required: ["id", "itemId", "toStatus", "itemVersion", "occurredAt"], properties: { id: { type: "string", format: "uuid" }, itemId: { type: "string", format: "uuid" }, actorId: { type: "string", format: "uuid", nullable: true }, fromStatus: { allOf: [{ $ref: "#/components/schemas/LaunchReadinessStatus" }], nullable: true }, toStatus: { $ref: "#/components/schemas/LaunchReadinessStatus" }, itemVersion: { type: "integer", minimum: 1 }, ownerNameSnapshot: { type: "string", nullable: true }, dueAtSnapshot: { type: "string", format: "date-time", nullable: true }, evidenceReferenceSnapshot: { type: "string", nullable: true }, evidenceNoteSnapshot: { type: "string", nullable: true }, blockerReasonSnapshot: { type: "string", nullable: true }, actor: { allOf: [{ $ref: "#/components/schemas/LaunchReadinessActor" }], nullable: true }, occurredAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        LaunchReadinessItem: { type: "object", required: ["id", "key", "category", "title", "requirement", "status", "isRequired", "isBaseline", "version", "createdAt", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, key: { type: "string" }, category: { $ref: "#/components/schemas/LaunchReadinessCategory" }, title: { type: "string" }, requirement: { type: "string" }, status: { $ref: "#/components/schemas/LaunchReadinessStatus" }, isRequired: { type: "boolean" }, isBaseline: { type: "boolean" }, ownerName: { type: "string", nullable: true }, dueAt: { type: "string", format: "date-time", nullable: true }, evidenceReference: { type: "string", nullable: true, description: "Safe ticket, report, contract, or HTTPS evidence reference; never a credential." }, evidenceNote: { type: "string", nullable: true }, blockerReason: { type: "string", nullable: true }, version: { type: "integer", minimum: 1 }, createdById: { type: "string", format: "uuid", nullable: true }, updatedById: { type: "string", format: "uuid", nullable: true }, verifiedById: { type: "string", format: "uuid", nullable: true }, verifiedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { allOf: [{ $ref: "#/components/schemas/LaunchReadinessActor" }], nullable: true }, verifiedBy: { allOf: [{ $ref: "#/components/schemas/LaunchReadinessActor" }], nullable: true }, events: { type: "array", maxItems: 20, items: { $ref: "#/components/schemas/LaunchReadinessEvent" } }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        LaunchReadinessCreateRequest: { type: "object", required: ["category", "title", "requirement"], properties: { category: { $ref: "#/components/schemas/LaunchReadinessCategory" }, title: { type: "string", minLength: 3, maxLength: 120 }, requirement: { type: "string", minLength: 10, maxLength: 1500 }, isRequired: { type: "boolean", default: true }, ownerName: { type: "string", maxLength: 120, nullable: true }, dueAt: { type: "string", format: "date-time", nullable: true } }, additionalProperties: false },
        LaunchReadinessUpdateRequest: { type: "object", required: ["category", "title", "requirement", "status", "isRequired", "version", "verificationConfirmed"], properties: { category: { $ref: "#/components/schemas/LaunchReadinessCategory" }, title: { type: "string", minLength: 3, maxLength: 120 }, requirement: { type: "string", minLength: 10, maxLength: 1500 }, status: { $ref: "#/components/schemas/LaunchReadinessStatus" }, isRequired: { type: "boolean" }, ownerName: { type: "string", maxLength: 120, nullable: true }, dueAt: { type: "string", format: "date-time", nullable: true }, evidenceReference: { type: "string", maxLength: 500, nullable: true }, evidenceNote: { type: "string", maxLength: 2000, nullable: true }, blockerReason: { type: "string", maxLength: 1000, nullable: true }, version: { type: "integer", minimum: 1 }, verificationConfirmed: { type: "boolean" } }, additionalProperties: false },
        TechnicalReadinessSignal: { type: "object", required: ["code", "label", "status", "detail", "checkedAt"], properties: { code: { type: "string", enum: ["DATABASE", "PRODUCTION_CONFIG", "CHECKOUT_LANE", "PAYMENT_METHOD", "WAREHOUSE", "ROLE_STAFFING"] }, label: { type: "string" }, status: { type: "string", enum: ["PASS", "FAIL", "DEVELOPMENT"] }, detail: { type: "string", description: "Non-secret readiness summary. Environment values are never returned." }, checkedAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        LaunchReadinessListResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["items", "technicalSignals"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/LaunchReadinessItem" } }, technicalSignals: { type: "array", minItems: 6, maxItems: 6, items: { $ref: "#/components/schemas/TechnicalReadinessSignal" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        LaunchReadinessItemResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["item"], properties: { item: { $ref: "#/components/schemas/LaunchReadinessItem" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        NotificationPreferenceItem: { type: "object", required: ["category", "channel", "enabled", "locale", "available", "locked", "deliveryState"], properties: { category: { type: "string", enum: ["TRANSACTIONAL", "SECURITY", "MARKETING"] }, channel: { type: "string", enum: ["IN_APP", "EMAIL", "PUSH", "SMS", "WHATSAPP"] }, enabled: { type: "boolean" }, locale: { type: "string", enum: ["en", "bn"] }, available: { type: "boolean" }, locked: { type: "boolean" }, deliveryState: { type: "string", enum: ["ACTIVE", "QUEUED_UNTIL_PROVIDER", "NOT_AVAILABLE"] } }, additionalProperties: false },
        NotificationPreferenceUpdateRequest: { type: "object", required: ["category", "channel", "enabled"], properties: { category: { type: "string", enum: ["TRANSACTIONAL", "SECURITY", "MARKETING"] }, channel: { type: "string", enum: ["IN_APP", "EMAIL", "PUSH", "SMS", "WHATSAPP"] }, enabled: { type: "boolean" }, locale: { type: "string", enum: ["en", "bn"], default: "en" } }, additionalProperties: false },
        NotificationPreferencesResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["items"], properties: { items: { type: "array", minItems: 15, maxItems: 15, items: { $ref: "#/components/schemas/NotificationPreferenceItem" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        NotificationPreferenceResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["preference"], properties: { preference: { $ref: "#/components/schemas/NotificationPreferenceItem" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        MarketingCampaignAudience: { type: "object", properties: { targetUserId: { type: "string", format: "uuid" }, accountType: { type: "string", enum: ["PERSONAL", "BUSINESS"] }, locale: { type: "string", enum: ["en", "bn"] } }, additionalProperties: false },
        MarketingCampaignSendRequest: { type: "object", required: ["title", "body"], properties: { targetUserId: { type: "string", format: "uuid" }, accountType: { type: "string", enum: ["PERSONAL", "BUSINESS"] }, locale: { type: "string", enum: ["en", "bn"] }, title: { type: "string", minLength: 3, maxLength: 120 }, body: { type: "string", minLength: 10, maxLength: 1000 }, titleBn: { type: "string", minLength: 3, maxLength: 120 }, bodyBn: { type: "string", minLength: 10, maxLength: 1000 }, deepLink: { type: "string", maxLength: 500, description: "Public DeshDak product, store, help, or trust path only." }, scheduledFor: { type: "string", format: "date-time", description: "Optional delivery time from five minutes to one year in the future." } }, additionalProperties: false },
        MarketingCampaignPreview: { type: "object", required: ["matchedConsentCount", "eligibleCount", "frequencySuppressedCount", "frequencyHours", "synchronousRecipientLimit"], properties: { matchedConsentCount: { type: "integer", minimum: 0 }, eligibleCount: { type: "integer", minimum: 0 }, frequencySuppressedCount: { type: "integer", minimum: 0 }, frequencyHours: { type: "integer", minimum: 1 }, synchronousRecipientLimit: { type: "integer", minimum: 1 } }, additionalProperties: false },
        MarketingCampaignPreviewResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["preview"], properties: { preview: { $ref: "#/components/schemas/MarketingCampaignPreview" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        MarketingCampaignSummary: { type: "object", required: ["id", "campaignCode", "status", "matchedConsentCount", "frequencySuppressedCount", "recipientCount", "scheduledFor", "sentAt"], properties: { id: { type: "string", format: "uuid" }, campaignCode: { type: "string", pattern: "^MKT-[A-F0-9]{20}$" }, status: { type: "string", enum: ["SCHEDULED", "PROCESSING", "SENT", "CANCELLED", "FAILED"] }, matchedConsentCount: { type: "integer", minimum: 0 }, frequencySuppressedCount: { type: "integer", minimum: 0 }, recipientCount: { type: "integer", minimum: 0, maximum: 1000 }, scheduledFor: { type: "string", format: "date-time", nullable: true }, sentAt: { type: "string", format: "date-time", nullable: true } }, additionalProperties: false },
        MarketingCampaignSendResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["campaign", "idempotentReplay"], properties: { campaign: { $ref: "#/components/schemas/MarketingCampaignSummary" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        MarketingCampaignReportCampaign: { type: "object", required: ["id", "campaignCode", "title", "body", "status", "matchedConsentCount", "frequencySuppressedCount", "recipientCount", "scheduledFor", "sentAt", "cancelledAt", "failureCode", "createdAt", "createdBy"], properties: { id: { type: "string", format: "uuid" }, campaignCode: { type: "string" }, title: { type: "string" }, body: { type: "string" }, titleBn: { type: "string", nullable: true }, bodyBn: { type: "string", nullable: true }, deepLink: { type: "string", nullable: true }, status: { type: "string", enum: ["SCHEDULED", "PROCESSING", "SENT", "CANCELLED", "FAILED"] }, audienceAccountType: { type: "string", enum: ["PERSONAL", "BUSINESS"], nullable: true }, audienceLocale: { type: "string", enum: ["en", "bn"], nullable: true }, targetUserId: { type: "string", format: "uuid", nullable: true }, matchedConsentCount: { type: "integer", minimum: 0 }, frequencySuppressedCount: { type: "integer", minimum: 0 }, recipientCount: { type: "integer", minimum: 0 }, scheduledFor: { type: "string", format: "date-time", nullable: true }, sentAt: { type: "string", format: "date-time", nullable: true }, cancelledAt: { type: "string", format: "date-time", nullable: true }, failureCode: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" }, createdBy: { type: "object", required: ["id", "personCode", "fullName"], properties: { id: { type: "string", format: "uuid" }, personCode: { type: "string" }, fullName: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
        MarketingCampaignReportRecipient: { type: "object", required: ["id", "localeSnapshot", "accountTypeSnapshot", "consentPreferenceUpdatedAt", "createdAt", "user", "notification"], properties: { id: { type: "string", format: "uuid" }, localeSnapshot: { type: "string", enum: ["en", "bn"] }, accountTypeSnapshot: { type: "string", enum: ["PERSONAL", "BUSINESS"] }, consentPreferenceUpdatedAt: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" }, user: { type: "object", required: ["id", "personCode", "fullName", "email"], properties: { id: { type: "string", format: "uuid" }, personCode: { type: "string" }, fullName: { type: "string" }, email: { type: "string", format: "email" } }, additionalProperties: false }, notification: { type: "object", required: ["id", "readAt", "deliveries"], properties: { id: { type: "string", format: "uuid" }, readAt: { type: "string", format: "date-time", nullable: true }, deliveries: { type: "array", maxItems: 1, items: { type: "object", required: ["status", "deliveredAt", "readAt"], properties: { status: { type: "string", enum: ["QUEUED", "SENT", "DELIVERED", "FAILED", "READ"] }, deliveredAt: { type: "string", format: "date-time", nullable: true }, readAt: { type: "string", format: "date-time", nullable: true } }, additionalProperties: false } } }, additionalProperties: false } }, additionalProperties: false },
        MarketingCampaignReportResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["campaign", "recipients", "query", "metrics", "pagination"], properties: { campaign: { $ref: "#/components/schemas/MarketingCampaignReportCampaign" }, recipients: { type: "array", maxItems: 50, items: { $ref: "#/components/schemas/MarketingCampaignReportRecipient" } }, query: { type: "string", maxLength: 120 }, metrics: { type: "object", required: ["recipientCount", "readCount", "unreadCount", "readRatePercent"], properties: { recipientCount: { type: "integer", minimum: 0 }, readCount: { type: "integer", minimum: 0 }, unreadCount: { type: "integer", minimum: 0 }, readRatePercent: { type: "number", minimum: 0, maximum: 100 } }, additionalProperties: false }, pagination: { type: "object", required: ["page", "pageSize", "total", "pages"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", enum: [50] }, total: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 1 } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        MarketingCampaignCancelRequest: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["CANCEL"] } }, additionalProperties: false },
        MarketingCampaignCancelResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["campaign"], properties: { campaign: { type: "object", required: ["id", "campaignCode", "status", "scheduledFor", "cancelledAt"], properties: { id: { type: "string", format: "uuid" }, campaignCode: { type: "string" }, status: { type: "string", enum: ["CANCELLED"] }, scheduledFor: { type: "string", format: "date-time", nullable: true }, cancelledAt: { type: "string", format: "date-time" } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        MarketingCampaignRunResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["runId", "status", "skipped", "summary"], properties: { runId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] }, skipped: { type: "boolean" }, summary: { type: "object", required: ["examined", "sent", "failed", "recipients"], properties: { examined: { type: "integer", minimum: 0, maximum: 25 }, sent: { type: "integer", minimum: 0, maximum: 25 }, failed: { type: "integer", minimum: 0, maximum: 25 }, recipients: { type: "integer", minimum: 0, maximum: 25000 }, remainingMayExist: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        RegisterRequest: { type: "object", required: ["fullName", "email", "phone", "residenceCountryCode", "password"], properties: { fullName: { type: "string", minLength: 2, maxLength: 120 }, email: { type: "string", format: "email", maxLength: 254 }, phone: { type: "string", pattern: "^\\+[1-9][0-9]{7,14}$" }, residenceCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, accountType: { type: "string", enum: ["PERSONAL", "BUSINESS"], default: "PERSONAL" }, password: { type: "string", format: "password" }, humanVerificationToken: { type: "string", maxLength: 2048 } }, additionalProperties: false },
        LoginRequest: { type: "object", required: ["email", "password", "portal"], properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password", maxLength: 128 }, portal: { type: "string", enum: ["customer", "seller", "admin", "warehouse", "inspector", "logistics", "support", "compliance", "finance", "sourcing", "sales"] }, humanVerificationToken: { type: "string", maxLength: 2048 } }, additionalProperties: false },
        Address: { type: "object", required: ["fullName", "phone", "addressLine1", "city", "district"], properties: { label: { type: "string", minLength: 2, maxLength: 50, default: "Delivery address" }, fullName: { type: "string", minLength: 2, maxLength: 120 }, phone: { type: "string", minLength: 8, maxLength: 24 }, addressLine1: { type: "string", minLength: 5, maxLength: 250 }, addressLine2: { type: "string", maxLength: 250 }, city: { type: "string", minLength: 2, maxLength: 100 }, district: { type: "string", minLength: 2, maxLength: 100 }, postalCode: { type: "string", maxLength: 20 }, countryCode: { type: "string", pattern: "^[A-Z]{2}$", default: "BD" } }, additionalProperties: false },
        MarketCountryPreferenceRequest: { type: "object", required: ["countryCode"], properties: { countryCode: { type: "string", pattern: "^[A-Z]{2}$" } }, additionalProperties: false },
        MarketCountryPreferenceResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["market"], properties: { market: { type: "object", required: ["isoCode", "name"], properties: { isoCode: { type: "string", pattern: "^[A-Z]{2}$" }, name: { type: "string" } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CustomerProfile: { type: "object", required: ["id", "personCode", "fullName", "email", "residenceCountryCode", "status", "locale", "accountType", "preferredCurrency", "kycStatus"], properties: { id: { type: "string", format: "uuid" }, personCode: { type: "string" }, fullName: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: "string", nullable: true }, residenceCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, status: { type: "string" }, locale: { type: "string", enum: ["en", "bn"] }, accountType: { type: "string", enum: ["PERSONAL", "BUSINESS"] }, preferredCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, kycStatus: { type: "string" }, analyticsConsent: { type: "boolean" }, analyticsConsentAt: { type: "string", format: "date-time", nullable: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, roles: { type: "array", items: { type: "string" } } }, additionalProperties: false },
        AccountSessionSummary: { type: "object", required: ["portal", "createdAt", "lastSeenAt", "expiresAt"], properties: { portal: { type: "string" }, createdAt: { type: "string", format: "date-time" }, lastSeenAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        CustomerProfileUpdateRequest: { type: "object", required: ["fullName", "phone", "residenceCountryCode", "locale", "preferredCurrency", "accountType"], properties: { fullName: { type: "string", minLength: 2, maxLength: 120 }, phone: { type: "string", pattern: "^\\+[1-9][0-9]{7,14}$" }, residenceCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, locale: { type: "string", enum: ["en", "bn"] }, preferredCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, accountType: { type: "string", enum: ["PERSONAL", "BUSINESS"] } }, additionalProperties: false },
        CustomerProfileGetResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["user", "session"], properties: { user: { allOf: [{ $ref: "#/components/schemas/CustomerProfile" }], nullable: true }, session: { allOf: [{ $ref: "#/components/schemas/AccountSessionSummary" }], nullable: true } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CustomerProfileUpdateResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["user"], properties: { user: { $ref: "#/components/schemas/CustomerProfile" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        SavedAddress: { type: "object", required: ["id", "label", "fullName", "phone", "addressLine1", "city", "district", "countryCode", "isDefault"], properties: { id: { type: "string", format: "uuid" }, label: { type: "string" }, fullName: { type: "string" }, phone: { type: "string" }, addressLine1: { type: "string" }, addressLine2: { type: "string", nullable: true }, city: { type: "string" }, district: { type: "string" }, postalCode: { type: "string", nullable: true }, countryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isDefault: { type: "boolean" } }, additionalProperties: false },
        SavedAddressCreateRequest: { type: "object", required: ["fullName", "phone", "addressLine1", "city", "district"], properties: { label: { type: "string", minLength: 2, maxLength: 50, default: "Delivery address" }, fullName: { type: "string", minLength: 2, maxLength: 120 }, phone: { type: "string", minLength: 8, maxLength: 24 }, addressLine1: { type: "string", minLength: 5, maxLength: 250 }, addressLine2: { type: "string", maxLength: 250 }, city: { type: "string", minLength: 2, maxLength: 100 }, district: { type: "string", minLength: 2, maxLength: 100 }, postalCode: { type: "string", maxLength: 20 }, countryCode: { type: "string", pattern: "^[A-Z]{2}$", default: "BD" }, isDefault: { type: "boolean", default: false } }, additionalProperties: false },
        SavedAddressUpdateRequest: { type: "object", minProperties: 1, properties: { label: { type: "string", minLength: 2, maxLength: 50 }, fullName: { type: "string", minLength: 2, maxLength: 120 }, phone: { type: "string", minLength: 8, maxLength: 24 }, addressLine1: { type: "string", minLength: 5, maxLength: 250 }, addressLine2: { type: "string", maxLength: 250, nullable: true }, city: { type: "string", minLength: 2, maxLength: 100 }, district: { type: "string", minLength: 2, maxLength: 100 }, postalCode: { type: "string", maxLength: 20, nullable: true }, countryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isDefault: { type: "boolean" } }, additionalProperties: false },
        SavedAddressListResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["addresses"], properties: { addresses: { type: "array", items: { $ref: "#/components/schemas/SavedAddress" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        SavedAddressResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["address"], properties: { address: { $ref: "#/components/schemas/SavedAddress" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        SavedAddressDeleteResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["removedAddressId", "newDefaultAddressId"], properties: { removedAddressId: { type: "string", format: "uuid" }, newDefaultAddressId: { type: "string", format: "uuid", nullable: true } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CustomerPrivacy: { type: "object", required: ["analyticsConsent"], properties: { analyticsConsent: { type: "boolean" }, analyticsConsentAt: { type: "string", format: "date-time", nullable: true } }, additionalProperties: false },
        CustomerPrivacyUpdateRequest: { type: "object", required: ["analyticsConsent"], properties: { analyticsConsent: { type: "boolean" } }, additionalProperties: false },
        CustomerPrivacyResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["privacy"], properties: { privacy: { allOf: [{ $ref: "#/components/schemas/CustomerPrivacy" }], nullable: true } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        WishlistSaveRequest: { type: "object", required: ["productId"], properties: { productId: { type: "string", format: "uuid" } }, additionalProperties: false },
        WishlistProductVariant: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" }, priceBdt: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, priceCurrency: { type: "string", nullable: true }, inventoryQuantity: { type: "integer", minimum: 0, nullable: true }, stockStatus: { type: "string", nullable: true } }, additionalProperties: false },
        WishlistProductMedia: { type: "object", required: ["id", "kind", "isPrimary"], properties: { id: { type: "string", format: "uuid" }, kind: { type: "string", enum: ["IMAGE", "VIDEO", "DOCUMENT"] }, altText: { type: "string", nullable: true }, isPrimary: { type: "boolean" } }, additionalProperties: false },
        WishlistProduct: { type: "object", required: ["id", "productCode", "titleEn", "originCountryCode", "isInternationallyAvailable", "media", "variants"], properties: { id: { type: "string", format: "uuid" }, productCode: { type: "string" }, titleEn: { type: "string" }, titleBn: { type: "string", nullable: true }, shortDescription: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isInternationallyAvailable: { type: "boolean" }, category: { type: "object", nullable: true, required: ["slug", "nameEn"], properties: { slug: { type: "string" }, nameEn: { type: "string" } }, additionalProperties: false }, sellerProfile: { type: "object", nullable: true, required: ["businessName"], properties: { businessName: { type: "string" }, storeSlug: { type: "string", nullable: true } }, additionalProperties: false }, media: { type: "array", maxItems: 1, items: { $ref: "#/components/schemas/WishlistProductMedia" } }, variants: { type: "array", maxItems: 1, items: { $ref: "#/components/schemas/WishlistProductVariant" } } }, additionalProperties: false },
        WishlistItem: { type: "object", required: ["id", "createdAt", "product"], properties: { id: { type: "string", format: "uuid" }, createdAt: { type: "string", format: "date-time" }, product: { $ref: "#/components/schemas/WishlistProduct" } }, additionalProperties: false },
        WishlistMeta: { type: "object", required: ["page", "pageSize", "total", "hasNextPage"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 48 }, total: { type: "integer", minimum: 0 }, hasNextPage: { type: "boolean" } }, additionalProperties: false },
        WishlistResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["items", "meta"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/WishlistItem" } }, meta: { $ref: "#/components/schemas/WishlistMeta" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        WishlistSavedItem: { type: "object", required: ["id", "productId", "createdAt"], properties: { id: { type: "string", format: "uuid" }, productId: { type: "string", format: "uuid" }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        WishlistSaveResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["item", "idempotentReplay"], properties: { item: { $ref: "#/components/schemas/WishlistSavedItem" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        WishlistRemoveResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["productId", "removed"], properties: { productId: { type: "string", format: "uuid" }, removed: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        OrderType: { type: "string", enum: ["BUY_AND_SHIP", "SHIP_FOR_ME", "LOCAL_SELLER", "EXPORT_MARKETPLACE"] },
        OrderStatus: { type: "string", enum: ["DRAFT", "PENDING_PAYMENT", "PAID", "PENDING_PURCHASE_REVIEW", "PENDING_EXPORT_REVIEW", "SELLER_PREPARING", "READY_FOR_COLLECTION", "SOURCING", "PURCHASED", "SUPPLIER_SHIPPED", "WAREHOUSE_RECEIVED", "INSPECTION", "MEASURED", "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", "SHIPPING_QUOTE_READY", "SHIPPING_PAYMENT_PENDING", "READY_TO_SHIP", "IN_TRANSIT", "CUSTOMS", "BD_WAREHOUSE", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED", "ON_HOLD"] },
        Money: { type: "string", pattern: "^-?[0-9]+(?:\\.[0-9]{1,2})?$", example: "1250.00" },
        OrderCheckoutRequest: { type: "object", required: ["cartId", "address"], properties: { cartId: { type: "string", format: "uuid" }, address: { $ref: "#/components/schemas/Address" }, shippingLaneId: { type: "string", format: "uuid" }, saveAddress: { type: "boolean", default: true }, couponCode: { type: "string", minLength: 3, maxLength: 40, pattern: "^[A-Za-z0-9_-]+$" } }, additionalProperties: false },
        OrderCheckoutSummary: { type: "object", required: ["id", "orderNumber", "type", "status", "grandTotal", "currency"], properties: { id: { type: "string", format: "uuid" }, orderNumber: { type: "string" }, type: { $ref: "#/components/schemas/OrderType" }, status: { $ref: "#/components/schemas/OrderStatus" }, grandTotal: { $ref: "#/components/schemas/Money" }, currency: { type: "string", pattern: "^[A-Z]{3}$" } }, additionalProperties: false },
        OrderCheckoutResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["order", "idempotentReplay", "nextAction"], properties: { order: { $ref: "#/components/schemas/OrderCheckoutSummary" }, idempotentReplay: { type: "boolean" }, nextAction: { type: "string", enum: ["PAYMENT_REQUIRED"] } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        OrderTimelineEvent: { type: "object", required: ["toStatus", "createdAt"], properties: { toStatus: { $ref: "#/components/schemas/OrderStatus" }, note: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        ShipmentEvent: { type: "object", required: ["status", "occurredAt"], properties: { status: { type: "string" }, location: { type: "string", nullable: true }, description: { type: "string", nullable: true }, occurredAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        TimelineShipment: { type: "object", required: ["trackingNumber", "status", "events"], properties: { trackingNumber: { type: "string" }, status: { type: "string" }, events: { type: "array", items: { $ref: "#/components/schemas/ShipmentEvent" } } }, additionalProperties: false },
        TimelinePackage: { type: "object", required: ["packageCode", "status", "shipmentPackages"], properties: { packageCode: { type: "string" }, status: { type: "string" }, shipmentPackages: { type: "array", items: { type: "object", required: ["shipment"], properties: { shipment: { $ref: "#/components/schemas/TimelineShipment" } }, additionalProperties: false } } }, additionalProperties: false },
        OrderTimelineResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["order"], properties: { order: { type: "object", required: ["id", "orderNumber", "status", "statusHistory", "packages"], properties: { id: { type: "string", format: "uuid" }, orderNumber: { type: "string" }, status: { $ref: "#/components/schemas/OrderStatus" }, statusHistory: { type: "array", items: { $ref: "#/components/schemas/OrderTimelineEvent" } }, packages: { type: "array", items: { $ref: "#/components/schemas/TimelinePackage" } } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        ShippingQuoteStatus: { type: "string", enum: ["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "PAID", "CANCELLED"] },
        ShippingQuote: { type: "object", required: ["id", "orderId", "version", "shippingLaneId", "chargeableWeightGrams", "discrepancyThresholdPercent", "ratePerKgBdt", "shippingAmountBdt", "handlingFeeBdt", "insuranceFeeBdt", "totalBdt", "status", "expiresAt", "createdAt", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, orderId: { type: "string", format: "uuid" }, version: { type: "integer", minimum: 1 }, shippingLaneId: { type: "string", format: "uuid" }, chargeableWeightGrams: { type: "integer", minimum: 1 }, declaredWeightGrams: { type: "integer", nullable: true }, discrepancyPercent: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, discrepancyThresholdPercent: { $ref: "#/components/schemas/Money" }, ratePerKgBdt: { $ref: "#/components/schemas/Money" }, shippingAmountBdt: { $ref: "#/components/schemas/Money" }, handlingFeeBdt: { $ref: "#/components/schemas/Money" }, insuranceFeeBdt: { $ref: "#/components/schemas/Money" }, totalBdt: { $ref: "#/components/schemas/Money" }, status: { $ref: "#/components/schemas/ShippingQuoteStatus" }, note: { type: "string", nullable: true }, expiresAt: { type: "string", format: "date-time" }, acceptedAt: { type: "string", format: "date-time", nullable: true }, rejectedAt: { type: "string", format: "date-time", nullable: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        ShippingQuoteDecisionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["quote"], properties: { quote: { $ref: "#/components/schemas/ShippingQuote" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        SupplierDispatchRequest: { type: "object", required: ["carrierName", "trackingNumber"], properties: { carrierName: { type: "string", minLength: 2, maxLength: 80 }, trackingNumber: { type: "string", minLength: 4, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9-]{3,79}$" } }, additionalProperties: false },
        SupplierDispatchResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["dispatch", "replayed"], properties: { dispatch: { type: "object", required: ["id", "supplierRecordId", "carrierName", "trackingNumber", "createdAt", "package"], properties: { id: { type: "string", format: "uuid" }, supplierRecordId: { type: "string", format: "uuid" }, carrierName: { type: "string" }, trackingNumber: { type: "string" }, createdAt: { type: "string", format: "date-time" }, package: { type: "object", required: ["id", "packageCode", "status", "warehouseId"], properties: { id: { type: "string", format: "uuid" }, packageCode: { type: "string" }, status: { type: "string" }, warehouseId: { type: "string", format: "uuid", nullable: true } }, additionalProperties: false } }, additionalProperties: false }, replayed: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
        WarehouseReceiptRequest: { type: "object", required: ["orderNumber", "warehouseId"], properties: { orderNumber: { type: "string", minLength: 4, maxLength: 80 }, warehouseId: { type: "string", format: "uuid" }, inboundTracking: { type: "string", maxLength: 120 }, packageCode: { type: "string", pattern: "^PKG-[A-F0-9]{12}$" } }, additionalProperties: false },
        WarehouseReceiptResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["package", "idempotentReplay"], properties: { package: { type: "object", required: ["id", "packageCode", "status"], properties: { id: { type: "string", format: "uuid" }, packageCode: { type: "string" }, status: { type: "string" }, warehouseId: { type: "string", format: "uuid", nullable: true }, inboundTracking: { type: "string", nullable: true } }, additionalProperties: true }, idempotentReplay: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
        SupplierRecordReplacementRequest: { type: "object", required: ["supplierName", "supplierOrderReference", "variantDescription", "reason", "holdHistoryId"], properties: { supplierName: { type: "string", minLength: 1, maxLength: 120 }, supplierOrderReference: { type: "string", minLength: 1, maxLength: 120 }, variantDescription: { type: "string", minLength: 1, maxLength: 300 }, reason: { type: "string", minLength: 3, maxLength: 120 }, holdHistoryId: { type: "string", format: "uuid" } }, additionalProperties: false },
        PackageInspectionRequest: { type: "object", required: ["type", "result"], properties: { type: { type: "string", enum: ["BASIC", "PHOTO", "VIDEO"] }, result: { type: "string", enum: ["PASSED", "FAILED", "ATTENTION_REQUIRED"] }, notes: { type: "string", maxLength: 2000, description: "Required for failed or attention-required decisions." }, mediaReference: { type: "string", maxLength: 500, description: "Private evidence reference for this package; required and type-matched for PHOTO/VIDEO." } }, additionalProperties: false },
        PackageInspectionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["inspection", "idempotentReplay"], properties: { idempotentReplay: { type: "boolean" }, inspection: { type: "object", required: ["id", "packageId", "inspectorId", "type", "result", "notes", "mediaRefs", "createdAt"], properties: { id: { type: "string", format: "uuid" }, packageId: { type: "string", format: "uuid" }, inspectorId: { type: "string", format: "uuid" }, type: { type: "string" }, result: { type: "string" }, notes: { type: "string", nullable: true }, mediaRefs: { type: "array", nullable: true, items: { type: "string" } }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false } }, additionalProperties: false } }, additionalProperties: false },
        SupplierOrderRecordRequest: { type: "object", required: ["supplierName", "supplierOrderReference", "variantDescription", "quantity", "originWarehouseId"], properties: { orderItemId: { type: "string", format: "uuid", nullable: true }, supplierName: { type: "string", minLength: 1, maxLength: 120 }, supplierOrderReference: { type: "string", minLength: 1, maxLength: 120 }, variantDescription: { type: "string", minLength: 1, maxLength: 300 }, quantity: { type: "integer", minimum: 1, maximum: 1000000 }, originWarehouseId: { type: "string", format: "uuid" }, internalNote: { type: "string", maxLength: 500 } }, additionalProperties: false },
        SupplierOrderRecord: { type: "object", required: ["id", "orderId", "orderItemId", "supplierName", "supplierOrderReference", "variantDescription", "quantity", "originWarehouseId", "originCountryCode", "internalNote", "createdAt"], properties: { inboundDispatch: { type: "object", nullable: true, required: ["carrierName", "trackingNumber", "package"], properties: { carrierName: { type: "string" }, trackingNumber: { type: "string" }, package: { type: "object", required: ["packageCode", "status"], properties: { packageCode: { type: "string" }, status: { type: "string" } }, additionalProperties: false } }, additionalProperties: false }, correction: { type: "object", nullable: true, required: ["replacementRecordId"], properties: { replacementRecordId: { type: "string", format: "uuid" } }, additionalProperties: false }, id: { type: "string", format: "uuid" }, orderId: { type: "string", format: "uuid" }, orderItemId: { type: "string", format: "uuid", nullable: true }, supplierName: { type: "string" }, supplierOrderReference: { type: "string" }, variantDescription: { type: "string" }, quantity: { type: "integer", minimum: 1 }, originWarehouseId: { type: "string", format: "uuid" }, originCountryCode: { type: "string" }, internalNote: { type: "string" }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        SupplierOrderRecordResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["record", "replayed"], properties: { record: { $ref: "#/components/schemas/SupplierOrderRecord" }, replayed: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
        SupplierOrderRecordListResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["records"], properties: { pagination: { type: "object", required: ["page", "pageSize", "total", "pages"], properties: { page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", enum: [100] }, total: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 1 } }, additionalProperties: false }, records: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/SupplierOrderRecord" } } }, additionalProperties: false } }, additionalProperties: false },
        PurchaseReviewRequest: { type: "object", required: ["action", "note"], properties: { action: { type: "string", enum: ["APPROVE_FOR_PURCHASE", "MARK_PURCHASED", "PLACE_ON_HOLD"] }, note: { type: "string", minLength: 3, maxLength: 500 }, supplierRecordId: { type: "string", format: "uuid", description: "Private record being reported; valid only for PLACE_ON_HOLD from SOURCING." } }, additionalProperties: false },
        AdminShippingQuoteRequest: { type: "object", required: ["shippingLaneId", "ratePerKgBdt", "expiresAt"], properties: { shippingLaneId: { type: "string", format: "uuid" }, ratePerKgBdt: { type: "number", exclusiveMinimum: true, minimum: 0, maximum: 1000000 }, handlingFeeBdt: { type: "number", minimum: 0, maximum: 10000000, default: 0 }, insuranceFeeBdt: { type: "number", minimum: 0, maximum: 10000000, default: 0 }, expiresAt: { type: "string", format: "date-time" }, note: { type: "string", maxLength: 1000 } }, additionalProperties: false },
        AdminOrderStatusRequest: { type: "object", required: ["status", "note"], properties: { status: { $ref: "#/components/schemas/OrderStatus" }, note: { type: "string", minLength: 3, maxLength: 500 } }, additionalProperties: false },
        CatalogPageMeta: { type: "object", required: ["page", "pageSize", "total", "hasNextPage"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 }, total: { type: "integer", minimum: 0 }, hasNextPage: { type: "boolean" } }, additionalProperties: false },
        CatalogCategory: { type: "object", required: ["id", "slug", "nameEn"], properties: { id: { type: "string", format: "uuid" }, slug: { type: "string" }, nameEn: { type: "string" }, nameBn: { type: "string", nullable: true } }, additionalProperties: false },
        CatalogCategoryRecord: { type: "object", required: ["id", "slug", "nameEn", "sortOrder", "showOnHomepage", "productCount"], properties: { id: { type: "string", format: "uuid" }, slug: { type: "string" }, nameEn: { type: "string" }, nameBn: { type: "string", nullable: true }, description: { type: "string", nullable: true }, icon: { type: "string", nullable: true }, sortOrder: { type: "integer" }, parentId: { type: "string", format: "uuid", nullable: true }, showOnHomepage: { type: "boolean" }, productCount: { type: "integer", minimum: 0 } }, additionalProperties: false },
        CatalogCategoriesResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["categories"], properties: { categories: { type: "array", items: { $ref: "#/components/schemas/CatalogCategoryRecord" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CatalogDestination: { type: "object", required: ["shippingLaneId", "serviceName", "country"], properties: { shippingLaneId: { type: "string", format: "uuid" }, serviceName: { type: "string" }, transitDaysMin: { type: "integer", minimum: 0, nullable: true }, transitDaysMax: { type: "integer", minimum: 0, nullable: true }, country: { type: "object", required: ["isoCode", "name", "defaultCurrency", "defaultLocale"], properties: { isoCode: { type: "string", pattern: "^[A-Z]{2}$" }, name: { type: "string" }, defaultCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, defaultLocale: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
        CatalogDestinationsResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["originCountryCode", "destinations"], properties: { originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, destinations: { type: "array", items: { $ref: "#/components/schemas/CatalogDestination" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CatalogSeller: { type: "object", required: ["businessName"], properties: { businessName: { type: "string" }, storeSlug: { type: "string", nullable: true } }, additionalProperties: false },
        CatalogVariantSummary: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" }, priceBdt: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, priceCurrency: { type: "string", nullable: true }, inventoryQuantity: { type: "integer", minimum: 0, nullable: true }, stockStatus: { type: "string", nullable: true }, weightGrams: { type: "integer", minimum: 0, nullable: true } }, additionalProperties: false },
        CatalogProductListItem: { type: "object", required: ["id", "productCode", "titleEn", "originCountryCode", "isInternationallyAvailable", "category", "sellerProfile", "variants"], properties: { id: { type: "string", format: "uuid" }, productCode: { type: "string" }, titleEn: { type: "string" }, titleBn: { type: "string", nullable: true }, description: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isInternationallyAvailable: { type: "boolean" }, category: { allOf: [{ $ref: "#/components/schemas/CatalogCategory" }], nullable: true }, sellerProfile: { allOf: [{ $ref: "#/components/schemas/CatalogSeller" }], nullable: true }, variants: { type: "array", items: { $ref: "#/components/schemas/CatalogVariantSummary" } } }, additionalProperties: false },
        CatalogProductsResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["products", "meta"], properties: { products: { type: "array", items: { $ref: "#/components/schemas/CatalogProductListItem" } }, meta: { $ref: "#/components/schemas/CatalogPageMeta" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CatalogProductMedia: { type: "object", required: ["id", "kind", "sortOrder", "isPrimary"], properties: { id: { type: "string", format: "uuid" }, kind: { type: "string", enum: ["IMAGE", "VIDEO", "DOCUMENT"] }, altText: { type: "string", nullable: true }, caption: { type: "string", nullable: true }, sortOrder: { type: "integer" }, isPrimary: { type: "boolean" } }, additionalProperties: false },
        CatalogVariantDetail: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" }, sku: { type: "string", nullable: true }, attributes: { type: "object", additionalProperties: true, nullable: true }, priceBdt: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, priceCurrency: { type: "string", nullable: true }, inventoryQuantity: { type: "integer", minimum: 0, nullable: true }, stockStatus: { type: "string", nullable: true }, weightGrams: { type: "integer", minimum: 0, nullable: true }, lengthMm: { type: "integer", minimum: 0, nullable: true }, widthMm: { type: "integer", minimum: 0, nullable: true }, heightMm: { type: "integer", minimum: 0, nullable: true } }, additionalProperties: false },
        CatalogProductDetail: {
          type: "object",
          required: ["id", "productCode", "titleEn", "originCountryCode", "isInternationallyAvailable", "minimumOrderQuantity", "sampleAvailable", "customizationAvailable", "completenessScore", "category", "sellerProfile", "media", "variants"],
          properties: {
            id: { type: "string", format: "uuid" }, productCode: { type: "string" }, titleEn: { type: "string" }, titleBn: { type: "string", nullable: true }, shortDescription: { type: "string", nullable: true }, description: { type: "string", nullable: true }, highlights: { type: "array", items: { type: "string" } }, brand: { type: "string", nullable: true }, modelNumber: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isInternationallyAvailable: { type: "boolean" }, minimumOrderQuantity: { type: "integer", minimum: 1 }, sampleAvailable: { type: "boolean" }, customizationAvailable: { type: "boolean" }, productionLeadDaysMin: { type: "integer", minimum: 0, nullable: true }, productionLeadDaysMax: { type: "integer", minimum: 0, nullable: true }, sellingUnit: { type: "string", nullable: true }, packageContents: { type: "string", nullable: true }, returnPolicy: { type: "string", nullable: true }, warrantyInfo: { type: "string", nullable: true }, completenessScore: { type: "integer", minimum: 0, maximum: 100 }, category: { allOf: [{ $ref: "#/components/schemas/CatalogCategory" }], nullable: true }, sellerProfile: { type: "object", nullable: true, properties: { businessName: { type: "string" }, storeSlug: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, shipsInternationally: { type: "boolean" }, processingDays: { type: "integer", minimum: 0 } }, additionalProperties: false }, media: { type: "array", items: { $ref: "#/components/schemas/CatalogProductMedia" } }, variants: { type: "array", items: { $ref: "#/components/schemas/CatalogVariantDetail" } },
          },
          additionalProperties: false,
        },
        CatalogProductDetailResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["product"], properties: { product: { $ref: "#/components/schemas/CatalogProductDetail" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CatalogStoreListItem: { type: "object", required: ["id", "storeCode", "businessName", "storeSlug", "originCountryCode", "shipsInternationally", "processingDays", "productCount"], properties: { id: { type: "string", format: "uuid" }, storeCode: { type: "string" }, businessName: { type: "string" }, storeSlug: { type: "string" }, storeDescription: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, shipsInternationally: { type: "boolean" }, processingDays: { type: "integer", minimum: 0 }, productCount: { type: "integer", minimum: 0 } }, additionalProperties: false },
        CatalogStoresResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["stores", "meta"], properties: { stores: { type: "array", items: { $ref: "#/components/schemas/CatalogStoreListItem" } }, meta: { $ref: "#/components/schemas/CatalogPageMeta" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CatalogStoreProduct: { type: "object", required: ["id", "productCode", "titleEn", "originCountryCode", "category", "variants"], properties: { id: { type: "string", format: "uuid" }, productCode: { type: "string" }, titleEn: { type: "string" }, titleBn: { type: "string", nullable: true }, description: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, category: { allOf: [{ $ref: "#/components/schemas/CatalogCategory" }], nullable: true }, variants: { type: "array", items: { $ref: "#/components/schemas/CatalogVariantSummary" } } }, additionalProperties: false },
        CatalogStoreDetailResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["store"], properties: { store: { type: "object", required: ["id", "storeCode", "businessName", "storeSlug", "originCountryCode", "processingDays", "products"], properties: { id: { type: "string", format: "uuid" }, storeCode: { type: "string" }, businessName: { type: "string" }, storeSlug: { type: "string" }, storeDescription: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, processingDays: { type: "integer", minimum: 0 }, products: { type: "array", items: { $ref: "#/components/schemas/CatalogStoreProduct" } } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PublicProductReview: { type: "object", required: ["id", "rating", "body", "verifiedPurchase", "publishedAt", "reviewerName"], properties: { id: { type: "string", format: "uuid" }, rating: { type: "integer", minimum: 1, maximum: 5 }, title: { type: "string", nullable: true }, body: { type: "string" }, verifiedPurchase: { type: "boolean" }, publishedAt: { type: "string", format: "date-time", nullable: true }, reviewerName: { type: "string" } }, additionalProperties: false },
        ProductReviewsResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["reviews", "summary", "pagination"], properties: { reviews: { type: "array", items: { $ref: "#/components/schemas/PublicProductReview" } }, summary: { type: "object", required: ["count", "averageRating"], properties: { count: { type: "integer", minimum: 0 }, averageRating: { type: "number", minimum: 1, maximum: 5, nullable: true } }, additionalProperties: false }, pagination: { type: "object", required: ["page", "pageSize", "total", "pages"], properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 50 }, total: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 1 } }, additionalProperties: false } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        ProductReviewSubmissionRequest: { type: "object", required: ["orderItemId", "rating", "body"], properties: { orderItemId: { type: "string", format: "uuid" }, rating: { type: "integer", minimum: 1, maximum: 5 }, title: { type: "string", minLength: 3, maxLength: 120 }, body: { type: "string", minLength: 10, maxLength: 2000 } }, additionalProperties: false },
        SubmittedProductReview: { type: "object", required: ["id", "rating", "body", "status", "verifiedPurchase", "createdAt", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, rating: { type: "integer", minimum: 1, maximum: 5 }, title: { type: "string", nullable: true }, body: { type: "string" }, status: { type: "string", enum: ["PENDING_MODERATION", "PUBLISHED", "REJECTED", "REMOVED"] }, verifiedPurchase: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        ProductReviewSubmissionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["review", "idempotentReplay"], properties: { review: { $ref: "#/components/schemas/SubmittedProductReview" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CartItemSaveRequest: { type: "object", required: ["productVariantId", "quantity"], properties: { productVariantId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 99 } }, additionalProperties: false },
        CartItemQuantityRequest: { type: "object", required: ["quantity"], properties: { quantity: { type: "integer", minimum: 1, maximum: 99 } }, additionalProperties: false },
        CartVariant: { type: "object", required: ["id", "sku", "attributes", "priceBdt", "stockStatus"], properties: { id: { type: "string", format: "uuid" }, sku: { type: "string", nullable: true }, attributes: { type: "object", additionalProperties: true, nullable: true }, priceBdt: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, stockStatus: { type: "string", nullable: true } }, additionalProperties: false },
        CartProduct: { type: "object", required: ["id", "titleEn", "titleBn", "categoryName", "sellerName", "sellerProfileId", "sellerStatus", "originCountryCode", "isInternationallyAvailable", "sellerShipsInternationally"], properties: { id: { type: "string", format: "uuid" }, titleEn: { type: "string" }, titleBn: { type: "string", nullable: true }, categoryName: { type: "string", nullable: true }, sellerName: { type: "string", nullable: true }, sellerProfileId: { type: "string", format: "uuid", nullable: true }, sellerStatus: { type: "string", nullable: true }, originCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, isInternationallyAvailable: { type: "boolean" }, sellerShipsInternationally: { type: "boolean" } }, additionalProperties: false },
        CartItem: { type: "object", required: ["id", "quantity", "isAvailable", "quoteRequired", "lineTotal", "variant", "product"], properties: { id: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 99 }, isAvailable: { type: "boolean" }, quoteRequired: { type: "boolean" }, lineTotal: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, variant: { $ref: "#/components/schemas/CartVariant" }, product: { $ref: "#/components/schemas/CartProduct" } }, additionalProperties: false },
        CartSummary: { type: "object", required: ["id", "currency", "itemCount", "subtotal", "hasUnavailableItems", "hasQuoteRequiredItems", "fulfillmentKind", "items"], properties: { id: { type: "string", format: "uuid", nullable: true }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, itemCount: { type: "integer", minimum: 0 }, subtotal: { $ref: "#/components/schemas/Money" }, hasUnavailableItems: { type: "boolean" }, hasQuoteRequiredItems: { type: "boolean" }, fulfillmentKind: { type: "string", enum: ["EMPTY", "SOURCED_IMPORT", "SELLER_MARKETPLACE", "MIXED"] }, items: { type: "array", items: { $ref: "#/components/schemas/CartItem" } } }, additionalProperties: false },
        CartResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["cart"], properties: { cart: { $ref: "#/components/schemas/CartSummary" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        CartItemSaveResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["itemId", "cart"], properties: { itemId: { type: "string", format: "uuid" }, cart: { $ref: "#/components/schemas/CartSummary" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentStatus: { type: "string", enum: ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"] },
        PaymentCheckoutRequest: { oneOf: [{ type: "object", required: ["orderId", "provider"], properties: { orderId: { type: "string", format: "uuid" }, provider: { type: "string", minLength: 2, maxLength: 40, pattern: "^[A-Za-z][A-Za-z0-9_]*$" } }, additionalProperties: false }, { type: "object", required: ["quoteId", "provider"], properties: { quoteId: { type: "string", format: "uuid" }, provider: { type: "string", minLength: 2, maxLength: 40, pattern: "^[A-Za-z][A-Za-z0-9_]*$" } }, additionalProperties: false }] },
        WalletPaymentRequest: { oneOf: [{ type: "object", required: ["orderId"], properties: { orderId: { type: "string", format: "uuid" } }, additionalProperties: false }, { type: "object", required: ["quoteId"], properties: { quoteId: { type: "string", format: "uuid" } }, additionalProperties: false }] },
        ShippingWalletPaymentRequest: { type: "object", required: ["orderId"], properties: { orderId: { type: "string", format: "uuid" } }, additionalProperties: false },
        PaymentIntentSummary: { type: "object", required: ["id", "reference", "amount", "currency", "status", "provider"], properties: { id: { type: "string", format: "uuid" }, reference: { type: "string" }, amount: { $ref: "#/components/schemas/Money" }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, status: { $ref: "#/components/schemas/PaymentStatus" }, provider: { type: "string" } }, additionalProperties: false },
        PaymentIntentResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["paymentIntent", "idempotentReplay", "nextAction", "redirectUrl"], properties: { paymentIntent: { $ref: "#/components/schemas/PaymentIntentSummary" }, idempotentReplay: { type: "boolean" }, nextAction: { type: "string", enum: ["REDIRECT"] }, redirectUrl: { type: "string", format: "uri", pattern: "^https://(sandbox|securepay)\\.sslcommerz\\.com/" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentRiskDecisionRequest: { type: "object", required: ["decision", "reason"], properties: { decision: { type: "string", enum: ["APPROVED", "REJECTED"] }, reason: { type: "string", minLength: 10, maxLength: 1000 } }, additionalProperties: false },
        PaymentRiskDecisionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["decision", "paymentStatus", "idempotentReplay"], properties: { decision: { type: "object", required: ["id", "paymentIntentId", "decision", "reason", "reviewedAt"], properties: { id: { type: "string", format: "uuid" }, paymentIntentId: { type: "string", format: "uuid" }, decision: { type: "string", enum: ["APPROVED", "REJECTED"] }, reason: { type: "string" }, reviewedAt: { type: "string", format: "date-time" } }, additionalProperties: false }, paymentStatus: { $ref: "#/components/schemas/PaymentStatus" }, orderId: { type: "string", format: "uuid", nullable: true }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentSettlementRowRequest: { type: "object", required: ["externalTransactionId", "grossAmount", "netAmount", "currency", "settledAt"], properties: { externalTransactionId: { type: "string", minLength: 3, maxLength: 100 }, bankTransactionId: { type: "string", maxLength: 100 }, grossAmount: { type: "number", minimum: 0, maximum: 100000000 }, gatewayFee: { type: "number", minimum: 0, maximum: 100000000, default: 0 }, netAmount: { type: "number", minimum: 0, maximum: 100000000 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, settledAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        PaymentSettlementImportRequest: { type: "object", required: ["provider", "externalBatchReference", "settlementDate", "currency", "entries"], properties: { provider: { type: "string", enum: ["SSLCOMMERZ"] }, externalBatchReference: { type: "string", minLength: 3, maxLength: 100 }, settlementDate: { type: "string", format: "date" }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, entries: { type: "array", minItems: 1, maxItems: 1000, items: { $ref: "#/components/schemas/PaymentSettlementRowRequest" } } }, additionalProperties: false },
        PaymentSettlementResolutionDecision: { type: "object", required: ["id", "decision", "reason", "reviewedAt"], properties: { id: { type: "string", format: "uuid" }, decision: { type: "string", enum: ["APPROVED", "REJECTED"] }, reason: { type: "string" }, reviewedAt: { type: "string", format: "date-time" }, reviewedBy: { type: "object", required: ["fullName"], properties: { fullName: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
        PaymentSettlementResolutionProposal: { type: "object", required: ["id", "settlementEntryId", "resolutionType", "reason", "evidenceReference", "correctedPaymentReference", "proposedAt"], properties: { id: { type: "string", format: "uuid" }, settlementEntryId: { type: "string", format: "uuid" }, resolutionType: { type: "string", enum: ["CONFIRMED_DUPLICATE", "PROVIDER_REPORT_ERROR", "PAYMENT_REFERENCE_CORRECTED", "CHARGEBACK_CONFIRMED", "MANUAL_EVIDENCE_ACCEPTED"] }, reason: { type: "string" }, evidenceReference: { type: "string" }, correctedPaymentReference: { type: "string", nullable: true }, proposedAt: { type: "string", format: "date-time" }, proposedBy: { type: "object", required: ["fullName"], properties: { fullName: { type: "string" } }, additionalProperties: false }, decision: { allOf: [{ $ref: "#/components/schemas/PaymentSettlementResolutionDecision" }], nullable: true } }, additionalProperties: false },
        PaymentSettlementEntry: { type: "object", required: ["id", "rowNumber", "externalTransactionId", "bankTransactionId", "grossAmount", "gatewayFee", "netAmount", "currency", "settledAt", "matchStatus", "exceptionReason"], properties: { id: { type: "string", format: "uuid" }, rowNumber: { type: "integer", minimum: 1 }, externalTransactionId: { type: "string" }, bankTransactionId: { type: "string", nullable: true }, grossAmount: { $ref: "#/components/schemas/Money" }, gatewayFee: { $ref: "#/components/schemas/Money" }, netAmount: { $ref: "#/components/schemas/Money" }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, settledAt: { type: "string", format: "date-time" }, matchStatus: { type: "string", enum: ["MATCHED", "PAYMENT_NOT_FOUND", "PAYMENT_NOT_SUCCEEDED", "AMOUNT_MISMATCH", "CURRENCY_MISMATCH", "DUPLICATE_TRANSACTION", "REVIEW_REQUIRED"] }, exceptionReason: { type: "string", nullable: true }, resolutionProposals: { type: "array", items: { $ref: "#/components/schemas/PaymentSettlementResolutionProposal" } } }, additionalProperties: false },
        PaymentSettlementBatch: { type: "object", required: ["id", "reference", "provider", "externalBatchReference", "settlementDate", "currency", "status", "rowCount", "matchedCount", "exceptionCount", "importedAt", "entries"], properties: { id: { type: "string", format: "uuid" }, reference: { type: "string" }, provider: { type: "string" }, externalBatchReference: { type: "string" }, settlementDate: { type: "string", format: "date-time" }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, status: { type: "string", enum: ["RECONCILED", "EXCEPTIONS"] }, rowCount: { type: "integer", minimum: 1 }, matchedCount: { type: "integer", minimum: 0 }, exceptionCount: { type: "integer", minimum: 0 }, importedAt: { type: "string", format: "date-time" }, importedBy: { type: "object", required: ["fullName"], properties: { fullName: { type: "string" } }, additionalProperties: false }, entries: { type: "array", items: { $ref: "#/components/schemas/PaymentSettlementEntry" } } }, additionalProperties: false },
        PaymentSettlementListResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["batches"], properties: { batches: { type: "array", items: { $ref: "#/components/schemas/PaymentSettlementBatch" } } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentSettlementImportResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["batch", "idempotentReplay"], properties: { batch: { $ref: "#/components/schemas/PaymentSettlementBatch" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentSettlementResolutionProposalRequest: { type: "object", required: ["resolutionType", "reason", "evidenceReference"], properties: { resolutionType: { type: "string", enum: ["CONFIRMED_DUPLICATE", "PROVIDER_REPORT_ERROR", "PAYMENT_REFERENCE_CORRECTED", "CHARGEBACK_CONFIRMED", "MANUAL_EVIDENCE_ACCEPTED"] }, reason: { type: "string", minLength: 10, maxLength: 1000 }, evidenceReference: { type: "string", minLength: 3, maxLength: 255 }, correctedPaymentReference: { type: "string", minLength: 3, maxLength: 100 } }, additionalProperties: false },
        PaymentSettlementResolutionProposalResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["proposal", "idempotentReplay"], properties: { proposal: { $ref: "#/components/schemas/PaymentSettlementResolutionProposal" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentSettlementResolutionDecisionRequest: { type: "object", required: ["decision", "reason"], properties: { decision: { type: "string", enum: ["APPROVED", "REJECTED"] }, reason: { type: "string", minLength: 10, maxLength: 1000 } }, additionalProperties: false },
        PaymentSettlementResolutionDecisionResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["resolutionDecision", "idempotentReplay"], properties: { resolutionDecision: { $ref: "#/components/schemas/PaymentSettlementResolutionDecision" }, idempotentReplay: { type: "boolean" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        WalletPaymentResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["paymentIntent", "idempotentReplay", "nextAction"], properties: { paymentIntent: { $ref: "#/components/schemas/PaymentIntentSummary" }, idempotentReplay: { type: "boolean" }, nextAction: { type: "string", enum: ["ORDER_CREATED"] } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        ShippingPaymentResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["shippingPayment", "idempotentReplay", "nextAction"], properties: { shippingPayment: { $ref: "#/components/schemas/PaymentIntentSummary" }, idempotentReplay: { type: "boolean" }, nextAction: { type: "string", enum: ["WAIT_FOR_SHIPMENT_CREATION"] } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        PaymentProvider: { type: "object", required: ["id", "code", "displayName", "kind", "currency", "payableAmount"], properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, displayName: { type: "string" }, kind: { type: "string", enum: ["MOBILE_WALLET", "CARD", "BANK_TRANSFER", "LOCAL_METHOD", "OTHER"] }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, payableAmount: { $ref: "#/components/schemas/Money" }, minimumAmount: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, maximumAmount: { allOf: [{ $ref: "#/components/schemas/Money" }], nullable: true }, validUntil: { type: "string", format: "date-time", nullable: true } }, additionalProperties: false },
        PaymentProvidersResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["providers", "destinationCountryCode", "baseCurrency"], properties: { providers: { type: "array", items: { $ref: "#/components/schemas/PaymentProvider" } }, destinationCountryCode: { type: "string", pattern: "^[A-Z]{2}$" }, baseCurrency: { type: "string", pattern: "^[A-Z]{3}$" } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
        WalletTransactionType: { type: "string", enum: ["REFUND_CREDIT", "PAYMENT_DEBIT", "MANUAL_CREDIT", "MANUAL_DEBIT", "HOLD", "RELEASE", "REVERSAL"] },
        WalletTransactionStatus: { type: "string", enum: ["POSTED", "REVERSED"] },
        WalletTransaction: { type: "object", required: ["id", "reference", "type", "status", "amount", "currency", "balanceAfter", "description", "createdAt"], properties: { id: { type: "string", format: "uuid" }, reference: { type: "string" }, type: { $ref: "#/components/schemas/WalletTransactionType" }, status: { $ref: "#/components/schemas/WalletTransactionStatus" }, amount: { $ref: "#/components/schemas/Money" }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, balanceAfter: { $ref: "#/components/schemas/Money" }, description: { type: "string" }, createdAt: { type: "string", format: "date-time" } }, additionalProperties: false },
        WalletResponse: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["wallet", "transactions", "nextCursor"], properties: { wallet: { type: "object", required: ["currency", "availableBalance", "heldBalance"], properties: { currency: { type: "string", pattern: "^[A-Z]{3}$" }, availableBalance: { $ref: "#/components/schemas/Money" }, heldBalance: { $ref: "#/components/schemas/Money" } }, additionalProperties: false }, transactions: { type: "array", items: { $ref: "#/components/schemas/WalletTransaction" } }, nextCursor: { type: "string", format: "uuid", nullable: true } }, additionalProperties: false }, meta: { type: "object", additionalProperties: true } }, additionalProperties: false },
      },
      responses: {
        Success: successResponse("Successful response."), Created: successResponse("Resource created."),
        ProviderPlainTextError: { description: "External provider protocol error or retry response.", content: { "text/plain": { schema: { type: "string" } } } },
        SvgAsset: { description: "Standards-compliant QR or Code 128 SVG asset.", headers: { "x-request-id": { $ref: "#/components/headers/RequestId" } }, content: { "image/svg+xml": { schema: { type: "string" } } } },
        BadRequest: errorResponse("Malformed request."), Unauthorized: errorResponse("Authentication required."), Forbidden: errorResponse("Authenticated identity lacks permission."), NotFound: errorResponse("Resource not found or not visible to this identity."), Conflict: errorResponse("State or concurrency conflict."), Unprocessable: errorResponse("Validation or business-rule failure."), RateLimited: errorResponse("Rate limit or human verification required."), ServerError: errorResponse("Safe internal failure response."),
      },
    },
  };
}
