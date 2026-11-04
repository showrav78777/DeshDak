# Order and product identifier requirements

## Mandatory business rule

Every Crossly order and every Crossly product must have all three identities:

1. A unique human-readable platform code.
2. A scannable QR identity.
3. A scannable one-dimensional barcode identity.

Packages retain their own package code and package label. Product, order, and package identifiers are related but must not be reused interchangeably.

## Identifier ownership

- The backend generates platform codes during the same database transaction that creates the product or order.
- Platform codes are unique, immutable, never recycled, and protected by database uniqueness constraints.
- A supplier/manufacturer UPC, EAN, GTIN, external product code, seller SKU, or source-platform identifier is stored separately and can never replace the Crossly product code.
- Customers, sellers, administrators, imports, and external APIs cannot select or overwrite a Crossly platform code.

## QR and barcode rules

- QR and barcode images are rendered from canonical backend-controlled payload values; generated image files do not become the source of truth.
- A barcode should encode the relevant human-readable Crossly code or another documented non-secret lookup value.
- A QR code should encode an HTTPS lookup URL containing an opaque token, or an opaque identifier resolved by an authorized Crossly application.
- QR/barcode payloads must not contain raw database UUIDs, customer names, phone numbers, addresses, emails, internal supplier/provider identities, private costs, API credentials, session data, or other secrets.
- Scanning a private order or operational product record must still enforce authentication and object-level authorization. Possession of a QR code does not grant access.
- Public product QR links may expose only the same approved catalog information available through the public product API.

## Application coverage

- Customer website: display/copy the order code and allow approved product QR/barcode views where useful.
- Admin: search, open, scan, and print by product code, order code, QR, or barcode.
- Warehouse and logistics: scan identifiers without manually typing database IDs.
- Seller portal: show Crossly product codes separately from seller SKUs and manufacturer codes.
- Future Flutter Android/iOS apps: consume the same API fields and lookup endpoints; no mobile-only identifier generation.
- Labels: remain compatible with the binding fixed-width 80 mm, variable-length thermal-label specification.

## Implementation acceptance criteria

- Database migration is expand-only and safely backfills existing products and orders before non-null constraints are enforced.
- Concurrent creation cannot produce duplicate identifiers.
- API responses expose only approved codes and lookup values.
- Search supports exact code/barcode matches where relevant.
- QR and barcode scan-resolution tests cover valid, unknown, malformed, unauthorized, and revoked/rotated lookup tokens.
- Print verification covers black-and-white contrast, quiet zones, scan reliability, full product description wrapping, and physical 80 mm printer calibration.
- Identifier creation, reprint, and privileged lookup events are auditable where required.

## Delivery status

- Step 1 — identifier foundation: implemented. `orderNumber` remains the order code; new products receive a `PRD-` code with 80 bits of cryptographic randomness. Existing products are deterministically backfilled by migration. Product codes and order codes are uppercase, Code 128-compatible canonical barcode values.
- Step 2 — secure QR/barcode resolution API and rendered assets: implemented. Public assets exist only for approved catalog products; order lookup and assets require ownership or an authorized operational role. QR SVGs encode first-party scan URLs, Code 128 SVGs encode platform codes, and private assets are never cacheable.
- Step 3 — customer, seller, Admin, and warehouse UI integration: implemented. Approved product pages and protected order pages render reusable QR/Code 128 panels; seller and Admin lists expose compact identifier controls; warehouse package operations show related order/product identifiers; and the package label includes the Crossly order barcode without exposing PII.
- Step 4 — search/scan workflows, printing, and physical-device acceptance: software workflow implemented; physical acceptance remains pending. Exact product-code search, role-aware scan routing, Admin scanned-code filtering, and fixed-width 80 mm product/order print pages are covered by automated and browser checks. Warehouse printer/scanner calibration and real Android/iOS scan trials must still be completed before go-live.
