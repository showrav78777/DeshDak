# Security review remediation

Last verified: 1 September 2026, Asia/Dhaka

## Outcome

The two medium-severity findings from the release security review are remediated with server/client defense in depth, production fail-closed configuration, durable shared throttling, and regression coverage.

## Post-login redirect

Customer login now normalizes `next` through one shared allowlist function on both the server-rendered page and client submit handler. The function accepts only same-origin root-relative paths and rejects absolute URLs, protocol-relative values, raw backslashes, control characters, and encoded slash/backslash separators. Unsafe input falls back to `/dashboard`.

## Trusted client identity

Production no longer accepts `cf-connecting-ip`, `x-forwarded-for`, or `x-real-ip` merely because a caller supplied it. The runtime requires:

- `TRUSTED_CLIENT_IP_HEADER` set to the one header that the approved ingress controls.
- `TRUSTED_PROXY_SHARED_SECRET` set to an independent value of at least 32 characters.
- The ingress to remove caller-supplied copies of the chosen IP header and `x-crossly-proxy-secret`, then inject the verified client address plus the proxy proof before forwarding to the private application origin.

If configuration or proof is missing/invalid, production returns the non-identifying value `unknown`. This deliberately applies one shared IP bucket rather than allowing header rotation. The proxy secret is never returned, logged, persisted, or accepted from an Admin form.

Direct public access to the application origin must be blocked by network policy, firewall, or private ingress. The shared secret supplements that boundary; it is not a substitute for origin isolation, WAF controls, or proxy header stripping.

## Durable rate limiting

Anonymous text search, image search, and shopping-chat limits now use the existing PostgreSQL `SecurityRateLimit` store with keyed HMAC identifiers and serializable transactions. Counters therefore survive process restarts and are shared across horizontally scaled application instances. The security-cleanup job retains bounded counter lifecycle management.

PostgreSQL is the safe first-launch implementation. At measured higher traffic, replace the storage adapter with an approved atomic Redis-compatible limiter while keeping the same trusted-ingress identity, fail-closed behavior, quotas, cleanup, and tests.

## Verification evidence

- Same-origin redirect and trusted-ingress unit regressions pass.
- Three concurrent public searches produce one durable database counter with exactly three attempts.
- AI chat/handoff, authentication recovery, session management, CSRF boundary, production configuration, TypeScript, and ESLint checks pass.
- Both production-only and complete npm dependency audits reported zero known vulnerabilities during the review.

## External production work

The infrastructure owner must configure the ingress secret injection and stripping rules, block direct origin access, store/rotate the proxy secret in the secret manager, test the path through staging, add rate-limit/WAF monitoring, and run an independent penetration test. Code cannot prove those external controls are active.
