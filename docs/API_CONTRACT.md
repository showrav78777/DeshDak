# Crossly API contract increment

## Business outcome

The website backend now publishes a machine-readable OpenAPI 3.0.3 contract that the future Flutter application and internal tools can use as a stable `/api/v1` inventory. CI fails when a route operation is added, removed, renamed, or changes its enforced idempotency-header requirement without regenerating and reviewing the contract.

Published contract: `/openapi.yaml`

Repository file: `public/openapi.yaml`

## Current contract guarantees

- All 230 exported HTTP operations under `src/app/api/v1` appear in the contract.
- Every operation has an explicit access classification: public, optional browser session, authenticated browser session, one-time administrator bootstrap, or protected scheduler.
- Existing `Idempotency-Key` requirements are detected from handlers and published as required headers.
- Standard success and error envelopes, correlation response headers, common HTTP errors, pagination parameters, language headers, registration, login, and image-upload primitives are reusable components.
- The contract contains no supplier credentials, raw provider tokens, secret-manager values, private costs, customer records, or administrative data.
- JSON syntax is intentionally used inside `openapi.yaml`; JSON is valid YAML 1.2 and avoids adding an unreviewed parser dependency to the application.

## Order lifecycle refinement

- Customer cart checkout now publishes an exact address, cart, lane, coupon, order-summary, idempotent-replay, and next-action contract.
- Customer order timelines publish exact order-stage, package, shipment, and shipment-event structures.
- Measured shipping-quote acceptance and rejection are correctly documented as bodyless idempotent actions.
- Customer shipping-quote responses omit staff identity and stored idempotency evidence.
- Administrator purchase review, measured shipping quote, and operational status mutations publish exact validated request schemas.
- Each refined operation publishes its stable business-error code inventory through `x-crossly-error-codes`.
- Contract verification fails if these request bodies, bodyless actions, success schemas, or error inventories regress to generic definitions.

## Payment and wallet refinement

- Payment-method discovery publishes exact destination, currency, amount, provider, converted amount, limits, and validity fields.
- Gateway-intent, wallet-payment, and shipping-wallet operations publish mutually exclusive order/quote targets, exact payment summaries, replay flags, next actions, and stable business-error inventories.
- The private wallet API publishes exact balance, transaction, and cursor-pagination schemas.
- Reusing a payment idempotency key with a different order, quotation, or provider now fails closed with `IDEMPOTENCY_KEY_REUSED`; an identical owner retry returns the original payment with `idempotentReplay: true`.
- The contract verifier prevents these financial operations from regressing to generic bodies or responses.

## Public catalog refinement

- Categories, checkout-ready destinations, product search/detail, store search/detail, published reviews, and review submission now publish exact Flutter-ready query, request, response, pagination, enum, and business-error contracts.
- Public catalog reads consistently require active products, clear compliance, active categories, and either no seller or an approved seller. Suspending a seller immediately removes its products from detail, search, and category counts.
- Store directory responses expose `productCount` instead of the database-specific `_count` shape.
- Review submission responses return only the customer's submitted content and moderation status; customer IDs, order-item IDs, idempotency keys, request fingerprints, and moderation identities remain private.
- Contract verification prevents public catalog and review operations from regressing to generic schemas or exposing restricted review fields.

## Customer cart refinement

- Private cart retrieval, item save, quantity update, and removal publish exact Flutter-ready schemas for product/variant snapshots, availability, totals, fulfillment type, and errors.
- Cart availability now applies the same approved-seller rule as the public catalog. A suspended seller's retained item becomes unavailable and contributes nothing to the payable subtotal.
- Contract verification protects all four cart operations from generic body/response regression and confirms removal remains bodyless.

## Customer account and address refinement

- Profile, current-session summary, analytics consent, and saved-address operations now publish exact Flutter-ready request, response, nullable-field, and business-error contracts.
- Saved addresses support list, create, partial edit, default selection, and recoverable deletion without exposing internal owner IDs or deletion timestamps.
- Database and transaction controls guarantee at most one active default address per customer; deleting the default promotes a remaining address automatically.
- Contract verification protects all eight customer-account operations from generic request/response regression and guards private saved-address fields.

## Administrator audit contract

- The protected audit-log operation publishes exact search, action, entity, UTC date, and pagination parameters.
- Its response identifies actors and entities while exposing only recursively redacted, bounded metadata suitable for administrator review.
- The contract verifier prevents the endpoint from regressing to an undocumented generic response.

## Customer wishlist refinement

- Wishlist list, save, and removal operations publish exact Flutter-ready pagination, product-card, replay, and removal schemas.
- Save and removal are idempotent, customer-owned mutations; wishlist reads expose only products that still satisfy the public catalog visibility boundary.
- Internal customer IDs, seller-profile IDs, compliance evidence, and deletion fields are excluded from the contract and verified against regression.

## Contract workflow

After adding or changing an API handler:

1. Run `npm run api:generate`.
2. Review `public/openapi.yaml`, especially security, idempotency, request, and response changes.
3. Run `npm run api:contract`.
4. Run the relevant workflow/security tests and production build.

CI runs the drift check automatically. Never bypass it by editing only the generated contract or by weakening the verifier.

## Security boundary

- The current website uses a secure HttpOnly browser session cookie. The contract does not falsely advertise that customer JWT bearer authentication is already available.
- The scheduler bearer scheme is a dedicated opaque maintenance credential, not a customer or administrator access token.
- Authentication and authorization remain enforced by the route/service implementation. OpenAPI security metadata is documentation, not an authorization control.
- Publicly publishing endpoint names is required by the binding API baseline; sensitive values and internal provider identities remain excluded from schemas and responses.
- One-time administrator setup remains protected by database state, production setup token, human verification, and automatic closure after first setup.

## Remaining contract refinement

The contract inventory and global components are enforced now. As each business workflow reaches its implementation gate, replace its generic mutation body and generic success data with exact request/response schemas, enums, examples, pagination details, and documented business-error codes in the same increment. Critical financial and order workflows receive priority.

When mobile authentication is implemented, add short-lived access-token and rotating refresh-token endpoints, the mobile bearer security scheme, device/session schemas, revocation errors, and generated Dart-client verification together. Do not add a bearer scheme before the server actually enforces it.

## Acceptance evidence

- Contract generation completed for 230 operations.
- Drift/security/envelope/idempotency verification passed.
- The end-to-end Ship for Me workflow passed with the bodyless quote decision and customer-response privacy assertion.
- The shipping-payment workflow also verifies exact replay and rejects reuse of the same payment key against a different order.
- Seller catalog verification proves suspended-seller products disappear from every public catalog boundary; product-review verification proves submission and publication responses minimize identity and mutation evidence.
- The isolated cart workflow verifies authentication, browser-origin protection, ownership isolation, inventory enforcement, totals, suspended-seller blocking, updates, and deletion.
- The isolated customer-account workflow verifies profile and privacy access, trusted-origin enforcement, address ownership isolation, safe response fields, default-address integrity, and recoverable deletion.
- The isolated wishlist workflow verifies authentication, customer-role and origin enforcement, public visibility, pagination, response privacy, ownership isolation, and idempotent save/removal.
- Prisma validation, ESLint, and TypeScript passed.
- The optimized production build passed using the documented Next.js Webpack fallback after the local sandbox blocked Turbopack's internal CSS worker port.
- The production runtime served `/openapi.yaml`, liveness, and PostgreSQL readiness successfully.
