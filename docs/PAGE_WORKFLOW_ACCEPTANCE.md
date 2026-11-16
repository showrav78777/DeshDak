# Page-by-page acceptance scope — 22 October 2026

## Inventory and honest coverage

`node scripts/audit-page-inventory.mjs` discovers page source files without reading
secrets or connecting to a database. Current inventory: 131 pages, 104 static paths
and 27 parameterized paths requiring fixtures. Areas: 36 customer/public, 47 Admin,
2 Compliance, 6 Finance, 6 Inspector, 5 Logistics, 3 Sales, 11 Seller, 2 Sourcing,
5 Support and 8 Warehouse pages. Area is source grouping, not an authorization rule
(for example, public help and protected support tools must be tested separately).

Every inventory entry starts NOT_REVIEWED for workflow, desktop and mobile. It is
not a runtime pass list, and automated browser cases are not full page coverage.
Keep explicit evidence per route/state before marking its review complete. Static
source existence or a successful GET is not proof that its actions work.

## Required acceptance per route

- Use approved synthetic fixtures and the correct role. Verify anonymous behavior,
  wrong-role denial, row ownership/assignment and privileged MFA where applicable.
- Exercise valid actions through the UI and verify the resulting server state,
  audit and customer-safe timeline. Check invalid input, duplicate/uncertain saves,
  stale state, permissions revoked and provider-unavailable behavior.
- Review desktop and narrow mobile layouts, text wrapping, keyboard/focus, labelled
  inputs, touch targets, loading/empty/error/success states and actionable guidance.
  Review screenshots manually; absence of horizontal overflow alone is insufficient.
- For parameterized pages use owned, foreign, missing and terminal-state resources.
  Do not substitute one detail page for all resource states or roles.
- Validate downloads and privacy where provided. Do not trigger real payments,
  messages, provider purchases or production mutations during this local review.

## Execution order and gates

First stabilize the existing critical workflow regression; its recent runtime
timeouts remain a blocker. Then review customer discovery/account/checkout and
tracking, Admin operations/configuration, Seller, Warehouse/Inspector/Logistics,
Finance/Compliance, Sourcing/Sales and Support in isolated bounded batches with
fresh application processes and fixtures. Retain failing reports and fix concrete
defects before claiming that batch complete. Do not raise deadlines to hide slow
pages, bypass MFA, invent live provider evidence or certify production readiness.

The latest test-harness change retries only the read-only layout assertion during
a navigation replacement. Dispatch/receipt/approval mutations are never replayed
by that assertion. No page redesign or all-page pass is claimed by this planning
and inventory increment.

## Baseline verification — 22 October 2026

The corrected existing suite passed all 33 browser cases in 260.68 seconds with
zero failures/skips/errors using the explicit Webpack isolated runtime. Focused
Inspector, Warehouse and Ship for Me API checks and post-browser database integrity
assertions also passed. Targeted lint, TypeScript and diff checks passed. HTML/JUnit
reports were exported; disposable schemas/containers/network removed. No owner
database change. Normal development/build defaults remain unchanged. This is
increment-level baseline evidence, not 131-page acceptance or proof that prior
runtime stalls are globally resolved.

The previous comparison failed on execution-context replacement during a layout
read, not an observed overflow. Only that read is now retried within ten seconds;
all mutations retain their original execution and integrity checks. A barcode
aspect-ratio console warning remains a visual-review item; no visual defect has
yet been confirmed or fixed for it at that baseline. Full per-page desktop/mobile and workflow
review remains outstanding as described above.

## Follow-ups — 22–23 October 2026

The shared barcode layout was subsequently corrected and checked at four viewport widths and print dimensions; see `IDENTIFIER_LAYOUT_VERIFICATION.md`. Scanner retry/receipt readiness and correction-disclosure hydration safeguards were also verified in isolated targeted runs; see `WAREHOUSE_SCANNER_RECOVERY_REVIEW.md`. The historical barcode/hydration items above are not current unresolved claims for those tested components.

The expanded suite now has 56 cases. Its first combined run passed all cases but failed global session cleanup on a real logout transaction expiry; this is not an overall pass. `LOGOUT_TRANSACTION_RECOVERY.md` records the atomic batch correction, failure/delay regression and post-fix rerun status. These increments do not certify 131 pages, real-device compatibility, external integrations or production readiness. The unpatched lint dependency advisory remains an explicit launch/security gate.

The post-fix 23 October combined run passed all 56 cases and global teardown, with zero failures/errors/skips, in 461.20 seconds. Post-browser integrity/session checks passed and the disposable schema was removed. Evidence: `playwright-report-full-final/` and `test-results-full-final/`. The earlier failed reports are retained, not relabelled as passes. Manual page-by-page acceptance and the remaining production gates still apply.

The next customer-account increment corrected privacy-control request recovery and
truncated order quantities. Eight targeted setup/account browser cases passed on
23 October, including desktop/mobile and ownership boundaries. See
`CUSTOMER_ACCOUNT_REVIEW.md` for exact scope, reports and visual-review limitations.
The expanded 61-case suite has not yet been run together; these three routes are
not certified across all roles and states by this bounded increment.

The subsequent order-detail claim-window correction passed the same eight targeted
cases with six synthetic shipment states on desktop/mobile, expired API rejection
and a zero-created-RMA database assertion. See the claim-window follow-up in
`CUSTOMER_ACCOUNT_REVIEW.md`. This does not certify the entire claims workflow.

Claim-create recovery subsequently passed the eight targeted cases with mocked
network/response failures, stable retry keys and duplicate-submit blocking on
desktop/mobile. See the 24 October follow-up in `CUSTOMER_ACCOUNT_REVIEW.md`.
Message/return-tracking recovery and successful end-to-end claims remain separate
acceptance work; no full-suite or all-page pass is inferred.

On 24 October, claim-message and return-tracking recovery plus real disposable
API saves passed in a ten-case account batch, with ownership/origin checks and
message/event/audit cardinality verified. Details and retained failed test reports
are in `CUSTOMER_ACCOUNT_REVIEW.md`. This expands the combined suite to 63 cases;
the expanded combined suite has not yet been run together.

## Combined regression — 24 October 2026

The expanded suite subsequently passed all 63 browser cases together: zero
failures, errors or skips; JUnit duration 426.493248 seconds. Global session
teardown and post-browser integrity checks passed; the generated schema was
removed. Evidence: `playwright-report-combined-63/` and
`test-results-combined-63/junit.xml`. Prior failed reports remain preserved.

The isolated run included public desktop/mobile checks, employee portal boundaries,
Admin MFA/purchase/dispatch/correction/quote operations, staged shipping wallet
settlement, warehouse receipt/inspection/measurement, tracking through delivery,
scanner recovery, customer account/claim updates and persisted customer sessions.
Database assertions verified immutable supplier evidence, receipt concurrency,
inspection retry cardinality, customer-safe correction history, balanced shipping
settlement, claim-update cardinality and session revocation. Separate security
redirect/ingress regression, CSRF-rule and production dependency-integrity checks
passed. No application source changes were needed for this combined run.

Runtime: cached browser image with read-only overlays of the current changed
source/test files, explicit Webpack isolated development server, one browser
worker, disposable PostgreSQL with no owner database or live-provider credentials.
Normal application build/development defaults were unchanged. The test containers
and network were removed after report export.

This is a regression-suite pass, not acceptance of every inventoried route or
state, real-device/printer validation, load/penetration testing, live AI/payment/
supplier/carrier integration, owner UAT or production readiness. Background AI
history requests reached their configured rate limit during the run; no live AI
integration claim is made. Manual page review, business-customer compatibility and
the documented production/security gates remain open.

The later 24 October session-panel increment passed a twelve-case targeted
account batch, including real single/bulk session revocation and current-browser
protection on desktop/mobile. See `CUSTOMER_ACCOUNT_REVIEW.md` for retained
failures, exact coverage and limitations. The suite is now 65 cases; the prior
63-case combined pass predates this change. Intermittent privacy-save timing and
development-server empty-manifest cleanup errors remain tracked, not globally
resolved by the later targeted pass.

The phone/identity presentation increment then passed fourteen targeted cases
after fixing an async upload-reset defect and mobile /profile overflow. Verification
responses were mocked and did not persist phone/KYC approval; no real document was
uploaded. See `CUSTOMER_ACCOUNT_REVIEW.md` for screenshots, failed-run evidence,
provider gates and limits. The expanded 67-case suite has not run together.

The profile/address increment passed five targeted cases (three setup and two
desktop/mobile CRUD cases), including real persistence, default replacement,
removal, failure recovery and ownership/Origin rejection. A real blank-optional-
field create defect was fixed without changing the API contract. Lint, TypeScript
and production build passed. See `CUSTOMER_ACCOUNT_REVIEW.md` for report paths and
the retained intermittent development-manifest cleanup failure. A clean rerun is
not a global runtime-reliability fix. The combined 69-case suite has not run
together; full page/state/device acceptance remains incomplete.

## Combined 69-case regression — 24 October 2026

The expanded suite ran together: 69 passed, zero failures, errors or skips,
532.315475 seconds. HTML: `playwright-report-combined-69/`; JUnit:
`test-results-combined-69/junit.xml`. The cached Docker browser image used
read-only overlays of the current logout/activity, account components, profile
CSS, order pages, isolated fixtures and Playwright configuration/tests. Webpack
was selected only for the isolated development runtime; normal dev/build defaults
were unchanged. No test assertions, retries or deadlines were weakened.

Global session revocation/state-file cleanup and post-browser database integrity
checks passed. These include one concurrent receipt package/event/history,
inspection lost-response retry cardinality, immutable supplier dispatch/correction
evidence, private customer timelines, unchanged purchase totals, profile/address
audit counts, and one synthetic wallet shipping payment with a balanced journal.
The isolated schema was removed; after report export, disposable containers,
tmpfs database and network were removed. No owner database or live provider was used.

Separate redirect/ingress security regression, CSRF-rule and production dependency
integrity scripts passed (11 direct and 104 locked production packages). Integrity
verification is not a vulnerability scan or penetration test. The immediately
preceding profile increment's production build passed; this increment changed
test evidence documentation only.

Background AI history reached configured rate limits. No live AI success is
claimed. The intermittent development empty-manifest cleanup failure did not
recur in this run, but its root cause remains unresolved. This combined pass
does not certify every inventoried page/state, all employee actions, real devices,
physical printers, live gateways/providers, accessibility, load/security testing
or owner UAT. Those acceptance and production readiness gates remain open.

The 25 October support review found and fixed cross-customer metadata exposure in
ticket creation idempotency replay. The new regression failed against the old
endpoint and passed with the ownership check and denial audit; the established
support API workflow, lint, TypeScript and production build passed. See
`SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for evidence and remaining payload-binding,
concurrency, business-role and UI recovery work. This is not another full browser
suite pass or complete support-page acceptance.

Support creation recovery subsequently passed five targeted setup/desktop/mobile
cases, including a real lost-response save/retry with one ticket/message/event/audit.
Request errors release pending state and preserve input; same-body retries reuse
their key. Lint, TypeScript and production build passed. Creation/detail screenshots
were inspected, but sticky/floating controls and real-device keyboard behavior are
not signed off. See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for evidence and limitations.
The combined 71-case suite has not run together; other support forms remain open.

Customer reply/assigned private-note recovery then passed five targeted cases,
including real lost-response retries, exact message/event/audit counts and private
note exclusion from customer JSON. The first run's global manifest cleanup error
was retained; the unchanged rerun passed teardown and integrity checks. Lint,
TypeScript and production build passed. See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md`
for scope and reports. The expanded 73-case suite has not run together, and the
intermittent development-manifest defect remains unresolved.

Satisfaction feedback recovery then passed five targeted setup/desktop/mobile
cases, including real resolution, required comment, lost-response retry, immutable
rating/summary and exact audit/Admin notification counts. Lint, TypeScript and
production build passed; teardown/database checks and environment cleanup passed.
See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for reports and coverage limits. The
expanded 75-case suite has not run together; other support forms and real-device/
overlay acceptance remain open.

