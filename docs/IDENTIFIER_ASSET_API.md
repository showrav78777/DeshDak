# Identifier asset API — Step 2

## Product endpoints

- `GET /api/v1/identifiers/products/{productCode}` — public lookup for an approved, active catalog product only.
- `GET /api/v1/identifiers/products/{productCode}/qr` — public QR SVG containing the canonical first-party product scan URL.
- `GET /api/v1/identifiers/products/{productCode}/barcode` — public Code 128 SVG containing only the product platform code.
- `GET /scan/products/{productCode}` — resolves an approved product code to its public product page.

Anonymous visitors can resolve only approved, active catalog products. An authenticated owning seller or MFA-completed Admin can resolve a non-public product for review and printing; those responses and assets use private, no-store caching. Inactive, rejected, deleted, uncategorized, malformed, unknown, and unauthorized products otherwise return the same not-found response.

## Order endpoints

- `GET /api/v1/identifiers/orders/{orderNumber}` — private minimal order lookup.
- `GET /api/v1/identifiers/orders/{orderNumber}/qr` — private QR SVG containing the canonical first-party order scan URL.
- `GET /api/v1/identifiers/orders/{orderNumber}/barcode` — private Code 128 SVG containing only the order platform code.
- `GET /scan/orders/{orderNumber}` — requires sign-in and resolves only for the owning customer or an authorized operational identity.

Anonymous order API requests receive `401`. An authenticated but unauthorized identity receives the same `404` as an unknown order, preventing existence disclosure. Customer access is ownership-scoped. Seller access is limited through the seller's own sub-order relationship. MFA-completed Admin, warehouse, inspection, and logistics roles can resolve operational identifiers without receiving customer PII.

## Asset controls

- SVG generation is server-side and uses standards-compliant QR and Code 128 encoders.
- QR values contain only canonical HTTPS scan URLs and platform codes.
- Barcode values contain only the canonical platform code.
- SVG responses use `nosniff`, restrictive Content Security Policy sandboxing, inline attachment-safe filenames, and search-engine exclusion.
- Approved product assets use bounded public caching. Order assets use `private, no-store`.
- Asset responses never include raw database UUIDs, customer PII, internal supplier/provider identities, private costs, cookies, or credentials.
- Production QR generation fails closed unless `APP_BASE_URL` is configured with HTTPS.

## Website and print integration

- Product detail and customer order detail pages display the code, QR, and Code 128 barcode together.
- Seller product review, Admin product/order review, and warehouse package operation pages use the same backend-rendered assets.
- `/print/products/{productCode}` and `/print/orders/{orderNumber}` render fixed-width 80 mm views and preserve the same authorization rules as their APIs.
- Order scans route customers, sellers, Admin, and operational staff to role-appropriate views. Scans never bypass authorization.

## Verification evidence

- Identifier foundation and live database uniqueness were rechecked before Step 2.
- Unit verification covers scan paths, first-party origins, invalid payload rejection, differing Code 128 geometry, QR generation, CSP, MIME type, and cache policy.
- Runtime verification covers public product lookup/assets, seller-owned private product access, exact product-code search, anonymous order denial, unrelated-customer non-disclosure, owner access, private assets, role-aware scan redirects, and protected product/order print pages.
- Browser verification confirms that SVG assets load, no console errors occur, the 80 mm sheet renders at 302.36 CSS pixels at 96 DPI, and the 390 px mobile layout has no horizontal overflow with 44 px action targets.
- The shared OpenAPI document explicitly identifies SVG success responses and cookie-protected order operations.
