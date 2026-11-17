# Browser testing

Latest Linux verification confirmed **18 November 2026**, from the sequential
17 November run against commit de27e69. All **105 distinct browser checks passed**
across three fresh database shards, including both reviewed Linux visual
comparisons. Each shard passed 37 executions, for 111 executions including the
three setup checks repeated in each shard. JUnit records zero failures, errors
and skips. The combined project/file/test-title inventory matches the declared
105 checks exactly. HTML/JUnit reports and logs are in
`/tmp/deshdak-browser-linux-sequential.0bVjzDZf/shard-{1,2,3}/`.
The disposable schemas, containers and networks were removed. Running shards
sequentially resolved the resource contention seen during simultaneous runs.

Latest macOS verification: **17 November 2026**. All **105 browser checks
passed** on Chromium with desktop and emulated mobile, including both reviewed
visual comparisons. HTML and JUnit are in `/tmp/deshdak-browser-full-fixed.DQ2TtuHr/`.
The isolated schema and database container were removed. The Admin setup test now
checks 10 required and five optional areas in the visible workspace. The account
test verifies the current development-only phone flow and confirms that no SMS
was sent. No visual baselines, application code, or live providers changed.

A subsequent fix restores native browser validation of international phone numbers
on signup and profile forms. Seven focused Chromium checks passed on 17 November
across desktop and emulated mobile, including the setup cases. The checks reject
a local-only number and accept the intended international format. The production
build, lint and TypeScript passed. The focused HTML/JUnit reports are in
`/tmp/deshdak-phone-pattern.VapF8BYf/`.

The focused Linux Docker rerun passed all 11 Admin, account and setup checks. The
disposable browser stack explicitly enables development-only verification codes
so it exercises the same branch as the native run. No production configuration
changed. Earlier full Linux retries reached time limits on this host and the earlier third
shard lacked the fixture setting. The sequential result above supersedes that
pending status.
Linux focused HTML/JUnit reports are in `/tmp/deshdak-browser-linux-phone.105XACuh/`.

Prior full inventory verification: **4 November 2026**, all **105 checks passed
in one isolated run** on Next.js 16.4.5, with zero failures, errors or skips
(5.8 minutes). Includes both reviewed macOS visual comparisons. HTML report:
`playwright-report-full105-20261104/`; JUnit and artifacts:
`test-results-full105-20261104/`. An initial run had 103 passes, one login-IP
rate-limit failure and one serially skipped case. Account-review contexts now
represent a separate synthetic client; production rate limits are unchanged.
The initial report remains under `playwright-report-full-browser-initial-20261104/`
and `test-results-full-browser-initial-20261104/`. This covers the configured
Chromium/emulated-mobile suite, not every physical device or live integration.

Previous full inventory verification: **2 November 2026**, 99 distinct cases passed
across three isolated schemas (35 executions each, including repeated setup).
Reports: `playwright-report-full99-20261102-{1,2,3}/`; JUnit/logs:
`test-results-full99-20261102-{1,2,3}/`. The coverage summary confirms no missing
or extra project/file/full-title entries. An initial mobile calendar confirmation
failure was traced to cold compilation of the shift handler; setup now issues an
unauthenticated denied preflight to compile it. The original failed report is
retained. No workflow assertions or deadlines were relaxed. See the acceptance
record for boundaries and remaining release gates.

This is the browser-test layer, not a replacement for the existing isolated API,
financial, tracking and role tests. Use synthetic local data only. The runner
rejects non-local application URLs and does not reset or seed a database.

## Prerequisites and installation

Use Node 22 and the repository's pinned npm version. Run `npm ci`, then
`npx playwright install chromium`. On Linux use
`npx playwright install --with-deps chromium`. Prepare a disposable local database
and run migrations and the normal seed separately; never use production data.
Start the application with `npm run dev` in a separate terminal.

The framework and Docker browser image are pinned to Playwright 1.64.1. Update
both together, install its matching browser binary, and review visual changes.
Chromium desktop and Pixel 7 emulation are configured; this is not evidence of
physical Android/iOS or Safari compatibility.

## Structure and configuration

- `playwright.config.ts`: local URL guard, projects, worker budget, retries,
  failure artifacts and reports. Two workers keep local database load bounded.
- `e2e/pages/catalogue.ts`: page object for catalogue navigation and assertions.
- `e2e/fixtures.ts`: fresh isolated page/context per test and a reusable page object.
  Advertising is explicitly mocked empty so demo campaigns cannot intercept clicks.
- `e2e/environment.setup.ts`: dependency project checks health and optionally signs
  in a dedicated customer; no database reset or authentication bypass.
- `e2e/teardown.ts`: revokes the saved customer session and removes its state file.
- `e2e/*.spec.ts`: public layout, filter/sort, image-request failure, optional
  session persistence and opt-in screenshot comparisons.

