# Support creation replay ownership — 25 October 2026

## Scope and requirements

The customer support review found that POST /api/v1/tickets replayed an existing
global idempotency key before checking its customer owner. Another signed-in
customer possessing that key could receive ticket ID, reference and status.
The governing RBAC/security specification requires customer-owned rows and audited
sensitive denials. This increment fixes that boundary only; it does not certify
all support forms, business-only roles or support UI/mobile states.

## Correction

The endpoint selects customerId internally and compares it with the authenticated
user before returning a replay. A foreign owner receives generic HTTP 409
IDEMPOTENCY_KEY_CONFLICT, with no ticket ID/reference, and a ticket.access_denied
audit records operation ticket.create.replay. Same-owner replay returns an explicit
ID/reference/status DTO, never the internal customerId. Existing portal/origin
checks, creation transaction and schemas are unchanged; no migration is required.

## Verification

An added regression in scripts/verify-support-workflow.mjs first failed against
the unmodified cached endpoint: the foreign customer's POST returned 200 and the
assertion reported "Another customer replayed a private ticket creation key."
The baseline isolated schema was removed after failure.

The corrected endpoint then passed the full existing support workflow script in
a fresh isolated schema. Assertions verify same-owner replay, foreign-owner 409,
no ticket ID/reference in the conflict response, exactly one ticket for the key
and exactly one denied-access audit for the foreign actor. Existing assignment,
portal/row boundaries, internal-note privacy, message payload-bound idempotency,
resolution/reopening, satisfaction, quality-review, workforce capacity and safe
role/session revocation checks passed too. These are API/database/server-page
checks, not browser interaction or notification-provider delivery acceptance.

Targeted ESLint, TypeScript, production build and diff checks passed. The run used
the cached Docker image with read-only overlays of the endpoint and regression
script, explicit isolated Webpack dev runtime and disposable PostgreSQL. Both
schemas, containers, tmpfs database and network were removed. No owner data, live
provider or production configuration was changed. This script emits console
evidence, not a new Playwright HTML/JUnit report. The prior 69-browser-case pass
predates this endpoint correction and was not rerun here.

## Remaining review

Ticket creation still does not bind same-owner replay to the original payload;
that requires a separate compatibility/data-history design and regression.
Concurrent creation conflict/retry behavior is not covered by this new check.
Several support forms need readiness, uncertain-save recovery and accessible
desktop/mobile review. Business-only customer roles remain a cross-route/API
compatibility task. These gaps are not marked complete by this security fix.

## Support creation UI recovery — 25 October 2026

TicketCreateForm now disables its labelled controls before hydration/while pending,
uses a synchronous duplicate-submit guard and a 15-second same-origin request with
redirect rejection, catches network/JSON/unconfirmed-success errors and always
releases pending state. Failed submissions retain entered fields. Unchanged retries
reuse an in-memory key; changed payloads get a new key. Only a UUID ticket response
navigates to a fixed local support detail path. No automatic retry, persisted draft,
cross-reload key guarantee, upload activation or server API/schema change was added.

Five targeted cases (three setup, desktop and mobile) passed in 32.541383 seconds
with zero failures/skips/errors. They exercise network abort, malformed JSON,
unconfirmed success, unsafe returned ID, validation error, preserved inputs,
unchanged/changed keys, synchronous duplicate submission, disabled POST no-JS forms,
375px/1440px creation/detail width checks and successful local navigation. A real
server creation followed by deliberately aborted client response is retried; one
ticket, initial message, event and creation audit remain. Post-browser persistence
checks and global session cleanup passed. Elapsed-time expiry was not separately
tested. API access boundaries remain covered by the preceding workflow regression.

HTML/screenshots: `playwright-report-support-create/`; JUnit:
`test-results-support-create/junit.xml`. The earlier successful run before explicit
form screenshots is retained as `playwright-report-support-create-initial/`.
Creation/detail screenshots were inspected at both widths: labels and error/help
content wrap and the forms fit. Full-page captures show sticky/floating navigation,
install and Reels/AI controls at capture positions; they do not establish unobscured
keyboard/real-device interaction. Those overlays require a dedicated viewport review.
No broad mobile visual sign-off is claimed.

Targeted lint, TypeScript, production build and diff checks passed. Cached Docker
image plus read-only current-source overlays, explicit isolated Webpack runtime,
synthetic accounts and disposable PostgreSQL were used. Schemas, containers, tmpfs
database and network were removed after report export. The expanded combined suite
is 71 cases and has not run together after this increment. Staff reply/actions,
support login/logout, satisfaction and Admin support forms still need UI recovery
review; same-owner server payload binding and business-role compatibility remain open.

