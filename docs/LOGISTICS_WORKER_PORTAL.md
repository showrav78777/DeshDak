# Logistics Worker Portal

## Operational surface

Logistics employees use the separate scanner-first PWA at `/logistics`. Authentication is isolated at `/logistics/login`; a Logistics role opened through another portal receives no Logistics permission. Admin assigns the `logistics_worker` role and active warehouse scope from `/admin/warehouses`.

## Documented workflow

The portal implements the binding shipment state machine:

`CREATED → PICKUP_PENDING → PICKED_UP → ORIGIN_WAREHOUSE → CONSOLIDATED → READY_FOR_EXPORT → DEPARTED_ORIGIN → IN_TRANSIT → DESTINATION_ARRIVAL → CUSTOMS → CUSTOMS_CLEARED → DESTINATION_WAREHOUSE → OUT_FOR_DELIVERY → DELIVERED`

Operational exceptions are `FAILED_DELIVERY`, `DAMAGED`, `LOST`, `HELD`, `RETURNED`, `CUSTOMS_EXCEPTION`, and the retained legacy `EXCEPTION`. Exception events require an explanation. Recovery paths are restricted by the server-side state machine.

## Assignment and privacy enforcement

- A Logistics Worker can access a shipment only when its origin or destination warehouse has an active assignment for that user.
- Tracking, package, and order scans use the same row-level scope.
- Shipment pages expose operational package/order codes, measured weight when present, carrier, route, status, and tracking history.
- Customer identity/contact/address, costs, margins, payment, refund, and FX fields are not queried or serialized.
- Warehouse Workers and Inspectors cannot publish shipment events. Logistics Workers cannot receive, inspect, measure, put away, or print warehouse labels.

## Shipment creation

Logistics Workers can create shipments in the web portal without code changes. Creation requires an assigned origin, configured destination, unique tracking number, and packages whose Package and Order states are both `READY_TO_SHIP`. A selected package cannot already belong to a shipment. Creation writes the Shipment, package links, initial immutable event, and audit record in one transaction.

The chosen warehouses must be different and configured for their respective origin/destination roles. Every selected active package must have stored order origin and destination country codes matching those warehouse countries. Mixed or misrouted country packages fail closed before shipment creation. Destination-only workers can process assigned arrivals but cannot create origin shipments.

Shipment creation requires an `Idempotency-Key`. The browser retains one stable key for the submission; an exact network retry returns the original shipment, while reusing the key with changed carrier, route, tracking, or package data is rejected. The database also enforces a unique package-to-shipment assignment, protecting against simultaneous submissions by different workers.

Every tracking-event mutation also requires an `Idempotency-Key`. The key is cryptographically bound to the shipment, status, normalized location, description, recipient, and private evidence reference. An exact offline/network retry replays the original event; changed-payload reuse is rejected. The web form rotates its key only after confirmed success.

An order may use more than one shipment. Customer order milestones are conservative aggregates across every active package: the order reaches international transit, customs, destination warehouse, out for delivery, and delivered only when every active package's shipment has reached that milestone or a later normal milestone. A serious shipment exception places the order on hold immediately. Inactive packages replaced by a controlled warehouse service are excluded from aggregation.

## Tracking integrity and offline replay

Every accepted transition updates the Shipment and creates an immutable ShipmentEvent within one transaction. Ordered transitions are checked server-side. Client-supplied offline idempotency keys are unique; a matching replay returns the previous outcome without creating a duplicate event. Scan activity and transition decisions are audited.

Tracking milestones synchronize customer-visible Order history without exposing customer data to the operator. Departure marks packages shipped. Delivery records `deliveredAt` and automatically sets `claimDeadline` to seven calendar days later.

## Proof of delivery

`DELIVERED` requires a recipient name, location, and an approved private reference under `delivery-evidence/`. Public URLs are rejected. The production media provider must issue presigned upload references, validate type/size, run malware scanning, keep objects private, and provide controlled viewing URLs.

## Verification

Run `npm run test:logistics-portal`. It covers Admin assignment, portal isolation, origin/destination scope, country-route mismatch rejection, creation guards, scanning, invalid transitions, exception notes, payload-bound offline idempotency, multi-shipment milestones, role separation, POD validation, claim deadlines, order synchronization, immutable history, and PII minimization.
