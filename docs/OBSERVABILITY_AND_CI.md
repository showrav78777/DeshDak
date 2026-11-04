# Observability and CI increment

## Business outcome

Crossly can now be probed safely by deployment infrastructure, correlate a browser or mobile API request across the server boundary, record machine-readable operational events without logging sensitive request data, and enforce a repeatable quality gate in GitHub Actions.

## Scope

- A Next.js 16 Proxy validates or generates `x-request-id`, forwards it to server code, and returns it to the caller.
- `/api/v1/health/live` confirms that the application process can answer requests without depending on PostgreSQL.
- `/api/v1/health/ready` checks PostgreSQL and returns HTTP 503 with a generic response when the dependency is unavailable.
- The compatibility `/api/v1/health` endpoint points operators to the two purpose-specific checks.
- Server startup, unhandled request failures, and protected cleanup outcomes use one-line JSON logs with an allowlisted metadata shape.
- CI validates Prisma, creates an isolated PostgreSQL schema, seeds reference roles/data, runs lint and TypeScript, rejects high-severity dependency advisories, builds the production application, and runs the security/API integration suites.

## Security and privacy decisions

- Request IDs accept only 8–128 ASCII letters, digits, `_`, and `-`; invalid input is replaced with a UUID, preventing control-character log injection.
- Logs do not accept request bodies, cookies, authorization headers, tokens, email addresses, raw IP addresses, provider credentials, raw exceptions, or database error messages.
- Readiness exposes only `ready` or `unavailable`; it never returns a connection string, Prisma error, stack trace, database host, or credential.
- Health responses are `no-store` and excluded from search indexing.
- Proxy performs correlation only. Authentication, authorization, MFA, ownership, and role checks remain inside protected server handlers.
- CI uses an ephemeral PostgreSQL service and CI-only values. Production secrets must never be copied into workflow source.

## Acceptance evidence

- Prisma client generation and schema validation pass.
- ESLint and `tsc --noEmit` pass.
- `npm audit --audit-level=high` reports zero vulnerabilities at verification time.
- Observability verification passes for liveness, database readiness, request-ID propagation/replacement, no-store behavior, and response non-disclosure.
- Authentication recovery, session ownership/revocation, administrator MFA, and protected maintenance regression suites pass.
- The Next.js optimized production build succeeds.

## Spiral risk review

- **Identity/security:** Proxy is not treated as an authorization boundary; existing server checks remain authoritative.
- **Privacy:** Structured logs deliberately use a small allowlist. Adding a new field requires review before production.
- **Availability:** Liveness does not restart a healthy process merely because PostgreSQL is briefly unavailable; readiness removes an unhealthy instance from traffic.
- **Database:** Readiness runs only `SELECT 1` and performs no mutation. CI uses `prisma db push` only for its disposable database; production requires reviewed migrations.
- **Mobile API:** `x-request-id` and JSON envelopes work for browser and future Flutter clients without cookie coupling.
- **External infrastructure:** Central log storage, metrics, alerts, probes, deployment environments, backups, rollback, and production secrets remain fail-closed production prerequisites in `idea.txt`.

## Owner handoff

Use these endpoints in hosting health probes:

- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`

When reporting a failed request to support, retain the response `x-request-id`; do not send passwords, cookies, payment data, or authentication tokens.