## Customer replies and assigned staff notes — 25 October 2026

TicketMessageForm now uses readiness and synchronous pending guards, disabled
controls and POST fallback, a bounded 15-second same-origin request with redirect
rejection, explicit uncertain-save feedback and a finally reset of pending state.
Text and internal-note selection survive failed requests. A matching UUID plus
valid createdAt is required before resetting the form and announcing "Message
saved." Unchanged retries retain the existing in-memory idempotency key. No API,
authorization or attachment-storage change was made; this does not promise key
retention across reloads or provider notification delivery.

Five targeted cases (three setup and two desktop/mobile cases) passed in 29.777866
seconds with zero failures/skips/errors. Both customer reply and assigned staff
internal note were tested for abort, malformed JSON, unconfirmed payload and 422
recovery, preserved fields/checkbox, no-JS disabled POST controls, duplicate-submit
blocking, and real server commit followed by deliberately lost response and retry.
Each ticket retained exactly three messages (initial, customer reply, private note)
and two lifecycle events. Post-browser checks confirmed one customer-reply audit
and one internal-note audit. Customer JSON contained only two public messages and
no private-note text; assigned staff JSON contained the private note. This is not
a new test of unassigned staff/Admin access or a public staff reply.

The first attempt passed all five cases but failed global logout cleanup with
"Manifest file is empty" and HTTP 500. Its report is retained at
`playwright-report-support-reply-cleanup-failure/`. An unchanged rerun passed global
session cleanup and post-browser database checks; no assertion or deadline was
weakened. The intermittent development-manifest root cause remains unresolved.
Final evidence: `playwright-report-support-reply/` and
`test-results-support-reply/junit.xml`. Staff desktop/mobile screenshots were
inspected; fields, success feedback and private-note styling fit the tested widths.
Real devices, keyboard/overlay behavior and complete page visual acceptance remain
open. Screenshot capture can precede the final server refresh; saved evidence is
verified separately through authenticated APIs and database assertions.

Targeted lint, TypeScript, production build and diff checks passed. Disposable
schemas, containers, tmpfs database and network were removed after report export.
Owner data and live providers were not used. The expanded combined suite is now
73 cases and has not run together. Support actions, satisfaction, login/logout and
Admin support forms remain separate recovery/UI review work.

## Satisfaction feedback recovery — 25 October 2026

SupportSatisfactionForm now guards readiness/pending submissions, disables answers
while saving, uses POST fallback and bounded same-origin requests with redirect
rejection, and preserves answers after network/JSON/unconfirmed/validation errors.
Unchanged answers reuse an in-memory retry key; changed answers get a fresh key.
The returned rating must have a UUID and match score, resolved flag and normalized
comment before success. Confirmed submission immediately replaces the form with a
saved status while the server refreshes, respecting the immutable-feedback UI.
No server/API/schema or delivery-provider changes were made.

Five targeted setup/desktop/mobile cases passed in 32.248208 seconds with zero
failures/errors/skips. Coverage includes real ticket creation and assigned-agent
resolution, disabled no-JS POST controls, required low-score/unresolved comment,
four failure modes with retained choices/comment, stable/changed keys, synchronous
duplicate-submit blocking, real commit/lost response/replay, immutable second-save
409, persisted summary/reload and 375px/1440px form width checks. Post-browser
checks confirm one immutable rating, one audit and one follow-up notification
record per active Admin. This verifies in-app records, not email/push delivery.
High-score/optional-comment UI and elapsed-time expiry are not separately tested.

Evidence: `playwright-report-support-feedback/` and
`test-results-support-feedback/junit.xml`. Error-state form screenshots were
inspected at both widths. Inputs/feedback wrap and fit; sticky/floating controls
appear at capture positions, so keyboard/overlay/real-device acceptance remains
open. No complete visual redesign or accessibility audit is claimed.

Global session cleanup, database integrity checks, targeted lint, TypeScript,
production build and scoped diff checks passed. The isolated schema, containers,
tmpfs database and network were removed after export; owner data/live providers
were not used. The combined suite is now 75 cases and has not run together.
Support actions, login/logout and Admin support UI recovery, business-only roles
and the intermittent development manifest issue remain open.

## Staff action confirmation/recovery — 25 October 2026