Staff action confirmation/recovery passed five targeted setup/desktop/mobile
cases: cancellation, errors, duplicate confirmation, real lost-response resolution,
stale-version rejection and seven successful lifecycle/priority actions through
closure with exact event/audit counts. Lint, TypeScript, production build, teardown
and integrity checks passed. See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for evidence,
screenshots and untested Admin/claim/access states. The combined 77-case suite has
not run together; full support/page/device acceptance remains incomplete.

Support authentication recovery passed five targeted setup/desktop/mobile cases,
including real login/logout, old-session rejection, failed-request recovery,
duplicate guards and disabled no-JS controls. Lint, TypeScript, production build,
teardown and database checks passed. The initial cold-homepage navigation timeout
and JSON logout cleanup failure are retained; a read-only homepage warm-up isolates
the auth test without changing deadlines. These runtime issues remain unresolved.
See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for reports/privacy limits. The expanded
79-case suite has not run together, and Admin support UI review remains open.

Admin workforce recovery passed five targeted setup/desktop/mobile cases through
real MFA, uncertain-save/stale-version recovery, blank-note normalization and exact
saved-state/audit counts. Lint, TypeScript, production build, teardown and integrity
checks passed. Earlier responsive-row/label selector failures are retained and
documented in `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md`; final assertions use the visible
accessible controls without higher deadlines. Overall dashboard layout and other
Admin support forms remain open. The combined 81-case suite has not run together.

Admin quality-review recovery passed five targeted setup/desktop/mobile cases
through real MFA, required coaching, lost-response/stale-version protection,
versioned update and role/private-visibility checks, with exact review audit and
in-app notification counts. Lint, TypeScript, production build, teardown and
integrity checks passed. See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for fixture/selector
failures, final reports and visual/access limits. The combined 83-case suite has
not run together. Role-management UI and broader layout/overlay review remain open.

