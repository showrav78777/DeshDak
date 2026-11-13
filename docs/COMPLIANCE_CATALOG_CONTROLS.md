# Catalog rescreen controls — 13 November 2026

## Server changes

Manual rescreens now pass the verified Admin session into maintenance. ACTIVE
account, current session, Admin portal/grant, MFA and expiry are checked under
account/session/grant locks before claiming a job, after waiting for its state row,
and again inside the transaction that changes rules/catalog. Caller JSON cannot
select the actor, session or trigger source. Scheduled execution retains its
separate protected maintenance-secret boundary.

The lease and RUNNING/SKIPPED run record are now created in one short transaction.
Run-record insertion failure rolls back the lease, avoiding an orphan lock.
An occupied valid lease still returns SKIPPED. Access lost after a valid claim
creates a minimal denial audit, performs no catalog changes, marks that run FAILED
with a fixed access-change code and releases the lease. Success audit failure rolls
back rule/catalog effects, records failure and releases the lease. Initial denial
uses the existing 403; other failures retain the existing generic 500.

Rule activation/expiry policy, catalog screening and scheduler behavior are
unchanged. No provider I/O or schema migration was added. Normal success retains
run history, and the Admin response now explicitly uses private/no-store caching.
The existing ten-minute lease and thirty-second work transaction limit remain.
Process-crash reconciliation of old RUNNING history is a separate operational
concern; this increment does not certify cloud crash/recovery behavior.

## UI changes

The manual control is disabled until hydration and while saving/refreshing, with
a synchronous duplicate guard. Bounded requests validate run ID, skipped/status
consistency and nonnegative integer catalog counts before displaying success.
Network/HTML/malformed-success responses show an accessible recovery message and
restore usable controls. Unconfirmed requests instruct Admin to refresh the saved
run status before retrying. Valid completion stays busy through queue refresh.

## Acceptance

The final owned disposable PostgreSQL run passed three suites together:
`test:compliance-catalog-controls`, `test:restricted-goods` and
`test:compliance-rule-controls`.

Catalog checks include five pre-claim access-change races, natural session expiry
during a job-state lock wait, post-claim revocation through a scoped database
trigger, claim/run insertion fault rollback, completion-audit fault rollback,
occupied lease skip and scheduler secret rejection/success. Browser cases at
390px/1440px exercise aborted/HTML/empty-success/invalid-count responses,
no-JavaScript disabled control and real completion held pending through RSC refresh.
Failures are deliberately injected; normal HTTP/database execution is real.
Existing restricted-goods policy/catalog/checkout and Admin rule lifecycle checks
also pass. Synthetic local policy data only; no owner DB or provider used.

The initial combined run passed catalog/restricted-goods but stopped in the rule
browser test because a locator matched both the transient fallback and hydrated
Admin form. It now waits for Admin navigation and scopes to visible workspace
content; no assertion or timeout was relaxed. Final schema/container cleanup passed.

Evidence: `/tmp/deshdak-catalog-controls-final-20261113.log`. Initial diagnostic:
`/tmp/deshdak-catalog-controls-20261113.log`. The SQA selection now contains 42
suites, not a new full42 acceptance. The earlier full39 run remains historical.
Production dependency/provider/cloud/device and independent security gates remain.

Lint, TypeScript, production build, 306-operation API contract, security regressions
and dependency integrity passed. Build evidence:
/tmp/deshdak-catalog-controls-build-20261113.log. No dependency/release gate was
waived and no production service enabled.