TicketActionControls now explains choose → reason → confirm, disables other
actions while a confirmation is open, shows pending priority/agent targets, and
uses readiness/synchronous submission guards. Confirmation uses POST fallback,
bounded same-origin PATCH with redirect rejection and recoverable errors retaining
the operational note. Success requires the same ticket, exactly next version and
action-specific status/priority/assignment evidence. A successful response locks
old-version controls until refreshed props arrive. Uncertain updates instruct
reload/history review; they are not automatically retried. Server authorization,
version guards and state-machine rules were unchanged.

Five targeted setup/desktop/mobile cases passed in 59.083369 seconds, with zero
failures/skips/errors. They verify disabled no-JS controls, cancellation without
mutation, four response/network failures preserving the note, one confirmation
at a time, duplicate-submit blocking and a real resolution commit followed by a
lost response. Retrying the stale version returns 409; reload reflects resolution.
The UI then performs reopen, priority HIGH, escalation URGENT, wait for customer,
resolve and close. Each ticket ends CLOSED/URGENT/version 8 with eight events;
database checks confirm exactly two resolution audits and one each for the other
five actions, without duplicate evidence from the uncertain retry.

HTML/screenshots: `playwright-report-support-actions/`; JUnit:
`test-results-support-actions/junit.xml`. Desktop/mobile error-state confirmations
were inspected and fit 1440px/375px widths; mobile confirm/cancel stack. Existing
sticky header/capture positions and real-device keyboard/focus/touch acceptance
remain separate review work. No complete accessibility sign-off is claimed.

Session teardown, post-browser database checks, targeted lint, TypeScript,
production build and diff checks passed. The isolated schema, containers, tmpfs
database and network were removed after export; no owner data/live providers used.
Claiming unassigned tickets, Admin reassignment/oversight, role-revoked/stale-multi-
agent scenarios and elapsed timeout need further UI coverage. This increment does
not fix the intermittent manifest issue. Support login/logout and Admin support
forms remain open. The combined suite is 77 cases and has not run together.

## Support authentication recovery — 25 October 2026

SupportLoginForm now uses explicit POST fallback, readiness-disabled credentials,
synchronous pending guards and bounded same-origin requests with redirect rejection.
Network/JSON/unconfirmed/rejected responses release pending state and show clear
feedback. Navigation requires a signed-in support-role response and UUID session;
the password input is cleared only after confirmation. Credentials are not copied
to persistent storage or logs. SupportLogoutButton now reports errors rather than
failing silently, guards readiness/duplicate requests, bounds the request and
requires loggedOut:true before navigating to the fixed local homepage. Server
authentication, session policy, CAPTCHA and logout transactions were unchanged.

Five targeted setup/desktop/mobile cases passed in 34.877817 seconds, with zero
failures/errors/skips. They cover no-JS disabled POST login, four failure modes for
login and logout, retained credential-field presence (boolean assertion only),
duplicate-submit blocking, real login/authorized queue, disabled no-JS logout,
real logout, copied pre-logout session rejection and protected-queue redirect to
sign-in. Queue width checks passed at 375px/1440px. This is not visual, real-device,
cookie-attribute, expiry or production CAPTCHA/provider acceptance. Authentication
traces and screenshots were disabled; final test-results contain JUnit only.

Initial evidence at `playwright-report-support-auth-initial/` records a desktop
redirect assertion failure: the real homepage cold development render took 13s,
exceeding the existing 10s navigation assertion. Global logout cleanup also failed
with JSON.parse "Unexpected end of JSON input"/HTTP 500, consistent with the
previously tracked development-manifest failures but not a proven common root cause.
The auth test now first performs a read-only GET of the real homepage to isolate
auth behavior from cold compilation. No destination mock, assertion bypass or
deadline increase was added. The warm-run pass does not resolve cold-render latency
or the intermittent cleanup defect.

Final reports: `playwright-report-support-auth/` and
`test-results-support-auth/junit.xml`. Global session revocation/state-file cleanup,
post-browser database checks, targeted lint, TypeScript, production build and diff
checks passed. Isolated schemas, containers, tmpfs database and network were removed
after report export; owner data and live providers were not used. The combined
suite is now 79 cases and has not run together. Admin support forms, business-only
account compatibility, overlay/keyboard review and runtime reliability remain open.

## Admin workforce settings recovery — 25 October 2026

