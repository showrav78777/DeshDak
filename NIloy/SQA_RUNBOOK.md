# Run and accept system testing

## Repeatable local workflow checks

Start local Docker and install the project's pinned Node/npm dependencies and
Playwright Chromium browser. From this repository run:

```sh
npm run test:sqa:isolated
```

This command creates its own randomly named PostgreSQL container, random test
credentials and a generated isolated schema. It selects a local application port,
runs 37 customer/seller/employee/Admin/authentication/notification workflow suites,
then removes its schema/container on normal success or failure. It rejects remote
Docker daemons and accepts no database/container/script arguments. It does not
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

The full dependency audit currently blocks release with the tooling findings
recorded in README.md. A passing production-only audit is not a waiver. Do not
force dependency overrides or lower the audit threshold to mark launch ready.

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


## Latest full selected-suite run — 13 November 2026

All 36 declared workflow suites passed in one owned disposable Docker/PostgreSQL
run after the session authorization and notification refresh hardening. This includes customer/seller flows,
employee role isolation, ordered logistics tracking, claims/refunds, Admin navigation,
notification controls, OTP issuance/operations/maintenance investigation and the
new session authorization race checks. The declared suite order/count and final cleanup markers were verified.
No owner database or real provider was used. Generated schema/container and temporary
Next.js configuration entries were removed.

This is acceptance of the selected automated workflows, not every page/device or
production integration. The full npm audit still reports seven moderate package-chain
findings rooted in the recorded minimatch advisory; production-only audit reports
zero. The compatible-fix dry run does not clear the seven findings. Dependencies and
the release gate were not changed. Live provider, cloud, load/security and physical
scanner/phone/printer acceptance remain separate requirements.


The session change rejects existing cookies for pending/inactive accounts and
rechecks authorization after a last-seen update waits on other session changes.
Unknown role codes do not become effective roles implicitly. Notification controls
stay pending until server-rendered read state refreshes. No owner configuration or
secret rotation is required for these code changes. Existing ACTIVE users retain
normal sessions; pending customers should complete the email verification workflow.
