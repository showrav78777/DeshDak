# Authentication and human-verification plan

## Available sign-in methods

The target login options are email/password, phone OTP, Google, and Facebook. Each identity is linked to one internal user ID, roles, audit history, and account status. Provider secrets never go to the browser.

## Human verification

Cloudflare Turnstile protects registration, password login, seller onboarding, OTP requests, and password reset. The server validates every token and fails closed in production. Tokens are never trusted only because a widget appeared in the browser.

Set these before production: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME`.

Production request identity also requires `TRUSTED_CLIENT_IP_HEADER` and an independent `TRUSTED_PROXY_SHARED_SECRET`. The approved ingress must strip caller-supplied forwarding/proof headers, inject the verified client address and proxy proof, and prevent direct access to the application origin. Without valid proof, authentication and anonymous AI throttling use a fail-closed shared `unknown` bucket.

## Before social and phone login are enabled

1. Register official Google OAuth and Facebook Login applications, including production redirect URLs and allowed domains.
2. Choose a Bangladesh-capable SMS/OTP provider and obtain its production account, sender ID, templates, delivery reports, and abuse limits.
3. Store all client secrets in the deployment secret manager, not `.env` committed to source control.
4. Configure redirect URLs, key rotation, account-linking rules, privacy notices, and support recovery procedures.

## Additional controls

- HTTP-only, secure, same-site session cookies.
- Password hashing with bcrypt cost 12; no passwords in logs.
- Role checks run on the server; UI visibility is never authorization.
- Audit logs for sensitive admin actions.
- Database-backed per-IP and per-account rate limiting now protects password login, verification-link requests, password-reset requests, and token confirmation.
- Email verification and password reset now use high-entropy, hashed, expiring, single-use tokens. Reset completion revokes every active session and invalidates every outstanding identity token.
- Security-email link payloads are encrypted at rest in the delivery queue using `AUTH_OUTBOX_ENCRYPTION_KEY`; neither the raw token nor the action URL appears in user-visible notification content, Admin, logs, or public APIs.
- Self-service password reset is deliberately unavailable to Admin, Finance, and Compliance identities. Privileged recovery requires the separately reviewed identity-verification and two-person recovery procedure.
- Authenticated customers can review their 25 most recent browser/mobile sessions and remotely revoke one or all other active sessions. The API enforces user ownership, protects the current browser from accidental remote revocation, immediately rejects revoked cookies, and records audit/activity history. Session records retain a readable client label plus keyed IP/user-agent fingerprints; raw IP addresses, cookies, JWTs, and full user-agent strings are not exposed through the API or UI.
- MFA is implemented for administrators. Finance/Compliance role separation and mandatory MFA must be completed when those portals and roles are activated.
- Expired security-link payloads, retained security-token rows, stale hashed rate limits, expired MFA enrollments, and expired inventory reservations now have a bounded, overlap-protected cleanup job with Admin configuration and run history. Production still requires the external scheduler and secret-manager configuration recorded in `idea.txt`.
- Google customer OAuth is implemented with signed state, PKCE, nonce and ID-token verification. It remains deliberately disabled until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are supplied through deployment secrets and the exact callback URL is registered. A Google identity is never silently linked to an existing password account.
- Customer phone verification is implemented as a rate-limited, single-use SMS challenge and is required with identity verification before order creation. The SMS provider remains disabled in production until its server-side credentials, sender, delivery reporting, and abuse limits are approved.
- Facebook, phone OTP, production email delivery, and mobile refresh-token rotation remain external/later integration work.
