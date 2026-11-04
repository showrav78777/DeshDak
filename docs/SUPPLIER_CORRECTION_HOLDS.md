# Supplier-record mistake reporting — 19 October 2026

## Scope and authority

The sourcing integration and database design specifications require manual sourcing
to retain normalized evidence and immutable history. This increment provides a
safe stop/escalation path, not record editing, supplier cancellation, money recovery
or approval to replace evidence. It builds on the existing purchase-review API.

## Employee instructions

1. Admin opens Purchases → Supplier references & items on a Sourcing-stage order.
2. Expand **Report record mistake** under the affected record.
3. Explain the mistake privately, confirm the whole-order hold, then submit.
4. The order becomes ON_HOLD. Existing records stay visible and unchanged; further
   supplier allocations and marking purchased are blocked by stage checks.
5. Escalate to operations. Check externally whether a supplier purchase already
   exists; a platform hold does not cancel it. Do not create replacement evidence
   or modify database history to work around the hold.

For an already purchased/shipped order, contact operations using its order number;
this pre-purchase action is unavailable. Independent name/reference/variant
replacement and release are now implemented in `docs/SUPPLIER_RECORD_REPLACEMENTS.md`.
General quantity, warehouse, cancellation and financial corrections remain pending.

## API and safeguards

PATCH `/api/v1/admin/orders/{orderId}/purchase-review` accepts optional UUID
`supplierRecordId`. It is valid only for PLACE_ON_HOLD from SOURCING and must refer
to a record belonging to that order. Admin portal/MFA, trusted mutation origin and
strict validation remain mandatory. Foreign/stale records fail without writing.
Conditional stage update, history, audit and notification remain transactional.
Competing/repeated decisions fail with 409; the UI instructs staff to refresh after
an uncertain response instead of blindly resubmitting.

The private audit links supplierRecordId and correctionRequested with the reason;
supplierCancelled and financialPosting are explicitly false. Customers receive
only the standard hold update. No supplier record, financial total or inventory is
edited. No new schema migration or external credentials are needed for this increment.

## Acceptance checks

Test own/foreign record ownership, wrong action/stage, duplicate requests, trusted
origin, private history, failed network recovery and mobile overflow. Verify one
hold history/audit and unchanged original record and order total in a disposable
database. Production deployment, correction approval/replacement and live supplier
reconciliation remain separate gates.

## Verification completed

Reviewed 20 October 2026: the isolated run passed all 33 browser cases (3.8 minutes)
and real database assertions for one linked private hold audit, one safe timeline
event, unchanged supplier evidence and unchanged order total. Tests cover foreign
record rejection, untrusted origin, aborted-request recovery, duplicate decisions
and mobile overflow. Unit tests, Prisma validation, targeted ESLint, TypeScript,
the 286-operation API contract and production build passed. HTML/JUnit reports were
exported before disposable containers/network were removed. The browser run logged
two development-only Performance.measure negative-timestamp errors on AdminHomePage;
these did not fail the workflow tests and are not a clean browser-console sign-off.
Existing development dependency advisories and production/provider prerequisites
remain unresolved release gates. No application database migration or deployment
was performed for this follow-up.
