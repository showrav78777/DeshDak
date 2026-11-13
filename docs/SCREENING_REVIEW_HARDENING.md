# Screening decision hardening — 13 November 2026

## Server behavior

Admin and Compliance screening decisions now recheck ACTIVE account, current
session, expected portal, current role grant, MFA and expiry inside the saving
transaction. The verified server session ID and route's fixed portal are passed
to the service; request JSON cannot choose either. Account/session/grant locks
protect authorization while the screening version/status, catalog effect and
success audit commit. Access changes return the existing 403 code and a minimal
`compliance.screening_review_denied` audit without changing the screening.

Current-state lookup now occurs in that transaction. Existing not-found, state
and version conflicts remain 404/409. Competing decisions still have one winner.
Exact-retry, hard-block and publication/rescreen policy are unchanged. No provider
I/O, schema migration, credential change or production activation was added.

## UI behavior

Both portals share the hardened decision form. Controls are disabled before
hydration and while saving/refreshing, with a synchronous duplicate-request guard.
Requests have a bounded timeout. A success response must identify the requested
screening and chosen outcome before refreshing the queue. Aborted, non-JSON and
malformed-success responses show an accessible recovery alert and restore usable
controls. An unconfirmed decision instructs the operator to refresh and review the
case before retrying. Backend version checks remain authoritative.

## Acceptance

Three suites passed together in one disposable local PostgreSQL environment:
`test:screening-review-authorization`, `test:compliance-portal` and
`test:identity-review-authorization`. Ten controlled HTTP races cover revoked
session, removed grant, cleared MFA, pending account and expired session in both
Admin and Compliance. Denied cases retain version/status/reviewer and write one
denial audit without success audit. Wrong portal/origin/customer, missing record,
stale version and a cross-portal concurrent decision pair are also checked.

Browser cases exercise both portals at 390px and 1440px: aborted/HTML/empty-success/
wrong-record responses, no-JavaScript disabled controls and valid real decisions
held busy until RSC refresh removes the completed card. Responses are simulated
only for deliberate failure cases; normal HTTP/database mutations are real.

The existing `test:restricted-goods` passed separately, verifying real manual review
and approved exact retry, atomic publication withdrawal/restoration, hard-blocked
checkout, rule activation/scheduling/expiry maintenance, revocation, audit and
customer-response privacy. Both disposable runs removed their schemas/containers;
no owner DB, real customer evidence or external provider was used.

Logs: `/tmp/deshdak-screening-review-20261113.log` and
`/tmp/deshdak-restricted-goods-regression-20261113.log`. The SQA selection now has
40 suites; this is not a complete40 acceptance. The earlier complete39 run remains
historical acceptance. Dependency, production integration, cloud/device and
independent security release gates remain unchanged.

Lint, TypeScript, production build, 306-operation API contract, security regressions
and dependency integrity passed. Build evidence:
/tmp/deshdak-screening-review-build-20261113.log. No dependency or release gate
was weakened.
