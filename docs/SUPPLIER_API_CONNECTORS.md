# Supplier API connector increment — 2026-10-18

## Scope and outcome

Added an internal, read-only OT Commerce transport for `SearchItemsFrame` and
`GetItemFullInfo`. This is a protocol foundation, not a completed sourcing workflow.
No live provider was called, no products were imported and no credentials were stored.
Existing Admin activation locks and the default unconfigured registry are unchanged.

The client requires an explicit internal approval flag and an injected server-side
credential resolver. It uses a fixed HTTPS destination, POST form parameters,
no redirects or retries, a 15-second end-to-end deadline, a 2 MiB decoded response limit,
XML escaping, bounded pagination and sanitized errors. Signed requests follow the
provider's published SHA-256 example. Unsigned accounts omit signing parameters.
Returned objects remain internal provider data: they are not public DTOs and must
not be passed directly into catalog APIs or persisted without validation.

## Documentation reviewed

- [OTAPI search](https://docs.otapi.net/en/Documentations/Method/SearchItemsFrame)
- [OTAPI product details](https://docs.otapi.net/en/Documentations/Method/GetItemFullInfo)
- [OTAPI signing algorithm and test vector](https://docs.otapi.net/en/Documentations/Description/MethodSignature)
- [OT Commerce Pinduoduo offering](https://otcommerce.com/pinduoduo-api-dropshipping/)
- The supplied GitHub repository describes a third-party scraping service, not the official Alibaba API.
- The supplied Postman collection is for Shopee; do not use it as a 1688 contract.
- Official 1688, Pinduoduo and AliExpress portal contracts could not be fully retrieved.
  Their signatures, permissions and response schemas have not been guessed.

## Acceptance and verification

Run `npm run test:otapi-client`. Offline checks cover the official signing vector,
pagination offsets, XML escaping, disabled calls, signed/unsigned account behavior,
fixed destination, POST-only requests, redirect rejection, response size limits,
malformed envelopes and secret-safe failures. These are synthetic protocol checks,
not proof of live account compatibility.

The deadline covers credential resolution, HTTP response and body reading, including
dependencies that do not honor abort signals. Stream cancellation is attempted without
waiting indefinitely. Credential bytes are preserved when signing. Regression tests
cover stalled credential stores, stalled fetches, stalled response streams, cancellation,
malformed JSON classification and exact credential signing. A timed-out credential
resolver may continue internally; a production resolver must also enforce its own
backend timeout. No automatic retry is performed for these potentially paid reads.

## Required before activation

### Admin onboarding increment

Admin > Source integrations (`/admin/source-integrations`) now includes a numbered
setup guide and saved-account configuration warnings. It checks secret-reference
presence, supported country, positive request limits, recorded quota exhaustion and
credential expiry (including a seven-day renewal warning). Missing expiry does not
imply failure: some credentials do not expire. These are advisory configuration
checks, not quota enforcement, secret resolution or live health checks. No activation
lock was removed and no schema migration or public endpoint was added.

The guide uses a responsive two-column list that becomes one column on narrow screens.
Verification: `npm run test:source-readiness`, existing connector/candidate tests,
targeted ESLint and TypeScript. Authenticated browser/mobile visual acceptance remains
to be performed; this increment does not claim a full production build or live test.

### Internal candidate validation increment

`src/modules/sourcing/product-candidate.ts` now defines an explicit internal mapped
candidate contract. This is not a guessed OTAPI response shape. Provider-specific
mappers must be verified against approved response fixtures before calling it.
It rejects unknown fields, invalid/zero/negative prices, unsupported currencies,
invalid metric dimensions/weight, malformed stock and non-approved image hosts.
Original titles and decimal price strings remain intact; no supplier FX conversion
or inferred sale price is introduced. Unknown stock is explicitly unconfirmed.
All returned candidates have `reviewStatus: PENDING` and `publishable: false`.

Run `npm run test:supplier-candidate` for synthetic boundary and hostile-input tests.
This increment has no database or public API changes and is not yet wired into the
live registry. Image URL validation does not authorize network fetching: production
media ingestion must separately prevent DNS rebinding/redirect SSRF, validate content,
scan and sanitize files, and use approved storage. Supplier HTML descriptions need
a separate sanitization pipeline rather than bypassing the plain-text contract.
Compliance screening, localization, moderation, mapper integration and live fixture
verification remain required before catalog publication. This boundary alone does
not implement those workflows.

1. Owner selects official APIs versus a licensed aggregator and approves commercial access/costs.
2. Provide approved account access through a secret manager, not chat or committed files.
3. Obtain account-specific provider identifiers, permissions, sample responses and API exports.
4. Implement validated product/variant normalization, original-currency pricing, localization
   and compliance screening before public display. Validate detail parameters with provider fixtures.
5. Implement persistent account quotas, credential-use audit, health metrics, circuit breakers
   and secret-manager lookup; retain Admin MFA/RBAC and operational approval.
6. Verify sandbox contract compatibility before linking the connector to the live registry.
7. Orders, cancellation, tracking, image search and AliExpress OAuth remain separate,
   unimplemented provider increments requiring their own verified contracts and tests.

Risk review: this increment cannot place an order, charge a customer or alter supplier
state. No public endpoint exposes raw upstream results. Live activation remains blocked.

## Credential-handoff and configuration reliability increment

The Admin guide now links to provider access pages and explains where to enter only
secret references. `docs/SUPPLIER_ACCESS_SETUP.md` includes the owner checklist and a
provider inquiry template. It explicitly lists unfinished production work; keys alone
do not activate an API.

All four configuration forms now capture their form element before asynchronous work,
release the saving state in `finally`, and preserve user input on failure. A shared
same-origin request helper rejects raw credentials before sending, rejects redirected
or malformed success responses and surfaces fixed, secret-safe errors. Mutations are
not automatically retried: uncertain outcomes instruct Admin to refresh before retrying.
The helper has a 15-second deadline including response parsing. It does not replace
server-side validation, CSRF, MFA, RBAC or audit controls, which remain unchanged.

Verification: all four supplier suites, targeted ESLint and TypeScript pass. Supplier
suites are now included in launch verification. Full launch verification, authenticated
browser acceptance and production build were not run for this increment. No live
provider calls, subscriptions, purchases, imports or deployments were performed.