The role-management review found a server assignment/revocation race and corrected
it before UI work. Role/session removal now rechecks active work under the existing
assignment advisory lock. A deterministic regression failed on the old endpoint
and passed with the fix; the established support workflow script, lint, TypeScript
and production build passed. See `SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for lock/test
scope and cleanup evidence. No new browser-case/all-page acceptance is claimed;
role-management UI recovery and the combined 83-case browser run remain open.

Support-access grant/removal UI recovery subsequently passed five targeted
setup/desktop/mobile cases, with cancellation, failure recovery, duplicate-submit
guards, no-JavaScript controls and real removal/session invalidation after a lost
response. Exact role/audit/session database checks, lint, TypeScript, production
build and disposable-environment cleanup passed. See
`SUPPORT_REPLAY_OWNERSHIP_REVIEW.md` for reports and explicit coverage limits.
The expanded 85-case suite has not run together; this is not all-page acceptance.

## 25 October 2026 — Expanded regression execution

The unchanged 85-case suite was executed against disposable Docker PostgreSQL
schemas, with live providers disabled. It did not pass as a single run:

- Unsharded: 66 passed, 19 did not run before the existing 600-second global
  limit. The console reported suite/teardown timeouts even though JUnit's root
  reports zero failures/errors; that root summary alone must not be used as a
  success signal. Evidence: `playwright-report-combined-85-timeout/` and
  `test-results-combined-85-timeout/` (600.147730 seconds).
- Existing shard 1/2: 44 passed, no failures/skips; teardown and post-browser
  database assertions passed. Evidence: `playwright-report-regression-shard-1/`
  and `test-results-regression-shard-1/` (166.569652 seconds).
- Existing shard 2/2: 31 passed, one failed, 12 skipped by the serial account
  group. The desktop privacy-save status did not appear within the unchanged
  10-second assertion deadline; the snapshot showed its checkbox disabled with
  "Saving…". Adjacent dev-route compilations took around 9–11 seconds. This is
  evidence of a timing-sensitive failure, not proof of a specific root cause.
  The request later returned 200, but no complete post-browser integrity pass
  is claimed for this failed shard. Evidence:
  `playwright-report-regression-shard-2-failure/` and
  `test-results-regression-shard-2-failure/` (391.461452 seconds).
- An unchanged, separate `customer account review` diagnostic passed all 16
  cases (3 setup and 13 account cases), including privacy, orders/claim rules,
  session revocation, phone/identity request recovery, profile/address CRUD and
  unauthorized access. Teardown and database assertions passed. Evidence:
  `playwright-report-account-diagnostic/` and
  `test-results-account-diagnostic/` (201.679349 seconds).

Report identity comparison by project, test file and test name found passing
evidence for all 85 distinct suite cases across shard 1, the passing cases in
shard 2 and the account diagnostic, with no missing identities. This is NOT a
clean combined/sharded acceptance pass: the recorded timeout and privacy timing
failure remain open. No assertions, request deadlines, retries, fixtures or
application source were changed to get the diagnostic pass. No new production
build/lint run was needed for this test-only increment; their prior passing
results are not presented as newly rerun checks.

All four run containers and the tmpfs database/network were removed after
reports were copied. Failed-run session cleanup is not assumed successful;
discarding the entire disposable database removes any retained fixture sessions.
No owner data, production deployment or external provider was changed.

Next gate: diagnose development runtime compilation/reliability and obtain a
clean complete regression execution without weakening privacy confirmation or
mutation safety. Broader all-page visual/device review, real integrations and
production acceptance remain separate, incomplete gates.

## 25 October 2026 — Isolated route-retention experiment

Next's installed webpack development runtime defaults to disposing inactive
entries after 60 seconds and retaining a five-page access buffer (confirmed in
`next/dist/server/config-shared.js` and `on-demand-entry-handler.js`). The long
multi-role run revisits previously compiled routes after that window. To reduce
repeated development compilation, the isolated runner now explicitly enables a
15-minute entry lifetime with a 64-page buffer. `next.config.ts` applies this only
when NODE_ENV is development and CROSSLY_ISOLATED_ROUTE_RETENTION is exactly 1.
Normal development and production defaults remain unchanged; the setting is not
a production performance fix or an authorization/provider bypass.

`npm run test:isolated-route-retention` checks all five combinations of marked
development, unmarked development, marked/unmarked production and marked test
mode. It passed. The unchanged, unsharded browser run completed within the
original 600-second deadline: 84 passed, one failed, zero skipped; JUnit duration
508.266096 seconds. Both desktop and mobile privacy recovery passed. This is
improved completion evidence, not proof that every prior timing/manifest failure
is permanently resolved or that retention alone explains all variance.

The remaining failure is Admin supplier dispatch: POST to the expected nested
dispatch endpoint returned HTTP 404. The UI showed "Dispatch not confirmed"
rather than "Expected arrival saved", correctly withholding a success state.
The test failed at the saved-state assertion. The root cause of that 404 is not
established; do not silently retry the mutation or weaken confirmation to get a
pass. Complete post-browser database-integrity verification did not run because
the browser child failed, although its logout teardown responses were 200.

Reports: `playwright-report-retention-85-failure/` and
`test-results-retention-85-failure/`. The disposable containers and tmpfs database
were removed after exporting reports. Earlier failures remain retained. Next:
diagnose the nested dispatch 404 and obtain a clean full run; all-page/mobile
acceptance and production gates remain incomplete.

The route-retention configuration tests, lint, TypeScript and diff checks passed.
The production build rerun remained at its compile stage for several minutes
without diagnostics; its inspected task-owned Next build process was stopped
with SIGTERM. This build is incomplete, not passed, and the cause is not yet
established. The earlier production build pass predates this configuration change.
The new test can be rerun via `npm run test:isolated-route-retention`.

## 26 October 2026 — Dispatch diagnosis and Admin sign-in safety

The previously stalled production build completed when retried outside the
restricted sandbox. This is a successful build, not proof that a compiler defect
was fixed. The dispatch endpoint exists in both the source and cached test image
with identical SHA-256 content, and appears in the production route manifest.
The dispatch regression now checks its HTTP status/content type/request ID before
waiting for a success-only UI state; it does not retry failed mutations or relax
saved-state assertions. A focused real MFA/purchasing run passed four cases,
including two dispatches, physical receipt, immutable evidence/audit checks,
supplier privacy and session cleanup (`playwright-report-dispatch-diagnostic/`,
`test-results-dispatch-diagnostic/`). The earlier transient 404 was not reproduced;
its original root cause remains unproven.

Another unsharded 85-case attempt reached the original 600-second deadline:
72 passed, 12 did not run, and the active serial account case was interrupted.
Evidence is retained in `playwright-report-regression-85-oct26-timeout/` and
`test-results-regression-85-oct26-timeout/`. This is not a pass.

The CI matrix was changed to three bounded shards, explicitly using the same
isolated Webpack runtime as local checks (normal dev/build defaults unchanged).
Local sequential validation of the pre-Admin-fix suite passed shard 1's 31 cases
in 132.033660 seconds, including teardown/database checks. Shard 2 reported
28 passed and two failed in its console: Admin MFA setup was never observed
before its existing 240-second test deadline, and wallet settlement returned 500.
Logout teardown also failed with a development-runtime JSON/manifest read error.
Its JUnit root differs from console totals, so it must not be treated as the sole
gate signal. The shell stopped on that failure; shard 3 was NOT run. Reports:
`playwright-report-ci3-1/`, `test-results-ci3-1/`,
`playwright-report-ci3-2/`, `test-results-ci3-2/`. Three-shard CI remains unaccepted
until all shards and integrity checks pass. No GitHub-hosted CI execution occurred.

Review found an independent defect in AdminLoginForm: before hydration it allowed
native GET submission, and its fetch lacked timeout/exception recovery. The form
now uses POST, disables credential inputs and Continue until client readiness,
has a synchronous duplicate-submit guard, a 15-second same-origin request with
redirects rejected, response validation for Admin role/session/known handoff,
visible network/unconfirmed-response errors and finally-based pending recovery.
Password input is cleared only after confirmed success; failed-request entries
remain only in the current form. Navigation uses fixed Admin/MFA destinations.
Server authentication, MFA, origin and role enforcement are unchanged. This fixes
the fallback risk; it does not establish the cause of the previous setup timeout.

Six focused cases passed after this fix: three setup, desktop/mobile synthetic
sign-in recovery/no-JavaScript/duplicate-submit cases, and the real Admin MFA,
purchase/dispatch/receipt/quote/single-use-recovery workflow. Duration:
156.325824 seconds; zero failures/errors/skips. Exact database assertions and
session/file cleanup passed. Reports: `playwright-report-admin-auth-recovery/`
and `test-results-admin-auth-recovery/`. Mocked login responses are not evidence
of real authentication; the separate real workflow covers that boundary.

Lint, TypeScript, route-retention configuration tests and diff checks passed.
The post-fix production build passed outside the restricted sandbox (its compile
stage reported 7.6 minutes; no performance improvement claim). All disposable
containers/tmpfs database/network were removed after report export. Failed-run
session cleanup is not assumed successful; the complete test DB was discarded.
No real credentials, owner data, provider activation or deployment was changed.

The two new sign-in cases expand the browser suite to 87. It has NOT passed as a
complete run. Next gates remain development-runtime manifest/JSON reliability,
full three-shard validation with the Admin fix, and broader page/device UAT.

## 27 October 2026 — Complete local three-shard regression passed

The interrupted all-route preflight exposed a concrete compiler resource failure:
after more than 125 unauthenticated OPTIONS checks, Next logged "Server is
approaching the used memory threshold, restarting..." and the next request reset.
The installed framework code restarts development servers above 80% of V8's heap
limit. That demonstrates a failure mode, not proof that every historical 404 or
JSON error had the same cause. The warmup had no workflow results and increased
memory pressure; its scripts, package entries and runner hook were removed.
Only experimental files created in this chat were deleted, not user data.

The explicit isolated Webpack runtime now uses a bounded 5120 MiB Node heap and
the installed CLI's `--disable-source-maps` option (Node source-map loading, not a
production bundler change). Its existing memory restart guard remains enabled.
A pre-start guard requires at least 6 GiB total/constrained runner RAM, leaving
headroom for Chromium/PostgreSQL. Actual child-process inspection confirmed a
5120 MiB setting and no `--enable-source-maps`; only those two settings were
printed, not the process environment. A point sample during the unsharded run
showed 2.806 GiB container usage of 7.748 GiB available; this is not a peak or load
measurement. Normal application dev/build and isolated Turbopack defaults are
preserved by unit checks. Authentication, MFA, CSRF, request limits and mutations
were not bypassed, retried or relaxed.

An unsharded cold development run still failed: scanner navigation missed its
10-second UI assertion, and the global 600-second limit interrupted account work
(79 passed, one failed, seven did not run in console; teardown timeouts also
reported). Its logs had no memory-restart/empty-manifest/truncated-JSON messages.
Evidence: `playwright-report-heap-87/`, `test-results-heap-87/`. This is not an
unsharded pass, cold-start performance fix or proof of permanent framework repair.

The configured three-shard strategy was then executed sequentially, each against
a fresh generated schema with live providers disabled. All shards passed:

- Shard 1: 31 cases, 166.269938 seconds.
- Shard 2: 31 cases, 279.964342 seconds.
- Shard 3: 31 cases, 268.972691 seconds.

Each report has zero failures/errors/skips, and each wrapper completed its
database assertions, session revocation and auth-state-file cleanup. Comparison
by project, file and test name against the complete 87-case inventory found
exactly 87 distinct passing cases, no missing and no extra cases; three setup
cases repeat per shard, explaining 93 total reported executions. This is a clean
local complete-suite pass via sharding, not a combination of selected successes
from failed runs. Assertions/deadlines were unchanged and CI flaky-test failure
policy remained enabled.

Reports: `playwright-report-memory-ci3-1/`, `-2/`, `-3/`; JUnit under matching
`test-results-memory-ci3-*/junit.xml`. All three run logs were checked and had
zero memory-restart, manifest/JSON-error or hydration-warning messages, and all
contained the final integrity/cleanup success marker. Earlier failed runs and
their reports remain retained. All disposable containers/tmpfs database/network
were removed after exports. No owner data, real provider or deployment changed.

Isolated-runtime argument/resource tests, lint, TypeScript and diff checks passed.
Production app source/build behavior did not change in this increment; the prior
post-Admin-fix production build passed, but no new build pass is asserted here.
GitHub-hosted CI and three-blob report merging were not newly executed locally.

Remaining scope: unsharded development cold-route latency/repeat-run reliability,
broader page-by-page/device/accessibility UAT, production load/security review and
real provider integrations. Passing these 87 cases is not certification of every
page, real payment, physical warehouse evidence, external AI or production launch.

## 27 October 2026 — Admin support layout increment

Scope: Admin support overview and ticket detail only. Applied the binding
UI/UX Design System's deep-blue theme, readable mobile forms, visible focus and
clear operational instructions. Active ticket oversight now precedes workforce
management; a three-step guide explains assignment and communication ownership.
Workforce forms use responsive cards instead of a narrow 340px column. Closed
cards no longer stretch when a neighboring form expands. Quality review sits
below the transcript in the main column, with mobile stacking, 16px form controls
and minimum 44px buttons. The redundant ticket navigation/logout is hidden only
inside the Admin workspace; the shell navigation remains available.

No database schema, API contract, role policy, payment or provider changes.
Admin MFA and assigned-agent communication boundaries remain enforced by the
existing server implementation. Customer/CS portal styles are outside this scope.

Acceptance: the final isolated run passed nine tests (three setup, six desktop/
mobile workforce, quality and role-management cases), zero failures/errors/skips,
85.687008 seconds. Checks include input recovery, lost responses, stale versions,
duplicate submissions, no-JavaScript disabled forms, role revocation, customer
privacy, queue order, panel widths, control typography, touch targets and horizontal
overflow. All four final screenshots were inspected. Database assertions, session
revocation and auth-state cleanup passed; the isolated schema, containers, tmpfs
database and network were removed after exporting reports.

Evidence: `playwright-report-support-layout-final/index.html` and
`test-results-support-layout-final/junit.xml`. The first passing run is retained
under the corresponding `support-layout` report directories. Targeted ESLint,
TypeScript, diff checks and the current production Turbopack build passed.

This targeted increment does not constitute a new full 87-case regression run,
all-page/device acceptance, a full accessibility audit or production certification.
Broader page polish, physical-device UAT and production/provider readiness remain.

## 27 October 2026 — Support calendar usability and request recovery

Scope: `/admin/support/settings` and its existing API-backed forms. Added ordered
setup guidance, empty calendar states, 16px inputs, 44px controls, visible focus
and responsive layouts. Operating hours explicitly use the configured policy
timezone. Shift entry explicitly uses the device timezone, while the saved rota
now formats dates in the policy timezone instead of the server's local timezone.

Calendar forms previously lacked network/JSON failure recovery. They now use a
15-second request timeout, same-origin credentials, redirect rejection, a pending
ref against double submission, disabled pre-hydration controls and POST fallback
forms. Success requires a confirmed response entity; inputs remain after failed
or unconfirmed requests. The error asks staff to reload and check uncertain writes
before retrying. Holiday/shift forms reset only after confirmation. Removal and
cancellation also recover from failures. No automatic mutation retries were added.
Server APIs, policy version guards, RBAC/MFA, schema and audit contracts are unchanged.

Verification: `test:support-policy` passed against the disposable schema, covering
calendar timezone, holiday exclusion, SLA snapshots, shift-gated assignment,
sequential overlap rejection and cancellation. The final browser evidence run
passed nine cases (three setup and six desktop/mobile calendar, workforce and
quality cases), zero failures/errors/skips, 89.003618 seconds. It covers aborted,
malformed and unconfirmed responses, server validation, retained inputs, duplicate
submit protection, stale policy, no-JavaScript safety, real holiday removal/shift
cancellation, foreign-origin rejection, readable controls and horizontal overflow.
Database assertions confirmed exactly one audit per calendar mutation, removed
closed dates, cancelled shifts and Sydney-to-UTC conversion. Dedicated calendar
MFA accounts avoid workforce test enrollment collisions; session revocation and
auth-state cleanup passed. All disposable schemas, containers/database and network
were removed after report exports. No owner data or production providers changed.

Evidence: `playwright-report-support-calendar-evidence/index.html` and
`test-results-support-calendar-evidence/junit.xml`, including setup-guide and rota
screenshots at both sizes. The prior complete passing targeted run is retained
under `support-calendar-final`. Initial failed reports (`support-calendar-first`
and `support-calendar-second`) retain the test fixture/selector failures and the
desktop input-size regression that were corrected. Final targeted ESLint,
TypeScript, diff checks and the production Turbopack build passed.

The current inventory contains 89 tests; this increment did not rerun all 89.
Physical devices, exhaustive accessibility, concurrent shift-creation races,
production load/security and real integrations remain outside this acceptance.

## 27 October 2026 — Concurrent support shift creation

Closed the shift-creation concurrency gap identified in the calendar increment.
The POST route previously checked agent eligibility and overlap before its write
transaction. It now acquires the existing support assignment/revocation lock,
checks eligibility/overlap, and creates the shift plus audit in one transaction.
Response envelopes, 201/404/409 codes, MFA/origin/role checks and adjacent-shift
behavior are preserved. No schema, UI, provider or production configuration changed.

The policy integration test holds the lock and observes queued requests in
PostgreSQL before release. Two overlapping requests yield one creation and one
conflict, one scheduled row and one creation audit. Adjacent shifts are allowed.
A gated role-removal transaction commits before a waiting creation; the route
returns 404 and creates no ineligible shift. The old cached route failed the new
lock-wait assertion; baseline evidence is retained in
`test-results-shift-race-baseline/run.log`. That failure demonstrates missing
serialization, not that this particular baseline run created duplicate shifts.

With the fix, `test:support-policy` passed, followed by nine browser cases (three
setup plus six desktop/mobile calendar, role-management and workforce cases), zero
failures/errors/skips, 75.397273 seconds. Audit cardinality, calendar timezone,
session revocation and auth-state cleanup assertions passed. Targeted ESLint,
TypeScript, diff checks and the production build passed. Reports are retained in
`playwright-report-shift-race-fixed/index.html`,
`test-results-shift-race-fixed/junit.xml` and its matching `run.log`. Both schemas
and all disposable containers/database/network were removed after exports.

This verifies API creation/role-removal races, not all calendar mutations, direct
database writers, a new full 89-case run or production load. Broader page/device
and production readiness review remains ongoing.

## 27 October 2026 — Concurrent shift cancellation and replay

Cancellation now reads shift state inside the existing support advisory-lock
transaction, shared with creation/assignment/revocation. The first request changes
state and audits; simultaneous and later requests confirm the cancelled record
with `idempotentReplay: true`, without adding another audit. Missing shifts retain
404 behavior. Authorization, MFA/origin guards, API envelopes, UI and schema are
unchanged.

The integration test queues two DELETE requests under a held lock, verifies both
return the cancelled shift, exactly one is an initial mutation and the other is a
replay, and checks one cancellation audit after a further retry. Existing creation,
active adjacent-interval and role-removal race checks remain in the same test.
The old cancellation implementation failed the lock-wait assertion; baseline log:
`test-results-shift-cancel-baseline/run.log`. This proves missing serialization in
that baseline, not that this particular run necessarily duplicated its audit.

The fixed policy integration suite passed, followed by five browser cases (three
setup, desktop/mobile calendar workflow), zero failures/errors/skips, 22.361267
seconds. Database assertions and session/auth-state cleanup passed. Targeted lint,
TypeScript, diff checks and production build passed. Reports:
`playwright-report-shift-cancel-fixed/index.html` and
`test-results-shift-cancel-fixed/junit.xml`, with integration output in `run.log`.
All disposable schemas, containers, database and network were removed after export.
No owner data, provider activation or deployment changed. This targeted pass does
not replace the broader page/device review or a full 89-case regression run.

## 27 October 2026 — Concurrent closed-date removal

The holiday DELETE route now performs the read, conditional `deleteMany` and
removal audit in one transaction. A request that loses the deletion race returns
the existing 404 contract instead of throwing Prisma P2025. Only the request that
deletes the row writes an audit. MFA/origin/Admin guards, successful response,
schema and UI are unchanged.

The integration test holds the holiday row lock until both API deletions are
waiting. The cached old route reproduced one HTTP 200 and one HTTP 500/P2025;
evidence: `test-results-holiday-race-baseline/run.log`. The fixed route returns
one 200 and one 404, removes the date, and records exactly one audit. A later retry
remains 404 and leaves audit history unchanged. Existing calendar/SLA and shift
concurrency checks pass in the same suite.

Five browser cases passed (three setup, desktop/mobile calendar), zero failures,
errors or skips, 28.033574 seconds. Database assertions, session revocation and
auth-state cleanup passed. Targeted ESLint, TypeScript, diff checks and production
build passed. Evidence: `playwright-report-holiday-race-fixed/index.html`,
`test-results-holiday-race-fixed/junit.xml` and its `run.log`. Disposable schemas,
containers/database and network were removed after export. No owner data,
deployment or provider activation changed. Full 89-case regression, broader
page/device review and production readiness remain outside this targeted pass.

## 27 October 2026 — Operating-policy initialization and concurrent saves

First-time policy persistence now uses conflict-safe insertion. The public default
calendar remains version 1; its first saved revision is version 2, so another form
loaded from the default cannot overwrite the initialized calendar. Competing
initializers return one success and one existing `SUPPORT_POLICY_CHANGED` 409,
instead of a unique-constraint server error. Existing saved-policy updates retain
their compare-and-swap version check. No schema or response-envelope change.

The integration test holds a table lock until both initializers reach INSERT.
The old route reproduced HTTP 200 plus 500/P2002; retained baseline:
`test-results-policy-race-baseline/run.log`. The fixed route passed one-success/
one-conflict, singleton/version-2, stale-default rejection and one-audit assertions.
Two saves from the same persisted version also yield one success, one conflict,
one version increment and one additional audit. Existing calendar, assignment,
holiday and shift concurrency checks passed in the same suite.

The first browser run caught a fractional-pixel measurement just below the 44px
minimum (43.9999847px); calendar buttons were increased to 48px, without relaxing
the assertion. That report remains under `policy-race-first`. The fresh final run
passed five browser cases, zero failures/errors/skips, 20.426665 seconds. Database
assertions and session/auth-state cleanup passed. Lint, TypeScript, diff checks
and production build passed. Evidence: `playwright-report-policy-race-fixed/` and
`test-results-policy-race-fixed/junit.xml`, plus its integration `run.log`. Mobile
rota screenshot inspected. Disposable schemas, containers/database and network
were removed. No owner data, deployment or provider activation changed. This is
targeted acceptance, not a full 89-case regression or all-page/device completion.

## 28 October 2026 — Complete 89-case regression consolidation

The complete current browser inventory now passes across three fresh-schema
shards: 32 cases in 147.023865s, 32 in 380.275920s, and 31 in 280.588819s.
Each final report has zero failures/errors/skips. Comparison of project, file and
full test title against the local inventory found exactly 89 distinct passing
cases, no missing and no extra cases. There are 95 reported executions because
the three setup cases repeat in each shard. All three isolated wrappers completed
their database/cardinality/privacy assertions, session revocation and auth-state
cleanup. Their final logs contain no compiler-memory restart, manifest/Server
Action lookup error or hydration-mismatch diagnostics from the checked patterns.

Two harness issues were resolved before accepting these fresh shard results.
The Admin MFA handoff mock now matches the pathname, including Next RSC query
variants, and also requires the synthetic heading to render. Real MFA remains
covered separately. Profile verification permits one transport-only ECONNRESET
retry on its GET; Playwright does not retry HTTP error responses with this option.
The profile write is never replayed, its returned value remains asserted, and
database checks still require exactly one profile audit and expected address CRUD
counts. The failed read had not reached the handler; logs showed no server restart
or OOM. The underlying transient connection-reset cause was not established.
Test deadlines, serial-test retry policy and authorization assertions were not
relaxed. Initial failed reports remain under `full89-first-1` and `full89-first-3`.

Evidence: `playwright-report-full89-1/`, `-2/`, `-3/`, with matching
`test-results-full89-*/junit.xml` and `run.log`. Final test-source lint, TypeScript
and diff checks passed. No production application source changed during this
consolidation; the prior policy-fix production build remains the latest verified
build. No new build or GitHub-hosted CI/report merge is claimed for this test-only
increment. All disposable schemas, containers, database and network were removed
after exports. No owner data, provider configuration or deployment changed.

This is a full automated-inventory pass, not certification of every page,
physical device/printer, live payment/supplier/carrier/AI service or production
load/security readiness. Broader manual page/device UAT and production integration
readiness remain open.

## 28 October 2026 — Sourcing sign-in safety and mobile review

Scope: sourcing sign-in only. Its API-backed form now uses POST fallback markup,
disabled pre-hydration controls, a pending-submit guard, same-origin credentials,
redirect rejection, a 15-second timeout and error/finally recovery. Success requires
the sourcing role, a valid session identifier and SIGNED_IN action; malformed or
wrong-role/action replies retain entries and show a recoverable error. The password
is cleared after confirmation. Scoped 16px inputs, 14px labels/help, 48px buttons
and visible keyboard focus improve desktop/mobile usability. Server authorization
and login API contracts are unchanged.

Two new browser cases cover no-JavaScript safety, network/JSON/unconfirmed errors,
wrong roles/actions/session IDs, server rejection, retained password, double submit,
synthetic handoff and real sourcing login with reload persistence. A customer is
rejected from sourcing; a sourcing employee can read the queue but cannot access
Admin users or finance reconciliation. Dedicated disposable fixtures must create
exactly one session each and revoke it during cleanup.

Seven targeted cases passed (three setup, two sourcing, two support auth), zero
failures/errors/skips, 36.02892 seconds. Database/session cleanup, targeted lint,
TypeScript, diff checks and production build passed. Both login screenshots were
inspected. Evidence: `playwright-report-sourcing-auth-final/` and
`test-results-sourcing-auth-final/junit.xml`, with its `run.log`. The initial run
used an incomplete source overlay and hit the cached old logout/activity-helper
incompatibility; its reports remain under `sourcing-auth-first`. Correcting the
container overlay to the already-fixed current helper resolved that harness issue;
no new logout application change was made. All disposable test resources removed.

The inventory now has 91 cases; the earlier full 89-case result remains historical,
and no full 91-case pass is claimed. Sourcing quote preparation, Admin sourcing
access-management forms, live supplier integrations and broader page/device UAT
are not certified by this sign-in increment.

## 28 October 2026 — Sourcing draft preparation and review handoff

The sourcing queue now explains the three preparation steps. Draft submission
uses disabled pre-hydration controls, a pending guard, a 15-second timeout,
confirmed-response validation, retained entries and a manual queue refresh after
an uncertain save. Expiry must be future and explicitly uses the employee device
timezone. Independent Admin approval remains required; money calculations and
server authorization contracts are unchanged. Scoped desktop/mobile styling fixes
joined field labels/help, field borders, saved-status spacing and a floating logout
control that could cover the submit button.

Two new browser cases exercise transport/JSON/validation failures, wrong response
state/identity, future expiry, duplicate submit and a committed-but-lost response.
Database assertions require one draft, one audit, the expected total, no premature
customer notification and revoked test sessions. Customer and sourcing permission
boundaries and the independent review handoff are covered. The sourcing API suite
also passed its real independent Admin approval/publication checks.

The first combined API/browser run passed seven browser assertions but failed
global logout cleanup with a development-server empty-manifest error. Its failed
evidence remains in `test-results-sourcing-drafts-first/`. Fresh browser-only
servers passed cleanup; no logout retries or global manifest fix were introduced.
The current automated inventory is 93 cases; the full 89-case regression remains
historical. This increment does not certify all pages, physical devices, production
providers or Admin sourcing staff grant/revoke forms.

Final evidence: `playwright-report-sourcing-drafts-accepted/` and
`test-results-sourcing-drafts-accepted/junit.xml`, with `run.log`: seven targeted
cases passed in 29.3 seconds, including session cleanup and post-run database
assertions. Desktop/mobile screenshots were reviewed; disposable test resources
were removed. Targeted lint and TypeScript passed. The final production build and
diff checks passed on 30 October after the earlier approval-service usage-limit
block cleared. No full 93-case rerun or production deployment is claimed.

## 30 October 2026 — Admin sourcing staff control recovery

Grant/removal controls now use hydration and duplicate-click guards, same-origin
requests, redirect rejection, bounded timeouts, caught parsing/network failures
and finally recovery. Grant retains the email until a matching staff response is
confirmed. Removal keeps the confirmation prompt and disables further removal
after a confirmed response. Both explain uncertain outcomes and offer manual
workforce refresh, without automatic mutation retries. Scoped 16px inputs, 48px
controls, focus outlines and wrapped staff identities improve mobile usability.
Server permissions, role mutation semantics and audit contracts are unchanged.

Five targeted cases passed in 21.5 seconds (three setup, desktop, mobile), with
real Admin login/MFA/logout and synthetic grant/removal responses. Coverage includes
transport/JSON/unconfirmed/validation failures, retained email, duplicate grant,
confirmed grant/removal, disabled completed removal and workforce control fit.
These mocked mutations do not prove live role-change concurrency or audit
cardinality. The earlier sourcing API test remains separate evidence of normal
server grant/removal and sourcing session revocation.

Reports: `playwright-report-sourcing-staff-final/` and
`test-results-sourcing-staff-final/junit.xml`, plus run log. Test schema, sessions,
containers and database were cleaned up. Targeted lint, TypeScript and diff checks
passed. Inventory is 95 cases; no full 95-case regression is claimed. Concurrent
grant/revoke serialization and replay audit behavior still need a dedicated server
review. The first passing run logged a render stream closing during page teardown;
no global runtime-resolution claim is made.

Final production build passed; the mobile staff-card screenshot was visually
reviewed after wrapping was corrected.

## 30 October 2026 — Sourcing access concurrency and audit consistency

Grant and removal now acquire the same per-staff PostgreSQL transaction advisory
lock before reading/mutating sourcing assignments. Grant rechecks the active
account after acquiring the lock, inserts only if absent and audits only an actual
grant. Removal reads inside the lock, removes the role, revokes active sourcing
sessions and records one audit atomically. A repeated removal returns the existing
404 contract; repeated grant retains its 201 response without a duplicate audit.
No migration or API response shape change is required. Admin portal/MFA and trusted
origin checks remain in place.

The extended isolated sourcing API suite passed: four parallel grants plus replay
produce one grant audit; four parallel removals produce one success and three 404s,
with one new removal audit. Removed sessions cannot read the sourcing queue.
Competing grant/removal requests return documented outcomes and leave final role
state consistent with the transition audit counts. Existing draft privacy and real
independent Admin publication checks also passed. Evidence is retained in
`test-results-sourcing-access-api/run.log`. Synthetic data/schema and disposable
containers/database were removed. No owner database or deployment changed.

These checks address the prior sourcing-access concurrency gap. They do not
certify all role writers, production load or the full 95-case browser inventory.
Targeted lint, TypeScript, diff checks and production build passed.

## 30 October 2026 — Admin sourcing quote review recovery

Approval/rejection controls now guard hydration and duplicate submission, validate
the selected action and trimmed note, use same-origin bounded requests and recover
from transport/JSON/unconfirmed replies. Success requires the matching quote ID,
expected SENT/REJECTED state and recorded reviewer/time. Confirmed decisions disable
further submission while refreshing the queue. An uncertain save retains the note
and offers manual refresh; there are no automatic decision retries. Scoped mobile
textarea typography, touch targets and focus styling accompany action guidance.
Review API financial/state/independent-review rules are unchanged.

Five targeted browser cases passed in 22.4 seconds (three setup plus desktop/mobile).
Real MFA Admin approval and rejection are exercised after mocked failures. A real
approval response is deliberately lost; refresh recovers the saved state and a
direct replay receives 409. Rejection removes the review form while retaining the
request as awaiting a corrected sourcing draft. Post-run database checks require
the correct request/quote states, reviewer/time, unchanged total, one audit and one
customer notification per decision. Session revocation and isolated cleanup passed.

The initial test incorrectly expected rejected requests to disappear; the test was
corrected to the existing workflow. Its failed report remains in
`test-results-sourcing-review-first/`. Final HTML/JUnit evidence is in
`playwright-report-sourcing-review-final/` and
`test-results-sourcing-review-final/`, including run log and reviewed mobile
screenshot. Disposable schemas/containers/database were removed. Targeted lint,
TypeScript and diff checks passed. Inventory is now 97 cases; no full 97-case or
production readiness certification is claimed.
The final production build also passed.

## 31 October 2026 — Full 97-case regression consolidation

All 97 distinct current browser cases passed across three fresh isolated schemas:
35 executions in 131.439170 seconds, 34 in 324.041195 seconds and 34 in 238.853962
seconds. The 103 executions include the three setup cases repeated per shard.
Exact comparison of project, file and full title against the current Playwright
inventory found 97 expected and 97 actual cases, with no missing or extra cases.
Final runs have zero failures, skips, errors or flaky outcomes. Database assertions
for state, audit cardinality, privacy, synthetic settlement and session revocation
passed. Every isolated schema was dropped, reports exported and disposable
containers/database/network removed; the final Compose inventory was empty.

Consolidation found and fixed two issues before the accepted runs:
- Sourcing staff/review tests shared the calendar Admin fixture, causing repeated
  MFA enrollment conflicts. They now have separate per-workflow/per-viewport Admins;
  cleanup checks include all of their sessions and review checks expect the
  dedicated decision reviewer. Production MFA rules were not weakened.
- Catalogue sorting was interactable before its client handler was ready, allowing
  a cold-page selection to be lost. The select now stays disabled until hydration;
  its page object explicitly waits for readiness before choosing a sort value.
  The original failure passed only on retry and was not accepted as a clean pass.

Earlier failed evidence is retained in `test-results-full97-first-1/` (shared MFA
fixtures) and `test-results-full97-second-1/` (catalogue flaky result), with matching
HTML reports. Accepted evidence is `playwright-report-full97-1/`, `-2/`, `-3/` and
matching `test-results-full97-*/junit.xml`/`run.log`. Checked final logs contained
no heap-limit restart, empty-manifest, hydration-failure or missing-Server-Action
diagnostic patterns. This does not establish that every possible runtime issue is
resolved. Dependency lockfile and Prisma schema hashes matched the cached image;
current src/scripts/tests/configs were used without mounting owner environment files.

Coverage spans public discovery/recovery, desktop/mobile sourcing and support,
Admin MFA, customer profile/privacy/sessions/verification/claims, procurement,
warehouse/inspection/logistics, synthetic finance settlement and delivery tracking.
This is a full automated-inventory result, not certification of every page,
physical device/printer, live provider, real payment or production load/security.
No production deployment, owner database mutation or external provider activation.
Targeted lint, TypeScript, final production build and diff checks passed.

## 31 October 2026 — Runtime dependency security update

Registry audit found critical/high Next.js advisories and a high Zod advisory in
the previously installed versions. Updated Next.js and eslint-config-next from
16.3.8 to 16.4.3, and Zod to 4.6.7, refreshing package-lock with npm. Maintainer
advisories identify fixes at Next 16.4.1 and Zod 4.6.6; the selected versions are
later compatible releases. No forced framework/linter downgrade or transitive
major override was applied. Production-only audit now reports zero findings;
full audit reports 16 moderate tooling-chain alerts rooted in minimatch
GHSA-g3hv-75wg-m249. The full audit gate stays enabled and unresolved.

Full lint initially scanned retained Playwright generated JS artifacts. Added
generated HTML report/test-result/blob paths to ESLint global ignores, retaining
source and test lint coverage. Full source lint, TypeScript, 288-operation OpenAPI
contract, security-regression, production-config, dependency-integrity and
production build then passed. Container and performance-policy checks also passed.

Eight isolated checks passed both before and after installing the updated lockfile:
CSRF rules/boundary, session management, logout database-fault rollback, payment
risk review, original-method refund integrity, sourcing access and support-policy
concurrency. Thirteen focused browser executions passed after the update: three
setup cases plus desktop/mobile Admin sign-in, sourcing sign-in, sourcing review,
catalogue sorting and mocked image-search failure recovery. State/audit/notification
and session-cleanup assertions passed. The full 97-case result above predates this
dependency update; no full 97-case pass on 16.4.3 is claimed.

Evidence: `playwright-report-security-upgrade/` and
`test-results-security-upgrade/` with JUnit, browser/API logs and before/after/full
production audit JSON. Test containers installed the new lockfile with npm ci;
the old cached image was not treated as current dependency evidence. The temporary
patched test image, schemas, containers, database and network were removed. The
original cached image remains older and requires a verified dependency refresh
before future current-version runtime tests. No owner database/deployment changed.

Primary advisories:
https://github.com/advisories/GHSA-2464-fhr4-w9xw
https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
https://github.com/advisories/GHSA-g3hv-75wg-m249

## 31 October 2026 — Consistent dependency-audit release gate

Confirmed the compatible tooling limitation against current registry metadata:
eslint-plugin-react 7.37.5, eslint-plugin-jsx-a11y 6.10.2 and eslint-plugin-import
2.32.0 still declare minimatch ^3.1.2. Maintainer advisory GHSA-g3hv-75wg-m249 lists
11.0.1 as the first patched version. Existing plugin callers use minimatch's legacy
callable API; blindly overriding them to a different major is not an accepted fix.
No dependency override, security suppression, forced downgrade or waiver was added.

Found an audit enforcement gap: CI previously used audit-level=high and the launch
candidate verifier ran dependency integrity but no registry audit. Added the shared
`test:dependency-audit` command (`npm audit --audit-level=moderate`), wired it into
both CI and launch verification, and kept integrity checking separate. The stricter
moderate-or-higher threshold now makes the documented tooling finding an explicit
release blocker. This supersedes earlier statements implying that the old CI
threshold already blocked moderate findings.

The real audit gate exits 1 with 16 moderate alerts, zero high/critical alerts;
this is an expected blocked result, not a clean audit. A synthetic launch-dispatch
harness confirmed exit 1 stops at this gate, runs no later gate/build and cannot
bypass audit with --skip-build. That harness mocks command outcomes/health only;
it is not a full launch-suite execution. Launcher lint, dependency integrity and
diff checks passed. No runtime source/dependencies changed in this increment, so
the preceding runtime build/browser/API evidence remains the latest evidence.
GitHub-hosted CI was not executed here.

Registry/audit snapshots are retained under `test-results-dependency-gate/`.
Compatible upstream plugin updates or a separately tested tooling migration remain
required before this gate can pass. No production deployment is approved.

## 1 November 2026 — Full patched-runtime browser verification

All 97 distinct inventory cases passed on Next.js 16.4.3/Zod 4.6.7 with default
Turbopack and the final application/test changes. Three fresh-schema groups ran
35 cases in 158.476141 seconds, 34 in 126.194070 seconds and 34 in 167.763324
seconds. The 103 executions include repeated setup cases. Exact matching of
project/file/full title found 97 expected/actual cases, no missing/extra cases,
and zero final failures/skips/errors. State/audit/privacy/notification/settlement
and session assertions passed. This supersedes the focused 13-case dependency
compatibility check as patched-runtime browser coverage.

The broader run exposed issues that focused checks did not:
- Scanner lookup pushed a destination and immediately refreshed the current route.
  It now makes one push, explains the opening state and offers a native `Open
  matched task` link to the validated same-portal destination. Warehouse, Inspector
  and Logistics delayed-navigation tests verify the fallback remains available.
- Feedback's lost-response test could advance before its intercepted request
  finished. It now awaits both the committed response and visible recovery state
  before retrying. Writes are not automatically replayed.
- Cold development compilation consumed catalogue/package-page test deadlines.
  Setup now compiles catalogue, protected package/lookup and feedback routes using
  public reads or denied requests. The package page must redirect unauthenticated
  users to warehouse login; lookup uses a valid synthetic payload before asserting
  denial. Workflow deadlines/retry rules were not increased. This verifies compiled
  workflows, not cold-start performance.
- Isolated verification now owns a schema-specific framework output directory,
  accepts only its generated name in Next configuration and removes it after
  stopping the child. Normal development/production output is unchanged. After
  the inventory pass, a shutdown guard was corrected to recognize signal-terminated
  children, avoiding waiting for a second exit event. Launcher lint and a real
  child-termination check passed for that guard-only correction.

Long Webpack runs still produced manifest JSON parsing and logout-cleanup errors,
including with separate output directories. No global Webpack/framework fix is
claimed. Default Turbopack passed the complete inventory and is now selected in
browser CI; hosted CI was not run here. Failed evidence remains in
patched-full97-first-2, patched-full97-second-2 and patched-recheck-first report/
result directories. The targeted ten-case recovery pass remains in patched-recovery.

Final HTML/JUnit/log evidence: `playwright-report-patched-final-{1,2,3}/` and
`test-results-patched-final-{1,2,3}/`. Final logs had zero unhandled-request,
manifest-parse, hydration-failure, missing-Server-Action or heap-restart diagnostic
patterns checked. Full lint, TypeScript, container controls, security regressions,
production build and diff checks passed. Disposable schemas/output/containers,
database/network and temporary patched image were removed. Owner data and
production integrations were not changed.

The moderate tooling advisory, physical-device/printer UAT, production providers
and load/security validation remain release gates. This result does not certify
every page or live integration or authorize production release.

## 1 November 2026 — Admin live setup guide

Owner request: make remaining live setup visible in Admin with instructions for
manual completion. `/admin/launch-readiness/setup` now provides nine required and
three optional setup areas, responsible roles, numbered instructions, protected
tool links and whitelisted environment-variable presence checks. It distinguishes
configuration presence from operational acceptance and missing adapter/certification
work. No secrets are displayed, no provider is activated, and no readiness gate is
automatically verified. Admin navigation and the evidence register link to it.
The example environment now documents the implemented transactional email fields.

Desktop/mobile browser verification passed five executions (three setup checks
plus two new guide cases), including no-JavaScript access, twelve visible cards,
responsive overflow, readable introduction, safe variable names and logout/session
cleanup. Screenshots were inspected. HTML/JUnit/log evidence is retained in
`playwright-report-live-setup-verified/` and `test-results-live-setup-verified/`.
The inventory is now 99 distinct browser cases; the historical full 97-case run
and this focused increment are separate evidence, not a fresh full 99-case run.

All 74 selected local test/database checks passed across the main diagnostic run
and a three-check tail rerun. The readiness test was corrected to accept an exact
`no-store` directive, which already forbids both private and shared caching. The
test still verifies authorization, no secret values, anti-framing, no indexing,
audit cardinality and immutable register events. The first disposable-container
attempt lacked Dockerfile test inputs; these were supplied before re-verification.
Test-command coverage now explicitly classifies interactive/reporting browser
commands separately and includes three previously omitted noninteractive checks
in the release runner. Full lint, TypeScript, 288-operation API contracts and diff
checks passed. This diagnostic selection excludes the known failing dependency
audit; the actual release runner retains that blocking gate. Production adapters,
owner acceptance, physical-device UAT and the tooling advisory remain unresolved.
The production build also passed using the patched runtime in the disposable
container; see `test-results-live-setup-verified/build.log`. The earlier host build
was stopped after making no compilation progress and is not counted as a pass.

## 2 November 2026 — Complete 99-case browser inventory

All 99 distinct browser cases passed across three isolated schemas on the locked
Next.js 16.4.3 runtime. Each group executed 35 cases; repeated setup accounts for
105 executions. Inventory comparison by project, file and full test title found
zero missing or extra cases. Final JUnit reports contain zero failures, errors or
skips. HTML/JUnit/log evidence is in `playwright-report-full99-20261102-{1,2,3}/`
and `test-results-full99-20261102-{1,2,3}/`; the first results directory also holds
the inventory, coverage summary and dependency audit evidence.

The initial second group failed the mobile calendar's ten-second confirmation
assertion because its first real shift POST spent 10.1 seconds compiling and
returned 201 after 11 seconds. The snapshot showed a pending form, not a rejected
or duplicate write. Setup now compiles that protected route with an unauthenticated
POST which must return 401/403 and cannot write state. No application business
rules, workflow deadlines, retry settings or assertions were relaxed. Groups two
and three then passed; group one's successful evidence remains valid because the
only change was this development preflight. The failed attempt is retained in
the `full99-20261102-first-2` report/results directories. Cold-start performance
is not certified by these compiled-route tests.

Post-run checks verified immutable inspection retry cardinality, one concurrent
warehouse receipt, bounded supplier records, private purchase-review history,
balanced synthetic shipping settlement, session revocation and fixture cleanup.
Final logs contained none of the checked unhandled-request, manifest parsing,
heap-restart, hydration or missing-server-action diagnostic patterns. Lint and
TypeScript passed for the harness change. No application source, schema, production
provider or owner data was changed in this increment.

The refreshed production dependency audit has zero findings. The full audit still
has 16 moderate tooling findings rooted in GHSA-g3hv-75wg-m249; registry checks
confirmed the legacy lint plugins still require minimatch 3. No incompatible
major override or audit bypass was introduced. The full release gate remains
blocked, alongside live-provider certification and physical-device acceptance.

## 2 November 2026 — Backup artifact and diagnostic protection

Backup creation now reserves unpredictable archive paths exclusively with 0600
permissions and a restrictive umask. It requires an owned 0700 output directory,
rejects a symbolic-link directory and locations inside the application checkout,
checks archive permissions and cleans up its own partial files on failure.
Backup and restore command failures no longer interpolate stdout/stderr or spawn
errors into exceptions; these can contain credentials or private records.

Extended `test:operations-safety` executes both CLI scripts with synthetic command
fixtures, testing archive/checksum permissions, output guards, symlink rejection,
failed-dump/catalog cleanup, preservation of existing evidence and diagnostic
redaction. Targeted lint, operations safety, security regressions and diff checks
passed. No browser/application/schema behavior was changed.

A real PostgreSQL 16 drill used a separately provisioned disposable database and
explicit synthetic credentials, with all 71 application migrations deployed.
The generated archive passed `pg_restore --list`; restoration into a separate
empty drill database passed with 126 tables (including the synthetic probe table)
and 71 successful migration records. Both probe rows matched. Observed modes were
0700 for the output directory and 0600 for archive/checksum. A second restore into
the populated drill target was rejected before restoring. No owner database was
read, backed up, migrated or restored. This is local tooling verification, not a
production backup, encryption, off-site retention, RTO/RPO or recovery sign-off.

### Restore failure rollback — 2 November 2026

The restore CLI now passes `--single-transaction` to PostgreSQL. Extended CLI
fixture coverage checks that transactional restoration is requested and that the
success path completes. Operations-safety tests and targeted lint passed.
A real PostgreSQL 16 disposable drill deliberately conflicted with the second
table in an archive: restore failed, zero restored tables remained, and the
pre-existing conflicting type was preserved. A clean target restored both tables
and the expected probe value (7). This proves rollback on an archive SQL error;
post-commit application verification remains a separate acceptance check.
The disposable container/database/archive were removed; owner data was untouched.

The pre-restore empty-target guard now also detects user-defined types, functions,
views, sequences and custom schemas. A second disposable PostgreSQL 16 drill
accepted an empty database, rejected each of those objects individually, and
accepted the database again after each object was dropped. CLI fixture coverage
also verifies that a nonempty target is rejected before `pg_restore` executes.
Operations-safety tests, targeted ESLint and whitespace checks passed. The second
disposable container was removed; no owner database was accessed.

## 2026-11-11 — phone verification availability

- Scope: correct unavailable SMS behavior without implementing a provider or bypassing verification for ordering. Request and confirmation reject outside explicit local development/test mode; placeholder credentials and a production development flag cannot enable the path. Existing verified status is preserved.
- The profile server passes a derived availability enum only. Unavailable customers see guidance instead of nonfunctional code controls; development users see test-only labels and a local code. No SMS delivery is queued and notification text makes no delivery claim.
- API contracts document the development response and service-unavailable errors. Admin setup and NIloy/API_CONNECTION_GUIDE.md explain the missing sender and live acceptance requirements.
- Automated evidence: test:phone-verification-availability executes the handlers with simulated dependencies and renders unavailable/development component states. Covers authentication/origin checks, unavailable/no-write behavior, explicit mode, rate limits, code validation, no-store, no SMS outbox and local confirmation. This is not real SMS delivery or database workflow certification.
- Verification passed for this increment: lint, TypeScript, API contract generation/validation, security regressions, targeted availability tests and production build. No owner database, deployment secrets or live messaging service was changed.

## 2026-11-11 — controlled quarantined-photo rescan

- Implemented immutable rescan requests/results, current Admin/MFA checks before and after processing, review/reference/namespace/deadline binding, idempotent replay and enforced attempt limits. Scan proof covers only the exact normalized stored copy; every outcome preserves quarantine and evidence.
- Added the protected API and history-page control, independent scanner/storage setup validation, startup/Docker packaging and operator instructions. No production identity/inspection upload/download route, release action, replacement flow or video pipeline was activated.
- Reran `test:private-photo-rescans`, `test:private-photo-reviews`, `test:private-photo-quarantine` and `test:private-photo-delivery` successfully against generated schema `crossly_launch_verify_e259b029b1eaa9a2` in disposable PostgreSQL. The wrapper removed the schema afterward. PostgreSQL and encryption were real; S3/scanner responses were simulated. No owner database was used.
- Protected HTTP setup denial and desktop/mobile setup/history checks passed. Inspected 1440×1000 and 390×844 screenshots: no horizontal overflow. Configured live HTTP success and actual AWS/scanner acceptance remain staging work.
- Production-configuration regressions, private-scanner checks, 24 static container controls and Prisma validation passed. The production application build passed in the preceding phone-availability increment with this rescan source present.
- Scope/risks and manual prerequisites are documented in `docs/PRIVATE_PHOTO_RESCAN.md` and `NIloy/PRIVATE_PHOTO_STORAGE_SETUP.md`. The rescan flag remains disabled by default; credentials and configuration alone do not certify safe live operation.
- Docker runtime acceptance passed after building both images without application environment files. Disposable migration/runtime checks passed for startup, health/public pages, private-page guards, UID/read-only filesystem restrictions, signed email receipt checks and synthetic browser widgets. The test removed its owned containers/network/image tags and temporary credential files. The older disposable rescan PostgreSQL container was also removed after workflow acceptance. No live provider, cloud deployment, vulnerability/load test or physical device was certified.
- Lint, TypeScript, API contract and dependency-integrity checks passed. This is a verified increment, not full release/security clearance; existing launch blockers remain.

## 2026-11-11 — notification preference recovery and audit recheck

- Customer notification switches now wait for hydration, serialize changes, disable all switches during a pending save, use a bounded same-origin request and recover from network, JSON and HTTP errors. Only a matching, validated server response updates the chosen setting. An uncertain response asks the customer to reload and check persisted settings instead of claiming success. Essential and unavailable channels remain locked by the existing server policy.
- Extended test:notification-preferences with real API/PostgreSQL checks plus browser failure/success interception on 1440px desktop and 390px mobile. Network abort, missing/wrong-target data and denied HTTP responses preserve the current switch; pending controls prevent overlapping changes; confirmed success updates it. No-JavaScript controls stay disabled with guidance. No horizontal overflow was detected. Provider messaging was not activated.
- Initial isolated attempt encountered temporary PostgreSQL socket readiness before its TCP listener was ready. It made no application data changes and removed its container. A corrected TCP readiness wait passed the full isolated test, removed its generated schema and container. The Docker acceptance harness now also waits explicitly on TCP.
- Lint, TypeScript and the production application build passed for the customer component. Tests used a synthetic customer only; no owner database was accessed.
- Full dependency audit still fails with seven moderate package-chain findings rooted in GHSA-g3hv-75wg-m249; production-only audit reports zero. Reviewed official npm/upstream v8.72.2 metadata still requires affected minimatch ^10.2.2. No dependency version, audit threshold or gate was changed. Full security/release acceptance remains blocked.
- Docker runtime acceptance passed with the TCP readiness guard: image build/migrations, health/pages, private guards, runtime identity/read-only filesystem, signed email receipt checks and synthetic widgets. The harness cleaned up its owned resources. Static container controls and dependency-integrity checks also passed. Full dependency audit remains blocking as stated above.

## 2026-11-11 — notification read actions

- Single-read requests now preserve the first read timestamp across retries and concurrency. Ownership and trusted origin are enforced in the routes, identifiers are validated, and success responses use private no-store headers. Bulk delivery updates exclude still-unread notifications, including one inserted after the bulk notification update begins. External-channel receipts are not marked read by these in-app actions.
- Both customer buttons now wait for hydration, prevent duplicate active requests, use bounded same-origin requests, validate response identity/count/date fields, and recover with accessible errors instead of remaining stuck or silently claiming success. Mobile read targets have a 44px minimum height; error text wraps. No-JavaScript actions are disabled with guidance.
- New test:notification-read-actions is limited to a generated disposable local schema and is included in isolated launch verification. Real PostgreSQL/API coverage passed for authentication/origin/ownership, malformed IDs, six concurrent retries with stable first timestamps, bulk retry, a trigger-inserted concurrent arrival and rollback after injected delivery-update failures. Desktop/mobile browser coverage passed network abort, malformed/wrong-target responses, denial, duplicate-request guards and real successful reads.
- Initial browser attempt used a locator tied to the label that changes while saving; it was corrected to target the stable control. The successful rerun also passed notification-preference regressions, no-JavaScript controls and viewport overflow checks. Inspected the 390px screenshot. The wrapper removed its schema and disposable container after each run; no owner database or live provider was used.
- Lint, TypeScript, API contract generation/validation and production build passed. This increment does not resolve the recorded dependency audit or live-provider launch blockers.

## 2026-11-11 — phone verification binding and broader role acceptance

- Fixed phone-code lookup to bind HMACs to the account and exact phone number. Profile changes compare against the locked current account, invalidate outstanding phone codes and clear verification atomically. Existing unbound codes cannot verify an account; no migration or secret change is required. Email/password-reset token behavior is unchanged. Production SMS stays unavailable.
- Account mutations lock the user/session and recheck active account, current session, revocation and expiry before issuing/confirming codes or saving a profile. Confirmation evaluates code expiry after waiting for the lock. No code, phone-bound digest or raw provider diagnostic was added to public responses/audit metadata.
- test:phone-code-binding passed against real disposable PostgreSQL/API: wrong/old/unbound number codes, change-back invalidation, same-code account separation, one-time concurrent confirmation, concurrent number change, expiry during lock wait, and session revocation while request/confirmation/profile update waits. Customer-account and unavailable-SMS regression suites passed. The wrapper removed the schema/container; no owner database or live provider was used.
- Independently ran 22 selected customer, seller, warehouse, inspector, logistics, finance, compliance, sourcing, support, sales, shipping/returns, AI handoff and identifier/printing suites successfully, followed by seven Admin/MFA/recovery/session/logout suites successfully. These are selected automated workflows, not all-page/mobile/cloud/provider sign-off.
- Added test:sqa:isolated to repeat 33 selected suites with owned local Docker/PostgreSQL, generated credentials/schema, dynamic application port and live providers disabled. Instructions and manual acceptance boundaries are in NIloy/SQA_RUNBOOK.md. This runner does not waive the failing full dependency-audit gate.
- The new test:sqa:isolated command completed all 33 selected suites successfully in one owned disposable Docker/PostgreSQL environment. It removed its generated schema and container. Phone-code coverage also confirmed that a duplicate-number profile rejection rolls back token invalidation. No owner database or external provider was used.
- Recorded owner messaging choice (Bangladesh gateway + Meta WhatsApp) and researched SSL Wireless ISMS Plus as the SMS candidate, with BulkSMSBD as an alternative. Account-specific contract/receipts and live acceptance remain required; no provider was purchased, contacted or activated. See NIloy/SMS_WHATSAPP_SETUP.md.
- Manual final review added an independent per-account confirmation-attempt limit alongside the IP limit. Targeted real PostgreSQL/API tests then passed again, proving an exhausted account is blocked even with a healthy IP counter and without consuming the code. Customer-account and unavailable-SMS regressions passed again. Final production build passed. A dedicated independent Security Review agent was unavailable; these checks are not formal independent production security sign-off.

## 2026-11-12 — disconnected secure OTP transport

- Implemented server-only SSL Wireless secure OTP protocol with a fixed HTTPS endpoint, encrypted code body, signature, explicit approval and Bangladesh-only canonical input. Acknowledgements return ACCEPTED only; raw provider echoes/errors are discarded. No route or worker imports the transport, and production phone verification remains unavailable.
- Simulated tests passed for an independently generated encryption/signature fixture, input/configuration rejection, one-attempt failure behavior, random IVs, recipient/reference matching, oversized/invalid responses, body cancellation and connection/body deadlines. No real SMS or credentials were used.
- Lint, TypeScript, production build, 305-operation API contract, dependency integrity and targeted security regressions passed. This is protocol-level acceptance, not live SMS, all-page acceptance or independent security certification. Encrypted dispatch, account revalidation, delivery receipts/reconciliation and controlled provider acceptance remain required. Existing dependency-audit and other launch blockers remain unresolved.

## 2026-11-12 — encrypted OTP dispatch payload and preflight

- Added isolated payload sealing and dispatch preflight. The encrypted record binds account, issuing session, verification token, exact phone, code and expiry. It carries a stable random client reference. Tampering, unsupported payloads, wrong/missing production encryption keys, stale binding and inactive/used/verified states fail with one redacted error.
- Fixed transport acknowledgement checks to use a snapshot of the client reference, preventing caller mutation during asynchronous I/O from changing the reference checked or returned.
- Payload and transport tests passed using synthetic secrets and simulated transport; no database, SMS or provider account was used. Production-unavailable phone route/UI regression checks, lint, TypeScript, production build, API contract, dependency integrity and targeted security regressions passed.
- This does not implement durable enqueue/claim, database locking, delivery receipts or live dispatch. Fresh locked context, token lifecycle, one-attempt job claiming and uncertain-send reconciliation remain required worker work. No API imports these payload helpers. Production SMS, independent review and the recorded broader launch blockers remain unresolved.

## 2026-11-12 — durable OTP enqueue and one-attempt dispatch core

- Added transactional enqueue and an internal worker using existing encrypted notification deliveries. Account/session/token checks use authoritative locked rows. Concurrent producers create one job; concurrent workers commit one attempt. Claiming purges OTP ciphertext and records only an opaque client reference in audit metadata for reconciliation.
- Provider acceptance is not delivery. Timeout, process death or persistence failure after acceptance leaves a durable uncertain attempt that the worker never reclaims, including after accidental status reset. Decryption failures stop for operator review without deleting encrypted evidence. Invalidated account/session/phone/token jobs cancel without sender calls.
- The targeted suite passed twice against owned disposable PostgreSQL; final run additionally covered acknowledgement-persistence failure and session revocation while waiting on the account lock. Sender calls were simulated. Generated schema/container were removed and transient Next.js includes were removed from tsconfig. No owner database, real SMS or provider account was used.
- Payload/transport tests, lint, TypeScript, production build, production-unavailable phone route/UI regression, API contract, dependency integrity and targeted security regressions passed. The standard isolated SQA runner now includes 34 suites; this increment ran the new database suite, not all 34 suites. Full launch verification and the known dependency audit remain separate unresolved gates.
- The core is not connected to a public request route, scheduler, provider secret resolver or Admin activation switch. Protected issuance/rate-limit integration, authenticated receipts, operator reconciliation, retention, controlled provider acceptance and independent security review remain outstanding. Production SMS remains disabled.

## 2026-11-12 — transactional queued phone-code issuance

- Added an internal issuance service that locks/rechecks the account/session/expected phone, enforces an account-wide resend cooldown, generates a secure code and commits token replacement, cancellation of unattempted old jobs, encrypted enqueue and minimal audit evidence together. Attempted jobs preserve their reconciliation state. Returned data contains no code, hash, phone or provider reference.
- Added bounded historical-code collision handling and snapshots of caller identity before asynchronous locks in issuance/enqueue. New token creation time is taken after locking. The existing public request/confirm routes and production-unavailable gate were not changed.
- Extended real disposable PostgreSQL acceptance passed twice, with the final run covering simultaneous issuance/cooldown, replacement/invalidation, rollback preserving prior token/job, wrong-phone rejection, preserved accepted claims, forced collision exhaustion, input mutation and issuance-to-simulated-dispatch. The generated schema/container were removed; transient Next.js tsconfig entries were cleaned. No owner database or real SMS was used.
- Lint, TypeScript, production build, payload/transport tests, production-unavailable route/UI checks, API contract, dependency integrity and targeted security regressions passed. This is internal workflow acceptance; public issuance connection, scheduling, authenticated receipts, reconciliation, retention, live provider acceptance and independent security review remain outstanding. The existing full dependency-audit release blocker remains unresolved.

## 2026-11-12 — Admin SMS review and obsolete OTP payload cleanup

- Added a read-only Admin Notifications → SMS verification review page with role/portal/MFA enforcement, bounded filters/pagination and expandable review instructions. Explicit projections omit phone numbers, customer contacts, notification bodies, encryption fields and unrelated audit metadata. Labels separate submission acceptance from handset delivery; no resend, status-reset or manual delivery override was added.
- Added internal obsolete-payload cleanup for unattempted queued jobs with expired/used/missing or incorrectly owned/purposed tokens. Conditional updates and minimal audit records commit together. Competing cleaners purge once; active tokens and attempted/reconciliation records are preserved. Scheduling/maintenance activation remains unimplemented.
- New operations acceptance passed with real disposable PostgreSQL and browser checks at 390px/1440px. Tested anonymous/non-MFA/wrong-portal/forged-role denial, empty/filter/pagination states, sensitive-field omission, mobile overflow and concurrent retention cleanup/auditing. Screenshots were reviewed and mobile instructions were made compact. Final operations + queued-issuance/worker suites passed together. Generated schema/container and temporary Next.js includes were removed; no owner DB or SMS provider was used.
- Lint, TypeScript, production build, targeted security regressions, production-unavailable phone route/UI checks, API contract and dependency integrity passed. The SQA runner now includes 35 selected suites; this increment did not rerun all 35 or resolve the existing dependency-audit gate.
- Public provider documentation research did not establish a verifiable receipt endpoint/signature/final-event contract. Receipt handling and reconciliation mutations remain blocked pending the account contract. Production SMS stays disabled. Owner handoff: NIloy/SMS_OPERATIONS.md.

## 2026-11-12 — OTP retention connected to authenticated maintenance

- Connected obsolete OTP payload cleanup to the existing security-cleanup transaction, Admin manual run and bearer-authenticated scheduler route. The job records inspected/purged counts and preserves attempted SMS claims. No SMS sender, receipt override, new endpoint or schema migration was enabled.
- Added explicit Admin role/portal/MFA checks to maintenance configuration reads/writes, manual runs and the maintenance page. Run history renders only whitelisted nonnegative counts. Client controls reset busy state on failed requests and reject malformed/incomplete responses instead of reporting false completion; uncertain outcomes direct operators to run history.
- Final real disposable PostgreSQL/browser acceptance passed for authorized scheduler/manual cleanup, invalid/missing scheduler credentials, wrong-origin and unverified/wrong-portal/forged-role rejection, unchanged attempted jobs, persisted run counts and client network/JSON/incomplete-success recovery. The existing security cleanup regression also passed for technical retention, inventory release, audit preservation and overlap locking. Generated schema/container and temporary Next.js includes were removed; no owner database or SMS provider was used.
- Lint, TypeScript, production build, 305-operation API contract, targeted security regressions, dependency integrity and production-unavailable phone checks passed. Full dependency audit, all-suite SQA and independent production security sign-off were not claimed. Cleanup test execution now rejects owner/non-disposable database schemas.
- Updated NIloy/SMS_OPERATIONS.md with the actual Admin control and existing scheduler contract. Cloud scheduling is not configured in an owner account. Live SMS issuance/sending, provider receipts, reconciliation mutations and provider certification remain gated.

## 2026-11-12 — immutable SMS investigation acknowledgements

- Added a confirmation-only versioned API and mobile form for acknowledging an uncertain OTP investigation. Admin role/portal/MFA, trusted origin and strict input gates apply. The transaction rechecks account/session/role, locks the job and rechecks session expiry after waiting. A single audit record preserves the first reviewer/time; retries return the existing acknowledgement.
- Job state, attempts, recipient, provider reference and encrypted fields are not changed. No resending, requeue, delivery override or provider activation is possible. UI displays the original reviewer and distinguishes acknowledgement from resolution/assignment/provider evidence. No free-text evidence or credentials are accepted.
- Final disposable PostgreSQL/API/browser tests passed for auth/origin/strict-body rejection, concurrent/repeated calls producing one audit, exact send-row preservation, rejection after racing acceptance, and mobile failure recovery followed by successful acknowledgement. The queued issuance/worker regression passed alongside operations. A 390px review-card screenshot was inspected. Generated schema/container and temporary Next.js includes were removed. No owner database or real SMS was used.
- Lint, TypeScript, production build, 306-operation API contract, targeted security regressions, dependency integrity and production-unavailable phone checks passed. The SQA suite count remains 35; only the targeted operations + job suites were rerun. Full audit/all-page/independent production security acceptance remains outstanding.
- Receipt ingestion, evidence-backed reconciliation and live SMS remain gated on the provider contract and certification. Owner instructions updated in NIloy/SMS_OPERATIONS.md.

## 2026-11-12 — complete selected 35-suite workflow run and dependency recheck

- Ran test:sqa:isolated against application source commit 163a837. All 35 declared suites completed successfully in order in one owned disposable Docker/PostgreSQL environment with synthetic credentials and live providers disabled. Verified the count/order, success marker and owned-container cleanup. Removed temporary Next.js includes after schema/server/container cleanup. No owner database or real provider was used.
- Coverage included authentication/recovery/revocation, customer cart/coupons/account flows, seller moderation/imports/connections, all employee role portals, ordered tracking/POD, Ship for Me, claims/refund linkage, support/policy/AI handoff, Sales/KAM, identifiers/80 mm views, 32 Admin destinations, audit/readiness, notification controls and OTP binding/issuance/worker/operations/investigation/maintenance. This is selected automated acceptance, not all-page/physical-device/live-provider certification. No application fix was required by this run.
- Full npm audit still failed with seven moderate package-chain findings rooted in GHSA-g3hv-75wg-m249; high/critical counts were zero. Production-only audit passed with zero vulnerabilities. Registry metadata confirmed current TypeScript ESLint 8.72.2 still requires minimatch ^10.2.2; the advisory fix begins at 11.0.1. The compatible dry run proposed only brace-expansion 5.0.12 to 5.0.13 and left seven findings. No dependency/lockfile change, override, downgrade or waiver was applied.
- Build/type/lint/API checks remain those recorded for the preceding implementation; no application source changed here. Release remains blocked by the full dependency audit and recorded provider/cloud/load/security/device requirements. Updated the owner SQA runbook and release status.
- Local log: /tmp/deshdak-sqa35-20261112.log, SHA-256 9eb27c850ad58a6f34c1f7dfbf34078897aa284aee18965fc854b1704d33c005. Audit diagnostics: /tmp/deshdak-audit-20261112.json, /tmp/deshdak-production-audit-20261112.json and /tmp/deshdak-audit-plan-20261112.json. Temporary logs are local evidence, not long-term certified reports.

## 2026-11-13 — session authorization and notification refresh hardening

- Fixed the shared resolver to require ACTIVE, non-deleted accounts; pending accounts could previously keep an existing cookie despite being unable to log in again. Google callback account eligibility now follows the same ACTIVE-only rule. Unknown role codes fail closed.
- Guarded last-seen writes and re-read identity, roles and MFA after a heartbeat wait. Real PostgreSQL tests prove rejection/reduction of access after concurrent revocation, expiry, role removal or MFA clearing, while healthy concurrent refresh remains valid. Existing Admin/Finance portal filtering stays intact.
- The first broad run stopped at a mobile notification unread-counter assertion; a focused rerun did not reproduce it. Review found that read controls could clear busy state before the server refresh completed. Added transition-aware pending state and a deterministic browser test holding that refresh. No timeout/retry increase or optimistic forced-zero count was applied.
- A later broad run reached the final SMS suite but stopped because its screenshot locator matched a temporary Suspense fallback. The locator now waits for the Admin workspace and selects its visible card. This was a test readiness correction, not an application authorization bypass.
- Final test:sqa:isolated on 13 November completed all 36 declared suites successfully in one clean run; count/order and cleanup markers were verified. This includes the new session races, desktop/mobile read controls and final SMS operations. Generated schema/server/container and temporary Next.js includes were removed. No owner database or live provider was used.
- Lint, TypeScript, production build, 306-operation API contract, targeted security regressions, dependency integrity and production-unavailable phone checks passed. No cookie name, secret, schema, token lifetime or public API shape changed. Full dependency audit/live provider/cloud/device/independent security release gates remain unresolved.
- Evidence: /tmp/deshdak-sqa36-20261113.log and /tmp/deshdak-session-hardening-build-20261113.log. Earlier diagnostic runs remain in /tmp/deshdak-session-read-diagnostics.log, /tmp/deshdak-read-refresh-final.log and /tmp/deshdak-sqa36-final-20261112.log. Owner runbook updated; no new manual configuration is needed for the code fixes.

## 2026-11-13 — private upload commit authorization

- Identity and inspection evidence intake now recheck account/session/portal/grants and relevant package/warehouse assignment inside the save transaction. Concurrent revocation, role/assignment changes or ineligible package state prevent file/domain writes and produce a minimal denial audit.
- Three targeted disposable workflow suites passed together, including actual multipart race tests and existing positive identity/capture/viewing workflows. Lint/type/build, API contract (306 operations), security regressions and dependency integrity passed. No owner DB/live provider was used; owned schema/container cleanup passed.
- The selected SQA runner now includes 37 suites; the latest complete selected acceptance remains the preceding 36-suite run. Production uploads remain gated. See docs/PRIVATE_UPLOAD_COMMIT_AUTHORIZATION.md for evidence and limits.

## 2026-11-13 — existing private download authorization

- Added a final transactional authorization check to existing identity-document and inspection-evidence downloads. Fresh account/session/portal/role/MFA and inspection warehouse/order ownership checks prevent stale-access delivery; final successes/denials are audited without file contents. Inspection response now includes same-origin resource policy.
- Three targeted disposable suites passed together: private-download-authorization, private-upload-workflow and inspector-portal. Nine controlled HTTP races verify denial after access changes; positive encrypted viewing/capture workflows pass. Generated schema/container cleanup completed, with synthetic photos only and no owner DB/live provider.
- Runner now selects 38 suites; no new full38 acceptance is claimed. See docs/LEGACY_PRIVATE_DOWNLOAD_AUTHORIZATION.md for scope and evidence. Production private uploads and remaining release gates stay closed.
- Lint, typecheck, production build, 306-operation contract, security regressions and dependency integrity passed. No dependency, schema or credential change. Build evidence: /tmp/deshdak-private-download-build-20261113.log.

## 2026-11-13 — transactional identity review authorization

- Compliance identity decisions now recheck ACTIVE account/session/portal/role/MFA in the save transaction. Reviewer/customer accounts are locked in identifier order before submission updates, aligning with customer-first replacement. Denials audit ACCESS_CHANGED without private evidence and leave identity/customer state untouched; existing version/status conflicts remain 409.
- Three targeted disposable suites passed together: identity-review-authorization, private-upload-workflow and compliance-portal. Controlled authorization races, concurrent opposing reviewers (one success/one conflict), replacement conflict, valid rejection, origin/role/MFA and real identity-upload regressions passed. Schema/container cleanup completed; no owner DB/live provider used.
- Runner now selects 39 suites; no complete39 acceptance claimed. Scope and evidence: docs/IDENTITY_REVIEW_AUTHORIZATION.md. No new manual setting or production activation.
- Lint/type/build, 306-operation API contract, security regressions and dependency integrity passed. Build evidence: /tmp/deshdak-identity-review-build-20261113.log. Existing dependency/provider/cloud/device release gates remain unresolved.

## 2026-11-13 — complete selected 39-suite acceptance and maintenance readiness

- The initial complete 39-suite run reached the final SMS operations suite but stopped while waiting for a mobile cleanup error. Source review found that the cleanup/policy buttons were server-rendered as enabled before client handlers were ready. They now use the existing shared client-ready hook and stay disabled until interactive. Backend authorization and cleanup policy are unchanged.
- Added deterministic mobile delayed-script coverage asserting both controls are disabled before hydration. After scripts resume, the test verifies the cleanup POST is actually issued and that aborted, non-JSON and malformed-success responses restore usable controls with clear recovery instructions. No test deadline/retry or production guard was weakened.
- The first focused diagnostic attempt encountered a test interception lifecycle error after removing a script route while its handlers resumed. Keeping that released handler until context close corrected the harness. The focused operations suite then passed; the original failed logs are retained separately.
- Final complete test:sqa:isolated passed all 39 declared suites together, in order, including the three new private-upload/private-download/identity-review authorization suites. Generated schema/container cleanup was verified and temporary Next.js includes removed. No owner DB, real customer documents or live provider was used.
- Evidence: /tmp/deshdak-sqa39-final-20261113.log, SHA-256 913dd3b81ae6394bc2431c3aa1bc95ed39685f831200c341492160a1b56f6c09. Initial complete-run failure: /tmp/deshdak-sqa39-20261113.log. Focused evidence: /tmp/deshdak-maintenance-ready-final-20261113.log; initial harness diagnostic: /tmp/deshdak-maintenance-ready-20261113.log. These temporary local logs are not long-term certified release reports.
- This is selected automated workflow acceptance, not full page/device/provider/security certification. Remaining dependency, production storage/scanning/lifecycle, provider, cloud/load and physical-device acceptance gates are unchanged. Owner runbook updated.
- Final lint, TypeScript, production build, 306-operation API contract, security regressions and dependency integrity passed. Build evidence: /tmp/deshdak-sqa39-build-20261113.log. No schema, dependency, credential, rate-limit or cleanup-policy change was made.

## 2026-11-13 — identity decision UI recovery and dependency recheck

- The identity decision control could remain stuck on Saving after network/JSON failures. Added bounded request handling, safe result validation, accessible failure text, finally-based control recovery, hydration gating and transition-aware queue refresh. Backend version/status/authorization controls are unchanged.
- Extended identity review verification passed 390/1440px network/non-JSON/malformed-success failures, no-JavaScript disabled state and a real successful decision held pending through RSC refresh. Existing authorization/concurrent-decision/replacement cases remain passing. Initial two-suite run also passed Compliance portal; final focused suite uses a bounded request wait for refresh readiness. Owned schema/container cleanup passed; synthetic media only, no owner DB/provider.
- Evidence: /tmp/deshdak-identity-decision-ui-20261113.log and /tmp/deshdak-identity-decision-ui-final-20261113.log. The preceding full 39-suite acceptance is unchanged historical evidence and was not repeated for this increment.
- Full npm audit recheck still reports seven moderate findings, zero high/critical. Registry metadata shows latest TypeScript ESLint 8.72.2 still requires minimatch ^10.2.2, while the advisory patch begins at 11.0.1. No dependency, lockfile, override or audit gate changed. Sources: https://github.com/advisories/GHSA-g3hv-75wg-m249 and https://github.com/typescript-eslint/typescript-eslint/releases. Local evidence: /tmp/deshdak-audit-20261113.json and /tmp/deshdak-estree-latest-20261113.json. Production audit was not repeated in this increment.

Lint, TypeScript, production build, 306-operation API contract, security regressions
and dependency integrity passed for this UI follow-up. Build evidence:
/tmp/deshdak-identity-decision-ui-build-20261113.log. Full dependency audit remains
blocked; no production integration was enabled.

## 2026-11-13 — restricted-goods decision authorization and UI

- Admin/Compliance screening decisions now lock and recheck account/session/portal/grant/MFA/expiry in the save transaction. Access changes leave screening state/version and catalog effects untouched, produce a minimal denial audit and return the existing 403. Existing state/version conflicts and exact-retry/publication policy remain unchanged.
- Shared decision UI is hydration-gated, duplicate-guarded and bounded; malformed success is rejected, failures recover visibly, and pending state lasts through queue refresh. Both portals passed 390/1440px browser failure/no-JavaScript/held-refresh checks alongside ten controlled access-change races and single-winner concurrent decisions.
- Screening authorization, Compliance portal and identity authorization suites passed together. Existing restricted-goods regression passed separately, including publication withdrawal/restoration, approved exact retry and checkout hard block. Owned cleanup completed; no owner DB/providers used. Evidence: /tmp/deshdak-screening-review-20261113.log and /tmp/deshdak-restricted-goods-regression-20261113.log.
- SQA now selects 40 suites; this increment does not claim a full40 run. The earlier full39 acceptance remains historical. Engineering scope: docs/SCREENING_REVIEW_HARDENING.md; operator steps: NIloy/COMPLIANCE_REVIEW.md. Remaining release gates stay closed.

Lint, TypeScript, production build, 306-operation API contract, security regressions
and dependency integrity passed. Build evidence:
/tmp/deshdak-screening-review-build-20261113.log. No dependency or release gate
was weakened.

## 2026-11-13 — Admin compliance rule controls

- Draft creation and status changes now reauthorize Admin account/session/portal/grant/MFA/expiry inside the mutation transaction, with minimal denial audit. Status/effective-window checks now use a locked current rule. Authorization is checked again after rule-lock waits to reject natural session expiry; archived rules cannot be revived with a guessed newer version during an archive race.
- Create/status UI now handles network/non-JSON/malformed responses, preserves unconfirmed create values, validates returned identity/status/version, gates pre-hydration controls and stays pending through refresh. Successful create reset uses a captured form element, fixing an asynchronous event reference bug.
- Final isolated run passed rule-control, restricted-goods and screening-review suites together. Includes ten create/status access-change races, archive/expiry/session-expiry waits, 390/1440px failure recovery, no-JavaScript disabled controls, real create/reset/held-refresh and activation/pause/archive. Existing public-catalog withdrawal/restoration, scheduling/expiry, hard-block checkout and exact approved retry regressions passed. Owned cleanup verified; no owner DB/providers or real policy used.
- Evidence: /tmp/deshdak-rule-controls-final-20261113.log (initial targeted run before natural-expiry addition: /tmp/deshdak-rule-controls-20261113.log). Runner now selects 41 suites; no full41 acceptance is claimed. Engineering: docs/COMPLIANCE_RULE_CONTROLS.md; operator instructions: NIloy/COMPLIANCE_REVIEW.md. No manual setting needed; release gates remain open.

Final lint, TypeScript and production build passed. The 306-operation API contract,
security regressions and dependency integrity also passed for this increment.
Build evidence: /tmp/deshdak-rule-controls-build-final-20261113.log. No release
gate was waived.

## 2026-11-13 — catalog maintenance authorization and UI recovery

- Manual catalog maintenance rechecks Admin account/session/portal/grant/MFA/expiry before claim, after job-row lock wait and before catalog effects. Lease/run creation is atomic. Pre-work access loss records denial and a failed claimed run without catalog changes; insertion failure rolls back the lease, and success-audit failure rolls back work and records failure/release. Scheduler secret and rule policy remain unchanged.
- Control now validates completion payload/counts, recovers from network/JSON failures, gates pre-hydration and remains busy through refresh. Final isolated run passed catalog-control, restricted-goods and rule-control suites together, with five access races, natural expiry during job-row wait, injected post-claim revocation/run/audit failures, lease skip, scheduler auth and mobile/desktop recovery/real completion.
- Initial combined run stopped on an Admin fallback duplicate locator in the rule test after the first two suites passed. Scoped to visible hydrated workspace after navigation readiness; no assertion/deadline weakened. Final generated schema/container cleanup completed; no owner DB/provider or real policy used.
- Evidence: /tmp/deshdak-catalog-controls-final-20261113.log; initial diagnostic: /tmp/deshdak-catalog-controls-20261113.log. Scope/limits: docs/COMPLIANCE_CATALOG_CONTROLS.md; owner steps: NIloy/COMPLIANCE_REVIEW.md. Runner now selects42; no new full42 run claimed. Prior full39 acceptance is historical; production release gates remain open.

Lint, TypeScript, production build, 306-operation API contract, security regressions
and dependency integrity passed. Build evidence:
/tmp/deshdak-catalog-controls-build-20261113.log. No dependency/release gate was
waived and no production service enabled.

## 2026-11-13 — complete selected 42-suite acceptance

- Ran test:sqa:isolated against source commit 9f17ba6. All 42 declared suites passed together, in declared order, without application/test changes during that run. Verified unique count/order, success marker, schema removal and owned-container cleanup. Removed generated Next.js includes. No owner database, real customer documents, policy deployment or live provider was used.
- The complete selected run now includes current identity review UI/backend, restricted-goods review authorization, Admin rule controls and catalog job controls alongside authentication/recovery/sessions, customer/seller flows, all selected employee portals, ordered tracking/POD, claims/refunds, support, Sales/KAM, scanning/80 mm identifiers, Admin navigation/audit/readiness, notifications and phone/OTP operations.
- Evidence: /tmp/deshdak-sqa42-20261113.log, SHA-256 d64c5d059fba252c881e89b31b482d65dcdfb8a952934653aa988a7e5497e1fe. The catalog build/lint/type/API/security/integrity acceptance recorded above applies to the same unchanged application source. This append changes documentation only; it does not rerun or waive the full dependency audit.
- Owner SQA runbook updated. This is selected workflow acceptance, not all-page/physical-device/live-provider/cloud/security certification. Remaining production storage/scanning/lifecycle, provider adapters/configuration, dependency-security, cloud/load/device and independent review gates remain open. No push/deployment or live service activation was performed.

## 2026-11-16 — Admin security cleanup and retention controls

- Manual cleanup and retention updates recheck the current Admin account, session, role and MFA inside database transactions. Cleanup claims its lease and creates its run record atomically. Completion and failure are tied to the claimed lease. Retention deletes recheck eligibility for rate-limit counters and AI conversations.
- The maintenance page shows whether the lease is currently active. Controls prevent duplicate submission, validate confirmations and remain disabled through the refresh.
- The isolated security cleanup and phone OTP operations suites passed together. Coverage includes Admin policy persistence, revoked-session rejection, run-insert failure rollback, successful retry and completion audit, scheduler cleanup and overlap, and Admin browser access and recovery. The isolated schema and container were removed. Evidence at /tmp/deshdak-security-maintenance-20261116.log.
- These were targeted suites following the earlier full selected 42-suite run. Live providers and owner data were outside this verification.