## Environment and secrets

See `e2e/environment.example`. Inject values in the shell or CI secret store;
the test command does not automatically load that example. Never commit passwords,
session state, traces containing personal data, or real customer documents.

Default anonymous tests require no credentials. Set both `E2E_CUSTOMER_EMAIL` and
`E2E_CUSTOMER_PASSWORD` for a dedicated local customer to enable saved-session
coverage. Login must pass normal security controls; MFA is not bypassed. This
does not yet provide authenticated coverage for every employee role.

For customer-session verification without supplying an account, stop any local
development server in this checkout and run:

```sh
E2E_VISUAL=1 npm run verify:launch:isolated -- test:e2e:isolated
```

This creates a synthetic customer with a random password in the disposable
verification schema, invokes the real login API, reuses saved session state,
and verifies session revocation plus removal of the state file. The wrapper
refuses ordinary or remote database schemas. Credentials stay in the child
process environment; the parent runner removes the disposable schema afterward.
Restart `npm run dev` when finished. Omit `E2E_VISUAL=1` on platforms without
reviewed visual baselines.

State is written under ignored `e2e/.auth` with restricted permissions and removed
at teardown. Authentication setup/customer projects disable traces/screenshots.
Do not run credentialed suites concurrently in the same checkout. Interrupted
runs may leave a state file; revoke the dedicated account's session from Security
and devices, then remove that exact state file. Never publish `.auth` artifacts.

Account-review tests use a separate synthetic client address (`198.18.0.20`)
only when `DATABASE_URL` identifies a generated disposable verification schema.
Default page/request fixtures and explicitly created browser contexts share that
address so unrelated portal logins do not exhaust the account-review client's
IP budget. This uses the existing development-only forwarded-IP path; production
ingress authentication and rate-limit thresholds are unchanged. Do not clear
rate-limit rows, raise production thresholds or retry denied logins to make a
full suite pass.

## Local execution and debugging

```sh
npm run test:e2e
npm run test:e2e -- --project=mobile
npm run test:e2e -- --project=desktop --grep catalogue
npm run test:e2e:ui
npm run test:e2e:debug -- --project=desktop
npm run test:e2e:report
npx playwright show-trace test-results/<failed-test>/trace.zip
```

Inspect failed assertions and the HTML report; opening a report does not mean its
failures were fixed. Traces are retained on failure, screenshots only on failure,
and video is disabled. Reports are ignored locally and retained seven days in CI.
Do not upload reports to a public third-party service without reviewing contents.

## Mocks and visual regression

`image-search.spec.ts` aborts only the image endpoint and verifies UI recovery.
Its synthetic bytes intentionally never reach the server. It does not establish
provider availability, scanning safety or image relevance. Existing API tests
remain responsible for server validation/security boundaries.

Visual tests are opt-in locally and enabled by default in the pinned Docker stack.
macOS and Linux desktop/mobile sign-in baselines have been rendered, inspected
and rerun. The component comparison hides floating utility chrome;
it is not a full-page usability certification.

```sh
E2E_VISUAL=1 npx playwright test --grep @visual --update-snapshots
npm run test:e2e:visual
```

Inspect every generated baseline before committing it. Baselines differ by
project and platform; do not approve new snapshots merely to clear a failure.
CI does not silently generate missing baselines. Current initial coverage is
the sign-in shell; broader page-by-page visual coverage remains future work.

Verified locally on 17 October 2026: 13 passed, 2 skipped (optional customer
setup and saved-session test), with visual comparisons enabled. Both shards also
passed independently on 16 October. HTML and JUnit reports were generated;
the HTML report shows zero failed/flaky tests. TypeScript, ESLint, production
build and existing security/dependency/container-policy checks passed on the
initial framework increment. This does not certify all employee flows, provider
integrations or production readiness.

The later isolated-customer run on 17 October passed all 15 tests with zero
skips, including login, saved-session profile access and logout teardown. The
runner verified database session revocation and absence of the saved state file;
the parent removed its disposable schema. CI shards now use this synthetic
customer runner rather than requiring stored customer credentials.

Both synthetic-customer shards were subsequently run locally with `CI=true` and
visual checks enabled. Each passed with teardown verified and its disposable
schema removed. Their blob reports merged successfully into HTML and
`test-results/merged-junit.xml`. This validates the local sharding/report path,
not execution on GitHub-hosted runners. Setup tests repeat in each shard.

## Reliability and parallelism

Use role/label locators and web-first assertions; avoid fixed sleeps, arbitrary
timeouts and shared mutable accounts. Default local retries are zero; CI allows
one retry and reports flaky outcomes for investigation. Retrying is not a fix.
Mutation workflows need unique per-worker fixtures and deterministic cleanup
before they are made parallel. Never parallelize live payments or shared accounts.

