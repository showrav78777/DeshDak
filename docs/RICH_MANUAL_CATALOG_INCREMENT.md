# Rich manual catalog increment

## Operating decision

Crossly is the seller's customer-facing storefront and commerce workspace. Bangladesh sellers can author products directly in Crossly or, in a later connector increment, import and synchronize catalog data from an authorized API. Customers are never redirected to a seller website to browse, order, pay, track, claim or request support.

## Delivered in this increment

- Rich provider-neutral product fields for summaries, highlights, brand/model, MOQ, production lead time, selling units, package contents, samples, customization, return information and warranty information.
- Server-calculated catalog completeness score.
- Secure product-media metadata with scan states and Crossly-controlled storage keys. Direct public URLs are deliberately absent.
- Expanded seller web form and immutable audit metadata identifying manual submission.
- Expanded public `/api/v1/catalog/products/{productId}` response with only approved, public-safe data.
- Richer product-detail page with commerce facts, progressive information sections and clear Crossly storefront language.
- Database verification for completeness, product terms, variants and media metadata.

## Intentionally gated

Seller image/video upload remains disabled until object storage, presigned upload, MIME/signature validation, configurable limits, malware scanning, metadata removal, transcoding and signed delivery are configured. External seller and international catalog APIs remain disabled until written rights, official API contracts, scopes, credentials and display/retention permissions are supplied.

## Acceptance checks

- Products remain private until Admin approval.
- Public data does not expose provider identity, raw snapshots, secrets, storage keys or seller-only economics.
- Seller terms are validated on the server, including lead-time ordering and in-stock MOQ versus available inventory.
- The website and future Flutter clients receive the same provider-neutral versioned catalog contract.
