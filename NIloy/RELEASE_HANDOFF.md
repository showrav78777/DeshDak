# DeshDak release handoff

Reviewed 18 November 2026. The verified source is prepared for the approved
GitHub repository, showrav78777/DeshDak, on codex/deshdak-platform.

## Verified locally

- The full launch runner passed 110 gates.
- All 105 configured Chromium browser cases passed on macOS.
- All 105 distinct Linux browser cases passed across three sequential Docker
  shards, including both visual comparisons. Each shard passed 37 executions
  because the three setup checks repeat.
- The production build and local runtime/migration container acceptance passed.
- Full and production-only dependency audits passed with zero findings on
  16 November. Run the audit again for the actual release.
- The isolated backup/restore drill restored 136 application tables and 81
  migrations. The warmed local performance probe passed 100 requests at
  concurrency five with zero errors and 611 ms p95.
- The scanner container passed local acceptance with real ClamAV and fresh
  definitions.

These checks establish local acceptance for their recorded revisions. Deployment,
live services, actual phones and warehouse equipment require their own evidence.
See docs/LAUNCH_READINESS_STATUS.md and docs/E2E_TESTING.md.

## Your account and business setup

1. Choose the staging and production hosting account, region and domain. Follow
   DOCKER_AND_AWS_SETUP.md for database, TLS, secrets, monitoring and deployment.
2. Supply the registered company name, address, tax rules, support contacts,
   approved policies, licensed catalog, real warehouse addresses and route rates.
3. Obtain the payment merchant account, verified email domain, SMS sender/account
   and any optional Google, Meta WhatsApp, supplier or AI approvals you want.
   Follow API_CONNECTION_GUIDE.md and the individual service guides.
4. Give the deployment operator access using account roles and the secret
   manager. Keep credentials out of Git and chat.
5. Arrange staff acceptance on actual phones, cameras, scanners, printers and
   physical delivery workflows. Record evidence in Admin launch readiness.

## Engineering still required

- Connect authenticated identity and inspection intake/download routes to the
  private storage and scanner components. Complete retention, holds, recovery,
  controlled quarantine release and video handling. See
  PRIVATE_PHOTO_STORAGE_SETUP.md.
- Finish live phone issuance/dispatch scheduling, delivery receipts and
  reconciliation. The encrypted queue and transport components have local tests.
  Public live SMS remains unavailable until the integration is accepted.
- Implement the optional Meta WhatsApp adapter, authenticated receipts, templates,
  opt-in and opt-out before enabling that channel.
- Complete each selected supplier adapter and its approved secret resolution,
  capabilities and staging tests. Complete image/vector search integration if
  it is offered at launch.
- Certify payment/refund/reconciliation, email delivery and suppression, Google
  OAuth and AI against the actual approved service accounts.
- Deploy staging and verify production image vulnerabilities/signing, ingress,
  storage permissions, backups/restore, alert delivery and realistic load.
  Complete independent security and physical-device acceptance before paid launch.

## Where to manage setup

Open Admin → System → Live setup guide to see service requirements and variable
names. Record evidence in the launch register. Presence of a variable establishes
configuration presence only. Each integration needs a successful acceptance test.

## Browser reports on this workstation

Linux HTML reports and JUnit files are preserved in the ignored directories
playwright-report-linux-release-20261118-{1,2,3} and
test-results-linux-release-20261118-{1,2,3}. Archive accepted evidence in your
organization's release store. These generated files contain synthetic test data
and are excluded from Git.
