# Ship for Me increment

## Paid international dispatch increment

An accepted, unexpired measured quote can now be paid from the customer BDT wallet. The debit, double-entry journal, FX parity snapshot, dedicated shipping-payment record, order history, package readiness, audit log, activity event, and customer notification commit atomically. Product payments remain separate. After success, assigned Logistics staff can create the shipment; ordered shipment events appear in the customer timeline and create notifications for meaningful order-stage changes.

If active packages are assigned to separate international shipments, the customer order remains at its last fully achieved milestone until every active package catches up. One delivered shipment cannot mark a partially delivered order complete. Replaced inactive package records do not participate in this aggregation.

## Multi-parcel inbound increment

A request can declare 1–10 parcels. Tracking submission must provide one distinct domestic tracking number per parcel and creates a separately scannable package record for each. The first warehouse scan produces a partial-receipt state and does not unlock inspection for the order; the final expected receipt publishes the warehouse-received milestone. Inspection and measurement operate per parcel, and the order becomes measured only after every parcel is measured, so the final quote uses their combined chargeable weight.

Each package now retains its own customer-declared carrier and tracking number. `/ship-for-me/[requestId]` is an ownership-protected customer view showing every parcel, receipt and measurement progress, customer-safe exception outcomes, final quote/payment state, and the link to the full order/shipment timeline. Notifications deep-link to this request view.

## Controlled parcel exceptions

Assigned Warehouse staff use `/warehouse/exceptions` to report missing, extra, mismatched, damaged, missing-reference, restricted, or other parcel exceptions. Reports are immutable, idempotent, warehouse-scoped, audited, and visible in `/admin/warehouse-exceptions`. Customers receive a neutral review notice; Admin must record an internal resolution and a separate customer-safe update. Any open exception blocks the final shipping quote.

## Aging and SLA warnings

Admin configures the expected-parcel warning threshold, parcel-exception resolution SLA, and warehouse-storage warning age from `/admin/warehouse-exceptions`. The same page calculates overdue expected requests, overdue exception reports, and aged received packages from server timestamps. These are operational reminders only: they do not charge a wallet, create a storage fee, cancel an order, or authorize disposal/abandonment.

## Controlled package services

Customers can request consolidation, splitting, or repacking from their protected Ship for Me request page after origin-warehouse receipt and before a shipping quote exists. The request identifies the exact active source packages and requested output count. An open parcel exception or another open package service blocks submission.

Admin reviews requests at `/admin/package-services`, recording separate internal and customer-safe notes. Approval fails closed if the order, package state, warehouse assignment, exception state, or quote state changed after submission. Assigned Warehouse staff execute only approved tasks at `/warehouse/package-services`; completion requires one exact physical-label scan for every approved source package, and rejects missing, duplicate, extra, or replacement codes.

Completion atomically marks source packages inactive, preserves their codes and event history, creates new `PKG-*` replacement records, links source/result lineage, resets the order to warehouse-received, and requires fresh inspection and measurement. Replaced source labels no longer resolve in Warehouse or Inspector task queues. Final quote, wallet payment, and shipment creation use only active outbound packages. The software does not invent or automatically debit a handling fee.

## Delivered scope

The website now implements the documented customer-to-origin-warehouse slice:

1. An authenticated customer requests an address for an active, checkout-enabled lane approved by Finance, Compliance, and Operations.
2. The server selects a configured origin warehouse with an address, creates a `SHIP_FOR_ME` order and immutable address snapshot, and issues opaque `SFM-*` and `ORD-*` references.
3. The customer submits a local carrier and inbound tracking number once through an idempotent, same-origin API.
4. The system creates an assigned `EXPECTED` package with a scannable `PKG-*` code.
5. An assigned Warehouse Worker can resolve the package code, order code, or inbound tracking number. Physical confirmation updates the existing package rather than creating a duplicate.
6. Package, request, and order transition together to warehouse received. Order history, notification delivery, and audit evidence are committed in the same database transaction.
7. Inspection, lane-bound measurement, final shipping quote, and customer approval are verified end to end. Shipping payment, shipment, claims, and delivery continue through the existing shared workflows.

## Security and privacy rules

- Anonymous users are redirected to customer login and APIs return `401`.
- Customer role and per-owner row filters are enforced on every customer endpoint.
- Consequential customer mutations require a same-origin request and `Idempotency-Key`.
- Warehouse workers can resolve and receive only packages assigned to their warehouses.
- Customer PII and upstream source-platform identities are excluded from warehouse and customer responses.
- Customer-supplied tracking is visibly distinguished from the warehouse-verified receipt.
- The warehouse address is snapshotted so later Admin changes cannot silently rewrite an issued instruction.

## API routes

- `GET|POST /api/v1/ship-for-me/requests`
- `GET /api/v1/ship-for-me/requests/{requestId}`
- `POST /api/v1/ship-for-me/tracking`
- `GET|POST /api/v1/package-services`
- `POST /api/v1/admin/package-services/{requestId}/review`
- `POST /api/v1/operations/package-services/{requestId}/complete`
- Existing `POST /api/v1/operations/packages/lookup`
- Existing `POST /api/v1/operations/packages/receive`

These routes use the standard JSON envelope and are included in `/openapi.yaml` for the future Flutter client.

## Verification evidence

- Clean Prisma migration deployment and zero schema drift
- TypeScript, ESLint, OpenAPI drift, and production build pass
- Dedicated end-to-end test: `npm run test:ship-for-me`
- Warehouse, Inspector, and identifier regression suites pass
- Browser checks confirm protected redirect, public navigation, no desktop/mobile horizontal overflow, and no browser console warnings/errors

## Deferred external/operational work

The carrier integration, real warehouse/contact configuration, legal approval, physical label/scanner acceptance, package-service pricing, storage charges, restricted-goods enforcement, and live insurance/customs processes remain owner/provider work. The authoritative follow-up list is maintained in `idea.txt`.
