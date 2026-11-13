# Compliance rule controls — 13 November 2026

## Fixed behavior

Rule creation and status changes now recheck ACTIVE Admin account, current
session, Admin portal/grant, MFA and expiry inside the mutation transaction.
Account/session/grant locks protect these checks. Changed access writes a minimal
`compliance.rule_change_denied` audit and returns the existing 403 without creating
or changing a rule. Caller identity/session come only from verified authentication.

Status changes lock the rule before reading current state, effective dates and
version. An additional authorization check after that wait catches natural session
expiry while waiting for the lock. Archived rules cannot be revived by supplying a
new version while a concurrent archive is committing; expired windows cannot be
activated using a pre-wait snapshot. Existing 404/409 codes, scheduling behavior,
version increments, public catalog rescreen and atomic success audit remain.
No schema, provider activation, policy rule or credential changed.

Create/status controls are disabled until hydrated and while saving/refreshing.
Duplicate in-flight calls are guarded synchronously. Requests are bounded, success
payloads are checked against the requested code/record/status/version, and network/
JSON/malformed-success failures restore usable controls with accessible recovery
messages. Unconfirmed creates preserve inputs. A successful create resets through
the captured form element rather than reading `event.currentTarget` after await.

## Acceptance

The final disposable run selected rule controls, restricted-goods and screening
review suites. Rule controls cover ten in-flight create/status authorization races,
archiving with a guessed newer version, effective-window expiry during a rule
lock wait, and natural session expiry during that wait. Denied changes retain
draft/version and create no success audit. Browser cases at 390/1440px cover aborted,
HTML, empty-success and mismatched-record responses, retained create values,
disabled no-JavaScript controls, real draft creation/reset, creation pending through
held queue refresh, and actual activate/pause/archive lifecycle.

The existing restricted-goods suite exercises scheduled activation/expiry,
publication withdrawal/restoration, exact approved retry, checkout hard block,
role separation, access revocation and customer privacy. Screening review retains
its access-race and mobile/desktop regression coverage. Synthetic policy data only;
no real policy was deployed, owner database touched or external provider called.

Evidence: `/tmp/deshdak-rule-controls-final-20261113.log`. Initial targeted evidence
before the added natural-expiry case is `/tmp/deshdak-rule-controls-20261113.log`.
The runner now selects 41 suites; this is not a new full41 acceptance. The previous
complete39 acceptance remains historical. Production/dependency/provider/cloud/
device and independent security release gates remain separate and unresolved.

Final lint, TypeScript and production build passed. The 306-operation API contract,
security regressions and dependency integrity also passed for this increment.
Build evidence: /tmp/deshdak-rule-controls-build-final-20261113.log. No release
gate was waived.
