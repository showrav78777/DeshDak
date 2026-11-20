# Run and accept system testing

## Repeatable local workflow checks

Start local Docker and install the project's pinned Node/npm dependencies and
Playwright Chromium browser. From this repository run:

```sh
npm run test:sqa:isolated
```

This command creates its own randomly named PostgreSQL container, random test
credentials and a generated isolated schema. It selects a local application port,
runs 42 customer/seller/employee/Admin/authentication/notification workflow suites,
then removes its schema/container on normal success or failure. It rejects remote
Docker daemons and accepts only the optional --full flag, never database/container/script arguments. It does not
migrate, seed or target your application database. Live provider switches and
credentials are disabled for this run; phone codes are development-only and no SMS
is sent. Do not use real customer documents or production credentials as fixtures.

The tests cover selected workflows, including role isolation, MFA, account
recovery, session revocation, catalog/cart/coupons, seller moderation/imports,
warehouse/inspection/logistics, returns, support, sales, PDF/label access and
notification/account verification protections. This is not a certificate for every
page, physical device, real payment or external integration.

If an operating-system kill or Docker outage interrupts cleanup, inspect Docker
Desktop for the exact `deshdak-sqa-...` container from that run, confirm it is a test
resource and no verification is still using it, and remove that container only.
Never prune unrelated containers, volumes or databases to clean up a test.

## Full disposable launch verification

To run every locally configured launch gate, including the dependency audit,
clean migrations, role workflows and photo safety checks, use:

```sh
npm run test:sqa:isolated -- --full
```

This uses the same owned disposable Docker database and cleanup safeguards.
Production build and actual provider/device acceptance remain separate. A full
run passed all 111 gates on 19 November 2026 against application revision fdd181c.
The new --full command also passed all 111 ordered gates in 5.6 minutes.
The sanitized inventory and evidence digest are in
[the verification record](../docs/verification/20261119-local-launch.json).
The earlier stopped runs remain historical evidence.

## Separate mandatory checks

Run the production build, lint, TypeScript, API contract and full security audit as
separate gates. The isolated workflow command never suppresses or replaces them:

```sh
npm run lint
npm run typecheck
npm run api:contract
npm run build
npm run test:dependency-audit
```

The full dependency audit passed with zero findings on 19 November. Repeat it
for the actual release. A production-only audit is not a waiver for full-audit
failures. Do not force dependency overrides or lower the audit threshold.

For the existing Playwright suite and HTML/JUnit reports, follow
[the E2E testing guide](../docs/E2E_TESTING.md). Console workflow checks and browser
reports are different evidence; keep both with the staging release record.

## Your real-world acceptance work

After engineering closes the remaining implementation gaps and staging is
configured, assign named staff to test their actual jobs on desktop and phones.
Use controlled test customers, warehouse parcels, cameras, scanners and an 80 mm
printer. Verify the customer-visible timeline and uploaded inspection evidence
against the real package, not fabricated tracking data.

Complete the business details, licensed content and provider account steps in
[the owner setup index](README.md) and [API connection guide](API_CONNECTION_GUIDE.md).
The private storage/scanner, SMS/WhatsApp, suppliers and image-search work listed
there is not completed by local test success or by adding API keys.

Before real orders, record provider sandbox/live acceptance, payment/refund and
settlement evidence, authorized private-file access, approved retention/holds,
backup restoration, monitoring/alerts, load/security review and physical-device
results in Admin launch readiness. Do not clear a readiness item without evidence.
No live service, cloud resource or production release was certified by this run.


## Latest full selected-suite run — 13 November 2026 (42 suites)

All 42 declared workflow suites passed together against source commit 9f17ba6 in
one owned disposable local PostgreSQL/Docker environment. This includes the recent
identity/screening decisions, Admin rule lifecycle and catalog-maintenance controls,
plus existing role, order, tracking, identifiers, notification and phone workflows.
Declared count/order and schema/container cleanup were verified. Temporary Next.js
configuration entries were removed; no owner database or real provider was used.

Evidence: /tmp/deshdak-sqa42-20261113.log. See the engineering acceptance register
for its SHA-256 and limits. Production build/lint/type/API/security/integrity checks
passed for the same application source before this run. No application changes
were needed during the combined run.

This is selected automated workflow acceptance, not certification for every page,
physical device, live integration or cloud recovery behavior. Dependency-audit,
production implementation/provider/cloud/load/device and independent security
release gates remain open. No manual setting is needed for these code fixes.

## Previous full selected-suite run — 13 November 2026 (39 suites)

All 39 declared suites passed together in one owned disposable PostgreSQL/Docker
run after the private upload/download/review authorization fixes and maintenance
button readiness fix. Count, order and schema/container cleanup were verified.
The buttons now remain disabled until their JavaScript handlers are ready; a
mobile test deliberately delays scripts and verifies error recovery afterward.
No owner database, real identity documents or live provider was used.

This does not certify every page/device, live services or production readiness.
Existing dependency-audit, storage/scanning integration, provider, cloud, load and
physical-device/security acceptance gates remain. No manual setting change is
needed for the button fix. Follow the setup index for the unfinished integrations.

## Previous full selected-suite run — 13 November 2026 (36 suites)

All 36 declared workflow suites passed in one owned disposable Docker/PostgreSQL
run after the session authorization and notification refresh hardening. This includes customer/seller flows,
employee role isolation, ordered logistics tracking, claims/refunds, Admin navigation,
notification controls, OTP issuance/operations/maintenance investigation and the
new session authorization race checks. The declared suite order/count and final cleanup markers were verified.
No owner database or real provider was used. Generated schema/container and temporary
Next.js configuration entries were removed.

This is acceptance of the selected automated workflows, not every page/device or
production integration. At the time of that run, the full npm audit reported seven moderate package-chain
findings rooted in the recorded minimatch advisory; production-only audit reports
zero. The compatible-fix dry run does not clear the seven findings. Dependencies and
the release gate were not changed in that run. On 16 November both dependency audits passed with zero findings. Live provider, cloud, load/security and physical
scanner/phone/printer acceptance remain separate requirements.


The session change rejects existing cookies for pending/inactive accounts and
rechecks authorization after a last-seen update waits on other session changes.
Unknown role codes do not become effective roles implicitly. Notification controls
stay pending until server-rendered read state refreshes. No owner configuration or
secret rotation is required for these code changes. Existing ACTIVE users retain
normal sessions; pending customers should complete the email verification workflow.

13 November UI follow-up: identity review now recovers from network/malformed
responses and remains busy through queue refresh. Targeted authorization/browser
and Compliance portal checks passed; the complete 39-suite run above precedes
this UI change. Use the evidence in docs/IDENTITY_REVIEW_AUTHORIZATION.md for the
current targeted scope. No owner setting is required for the UI fix.

## Linux browser acceptance confirmed 18 November 2026

All 105 configured Chromium desktop and emulated-mobile cases passed across three
sequential disposable Docker shards against de27e69. The Linux visual comparisons
also passed. Reports are recorded in docs/E2E_TESTING.md. No owner setting or
production migration is needed for this verification. Actual phones, scanners,
printers, live providers and the deployed environment still require acceptance.

## Media lifecycle verification — 20 November 2026

The full disposable command passed all 112 current launch gates, including the
new media-lifecycle workflow and the full dependency audit with zero findings.
Policy/hold/release audit rollback and desktop/mobile forms passed. The focused
lifecycle run also passed after final page formatting. Review
[the sanitized evidence](../docs/verification/20261120-media-lifecycle.json) for
scope and limits. These checks never enabled deletion or contacted live storage.