```sh
E2E_BLOB=1 npm run test:e2e -- --shard=1/3
E2E_BLOB=1 npm run test:e2e -- --shard=2/3
E2E_BLOB=1 npm run test:e2e -- --shard=3/3
npm run test:e2e:merge
```

Run shards in separate workspaces/CI jobs. `.github/workflows/e2e.yml` prepares a
disposable PostgreSQL service per job, starts an isolated-schema app, runs three shards and
merges HTML and JUnit reports. The existing quality-gate workflow is retained unchanged.
Remote CI execution must be confirmed by an actual CI run; adding YAML is not
proof that the workflow has passed.

### Isolated compiler resources (27 October 2026)

The explicit Webpack verification runtime uses a bounded 5120 MiB Node heap and
`--disable-source-maps` to avoid Node source-map loading overhead. Next's memory
restart guard is retained. The runner requires at least 6 GiB total/constrained
RAM before creating the disposable schema; 8 GiB Docker RAM is recommended for
browser/compiler/database headroom. Normal `npm run dev`, production builds and
the default isolated Turbopack argument/environment behavior are unchanged.

Run `node scripts/verify-isolated-dev-arguments.mjs` and
`npm run test:isolated-route-retention` for configuration regression checks.
Do not disable the restart guard, add mutation retries or extend assertions to
hide resource problems. The all-route OPTIONS warmup experiment was removed:
it increased compiler memory pressure and was not workflow/performance evidence.

All 87 cases in the earlier complete-suite run passed locally across three fresh-schema shards, including
each shard's session cleanup/database assertions. Reports are retained in
`playwright-report-memory-ci3-1/` through `-3/` and corresponding
`test-results-memory-ci3-*/junit.xml`. Test-identity comparison found no missing or
extra cases (setup repeats in each shard). This run used per-shard HTML/JUnit;
GitHub-hosted execution and a new three-blob merged report are not claimed.
See `PAGE_WORKFLOW_ACCEPTANCE.md` for failures retained, durations and limits.

The later support-calendar increment adds two desktop/mobile cases in
`e2e/support-settings.spec.ts`. It uses separate process-local MFA Admin fixtures
(`E2E_CALENDAR_ADMINS`) so it can run alongside workforce tests without reusing
enrollment state. Run it only through the isolated fixture runner, for example
with `E2E_GREP='support calendar settings|support workforce settings|support quality review'`.
Run `test:support-policy` inside the isolated wrapper as well to exercise timezone
calendars, holiday exclusions, SLA snapshots, shift-gated assignment and sequential
overlap rejection. The same integration test now also queues concurrent creation
under a held PostgreSQL advisory lock and verifies overlap/role-removal races and
allowed adjacent intervals.
Concurrent cancellation is also queued under the held lock and must produce one
state-changing response, one idempotent replay and exactly one audit even after a
later retry. Holiday removal uses a held row-lock barrier to verify concurrent
requests return one success and one 404 with one audit; later retries must remain
404 without changing history. Browser checks cover failed/invalid responses, retained inputs,
duplicate submit prevention, stale-policy errors, real holiday/shift changes and
responsive controls. Post-browser database checks assert one audit per change,
closed-date removal, cancelled shifts and Sydney-device-to-UTC conversion.
These targeted runs do not replace a new complete-suite regression pass.

The subsequent complete 89-case run finished on 28 October 2026: three clean
fresh-schema shards reported 32/32/31 cases with no failures/errors/skips. Exact
test-identity comparison found 89 unique passes and no omissions or extras; setup
repetition accounts for 95 executions. Reports are retained under
`playwright-report-full89-{1,2,3}/` and matching `test-results-full89-*` directories.
See `PAGE_WORKFLOW_ACCEPTANCE.md` for the two harness corrections, the single
read-only transport retry, database/session cleanup evidence and remaining limits.

On a fresh schema, `test:support-policy` also holds a table lock until two policy
initializers reach INSERT. It requires one success, one 409, one saved version-2
policy and one audit, then rejects a stale default-version form. Same-version
updates must produce one success/conflict pair, one revision and one audit.

`e2e/sourcing-auth.spec.ts` adds desktop/mobile sign-in recovery and real sourcing
role/session checks. The isolated runner creates process-local
`E2E_SOURCING_ACCOUNTS`; do not supply owner credentials. Use
`E2E_GREP='sourcing sign-in recovery|support sign-in and sign-out'` for the targeted
authentication check. The runner asserts one revoked sourcing session per tested
fixture. Current-source overlays must include both the logout route and its
activity helper together; mixing an old async helper with the fixed batch route
is an invalid verification environment. The current inventory is 97 cases; see
the acceptance record for the targeted pass and full-suite evidence boundaries.

