# Seller catalog management increment

## Business outcome

Approved Bangladesh sellers can now manage a catalog from a dedicated seller workspace instead of using one combined submission/list page. A seller can add a new product, open an owned product, and submit changes for Admin review. An active customer-facing listing remains unchanged and purchasable while its proposed revision is reviewed.

## Delivered

- Dedicated seller catalog list at `/seller/products`.
- Dedicated manual product creation at `/seller/products/new`.
- Seller-owned product detail/editor at `/seller/products/{productId}`.
- Versioned, provider-neutral seller revision API at `/api/v1/seller/products/{productId}/revisions` for the website and future Flutter client.
- Separate immutable revision records containing validated public product and primary-variant proposals.
- One-pending-revision database guard per product.
- Seller portal, approved-seller, row ownership, active-category, SKU uniqueness, and optimistic product-version enforcement on the server.
- Admin moderation at `/admin/products`, with current-live-title and proposed-content context.
- Atomic Admin approval: validated product and variant changes publish together and increment the product version.
- Safe rejection: the revision is retained with the Admin note and the live listing is not changed.
- Audit evidence for seller submission and Admin approval/rejection.
- Existing Crossly product codes, QR codes, barcodes, cart, checkout, public product pages, and public store pages continue using the canonical approved product record.
- Public category counts, product search, and product-detail APIs require the owning seller to remain approved; suspended or otherwise non-approved seller inventory disappears immediately without deleting the retained product record.

## Security and data-integrity decisions

- No client can select a seller profile ID; ownership comes from the authenticated seller session.
- A seller identity must use the seller portal. An Admin identity must use the MFA-authorized Admin portal.
- Browser mutations remain protected by the application-wide trusted-origin/CSRF boundary.
- JSON revision snapshots are never trusted when published; Admin approval reparses them through the current catalog schema and rechecks category, seller, product version, and SKU rules inside the workflow.
- A database partial unique index prevents concurrent pending revisions even if two requests race.
- External seller API imports must create the same normalized revision records and cannot publish directly.

## Acceptance evidence

Run:

```text
npm run test:seller-product-revisions
```

The workflow test covers portal isolation, seller row ownership, CSRF, one-pending protection, preservation of the live listing, Admin moderation, atomic approval, safe rejection, optimistic concurrency, replay denial, and audit evidence.

## Subsequent completed increments

- Moderated store identity management is delivered and documented in `SELLER_STORE_PROFILE_INCREMENT.md`.
- CSV preview/import with validation, row-level errors, explicit confirmation, and Admin moderation is delivered and documented in `SELLER_CATALOG_IMPORT_INCREMENT.md`.
- The fail-closed seller catalog-connection control plane is delivered and documented in `SELLER_CATALOG_CONNECTION_CONTROL_PLANE_INCREMENT.md`.

## Intentionally gated

- Product image/video upload remains disabled until private object storage, presigned upload, signature validation, malware scanning, metadata removal, processing, retention, and signed delivery are configured.
- Live seller API synchronization remains disabled until official contracts, seller consent/revocation, secret-manager credentials, scopes, quotas, webhooks, mapping rules, media rights, conflict ownership, deletion behavior, and reconciliation are approved and implemented. Imported products and synchronized changes must enter the existing Admin moderation boundary.
- Seller payout, commission, reserve, and settlement automation remains disabled until the owner supplies approved commercial, legal, tax, refund, and reconciliation rules.
