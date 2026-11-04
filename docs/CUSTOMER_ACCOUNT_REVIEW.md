# Customer account regression increment — 23 October 2026

Scope: personal-customer dashboard, order list and an owned three-line draft order
at 1440×1000 and 375×812. This is not full customer or all-page acceptance.

## Corrections

- Optional analytics preference requests now have a deadline and recover from
  network, malformed JSON and unconfirmed responses. The checkbox retains the
  last confirmed setting; retries become available. Saves are announced and the
  checkbox has an explicit accessible label. Before hydration it is disabled with
  guidance. Recorded timestamps use an explicit UTC timezone.
- Order quantity now includes all item rows, not only the first two. Order lists
  load only the latest two status events per order, preserving display order.

## Verification

Targeted lint, TypeScript and production build passed. Isolated Chromium run:
8 cases passed (three setup, five account cases), zero skips/failures, 40.4 seconds.
The real privacy save persists across reload; abort/malformed-response recovery,
cross-origin rejection, no-JavaScript disabled control, empty-state links,
six-item quantity, owned order navigation and three detail rows were checked.
Anonymous/warehouse sessions cannot open these customer pages; another customer's
detail and timeline return 404. Session teardown and post-browser checks passed;
the generated database schema was removed. No owner database/provider mutations.

HTML/screenshots: `playwright-report-account-review/`; JUnit:
`test-results-account-review/junit.xml`. Initial failing HTML report retained at
`playwright-report-account-review-initial/`: the test incorrectly expected 403
instead of the existing privacy-preserving 404. An earlier fixture setup lacked
the required password hash and was corrected without changing application auth.

Desktop/mobile screenshots were inspected. Cards wrap without horizontal overflow
in these fixtures. Full-page mobile captures include sticky header/navigation at
the saved scroll position; they are not sufficient evidence of every viewport's
overlay behavior. Real-device, keyboard, overlay and comprehensive visual review
remain open. The full combined suite now contains 61 cases but has not been rerun
as a combined suite after this increment; the prior 56-case run remains separate.

## Remaining scope

- Business-customer role support across account routes/APIs requires a separate
  compatibility review; this increment tests personal customers only.
- Order pagination, zero-line quantity wording, all terminal/payment/RMA states,
  private legacy history review and broader detail-page actions remain unaccepted.
- No production readiness claim; the known lint dependency advisory remains open.

## Follow-up: shipment claim windows — 23 October 2026

The order-detail expired-window branch was unreachable: it repeated the same
condition as the open-form branch. The page now compares each recorded shipment
deadline against request-time UTC and shows the expiry guidance instead of a form
after the deadline. The existing server API independently enforces the deadline;
no authorization, deadline override, refund or payment rules were changed.

The isolated account fixtures now cover delivered/open, delivered/expired,
delivered/missing deadline, in-transit, damaged/open and lost/expired shipments.
Both desktop and mobile assert two correctly identified open forms, two expired
messages and two unavailable messages. Direct expired-claim POSTs return 422
`CLAIM_WINDOW_EXPIRED`; the post-browser database check confirms zero RMAs created
for the review order. Existing account recovery/access tests also ran.

Eight cases passed in 34.6 seconds, including setup, with successful global session
cleanup and schema removal. Targeted lint, TypeScript and production build passed.
Evidence: `playwright-report-claim-review/`, `test-results-claim-review/junit.xml`.
The preceding run passed its cases but failed teardown with a development-server
empty-manifest error; its report is retained as
`playwright-report-claim-review-initial/`, not counted as an overall pass. The fresh
rerun used unchanged source during execution; the original manifest cause is not
claimed globally resolved. The full combined 61-case suite was not rerun.

Binding references read: Order & Logistics Workflow section 5 and Company Policies
v1.1 section 1.5. Existing-claim rendering, successful claim creation, evidence
uploads, exceptional Admin overrides and business-customer role compatibility
remain outside this narrow correction. An already open browser page may cross a
deadline before refresh; the API still rejects late submissions.

## Follow-up: claim submission recovery — 24 October 2026

`RmaCreateForm` now bounds requests to 15 seconds, catches network/JSON/unconfirmed
success failures, releases its pending state and keeps entered details. An
unchanged retry reuses its in-memory idempotency key; changed details receive a new
key. A synchronous pending guard blocks duplicate submissions. Only a confirmed
UUID claim identifier permits navigation to the local claim route. Before
hydration the inputs/button are disabled, guidance is visible and the form uses
POST rather than leaking fields through a native GET. Deadline text uses explicit
UTC formatting. Authentication and server claim rules are unchanged.

Eight isolated setup/account cases passed in 52.3 seconds, including desktop and
mobile aborts, malformed JSON, an invalid success identifier, validation errors,
preserved input, stable retry keys, changed-payload keys, pending duplicate-submit
blocking and no-JavaScript disabled submission. Global session cleanup,
post-browser checks and zero-created-RMA assertion passed; the schema was removed.
Lint, TypeScript, production build and diff checks passed. Evidence:
`playwright-report-claim-recovery/`, `test-results-claim-recovery/junit.xml`.