On 31 October the full 97-case inventory passed across three fresh-schema shards
(35/34/34 executions, including repeated setup cases). See the full regression
entry in `PAGE_WORKFLOW_ACCEPTANCE.md` and `test-results-full97-{1,2,3}/junit.xml`.
Sourcing workforce, sourcing decisions and support calendar now use separate
process-local Admin fixtures so enrolling MFA in one workflow cannot affect
another. Catalogue sorting waits for hydration before allowing selection.

The 1 November patched-runtime result supersedes that version-specific result:
97 distinct cases passed on Next.js 16.4.3 with Turbopack (35/34/34 executions).
See `test-results-patched-final-{1,2,3}/junit.xml` and the acceptance record.
Browser CI selects Turbopack; Webpack remains a diagnostic override whose manifest/
cleanup failures in long upgraded-runtime runs are unresolved. The verifier owns
and removes a unique `.next-crossly_launch_verify_*` output directory per schema.
Setup compiles catalogue/package/lookup/feedback routes through public reads or
authorization-denied requests; this does not measure cold compilation performance.
The moderate-or-higher dependency-audit release gate remains independently blocked.

## Enterprise reporting and Docker

The owner selected HTML/JUnit only. No external reporting service is connected.

Local runs emit HTML and JUnit XML (`test-results/junit.xml`), consumable by Jenkins,
Azure DevOps and other JUnit-compatible systems. Sharded CI emits blob artifacts
and merged HTML/JUnit reports. Enterprise account connections (for example Allure TestOps
or a private reporting service) require the owner's destination and credentials;
none are connected or sent data by this configuration.

`Dockerfile.e2e` packages matching browser binaries, locked dependencies and tests
as the non-root `pwuser`. It is separate from the production application image.
Build with `docker build -f Dockerfile.e2e -t duar-e2e .`. The app must be reachable
on localhost inside the test container: use a shared network namespace on Linux
or start the local test app in the same container. Supply database/configuration
at runtime from a disposable environment, never in image layers. Do not run the
test image against untrusted arbitrary websites. The image built successfully
on 17 October 2026 after pinning npm 11.6.2; the base image's newer npm rejected
the existing cross-platform optional-dependency lock entries. A container build
is separate from running the full application suite inside the container.
Chromium was also launched and closed successfully inside that image as UID 1001
without application credentials or a database connection.

For the complete Docker application/browser run, `compose.e2e.yml` creates a
separate PostgreSQL instance in temporary memory. No database ports are published,
no host secrets are loaded, and there are no persistent database volumes. The
browser container shares that database's network namespace so the localhost-only
verification guard remains intact. It creates its synthetic customer and schema
through the same isolated runner used locally.

```sh
docker compose -f compose.e2e.yml up --build --abort-on-container-exit --exit-code-from browser
docker compose -f compose.e2e.yml cp browser:/work/playwright-report ./playwright-report-docker
docker compose -f compose.e2e.yml cp browser:/work/test-results ./test-results-docker
docker compose -f compose.e2e.yml down
```

Copy reports before removing stopped test containers. This stack is dedicated
test infrastructure; stopping/removing it discards its synthetic database.
Linux visual checks are enabled by default in this pinned stack. To deliberately
skip them for a diagnostic run, set `E2E_VISUAL=0`. Baseline regeneration requires
the explicit `E2E_UPDATE_SNAPSHOTS=1` flag and is refused in GitHub Actions.

The complete Docker application/browser run passed on 17 October 2026: 13
passed, zero failures, and two intentionally skipped Linux visual comparisons.
Actual API login, saved-session profile access, logout revocation and local
state-file cleanup passed. The isolated schema was removed, and HTML/JUnit
reports were exported before removing the dedicated test stack.

After Linux baselines were generated and visually inspected, a fresh comparison
run on 17 October passed all 15 tests with zero skips and without updating
snapshots. Reports were re-exported and the disposable stack was removed. Browser
CI now uses the same pinned Docker stack and enables visual comparisons. Remote
GitHub runner execution, including architecture-dependent rendering, still needs
verification.

## Remaining acceptance checks

On 17 October 2026, the expanded Docker suite passed all 24 tests, with no
skips or retries. Disposable warehouse, inspector, logistics and support accounts
now exercise normal API login, desktop portal rendering, 390px mobile width,
wrong-portal redirects and admin API denial. Warehouse-assigned roles also check
that their assigned station is visible and an unrelated origin station is absent.
The first run exposed warehouse mobile navigation overflow; wrapping its links
onto a separate row fixed it, and the fresh full run passed. All five customer/
employee sessions were verified revoked and saved authentication files removed.
HTML/JUnit reports were exported before removing the dedicated containers and
temporary database. Targeted ESLint and TypeScript checks passed.

