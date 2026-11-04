# Administrator audit-log increment

## Business outcome

Crossly administrators can now review security, financial, customer, seller, sourcing, warehouse, logistics, support, and configuration evidence from one protected web page at `/admin/audit-logs`. This completes the local operational-audit viewer without depending on an external logging provider.

## Delivered controls

- Admin-only web page and versioned `GET /api/v1/admin/audit-logs` endpoint.
- Server-side search by action, entity type/reference, or actor identity; exact entity-type selection; UTC date range; bounded page size; and deterministic newest-first pagination.
- Private `no-store` API responses and Admin portal isolation.
- Recursive display-time redaction for credential, password, token, cookie, OTP, recovery, private-key, card, CVV, and PIN metadata keys.
- Metadata depth, key, array, and string limits prevent unusually large audit payloads from overwhelming the administrator page or API response.
- Database indexes support time, action/time, and entity-type/time review paths.
- The audit viewer is read-only. Existing immutable business evidence is never edited or deleted from this page.

The display redaction is a defense-in-depth boundary. Application code must still never write raw credentials or payment authentication data into `AuditLog`.

## API and future operations

The exact response and query parameters are published in `/openapi.yaml`. This endpoint remains an internal Admin capability and is not intended for the customer Flutter application. A production SIEM/logging platform remains external infrastructure work; export should later use a reviewed, least-privilege worker rather than exposing database credentials.

## Verification

Run:

```text
npm run db:generate
npm run db:deploy
npm run test:admin-audit-log
npm run test:admin-shell
npm run api:generate
npm run api:contract
npm run lint
npm run typecheck
npm run build
```

The workflow verifier proves anonymous/customer denial, Admin access, no-store delivery, filters, pagination data, actor attribution, nested sensitive-value redaction, output bounding, protected page rendering, and cleanup.