Submission recovery responses were mocked in the browser: this is not evidence of
successful claim creation, approved evidence storage, refunds or notifications.
Keys persist only within the mounted form, not after reload. Customers are told to
check All claims before retrying an uncertain submission. The 15-second deadline
is implemented but an elapsed-time timeout case was not separately exercised.
Message and return-tracking forms still need their own recovery review. Business
role support, real evidence-upload UX and combined-suite acceptance remain open.

## Follow-up: claim messages and return tracking — 24 October 2026

The message and return-tracking forms now share bounded, same-origin request
handling with redirect rejection, a synchronous pending guard, disabled fields
while saving, no-JavaScript guidance and POST fallback. Network, JSON and
unconfirmed-success errors release the pending state and preserve input. Confirmed
responses must match the claim and submitted content before clearing the form and
refreshing. Success/error feedback uses status/alert roles. No server RBAC,
transition, refund, schema or notification-delivery behavior was changed.

These two APIs do not provide replay keys. No automatic retries or cross-request
deduplication guarantee was added: after an uncertain save, the UI explicitly asks
customers to reload and inspect the conversation/tracking before retrying. A
15-second deadline is implemented; elapsed-time expiry was not separately tested.

Ten targeted setup/account cases passed, including desktop/mobile failure recovery,
preserved inputs, invalid success responses, validation/state conflicts, pending
duplicate-submit blocking, no-JavaScript disabled controls and real API saves into
disposable approved-return fixtures. Reload and API reads confirmed one message
and RETURN_IN_TRANSIT tracking per fixture. Database checks confirmed exactly one
message, one return-transition event, and one message/return audit entry each.
Trusted-origin rejection, anonymous 401 and other-customer 404 were verified.
Global session teardown, post-browser checks and schema removal passed. Lint,
TypeScript, production build and diff checks passed.

Evidence: `playwright-report-claim-updates/`,
`test-results-claim-updates/junit.xml`. Two failing test reports are retained:
`playwright-report-claim-updates-initial/` (form locator depended on changing button
text) and `playwright-report-claim-updates-context/` (supposedly anonymous test
context inherited the project customer state). The latter made one extra synthetic
message before failing, confined to the schema subsequently removed. Anonymous
verification now explicitly starts with empty cookies/origins; no application auth
bypass was inferred from that test setup error.

No real messages to providers, physical returns, refunds, live notification
delivery, evidence upload or production mutations occurred. The combined suite is
now 63 cases and has not been rerun together. Comprehensive visual/device review,
business-customer compatibility and remaining production gates still apply.

### Combined rerun

The later 24 October combined run passed all 63 cases, global teardown and
post-browser checks in 426.49 seconds with zero failures/errors/skips. The earlier
statements that the expanded suite had not yet run describe their increment-time
status, not the current result. See `PAGE_WORKFLOW_ACCEPTANCE.md` and
`test-results-combined-63/junit.xml`. Comprehensive page/device acceptance and the
listed external/production prerequisites are still not certified by this run.

## Follow-up: devices and sessions — 24 October 2026

The session panel now recovers from network/JSON/unconfirmed-response failures,
retains the displayed active state until confirmation, bounds requests to 15
seconds and prevents overlapping actions with a synchronous pending guard. Controls
are disabled until hydration with explicit guidance; dates use UTC. Responses must
identify the requested session or protected current session and contain valid
revocation data before local state is changed.

The displayed count is now labelled as sessions shown, not a total across the
account. Confirmation explains that bulk sign-out includes devices outside the
25-row recent list and preserves this browser. The bulk action remains available
even when the recent list shows no other active session. Server ownership,
current-session protection, atomic audit/revocation and authentication behavior
were not changed.

Twelve targeted setup/account cases passed in 88.505423 seconds, zero
failures/errors/skips. Desktop/mobile session cases exercised no-JavaScript
disabled controls, abort/malformed/unconfirmed responses for single and bulk
actions, canceled bulk confirmation, real single/bulk revocation, invalidated
secondary cookies, protected current-browser access, another user's session 404,
forged-origin 403 and reload persistence. Existing account/claim checks, teardown,
post-browser integrity checks and schema removal passed. Lint, TypeScript,
production build and diff checks passed. Reports: `playwright-report-session-ui/`
and `test-results-session-ui/junit.xml`.

Failed evidence is retained: `playwright-report-session-ui-initial/` stopped on the
existing privacy-save assertion deadline and cleanup's development-server
"Manifest file is empty" error; `playwright-report-session-ui-locator/` failed
because an unscoped alert locator also matched Next.js's hidden route announcer.
The test locator was scoped to the session panel. No timeout was increased; the
later pass does not establish a root-cause fix for intermittent runtime/timing
failures. These remain a verification reliability follow-up.

The suite now contains 65 cases; the expanded suite has not run together after
this change. More-than-25 active-session fixtures, elapsed-time timeout and direct
double-dispatch cases were not exercised here. Full profile/address/identity
recovery, comprehensive mobile/keyboard/device acceptance and production gates
remain open. All mutations used disposable synthetic customer sessions only.

