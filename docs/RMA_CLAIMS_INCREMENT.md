# RMA and claims increment

## Business outcome

Customers can report an eligible shipment problem within its stored claim deadline, follow the return/claim timeline, submit return tracking, and receive audited Admin decisions. Required physical returns enter the assigned Inspector warehouse queue. Approved refund amounts are linked to the existing promotion-netted, original-FX wallet refund engine.

## Enforced workflow

`RETURN_REQUESTED → RETURN_APPROVED / RETURN_REJECTED → RETURN_IN_TRANSIT → RETURN_RECEIVED → INSPECTED → REFUNDED / REPLACED / CLOSED`

No endpoint accepts an undocumented state jump. Optimistic version checks prevent stale Admin or Inspector decisions. Every state change creates an immutable `RmaEvent` and an audit record.

## Policy and security controls

- Customer ownership, Admin role, Inspector portal, and assigned destination warehouse are checked on the server.
- The per-shipment deadline is snapshotted when a claim is created. Late customer claims fail with `CLAIM_WINDOW_EXPIRED`; only Admin can create an exceptional late claim with a mandatory audited reason.
- Buy & Ship and Ship for Me eligibility rules are distinct. Minor cosmetic, change-of-mind, and unsupported reasons fail closed.
- Evidence accepts only private `rma-evidence/...` references. Public URLs are rejected.
- The default review target is five weekdays and can be configured from three to five with `RMA_SLA_BUSINESS_DAYS`.
- Inspector responses exclude customer identity, contact, order price, payment, refund amount, supplier cost, and margin.
- Approved claim refunds must match the exact approved gross amount, use the original payment FX snapshot, net promotions, remain idempotent, post a balanced wallet journal, and atomically move the claim to `REFUNDED`.

## Web and API surfaces

- Customer: `/orders/[orderId]`, `/rmas`, `/rmas/[rmaId]`
- Admin: `/admin/rmas`, `/admin/refunds`
- Inspector: `/inspector#returns`, `/inspector/rmas/[reference]`
- API: `/api/v1/rmas`, `/api/v1/rmas/{rmaId}`, messages, return tracking, Admin queue/decisions/late override, Inspector return inspection, secure refund linkage

## External gates

Private evidence storage/scanning, carrier ETA rules, reverse-logistics labels, external original-method refunds, insurance and supplier/carrier recovery remain fail-closed and are recorded in `idea.txt`.
