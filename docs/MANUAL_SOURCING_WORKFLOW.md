# Manual sourcing workflow — 18 October 2026 increment

## Scope

Manual sourcing uses the existing quote, payment, purchase review, warehouse,
inspection, shipping-quote and shipment workflows. No supplier API is activated.
This increment hardens purchase decisions; it does not certify the entire workflow.

## Employee sequence

1. Sourcing Agent uses `/sourcing` to verify the product/variant, quantity, current
   supplier price and availability, then prepares a quote draft.
2. Admin uses `/admin/sourcing` to independently approve/reject the draft. Only an
   approved quote becomes visible to the customer.
3. Customer accepts the quote and completes the existing payment process. Do not
   treat an external payment screenshot as verified platform payment.
4. Admin opens `/admin/purchases`, verifies the order and approves purchasing.
5. Purchase externally only after authorization. Open Supplier references & items,
   record each item/variant, supplier reference, quantity and origin warehouse.
   Exact allocation coverage is required before marking purchased. Retain receipts
   in the approved internal process; these records do not verify supplier payment.
6. Publish verified supplier dispatch through `/admin/orders`; do not invent events.
7. Assigned warehouse and inspection staff receive/inspect/measure through their
   portals. Media remains subject to secure-storage/scanning readiness.
8. Admin issues the final measured quote in `/admin/shipping-quotes`; the customer
   approves/pays through the established flow before shipment release.
9. Logistics records verified shipment/delivery events. Customer timeline updates
   come from recorded history, not unverified supplier claims.

## Controls added

- Purchase transitions use a conditional database update on the prior status.
  Competing/stale decisions fail with 409 before history/audit/notification writes.
- History and notifications receive fixed customer-safe messages. The entered
  internal note is stored only in the Admin audit record.
- The purchase form explains each step, limits notes, recovers from network errors
  and instructs Admin to refresh before retrying an uncertain mutation.
- Server-side Admin authorization, transaction rollback and existing notification
  idempotency remain in effect. No financial amount or payment state is changed.

Historical notes already copied to customer history by older code are not rewritten
automatically: review affected records under the approved privacy/remediation process.

## Remaining gaps — do not call these completed

- Supplier records now link item/variant quantities, supplier references, recording
  Admin and origin warehouse. Original-currency costs/FX, verified supporting
  evidence and an authorized void/correction workflow remain incomplete. See
  `docs/SUPPLIER_ORDER_RECORDS_INCREMENT.md`.
- Private supplier receipt uploads using validated, scanned, access-controlled storage.
- Structured inbound supplier tracking and reconciliation with warehouse receipts.
- Supplier cancellation/dispute/claim evidence and finance-authorized recoveries.
- End-to-end acceptance of manual product entry and supplier verification through
  final delivery, including exception cases and role boundaries.
- Production media infrastructure, monitoring and operational owner approvals.

These require further implementation and verification, not just supplier API keys.
Policy tests use a mock transaction. The isolated browser scenario additionally
checks real database competing approval requests, actual form recovery/confirmation,
customer timeline privacy, customer authorization denial and final audit counts.

## Verification result — 19 October 2026

All 33 isolated browser cases passed with one worker, no skips/retries, including
manual purchase confirmation, customer privacy, warehouse handoff and delivery
tracking. The database verified exactly two purchase history entries and two audit
records. MFA API regression, purchase policy tests, security regressions, targeted
ESLint, TypeScript and OpenAPI contract checks also passed. The MFA setup route now
reuses unexpired enrollment secrets to avoid invalidating a displayed QR code.
See `docs/E2E_TESTING.md` for the failed attempts and environment changes; a complete
production build/security sign-off was not performed and development dependency
advisories remain tracked in `idea.txt`.