## Follow-up: phone and identity verification UI — 24 October 2026

Identity upload now captures the form before awaiting the response, correcting
the async event-target reset defect. All three verification actions share bounded
same-origin requests, redirect rejection, pending guards and failure recovery.
Inputs/buttons are disabled before hydration and while saving; fallback forms use
POST. Network/JSON/unconfirmed-success failures preserve entered fields and the
selected file. Only matching success shapes announce requested/verified/pending
review states; a code request is not described as delivered. A new request clears
old development-code feedback. No automatic retry was added. Phone operations use
15-second deadlines, uploads 30 seconds; elapsed-time expiry was not separately
tested. Server authorization, verification rules and upload gates were unchanged.

The first run found real mobile horizontal overflow on /profile, as well as the
previously tracked empty-manifest logout cleanup error. The retained failing report
is `playwright-report-verification-ui-initial/`. The verification grid children and
native form controls now permit shrinking; fields are constrained to container
width, and step headers may wrap. No global overflow hiding was added. Layout
assertion diagnostics now report element classes/geometry, not private field
values. The subsequent 14-case account batch passed in 132.222587 seconds with
zero failures/errors/skips, global session cleanup and post-browser checks passing;
the schema was removed. Lint, TypeScript, production build and diff checks passed.
The manifest failure remains an unresolved runtime-reliability follow-up.

Desktop/mobile cases cover aborts, malformed JSON, invalid success payloads,
unavailable service responses, preserved input/file, pending duplicate upload,
safe no-JavaScript controls and confirmed-response form reset without page errors.
All verification mutations were mocked, with a synthetic UI-only file containing
no identity image. Real authenticated reads confirmed no identity submission and
no phone verification persisted. This is not SMS delivery, malware scanning,
encrypted storage, KYC approval or production integration acceptance. Production
upload remains fail-closed pending approved private-storage/scanning configuration.

Reports: `playwright-report-verification-ui/` and
`test-results-verification-ui/junit.xml`. Profile screenshots were inspected:
verification fields fit the tested 375px mobile and 1440px desktop widths. Full-page
mobile captures still show sticky/fixed controls at capture positions; they do not
certify all overlay, keyboard or real-device behavior. Screenshot success messages
represent mocked presentation states, not saved verification evidence.

The combined suite is now 67 cases and has not run together after this increment.
Full profile/address CRUD recovery, pending/verified/rejected identity states,
business-role compatibility and production provider/security gates remain open.

## Follow-up: profile and address CRUD recovery — 24 October 2026

Profile saves and address creation/edit/default/removal now use readiness and
synchronous pending guards, bounded same-origin requests and redirect rejection.
Failed, malformed or unconfirmed responses release the saving state and preserve
entered details. Explicit error/status state replaces message-text guessing;
success requires a matching returned resource. Forms use POST and remain disabled
without JavaScript. No automatic mutation retry or new API idempotency is claimed.

Real creation testing found that blank optional address line 2/postal code were
sent as null although the create contract expects strings. The form now sends
empty strings, leaving existing server normalization and API contracts unchanged.

Five targeted cases (three setup plus desktop/mobile CRUD) passed in 49.036902
seconds, with zero failures/skips/errors. Coverage includes four request-failure
modes, preserved fields, persisted profile save, two addresses, edit, default
selection, canceled removal, replacement default, final empty-book reload,
cross-customer PATCH/DELETE rejection and forged-Origin rejection. Post-run
database checks verify exact mutation audit counts and no remaining live fixture
addresses. Session teardown passed; the isolated schema, containers and temporary
database were removed. Owner data and live providers were not used. Lint,
TypeScript, production build and scoped diff checks passed.

Reports: `playwright-report-profile-crud/` and
`test-results-profile-crud/junit.xml`. The first report
`playwright-report-profile-crud-initial/` retains the optional-field defect and
cleanup error. A later run passed all five cases but failed global logout cleanup
with an empty development manifest; that report is retained as
`playwright-report-profile-crud-cleanup-failure/`. The clean rerun does not resolve
or explain that intermittent runtime failure; no cleanup assertion was bypassed.

The expanded combined suite is 69 cases and has not run together after these
increments. Real-device/accessibility review, elapsed timeout and explicit rapid
double-submit tests, business-only role compatibility, other profile preference
changes and production integrations remain outside this targeted acceptance.

## Combined regression confirmation — 24 October 2026

The expanded 69-case suite subsequently passed together in 532.315475 seconds,
with zero failures/skips/errors, global session teardown and post-run persistence/
audit checks passing. Reports: `playwright-report-combined-69/` and
`test-results-combined-69/junit.xml`. Disposable schema, containers and tmpfs
database were removed after export. See `PAGE_WORKFLOW_ACCEPTANCE.md` for exact
environment and limits. The previously retained intermittent manifest cleanup
failure did not recur; it is not considered explained or globally fixed.