SupportAgentProfileForm now guards readiness/duplicate saves, keeps the disclosure
inert before hydration and disables controls until ready/while pending. Bounded
same-origin requests reject redirects and recover from failed/malformed/unconfirmed
responses without losing entries. Confirmation checks agent ID, next version and
every normalized setting, including deduplicated languages and a nullable trimmed
status note. Saved-version controls remain locked until refreshed props arrive.
The form explains that existing assignments remain assigned. No server schema,
capacity/assignment rule, role/MFA rule or API contract was changed.

Five targeted setup/desktop/mobile cases passed in 22.832921 seconds with zero
failures/skips/errors. Dedicated Admins authenticated through normal login, a
pre-MFA denial and real TOTP enrollment/confirmation; credentials/MFA secrets were
not captured in traces. Dedicated offline agent fixtures avoid altering other
scenarios' assignments. Checks cover no-JS inert/disabled POST controls, four save
failure modes with retained capacity, duplicate submit, a real committed save with
lost response, stale retry 409, reload/persisted settings, a subsequent versioned
save, blank-note normalization and forged-Origin denial. Database assertions verify
exactly two profile-change audits, final version 3/OFFLINE/not accepting work,
capacity 4 and null note per target. New Admin sessions are included in global
revocation checks. Creating a previously absent profile and assignment impact are
not newly browser-tested here.

Retained reports: `playwright-report-support-workforce-initial/` (no-JS locator
matched both responsive copies), `playwright-report-support-workforce-readiness-failure/`
and `test-results-support-workforce-readiness-failure/` (test stalled on exact-label
selection, with teardown errors after timeout), and
`playwright-report-support-workforce-label-failure/` (shorter action deadline exposed
the Status selector). The final test scopes the visible row, explicitly waits for
disclosure readiness and uses the accessible Status combobox with an accessible-
name assertion. Per-action timeout was reduced to 10 seconds; no acceptance
assertion, MFA requirement, version/audit check or overall deadline was weakened.

Final HTML: `playwright-report-support-workforce/`; JUnit:
`test-results-support-workforce/junit.xml`. Post-auth desktop/mobile screenshots
were inspected: workforce fields and saved feedback fit 1440px/375px widths.
The desktop page retains a narrow workforce column/empty oversight area when no
tickets exist; overall dashboard density, typography, keyboard/overlay and
real-device review remain open, not certified by width checks.

Targeted lint, TypeScript, production build, scoped diff, global session cleanup
and post-browser checks passed. Schemas, containers, tmpfs database and network
were removed after report export; owner data/live providers were not used. The
expanded combined suite is 81 cases and has not run together. Admin quality review,
role grants/revocation UI, business-only roles and runtime reliability remain open.

## Admin quality review recovery — 25 October 2026

SupportQualityReviewForm now guards readiness/duplicate saves, disables fields
before hydration/while pending, uses POST fallback and bounded same-origin requests
with redirect rejection, preserves entries on failure and validates the returned
ticket/version/score/outcome/summary/coaching action before success. A non-pass
outcome requires coaching/escalation text in the UI as well as existing server
validation. Optional whitespace-only coaching text is normalized to null. Old-
version controls stay locked until refreshed props arrive. Success says only
"Quality review saved", not that an external notification was delivered. No
server authorization, review API, schema or notification-delivery rule changed.

Five targeted setup/desktop/mobile cases passed in 22.58888 seconds with zero
failures/errors/skips. Dedicated synthetic Admins used real login/TOTP confirmation
and pre-MFA denial. Dedicated resolved starting tickets are fixtures, not evidence
of a real customer resolution. Tests cover no-JS disabled POST controls, required
coaching, four save failures with retained entries, duplicate confirmation, real
creation/lost response, stale retry rejection, reload, versioned update and null
coaching normalization. An explicit stale API update returned 409 and staff review
mutation returned 403. Assigned staff HTML contained the saved summary; customer
HTML excluded it. Database checks confirm final version 2/score 4/PASS, one create
audit, one update audit and exactly two in-app agent notification records. This is
not proof of external message delivery or every private-field/access boundary.

The first attempt failed before browser tests because the synthetic initial
message lacked its required idempotency key; the fixture was corrected without
changing schema. A later exact-label selector failed on the prefilled summary;
its report is retained at `playwright-report-support-quality-label-failure/`.
The test now uses the accessible Review summary textbox. No deadlines, MFA,
privacy, stale-version or audit assertions were weakened.

Final HTML/screenshots: `playwright-report-support-quality/`; JUnit:
`test-results-support-quality/junit.xml`. Post-auth screenshots were inspected at
1440px/375px; fields/help/success feedback fit, but the narrow desktop review column,
empty scrolled content area and floating logout control remain layout/overlay
review concerns. No full visual/accessibility/device sign-off is claimed.

