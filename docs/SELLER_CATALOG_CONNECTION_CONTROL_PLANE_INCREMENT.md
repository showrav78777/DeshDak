# Seller Catalog Connection Control Plane Increment

## Business outcome

Approved Bangladesh sellers can request a provider-neutral, read-only catalog API connection from the Seller web application. Administrators can review ownership, scope, API documentation, data-use rights, media rights, security readiness, and a secret-manager reference from the Admin web application. A seller can correct a returned request or revoke consent.

This increment does not fetch, import, synchronize, publish, or delete products. Every external connection remains fail-closed until the official API contract and a reviewed production adapter exist.

## Governing requirements

- The latest owner request permits sellers to add products directly or through an authorized API while customers remain inside Crossly.
- `Final_Consolidated_Master_Architecture_v2.0.docx` requires backend-only adapters, normalization, secret management, controlled failure, and configuration-led providers.
- `13a_SOURCING_INTEGRATION_SPEC.docx` requires secret references, capabilities, quotas, retries, health, reconciliation, and provider isolation.
- `Crossly_Product_Catalog_Deep_Research.docx` requires seller ownership proof, narrow read-only scopes, consent and revocation, staging/moderation, provenance, deletion handling, webhook/reconciliation controls, and no arbitrary crawling.
- `AGENTS.md` requires versioned mobile-safe APIs, server authorization, audit evidence, browser-managed configuration, provider-neutral public surfaces, and disabled external supplier APIs until approved.

## Implemented scope

### Seller workflow

- Seller page: `/seller/integrations`
- API collection: `GET|POST /api/v1/seller/catalog-connections`
- Resubmission: `PATCH /api/v1/seller/catalog-connections/{connectionId}`
- Revocation: `POST /api/v1/seller/catalog-connections/{connectionId}/revoke`
- Approved Seller role and Seller portal are required.
- Sellers provide the system name, public HTTPS API URL, optional documentation URL, authentication method, requested catalog capabilities, approximate product count, preferred interval, and an explanatory note.
- Explicit versioned consent is required on creation and resubmission.
- Only requests returned as `CHANGES_REQUESTED` can be edited.
- Revocation is ownership-scoped, version-checked, idempotent, and immediately removes the stored adapter key, secret reference, and readiness approvals.

### Administrator workflow

- Admin page: `/admin/seller-integrations`
- Admin API list: `GET /api/v1/admin/seller-catalog-connections`
- Admin review: `PATCH /api/v1/admin/seller-catalog-connections/{connectionId}`
- The Admin can request changes, reject, or save safe configuration.
- Safe configuration requires a reviewed adapter key, a `secret://` reference, data-use approval, media-rights approval, security approval, and a review note.
- Raw credentials are never accepted. The complete secret reference is redacted from responses and rendered pages.
- There is deliberately no `LIVE` state, activation endpoint, synchronization button, remote health check, webhook receiver, or scheduled import in this increment.

## State model

```text
PENDING_REVIEW -> CHANGES_REQUESTED -> PENDING_REVIEW
PENDING_REVIEW -> CONFIGURATION_SAVED
PENDING_REVIEW -> REJECTED
any non-revoked state -> REVOKED
```

All review and resubmission changes use optimistic `version` checks. A revoked record is terminal. `CONFIGURATION_SAVED` means only that configuration evidence was recorded; activation remains locked.

## Security and privacy controls

- Seller ownership, role, portal, approval, state, and version checks are enforced in server APIs.
- Browser mutations require a same-origin request.
- API and documentation URLs require external HTTPS, reject credentials, unsafe ports, private/local/reserved IPv4 literals, local suffixes, IPv6 literals, and API-base query/hash content.
- The future controlled HTTP client must repeat DNS and redirect checks because intake validation alone cannot prevent DNS rebinding.
- Internal adapter and secret metadata are absent from Seller and public responses.
- Admin responses redact the configured secret reference.
- Public catalog APIs expose no seller connection metadata.
- Lifecycle transitions are audited, and Admin decisions generate seller notifications.
- The database enforces bounded product counts, bounded synchronization intervals, uniqueness per seller/system key, and consistency between `REVOKED` and `consentRevokedAt`.

## Verification evidence

- Prisma schema validation and client generation passed.
- All 30 migrations passed clean deployment, drift, seed, repeat-deploy, and cleanup verification.
- `test:seller-catalog-connections` passed authorization, portal, ownership, origin, URL, duplicate, consent, review, version, redaction, public privacy, revocation, notification, and audit checks.
- `test:seller-catalog-imports`, `test:seller-store-revisions`, and `test:admin-shell` passed as regressions.
- ESLint and TypeScript passed.
- OpenAPI generation and verification passed with 190 documented operations.
- The final Next.js production build passed with 129 generated routes/pages; authenticated Seller and Admin page rendering was exercised by the end-to-end workflow test.

## Explicitly out of scope and blocked

The following cannot be truthfully implemented or activated until the owner supplies approved external dependencies:

- Official seller API contract, commercial permission, scopes, rate limits, pagination, and sandbox.
- Production secret manager and credential rotation policy.
- Reviewed adapter implementation and canonical field mapping.
- Controlled outbound HTTP client with DNS resolution checks, redirect revalidation, timeouts, retry/backoff, circuit breaker, quotas, and egress restrictions.
- Product/variant/media normalization, immutable provenance, source-owned versus Crossly-owned field policy, and seller-selectable product scope.
- Secure image/video pipeline with rights evidence, malware scanning, metadata removal, private storage, transcoding, and approved delivery.
- Staged sync preview and reconciliation into the existing product-revision/Admin moderation workflow.
- Signed webhooks, replay protection, scheduled reconciliation, deletion-to-`SOURCE_REMOVED`, health monitoring, alerts, pause/disconnect operations, and incident runbooks.
- Production load, penetration, failure, revocation, and recovery testing.

These gates are also recorded in `idea.txt`. No customer or seller interface represents the connection as live.

## Owner handoff

1. Seller opens Seller dashboard → **Catalog API connections**.
2. Seller submits only official API metadata and consent; no credential is pasted.
3. Admin opens Admin → Sourcing → **Seller catalog APIs**.
4. Admin requests corrections, rejects, or records a reviewed adapter key and production secret-manager reference with all three approvals.
5. The record displays `CONFIGURATION_SAVED`, while synchronization remains locked.
6. Seller may revoke consent at any time; Crossly clears configuration readiness immediately.
