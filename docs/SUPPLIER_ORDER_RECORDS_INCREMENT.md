# Manual supplier records — 19 October 2026

## Outcome and boundaries

Admin → Purchases → Supplier references & items records private supplier names,
external order references, variants, quantities and the origin warehouse. The
sourcing integration, database and financial specifications govern this increment.
No supplier API is activated. These are operational records, not proof of supplier
payment, verified receipts, warehouse receipt or financial postings.

Approve purchasing first. Record allocations covering every ordered item and its
exact quantity before Mark purchased. Orders without catalog items use their
sourcing-request quantity; unknown quantities fail closed. Records remain readable
after purchasing, through the order-specific page.

## Server and API controls

- Admin authorization and the existing portal/MFA boundary apply to GET/POST
  `/api/v1/admin/orders/{orderId}/supplier-records`.
- POST requires a trusted origin and idempotency key. Matching retries replay the
  original result; changed payloads with the same key fail with a conflict.
- Serializable transactions, order locking, quantity bounds, item ownership and
  matching origin-warehouse checks prevent invalid allocations. Conflicts require
  a refresh/reconciliation, not blind automatic retries.
- Database triggers reject updates and deletes. Supplier details stay private;
  customer status history receives only fixed safe messages.
- Monetary fields are rejected: original-currency costs require a separate FX and
  accounting design. Creating a record never changes totals or marks an order paid.
- Mark purchased rejects incomplete allocation coverage with
  `SUPPLIER_RECORDS_REQUIRED`.

## Activation and remaining risks

Apply reviewed migration `20261019090000_manual_supplier_order_records` using
`npm run db:deploy`, regenerate with `npm run db:generate`, then restart the app.
Verification uses a disposable database, not the owner's application database.
Back up the target database before a controlled deployment. Do not drop records
to roll back; retain the schema and disable the workflow while investigating.

An incorrect immutable record currently requires an operational hold and escalation.
A Sourcing-stage Admin can now report the mistake directly under the record,
linking the private reason and placing the entire order on hold. See
`docs/SUPPLIER_CORRECTION_HOLDS.md`; reporting is not an approved correction itself.
A separately authorized, auditable void/correction process remains required; do not
edit records directly. Private scanned receipts, supplier cost/FX accounting,
inbound tracking reconciliation and supplier claims/recoveries remain out of scope.
This increment does not constitute production release or full-system acceptance.

## Verification evidence

19 October: all 33 isolated browser tests passed (2.1 minutes, one worker), including
the new Admin record flow, aborted-request recovery, idempotent replay, allocation
conflicts and customer access denial. Database assertions checked one record/audit,
unchanged order total and rejection of record updates/deletes. The initial run had
a test selector collision with Next's route-announcer alert; the form-scoped selector
fixed that test ambiguity. Unit tests also reject missing/overallocated individual
items. Schema validation, targeted ESLint, TypeScript, security regressions, the
286-operation OpenAPI contract and Next.js production build passed. HTML/JUnit
reports were exported; disposable containers/network were removed. The real
application database was not migrated. Known development dependency advisories and
external production prerequisites remain separate release gates.
