# Manual supplier inbound manifest — 20 October 2026

## Requirements and boundaries

The master sourcing integration, database design and order/logistics workflow
require external-order links and distinguish reported dispatch from physical
warehouse receipt. This increment adds a manual, Admin-only dispatch record for
each active purchased supplier record. No live supplier/carrier API is activated.
It supports one parcel per supplier record; split/merged supplier parcels, manifest
corrections, cost accounting, claims and automatic tracking remain separate work.

## Workflow

1. Complete purchase authorization and supplier quantity evidence first.
2. Purchased orders stay in Admin → Purchases. Open Supplier references & items.
3. After checking the real dispatch confirmation, enter domestic carrier and
   tracking for each active supplier record. A save creates an EXPECTED package
   in that record's origin warehouse and immutable dispatch/audit evidence.
4. Only after every active supplier record has dispatch details does the order
   become SUPPLIER_SHIPPED. The customer receives a standard safe update, without
   supplier names/references or internal costs. Partial manifests do not claim
   that the full order shipped or arrived.
5. Assigned Warehouse staff find expected parcels in their existing queue, or scan
   the domestic tracking/platform package code. The package task shows the linked
   item's expected quantity/variant, not a whole-order quantity for every parcel.
6. Staff physically confirm each matched parcel. Wrong parcel/warehouse and stale
   requests fail closed. Partial receipts keep the order SUPPLIER_SHIPPED; all
   expected parcels must arrive before WAREHOUSE_RECEIVED and inspection.
7. Inspector UI/API waits for complete receiving. Inspection still verifies the
   actual item/quantity; a supplier dispatch record is not that verification.

Do not force manual status changes, invent tracking or create a second supplier
record to bypass the one-parcel limit. Incorrect dispatch or split parcels require
operations hold/escalation. Dispatch records cannot be edited/deleted, and a hold
does not cancel an external purchase. Older unlinked packages need review before
using this new manifest workflow; existing legacy receipt behavior remains gated
by its original stage/authorization checks.

## API and integrity

POST `/api/v1/admin/orders/{orderId}/supplier-records/{recordId}/dispatch` enforces
Admin/MFA, trusted origin, strict carrier/tracking validation, idempotency, active
record ownership, complete quantity coverage and origin warehouse/country. It
normalizes tracking to uppercase and rejects existing case-insensitive matches.
Serializable order locking and unique record/package/key constraints prevent
competing dispatches. One transaction creates the expected parcel, dispatch,
private audit, and (when complete) one safe history/notification.

No physical RECEIVED event is created at dispatch. The receive endpoint reuses the
existing expected package instead of creating another and waits for all parcels.
General Admin status editing cannot bypass new dispatch or receipt requirements.
The existing held-order resume rules remain separate and do not fabricate receipt.
Admin supplier-record reads include a protected dispatch summary; warehouse DTOs
exclude supplier identities/costs. No customer/public provider integration exists.

## Deployment and acceptance

Review migration `20261020110000_supplier_inbound_dispatch`, back up the target
database, run `npm run db:deploy` and `npm run db:generate`, then restart. Isolated
tests do not migrate the owner's application database. Keep tables/evidence when
rolling back access; do not delete dispatch history to undo operations.

Verify duplicate tracking/retry, stale/foreign record, wrong warehouse/country,
partial manifest/receipt, unauthorized roles, quantity/privacy, mobile form network
recovery, inspection gating and immutable records. Run schema, lint, TypeScript,
policy/API checks, disposable database/browser tests and production build.
Production access reviews, split/correction flows, supplier evidence verification and live integrations
remain explicit future gates, not claims of this increment.
Case-folded tracking uniqueness across legacy/import writers is addressed by the
later migration and preflight in docs/INBOUND_TRACKING_INTEGRITY.md; review that
additional deployment gate before enabling writes.

## Verification evidence — 20 October 2026

The final isolated PostgreSQL/browser run passed all 33 cases in 3.1 minutes,
with no skips or retries. The Admin scenario owns both dispatch and receiving
steps, avoiding cross-test ordering dependencies. It covers network recovery,
matching/conflicting replay, unauthorized dispatch, manual-status bypass denial,
partial manifest/receipt, tracking scan, warehouse privacy and inspection gating.
Database assertions confirm exactly two linked received parcels, one shipped and
one received history entry, immutable dispatch rows and unchanged financial totals.
The earlier serial run also passed all 33 cases in 2.6 minutes.

Supplier/warehouse policy tests, security regressions, schema validation, targeted
lint, TypeScript, the 288-operation API contract and production build passed.
HTML/JUnit reports were exported; the isolated schema and disposable stack were
removed. The owner's database was not migrated. This is increment-level evidence,
not certification of live integrations or production security/performance.
