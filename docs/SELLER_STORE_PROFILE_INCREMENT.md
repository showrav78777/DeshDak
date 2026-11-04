# Seller store-profile management increment

## Business outcome

An approved Bangladesh seller can maintain customer-facing store information inside Crossly. Proposed changes do not overwrite the approved storefront. Admin reviews the current and proposed identity, then either publishes the complete revision atomically or rejects it without changing public data.

## Delivered

- Seller store settings page at `/seller/store`.
- Versioned website/mobile-safe API at `/api/v1/seller/store`.
- Public business name, customer description, and preparation-time editing.
- Permanent store URL, origin, and international eligibility shown as protected settings rather than seller-editable fields.
- One pending proposal per store, enforced in both the service workflow and a PostgreSQL partial unique index.
- Admin moderation integrated into `/admin/sellers`.
- Admin review API at `/api/v1/admin/store-revisions/{revisionId}/review`.
- Optimistic store/revision versions and replay-safe state transitions.
- Atomic approval and safe rejection.
- Audit records for seller submission, Admin decision, and authenticated wrong-portal access attempts.
- Seller dashboard access to Store settings and the approved public store.

## Security and trust decisions

- Seller identity comes from the protected seller session. The browser cannot select a seller profile.
- Seller and Admin portal boundaries are enforced server-side; Admin review requires the MFA-authorized Admin portal.
- Browser mutations use the application-wide trusted-origin/CSRF protection.
- The approved public store is the only data read by public pages and APIs while moderation is pending.
- Store slugs are not editable after onboarding, preserving customer bookmarks, indexed URLs, and external references.
- Trade licence, NID/TIN, business address, origin, and international eligibility are excluded because they require compliance-specific workflows.
- Logo/banner inputs are not faked with public URLs. They remain gated until private object storage, signature checks, malware scanning, metadata removal, processing, retention, and signed delivery exist.

## Verification

Run:

```text
npm run test:seller-store-revisions
```

The test covers portal isolation, authenticated denial audits, CSRF, validation, no-op rejection, one-pending protection, public-data privacy, seller/Admin pages, approval, rejection, URL stability, optimistic concurrency, replay denial, and audit evidence.

## Out of scope

- Secure store logo/banner upload.
- Compliance identity/address amendment.
- International-selling suspension/reactivation workflow.
- CSV catalog import and seller API connectors.
