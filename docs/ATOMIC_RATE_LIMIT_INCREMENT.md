# Atomic rate-limit reliability increment

The shared PostgreSQL security limiter now consumes each request with one atomic `INSERT ... ON CONFLICT DO UPDATE` statement. Concurrent requests for the same protected identity no longer use a read-then-write serializable transaction, removing the observed `P2034` write-conflict path while retaining durable counters, fixed windows, temporary blocks, hashed identities, and retry metadata.

Verification completed on 2026-09-09:

- TypeScript check passed.
- ESLint passed.
- Twenty simultaneous public-search requests produced one counter with exactly twenty attempts.
- Existing security regression checks passed.
- No new rate-limit serialization error appeared in the development log.

Production still requires shared managed PostgreSQL, connection pooling, capacity/load testing, monitoring, alert thresholds, and an approved ingress proxy configuration. The database limiter is the authoritative cross-instance control; CDN/WAF throttling should be an additional outer layer, not its replacement.