The subsequent 17 October run passed all 25 tests (36.8 seconds), with no skips
or retries. An additional mobile browser scenario scans a synthetic order,
confirms physical receipt, completes a basic inspection as the Inspector,
records warehouse measurements and confirms put-away. It checks the customer
timeline API reports WAREHOUSE_RECEIVED → INSPECTION → MEASURED in order,
rejects an inspection submitted by a Warehouse Worker, and rejects customer
timeline access by the Inspector. Country, lane, order and bin fixtures exist
only in the disposable schema; the test uses normal login sessions and actual
browser forms, without network mocks for these operations. TypeScript and
targeted ESLint passed. HTML/JUnit reports were exported and the stack removed.

The next 17 October run passed all 26 tests (41.9 seconds), with no skips or
retries. A mobile Logistics browser scenario now publishes all 13 normal stages
from PICKUP_PENDING through DELIVERED, checking the customer timeline API's
shipment status and full ordered event history after every publication. It
checks skipped-stage rejection, required delivery evidence, the seven-day claim
deadline, final customer order DELIVERED status, the completed read-only form,
and mobile width. TypeScript and targeted ESLint passed; reports were exported
and the disposable stack removed.

This shipment starts from a synthetic READY_TO_SHIP order and CREATED shipment,
not a verified payment or browser-created shipment. Its synthetic proof reference
exercises the current reference contract, not physical proof storage, malware
scanning or authenticity verification. The customer check uses the timeline API,
not a visual customer tracking-page assertion.

The subsequent 17 October run passed all 29 tests (40.0 seconds), with no skips
or retries. Three customer browser cases cover measured-quote acceptance,
rejection and expiry. Acceptance exposes the separate wallet payment step;
rejection places shipping ON_HOLD; expired acceptance returns 409. Both valid
decisions replay safely using their original idempotency keys and produce only
one customer status-history entry. An unrelated Inspector account receives 404
for the quote decision. A deliberately aborted acceptance request checks that
buttons recover and a subsequent real decision succeeds.

The tests exposed misleading confirmed-quote copy for rejected/expired quotes.
The quote component now distinguishes accepted, paid, rejected, expired,
cancelled and awaiting-confirmation states, and catches network/JSON failures
with an actionable error and released controls. TypeScript, targeted ESLint and
diff whitespace checks passed. Reports were exported and the stack removed.
Quotes are seeded synthetic records: admin issuance/MFA and financial settlement
are not certified by these cases.

Invoice settlement, real payment callbacks, camera hardware, inspection uploads
and production proof-of-delivery storage remain acceptance work.

On 17 October the expanded suite passed all 30 tests (53.4 seconds), with no
skips or retries. A mobile customer browser scenario settles an accepted measured
shipping quote using a synthetic BDT 1,060 opening wallet balance. It verifies
network failure releases the payment control, retry preserves the same mutation
key, successful payment returns 201, replay returns 200 without another debit,
changed-order key reuse is rejected, and an unfunded second order cannot pay
through either the UI or a direct API request. The customer timeline advances to
READY_TO_SHIP once. After the browser exits, database assertions verify exactly
one shipping payment, one wallet transaction, zero remaining balance and a
two-line balanced BDT 1,060 debit/credit journal. Session cleanup also passed.

The shipping-payment component now catches network failures and always releases
its busy state while retaining its retry key. Targeted ESLint, TypeScript and
whitespace checks passed. Reports were exported and disposable containers removed.
The opening balance and accepted quotes are test fixtures, not evidence of a
gateway deposit, admin quote issuance, reconciliation or real settlement.

The final 17 October run passed all 31 tests (2.9 minutes), with no skipped or
retried test cases. A disposable administrator now completes browser password
login, TOTP enrollment and recovery-code challenge. Admin users API access is
403 before MFA and 200 after verification; a used recovery code returns 401
on a new login and leaves privileged access blocked. An aborted verification
request confirms the MFA control recovers. The component now catches network/
JSON failures and releases its submitting state. MFA secrets/recovery screens
are not attached as screenshots or traces; test contexts close in finally and
database assertions reject any unrevoked disposable admin session.

Earlier runs exposed a receipt-navigation timing failure and a read connection
reset during cold development compilation. The warehouse test now explicitly
waits for its package route, and the tracking timeline GET permits one
transport-only connection-reset retry. Mutation retries remain disabled and
HTTP errors still fail. The complete final run passed; targeted ESLint,
TypeScript and whitespace checks passed. HTML/JUnit reports were exported and
the disposable stack removed. Finance/compliance MFA, admin quote issuance and
production gateway callbacks remain separate acceptance work.

