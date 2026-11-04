# Seller CSV catalog import increment

## Business outcome

An approved Bangladesh seller can import products without operating another website. The seller chooses a CSV in the Crossly web application, maps its columns, reviews row-level validation, and explicitly confirms a database-backed preview. Every confirmed product remains private and enters the existing Admin product-moderation queue.

## Delivered workflow

- Seller page: `/seller/products/import`.
- Downloadable header template: `/templates/seller-catalog-import.csv`.
- Versioned list/preview API: `GET|POST /api/v1/seller/catalog-imports`.
- Explicit confirmation API: `POST /api/v1/seller/catalog-imports/{importId}/confirm`.
- Browser CSV parsing with quoted fields and embedded line breaks.
- Explicit column mapping for 27 normalized product and primary-variant fields.
- Active category slugs displayed in the browser and revalidated by the server.
- Row-level field errors for content, category, Boolean values, stock, SKU, price, quantity, weight, dimensions, lead times, and product terms.
- One-hour private preview history with valid/invalid counts and immutable row fingerprints.
- Atomic all-or-nothing confirmation. Any invalid row blocks the entire import.
- Active-preview retry reuse, optimistic preview versions, completed-file duplicate prevention, and confirmation replay safety.
- Shared manual/CSV server creation service so both paths assign Crossly product codes, create the local source association, calculate completeness, and write the same audit action.
- CSV-created listings use `PENDING_REVIEW`; they are excluded from public catalog APIs and storefronts until individual Admin approval.
- Import-to-row-to-product provenance remains in the database for reconciliation.

## Security, privacy, and integrity

- Seller role, Seller portal, approved account, and seller-row ownership are enforced server-side.
- Browser mutations remain protected by the same-origin/CSRF proxy.
- The browser file is not uploaded or stored. Only bounded mapped text data is posted as JSON.
- Maximums are 512 KB in the browser, 100 product rows, 40 columns, and 3,000 characters per cell. The server independently enforces row, column, and cell limits.
- CSV cannot carry image/video files, public media URLs, executable connector code, supplier credentials, or raw API keys.
- Confirmation reparses every stored normalized row through the current product schema and rechecks category/SKU integrity inside a serializable transaction.
- Concurrent, stale, partial, cross-seller, wrong-portal, and exact completed-file replay paths fail safely.
- No external supplier identity is exposed to customers.

## Verification

Run:

```text
npm run test:seller-catalog-imports
```

The test covers portal and ownership isolation, CSRF, mapping enforcement, invalid rows, no-partial-import behavior, preview idempotency, stale versions, atomic creation, identifiers, replay safety, duplicate-file rejection, Admin visibility, public privacy, and audit evidence.

Also run Prisma migration verification, seller product-revision regression, OpenAPI contract verification, ESLint, TypeScript, and the optimized production build.

## Intentionally gated

Product and store media remain disabled until private object storage, signed upload/download, MIME/signature checks, malware scanning, metadata removal, processing, encryption, retention, and authorized delivery are configured. CSV imports deliberately cannot bypass this gate.

Seller API synchronization remains a later increment. It requires an official API contract, seller authorization/revocation, secret-manager credentials, scopes, quotas, webhooks, media rights, mapping/conflict rules, deletion behavior, health monitoring, and reconciliation. New products must enter initial Admin review; changes to approved products must create moderated product revisions rather than overwriting live listings.