Targeted lint, TypeScript, production build, diff checks, global session cleanup
and post-browser checks passed. Schemas, containers, tmpfs database and network
were removed after report export; owner data/live providers were not used.
The expanded combined suite is 83 cases and has not run together. Admin role-
grant/revocation UI, broader layout, business-only accounts and the intermittent
development-manifest issue remain open.

## Assignment/revocation race correction — 25 October 2026

While reviewing role-management UI, the DELETE support-agent endpoint was found
to count active tickets before its role/session deletion transaction. A preceding
assignment could commit between that count and deletion, allowing removal despite
newly active work. The endpoint now takes the same transaction-scoped advisory
lock used by claim/assignment, reads the role and active-ticket count under that
lock, then either returns the existing missing/active error or atomically removes
the role, revokes support sessions and records the audit. Response envelopes,
Admin/MFA/origin checks and business rules are unchanged. No schema migration or
new lock namespace was introduced.

The existing support workflow script gained a deterministic regression. An isolated
database transaction holds the assignment lock; the real DELETE endpoint is queued.
The test observes a waiter for that exact advisory key in pg_locks, then creates
and commits a synthetic assigned ticket before releasing the lock. Removal must
return 409 SUPPORT_AGENT_HAS_ACTIVE_TICKETS, retaining the role and live support
session with no successful-revocation audit. The fixture ticket is then resolved
and existing later checks verify successful revocation/session invalidation.
This models a preceding assignment commit with a controlled DB fixture writer;
it is not a newly tested simultaneous browser claim or reverse-order race.

The regression failed against the cached old endpoint with "Concurrent assignment/
revocation did not serialize and preserve active-ticket ownership." With the fixed
endpoint, the full support workflow script passed, including established assignment,
messages/privacy, satisfaction, quality review, capacity, role grant/revocation,
notifications and page checks. Evidence is the script/console run, not a new
Playwright report. No timeout/guard was raised or bypassed. Advisory coordination
protects cooperating application assignment paths; direct writers that ignore the
lock are not a new database-wide invariant guarantee.

Targeted lint, TypeScript, production build and diff checks passed. Baseline and
fixed tests used fresh loopback-only generated schemas in disposable PostgreSQL;
schemas, containers, tmpfs database and network were removed. No owner data/live
providers changed. Role-grant/removal UI failure recovery remains open: this
increment prioritized its server-side race before UI work. The prior expanded
83-case browser suite has not run together or been rerun after this API correction.

## 25 October 2026 — Support-access UI recovery

The Admin grant/removal controls now use readiness and synchronous pending guards,
15-second same-origin requests with redirects rejected, response validation,
visible failure feedback and finally-based recovery. Granting requires explicit
email confirmation. Unconfirmed grants preserve the email; unconfirmed removals
tell the administrator to reload/check access before retrying. Neither operation
automatically retries a potentially committed request. Confirmed grants reset the
form; confirmed removals remain disabled while refreshed workforce data arrives.
Without JavaScript the controls are disabled and the grant form uses POST.

New isolated desktop/mobile browser cases exercise canceled grant/removal,
network failures, invalid JSON, unconfirmed success envelopes and server rejection,
retained email, real grant/reset with duplicate-submit suppression, and real
removal whose committed response is deliberately lost. The last case confirms
one DELETE, removal after reload, and 403 from the removed employee's previously
valid support session. JavaScript-disabled controls are also checked. Dedicated
targets remain offline/not accepting assignments, so they cannot alter normal
queue autoassignment. Post-test database checks require exactly one grant audit,
one removal audit, no remaining support role and revoked support sessions.

Final result: 5 targeted cases passed (3 setup, desktop and mobile), zero failures,
errors or skips, JUnit duration 29.008263 seconds. HTML/JUnit evidence is under
`playwright-report-support-roles/` and `test-results-support-roles/`; the preceding
passing run is retained with `-initial` suffixes. Lint (zero warnings), TypeScript,
production build and diff checks passed. Generated schemas and disposable
containers/tmpfs database/network were removed. No owner data/providers changed.

This does not newly certify the confirmed-success removal UI branch, real
active-ticket blocking through the browser (the UI error here is mocked; the real
server concurrency guard was verified above), or all-page visual/device behavior.
Granting is not a new idempotent API: after uncertain completion, inspect current
access rather than retry blindly. The expanded 85-case browser suite has not run
together; broader layout, dev-manifest reliability and production gates remain.