On 18 October 2026 all 33 browser tests passed (2.5 minutes), with no skips or
retried test cases. New Finance and Compliance fixtures use normal password API
login followed by browser TOTP enrollment. Each role's protected queue returns
403 before MFA and 200 afterward; the other officer's queue and Admin users API
remain 403. The enrollment continue action opens the correct dashboard, whose
heading and 390px width are checked. All disposable privileged sessions are
checked for revocation. No real accounts, approvals or financial records are
changed. ESLint, TypeScript and whitespace checks passed. Reports were exported
before removing the dedicated containers and temporary database.

These checks verify enrollment and role boundaries, not finance posting,
compliance case decisions or Admin quote issuance. Those workflows and live
provider acceptance remain separate work.

The next 18 October increment extends the existing Admin MFA scenario to issue
a shipping quote through the real Admin form. A synthetic measured 1,200 g
package at BDT 800/kg plus BDT 100 handling produces BDT 1,060 and requires
customer approval because declared weight is missing. The test checks the
customer order page displays the issued note and approval control, and rejects
customer attempts to issue a quote. A deliberately aborted form request verifies
an actionable error and re-enabled controls. The component now catches transport/
JSON failures and advises refreshing/reviewing the latest quote before retrying.

Cold development compilation caused operational timeouts in two full runs,
including a 70-second route compilation and a 93-second filesystem cache write.
The multi-page warehouse scenario now has the same 120-second overall bound as
tracking. A subsequent unchanged-code run using the existing compilation cache
and a fresh disposable database passed all 33 cases (1.4 minutes), with no skipped
or retried test cases. This warm-cache pass does not resolve cold-start test
performance. Targeted ESLint, TypeScript and whitespace checks passed. HTML/JUnit
reports were exported and the temporary stack removed. Compliance decisions,
concurrent Admin quote submissions and live provider acceptance remain unverified.

The next 18 October increment exercises two synthetic restricted-goods screening
decisions within the Compliance MFA case. Browser forms approve one and reject
another. Missing notes return 422; wrong pending-case versions and repeated
decisions return 409; Finance cannot decide a case (403). Decided cards disappear
from the pending queue. An aborted PATCH checks button recovery and a refresh/
review instruction. Database assertions verify final outcome, version 2,
reviewer/time and exactly one matching audit record per decided fixture. These
are synthetic SOURCING_REQUEST screenings, not identity-document reviews or real
legal approvals.

The Compliance decision form now catches network/JSON failures and releases its
busy state. The Admin quote test is scoped to #admin-main-content to avoid
temporarily matching both a Suspense fallback and the loaded workspace. The first
run exposed that locator ambiguity; the corrected full run passed all 33 cases,
with no skips or retried test cases. Targeted ESLint, TypeScript and whitespace
checks passed. HTML/JUnit reports were exported and the disposable stack removed.
Identity-review decisions, production document handling, concurrent Admin quote
issuance and live gateway acceptance remain separate checks.
Admin, finance and compliance MFA browser flows remain separate acceptance work;
this fixture does not bypass MFA or modify real accounts.

Run remote CI and extend authenticated
employee/money-moving browser
flows with isolated fixtures. Existing 67-gate API/workflow verification remains
a separate requirement; browser smoke tests cannot certify full-system readiness.

