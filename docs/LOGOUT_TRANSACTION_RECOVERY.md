# Logout transaction correction — 23 October 2026

## Observed defect and scope

The combined 56-case browser run passed every test but failed global cleanup: an authenticated logout returned HTTP 500 because its interactive Prisma transaction expired after 5 seconds. The three writes do not depend on each other's returned data, so application scheduling/round-trip delay need not be inside an interactive callback.

Logout now submits session revocation, immutable audit creation, and user-activity creation in a single Prisma batch transaction. The activity helper returns the underlying lazy Prisma promise; existing awaited callers retain the same behavior. Successful response/cookie expiry occurs only after commit. No blanket retry, success-on-error, transaction-timeout increase, audit bypass, schema change, or authorization change is included. Relevant authority: RBAC/Security, Testing Strategy and the local development process.

## Deterministic regression

`test:logout-atomicity` refuses to run outside a loopback host and a generated `crossly_launch_verify_*` schema. It creates one synthetic customer and a narrowly scoped temporary database trigger matching only that customer's logout audit. An injected audit error must roll back all writes and must not expire the cookie. A subsequent six-second database delay exceeds the former timeout and must still commit revocation plus exactly one audit and one activity event. The revoked token cannot access the account; repeat logout must not duplicate evidence. Trigger/function and fixture cleanup are followed by schema removal by the isolated wrapper. The deliberate HTTP 500 in this test is expected fault injection, not a passing claim about a real outage.

Targeted ESLint, TypeScript, production build, guarded logout atomicity, session-management and auth-recovery checks passed. The latter verifies encrypted delivery, email verification, one-time reset, session revocation, and anti-enumeration using disposable data, not a live email provider.

The default launch-candidate runner includes the fault-injection gate only for a generated isolated schema. Non-isolated runs explicitly report that it was not run; the test script itself independently rejects non-loopback/non-generated targets before any mutation. This does not relax the existing dependency audit security gate.

Verification used the existing Playwright 1.64.1 test image with exact changed source files mounted read-only. A build started downloading a different upstream base-image digest and was stopped; no unrelated container-base update was applied. Production build was checked locally against the changed source. The first 56-case report is retained in `playwright-report-full-review/` and `test-results-full-review/`; its teardown error means that run is not an overall pass.

The post-fix combined run passed all 56 cases in 461.20 seconds with zero failures, errors, or skipped cases. Global logout teardown and auth-state cleanup passed. Post-run checks also verified immutable supplier evidence, two-parcel receipt history, lost-response inspection identity, concurrent receipt uniqueness, correction approval, capacity rejection, and a single balanced synthetic wallet settlement. The disposable schema was removed. Passing HTML/JUnit reports are in `playwright-report-full-final/` and `test-results-full-final/`. This is acceptance of the configured regression suite, not every route/state or the full launch-candidate gate set; the latter was not run end-to-end in this increment.

Remaining boundaries: full manual page/device review and production load/security acceptance are not established by these tests. The known unpatched development-only dependency advisory remains open and the npm audit gate remains unchanged.
