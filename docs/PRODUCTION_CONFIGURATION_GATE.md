# Production configuration gate

## Outcome

Crossly now refuses to start through `npm start` unless the production environment passes a single fail-closed configuration check. Development remains available through `npm run dev` and does not require production provider credentials.

## Enforced controls

- `DATABASE_URL` must be a valid non-local PostgreSQL URL and cannot contain the documented development credential or a placeholder.
- `APP_BASE_URL` and `AUTH_ISSUER` must be clean, matching HTTPS origins on a non-local hostname.
- `AUTH_SECRET` and `MAINTENANCE_JOB_SECRET` must be non-placeholder values of at least 32 characters.
- `AUTH_OUTBOX_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` must each decode to exactly 32 bytes from canonical base64.
- Authentication, MFA, outbox, maintenance, and optional initial-setup secrets must be independent.
- Turnstile public key, secret key, and expected hostname are mandatory; the hostname must match the application origin.
- The client-IP header and an independent proxy-to-origin proof secret are mandatory. Production ignores forwarded IP headers without valid proof and the ingress must strip caller-supplied copies.
- Google, Facebook, and SMS settings cannot be half-configured; each optional credential pair must be complete.
- External payment adapters remain disabled until a real hosted-checkout adapter, signed webhook handling, refunds, reconciliation, and sandbox/UAT certification exist.
- Validation output names failed settings but never prints their values.

## Commands

- `npm run test:production-config` runs isolated regression cases with synthetic values.
- `npm run config:production:check` validates the current shell/secret-manager environment as production-ready.
- `npm start` runs the same gate before starting Next.js.
- `npm run verify:launch` includes the regression suite but intentionally does not certify real credentials or external providers.

## Owner and platform work still required

Provision the real values in a deployment secret manager, restrict runtime access, audit access, define rotation/recovery procedures, and use environment-separated values for staging and production. Infrastructure must separately enforce TLS to PostgreSQL, private networking, direct-origin blocking, ingress header stripping/injection, least privilege, WAF/rate limits, monitoring, backup/restore, rollback, and provider certification.