Implementation references: [configuration](https://playwright.dev/docs/test-configuration),
[authentication](https://playwright.dev/docs/auth),
[visual comparisons](https://playwright.dev/docs/test-snapshots), and
[Docker](https://playwright.dev/docs/docker).

## Manual purchase and enrollment regression increment — 19 October 2026

The Admin MFA browser scenario now includes an inactive manual purchase fixture:
purchase-form network recovery, two concurrent approvals (one 200 and one 409),
actual purchase confirmation through the form, customer timeline note privacy and
customer mutation denial. Post-run database assertions require exactly two history
entries and two private purchase audit records. These are synthetic post-payment
orders, not real supplier purchases or verified gateway payments.

Repeated MFA setup requests previously replaced the pending TOTP secret. Setup now
reuses an unexpired enrollment without extending its lifetime. The isolated API MFA
check verifies concurrent repeated setup returns the same secret/expiry, confirms
enrollment and tests recovery login before browser fixtures are created.

The first full run stalled under Turbopack memory pressure and was stopped. A Webpack
experiment failed 4/33 cases, then 2/33 after enrollment stabilization and protected
handler preparation (remaining failures involved development navigation/timeouts).
Webpack was reverted, not adopted as a successful fix. The Docker suite now uses
one worker (`E2E_WORKERS=1`) to bound concurrent compiler/browser memory; ordinary
configuration retains two workers unless this value is supplied. Protected handler
preparation uses unauthenticated requests and asserts 401/403 before any browser
enrollment. It does not bypass permissions or exercise real mutations. It moves
development compilation outside sensitive browser steps, not a production load test.

Failed-run HTML evidence is retained under ignored `playwright-report-docker-failed-manual/`.
No screenshot/trace capture is enabled for privileged sessions or recovery secrets.
Full production build, full API launch verification, live services and production
security acceptance remain separate gates. Development dependency audit reports
five high-severity findings through the ESLint glob dependency chain; production-only
audit reports zero at this check. This is not a complete security sign-off.

The corrected Turbopack run with one worker passed all 33 cases in 2.6 minutes,
with no skips or retries. The MFA API regression passed before browser fixtures.
Database assertions confirmed exactly two manual purchase transitions and private
audit records, no internal note in customer history, one synthetic shipping payment,
one wallet debit and a balanced journal. The isolated schema and session-state files
were cleaned up. HTML/JUnit reports were exported to the ignored standard Docker
report directories; disposable containers/network were removed after export.
This establishes the tested increment only, not completion of structured supplier
purchase records, receipt storage, supplier claims or all production gates.

## Supplier records — 19 October 2026 follow-up

The extended 33-case suite passed in 2.1 minutes with one worker. New checks cover
Admin supplier-reference creation, missing-coverage purchase rejection, aborted
request recovery, retry replay, conflicting payloads/overallocations, a 255-character
idempotency header and customer access denial. Real database assertions reject
updates/deletes and confirm one record/audit with unchanged order totals. The first
run failed because a generic alert locator also matched Next's route announcer;
scoping it to the form resolved the test ambiguity. Unit/schema/lint/type/security
and 286-operation API contract checks passed; production build also passed.
Reports were exported and the disposable Docker stack removed. This does not
activate supplier APIs or migrate the owner's database; receipt evidence, cost/FX,
claims and authorized immutable-record corrections remain pending.

## Supplier-record correction holds — reviewed 20 October 2026

All 33 isolated browser cases passed in 3.8 minutes. The extended Admin scenario
verifies a linked correction hold, foreign-record and untrusted-origin denial,
network recovery, duplicate rejection and mobile overflow. Database assertions
confirm one private linked audit, one safe customer hold event and unchanged
supplier evidence/financial totals. Unit/schema/lint/type/API checks and production
build passed. Reports were exported and disposable containers/network removed.
Two development Performance.measure negative-timestamp console errors were observed
on AdminHomePage; workflow assertions passed, but this is not console-error-free
or production acceptance. Actual record replacement/approval/release is not included.

## Independent supplier text replacement — 20 October 2026

Supersedes the limited scope above: independent name/reference/variant replacement
and linked-hold release are now verified. The final isolated suite passed all 33
cases in 3.2 minutes with no skips/retries. A second MFA-verified Admin navigates
from the held purchase queue; recorder/reporter self-approval, quantity-field
injection and stale holds are rejected. Network recovery, retry replay and mobile
overflow are checked. PostgreSQL verifies immutable original/approval links,
unchanged quantity/warehouse/total and safe customer history. Schema/lint/type,
policy/security tests, 287-operation API contract and production build passed.
Reports were exported and the disposable Docker stack removed. The owner database
still requires reviewed migration 20261020090000_supplier_record_corrections.
General allocation/financial corrections and production acceptance remain pending.

## Warehouse receipt integrity — 20 October 2026

The final 33-case isolated suite passed in 4.4 minutes without skips/retries.
Additional coverage includes concurrent distinct receipt keys, one-package/event/
history database assertions, multi-parcel Ship for Me receipt through the mobile
warehouse UI, wrong tracking, malformed replay, changed order/warehouse/parcel,
matching replay, network recovery and Inspector denial. Final Ship for Me receipt
requires both expected parcels. An initial fixture setup failure (missing draft
order grandTotal) was corrected before the successful run. A handled serialization
conflict during the intentional race returned 409 as expected. Policy/schema/lint/
type/security/API-contract checks and production build passed; reports were exported
and the disposable stack removed. No new migration is required for this increment.
See docs/WAREHOUSE_RECEIPT_HARDENING.md for scope, legacy receipt handling and gaps.

## Supplier inbound dispatch and receiving — 20 October 2026

All 33 isolated cases passed in 3.1 minutes without skips/retries. One Admin
scenario now verifies dispatch and physical receipt together, independent of test
execution order. New checks cover two supplier records, expected-only packages,
aborted-request recovery, replay conflicts, forbidden roles/status bypasses,
partial dispatch/receipt, tracking scans, private supplier data and blocked early
inspection. Database checks confirm immutable dispatch records, no duplicate
packages, one shipped/received history each and unchanged order totals.
Schema/lint/type, policy/security tests, 288-operation API contract and production
build passed. HTML/JUnit reports were exported and the disposable stack removed.
Migration 20261020110000_supplier_inbound_dispatch is not applied to the owner's
database. Split parcels, dispatch corrections and live integrations remain gated;
see docs/SUPPLIER_INBOUND_TRACKING.md.

## Case-insensitive inbound identity — 20 October 2026

The final isolated run passed all 33 cases in 124.54 seconds (zero failures/skips/
errors). New database checks cover concurrent mixed-case inserts, conflicting
updates, distinct references and null tracking. Separate disposable preflight
fixtures verify safe conflict reporting, no data changes/reference leakage, clean
success and missing-table failure. Two initial runs each failed one existing UI
assertion: an Inspector refresh timeout and a correction locator matching a retained
inactive route. A bounded read-only wait and visible-record scoping corrected the
tests; no mutation retry was added. The first run's development stream-closure
error remains noted, not certified resolved. Static/policy/security/API/build gates
passed, reports were exported, and the disposable stack removed. Owner deployment
still requires migration 20261020120000_inbound_tracking_case_uniqueness. See
docs/INBOUND_TRACKING_INTEGRITY.md for the preflight and controlled rollout.

## Procurement next-task UI — 20 October 2026

All 33 isolated cases passed in 106.81 seconds, zero failures/skips/errors. Mobile
Admin checks cover the new next-task region, current-step semantics, remaining
dispatch counts, expected arrivals and completed receiving. Existing role/privacy
and complete operational handoffs still pass. Guidance policy cases cover holds,
inactive/superseded records, missing/overallocated quantities and truncated lists.
Lint/type/schema/security/API/build checks passed. The first sandboxed build
stalled and was stopped; the local-worker-permitted retry passed. Reports were
exported and disposable containers/network removed; the owner database and running
development server were left unchanged. See docs/PROCUREMENT_TASK_GUIDANCE.md.

## Private supplier record pagination — 20 October 2026

The final isolated suite passed all 33 cases in 111.80 seconds with zero failures/
skips/errors. A synthetic 101-record legacy order exercises default 100-record API
compatibility, page 2, empty later results, strict/repeated query validation,
customer denial, no-store headers, UI navigation/final-page access, creation-form
suppression and mobile fit. The attached mobile navigation screenshot was visually
reviewed. Unit/policy/schema/lint/type/security, 288-operation OpenAPI contract and
production build passed. Reports were exported and disposable schema/stack removed.
No new migration or owner database mutation. See docs/SUPPLIER_RECORD_PAGINATION.md.

## Inspection request integrity — 21 October 2026

Focused Inspector, Warehouse and Ship for Me API regressions passed, followed by
all 33 isolated browser cases in 115.15 seconds (zero failures/skips/errors).
The browser deliberately loses an already-saved inspection response and retries
the same request; database checks confirm one decision, event and audit. Competing
keys, changed replay identities, outstanding parcels, trusted-origin and strict
payload guards are covered. Schema/type/lint/policy/security/OpenAPI/build and
container/operations-safety checks passed. Earlier shared-server/cache experiments
stalled; the cache override was reverted and final API/browser phases use separate
fresh isolated servers/schemas. No global development-stall resolution is claimed.
Reports were exported and the disposable stack removed. Owner deployment requires
migration 20261020130000_inspection_request_identity, Prisma generation and restart;
the owner database was not migrated. See docs/INSPECTION_REQUEST_INTEGRITY.md.

## Procurement capacity browser acceptance — 21 October 2026

All 33 isolated cases passed in 263.23 seconds (zero failures/skips/errors), after
focused Inspector/Warehouse/Ship for Me API checks. Added a synthetic order with
exactly 100 retained records and an existing supplier-record hold. Mobile Admin
checks verify the capacity guidance, unavailable add/replacement buttons and no
horizontal overflow; direct independent-Admin correction receives RECORD_LIMIT.
Database checks confirm the order remains held with 100 records, one hold history,
no correction link and no replacement audit. Existing below-limit approval,
pagination, receipt/inspection retry and delivery scenarios passed. Targeted lint
and TypeScript passed. HTML/JUnit reports were exported and the disposable stack
removed. No owner database change or production certification. Development compile
latency remains an open concern despite the passing assertions.
# Admin live setup increment — 1 November 2026

The inventory now includes `e2e/live-setup.spec.ts`: separate desktop/mobile Admin
fixtures prevent concurrent MFA/session interference. The focused run passed all
five executions (three setup plus two guide cases), with HTML/JUnit evidence under
`playwright-report-live-setup-verified/` and `test-results-live-setup-verified/`.
Assertions cover protected access, required/optional card counts, absence of
credential forms, responsive overflow, typography, native detail expansion and
visible server-rendered content without JavaScript. There are now 99 distinct
browser cases; this increment does not represent a full rerun of all 99 cases.
