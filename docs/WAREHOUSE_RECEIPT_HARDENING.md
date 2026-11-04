# Warehouse receipt integrity — 20 October 2026

## Outcome and authority

The order/logistics workflow, database design and RBAC/security specifications
require physically confirmed receipts, assigned warehouse access and immutable
events for each transition. Before adding supplier inbound reconciliation, this
increment fixes replay and concurrency gaps in the existing receipt endpoint.
It creates no supplier/carrier events, prices, payments or financial postings.

## Controls

- Validate a strict request before replay lookup. Bind its canonical order number,
  warehouse, inbound tracking and optional platform package code to the employee.
- Store the request fingerprint in the immutable RECEIVED event. Only the same
  employee and matching payload can replay a key. Warehouse authorization remains
  mandatory; changed requests conflict and inaccessible receipts remain hidden.
- Legacy receipts without a fingerprint fail closed on replay. Staff should scan
  the existing package and review history; do not rewrite old events or receive
  it again merely to recreate a response.
- Lock the original order stage inside a Serializable transaction before receipt.
  Competing receipts/holds cannot blindly overwrite a newly changed stage. Unique
  key, serialization and stale-task conflicts roll back and return a safe 409;
  no automatic retry invents another physical receipt.
- An expected Ship for Me parcel may be selected by its scanned package code.
  Its warehouse and supplied inbound tracking must still match. One scanned parcel
  cannot silently select another; final order receipt waits for all expected parcels.
- Both browser receipt forms preserve the request key across uncertain network
  results, prevent parallel submission, time out safely and tell staff to review
  existing packages before retrying.

## Employee instructions

Scan the real order or expected parcel, confirm the assigned origin warehouse and
physically verify receipt before submitting. On success, continue on the package
task. On an uncertain response, refresh/scan and check existing receipt history.
If another worker already received it, use that package; do not change keys or
parcel details to force a second receipt. Incorrect receipts require operations
review through the existing exception process, not deletion of history.

## API and deployment

POST `/api/v1/operations/packages/receive` has an explicit OpenAPI request/response
contract. It accepts orderNumber, warehouseId, optional inboundTracking and optional
platform packageCode. Receipt keys use 16–255 ASCII letters/digits/colon/dot/underscore/
hyphen. Unknown fields are rejected. No new migration is required: request evidence
uses existing event metadata. Prior unapplied supplier-record migrations remain
separate activation requirements. No production database or provider is changed
by isolated verification.

## Acceptance and residual gaps

Test changed order/parcel/warehouse, another actor, malformed and legacy replay,
aborted network recovery, simultaneous distinct keys, exact receipt/event/history
counts, multi-parcel expected receipt matching and existing warehouse → inspection
→ measurement → delivery flows. Run schema/type/lint/policy/API/build checks.
Multiple supplier parcels and structured supplier-to-warehouse reconciliation still
need their own design: this fix must not be labelled that feature. Production
assignment-revocation races, infrastructure readiness and external provider testing
remain part of wider security acceptance.

## Verification evidence — 20 October 2026

All 33 isolated browser cases passed in 4.4 minutes, with no skips/retries. New
checks cover simultaneous distinct receipt keys (one 201 and one 409), exact database
counts of one package/receipt event/order history, two expected Ship for Me parcels
received through the actual mobile warehouse UI, mismatched tracking rejection,
matching replay, changed order/warehouse/tracking denial, malformed replay and
Inspector-role denial. The two-parcel order/request finished WAREHOUSE_RECEIVED
with exactly two original packages and one final receipt history entry.

The initial static check caught an incorrect event timestamp name, corrected to
occurredAt. A subsequent setup run stopped before browser tests because a synthetic
Ship for Me order lacked its required grandTotal; the fixture was corrected to zero.
The final suite passed. Its intentional receipt race logged a handled PostgreSQL
write-conflict error and returned the expected safe 409 rather than duplicating stock.

Receipt policy tests, schema validation, targeted ESLint, TypeScript, security
regressions, the 287-operation API contract and production build passed. HTML/JUnit
reports were exported; disposable schemas/containers/network were removed. No new
migration, real application-data change or production deployment was performed.
Known development dependency advisories and wider production prerequisites remain
open; this is not a full production security or load-test sign-off.
