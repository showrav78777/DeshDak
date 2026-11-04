# Dedicated Inspector portal

## Purpose

The Inspector sub-role of the Field Employee PWA works through `/inspector`. It is separate from `/warehouse`, Logistics operations, and Admin supervision.

## Administrator setup

1. Create or verify the employee's normal Crossly account.
2. Open Admin → Warehouses.
3. Select **Inspector**, choose the assigned warehouse, and enter the employee email.
4. The employee signs in at `/inspector/login` with their private password and human verification.

## Inspector workflow

1. Open the assigned inspection queue or scan a package QR, Code 128 barcode, order code, or inbound tracking number.
2. Review minimum product description, quantity, variant, package, order, and warehouse information.
3. Select Basic, Photo, or Video inspection and record Passed, Attention Required, or Failed.
4. Notes are mandatory for failed or attention-required decisions.
5. Photo and Video decisions require an approved `inspection-evidence/...` media reference supplied by the future protected media-upload integration.
6. After completion, the task becomes read-only. Passed packages return to Warehouse Worker measurement; exceptions place the order on hold.

## Security boundaries

- Access is limited to active warehouse assignments and enforced in API queries.
- Unknown and unauthorized packages both return `404` to prevent existence disclosure.
- Customer PII, payment details, supplier costs, margins, credentials, weight entry, put-away, labels, refund actions, and shipment transitions are excluded.
- Warehouse Workers cannot inspect. Inspectors cannot measure. Logistics shipment updates remain a separate role.
- Scan and decision actions write `PackageEvent`, `AuditLog`, `Inspection`, and `OrderStatusHistory` records as applicable.
- Authenticated responses use private no-store caching.

## Mobile readiness

The responsive portal supports camera scanning where the browser provides `BarcodeDetector`, plus USB/Bluetooth scanner and manual entry fallback. The same versioned lookup and inspection APIs can later be used by the Flutter applications after mobile bearer authentication is implemented.

## Verification

`npm run test:inspector-portal` verifies Admin assignment, portal isolation, cross-warehouse denial, scan lookup, media and failure-note validation, immutable events, PII minimization, and Warehouse/Logistics role separation.
