# DeshDak launch readiness status

Status reviewed: 26 November 2026, Asia/Dhaka

Current summary: scanned identity/inspection photo routes and protected object
downloads are implemented behind a disabled production switch. Admin provides
versioned retention settings, scoped preservation holds, review scheduling and
immutable independent deletion-review requests/decisions. Approval never queues
cleanup or authorizes execution. All 115 launch gates and the production build passed on 26 November, with
zero dependency audit findings. Local acceptance does not certify live services.
A limited default-disabled internal worker covers abandoned unlinked identity uploads;
production wiring and broader linked-media execution/recovery, video, messaging/supplier integration
and real staging/security acceptance remain unfinished. See the dated evidence
and NIloy/. Live acceptance is not claimed.

## Current handoff — 5 November 2026

On 4 November, all 105 configured browser checks passed in one isolated run on
Next.js 16.4.5, with no skips/failures, including the reviewed desktop/mobile
visual comparisons. The current runtime and matching migration image also passed
the repeatable disposable production-container acceptance command: migration
gate, readiness/liveness/public pages, Admin redirect, runtime CAPTCHA public-key
delivery, synthetic widget initialization, non-root/read-only filesystem behavior
and rejection of missing settings. That container check covered the then-current 297-operation contract.
See `E2E_TESTING.md` and `DESHDAK_CONTENT_MANAGER.md` for evidence and limits.

On 5 November, the signed email receipt and recipient suppression increment
passed isolated API/worker/preference tests and five targeted browser checks
(desktop, mobile and setup). Delivery confirmation is distinct from API acceptance;
MFA-protected Admin reviews record versioned evidence before a recipient block
is released. The current contract contains 300 operations. Provider DNS/account
configuration and live staging certification remain due; see
`NOTIFICATION_DELIVERY_RUNBOOK.md` and `NIloy/EMAIL_LIVE_SETUP.md`. The current runtime/migration images were subsequently rebuilt and passed the
expanded disposable container checks, including signed receipt rejection, replay,
conflict and private-access checks with email sends disabled. These checks do not
replace the historical full browser run, an image CVE scan or provider certification.

The refreshed 5 November production dependency audit reported zero vulnerabilities.
The full audit reported eight moderate development-tooling findings, down from
sixteen in the previous report (GHSA-g3hv-75wg-m249). No lockfile change caused
this count change. TypeScript ESLint still requires an affected minimatch 10.x
range; compatible upstream fixes remain outstanding. The release audit gate has
not been suppressed. Older September/October records are not current clearance.

The 5 November private upload intake increment fixed identity response storage-field
exposure, image decoding/metadata handling, streamed-body bounds and concurrent
pending submissions. Synthetic isolated identity/Compliance and Inspector evidence
workflows passed; see `PRIVATE_UPLOAD_INTAKE_SECURITY.md`. Production private
storage/scanning remains engineering work and intake remains disabled there.

On 6 November the authenticated website-image scanner gateway and serialized
FreshClam startup wrapper passed real-engine Docker acceptance with ClamAV 1.4.6
(AMD64 emulation on the ARM host). Fresh definitions and a clean image passed;
the antivirus test string and unsupported ZIP fixture were rejected. A reproduced
upstream ZIP truncation limitation means this remains an image-only gateway,
paired with application decode/re-encode. It is not a general private-document
scanner. TLS/ingress, approved image digests/CVE review, signature-update monitoring
and production certification remain due. See `NIloy/MEDIA_SCANNER_SETUP.md`.

The private-photo S3 adapter core was locally verified on 6 November with SDK-
signed simulated requests, application encryption, KMS/version/checksum requirements,
uncertain-write confirmation, bounded reads and exact-version deletion. It is not
connected to routes and adds no activation switch; the durable intake, scanning,
retention and delivery orchestration remains engineering work. No AWS account was
contacted. See `PRIVATE_PHOTO_STORAGE_ADAPTER.md`.

The owner database has not been migrated, AWS has not been provisioned, and no
real provider has been accepted. Private storage/scanning and outstanding provider
adapters remain engineering work as well as owner/service setup. Staging UAT,
physical-device/warehouse acceptance, image scanning/signing and independent
security/load review still block a paid production release. GitHub upload remains
pending the user's requested completion/verification condition. Owner-only setup
instructions are under `NIloy/`; the protected Admin live setup guide lists service
requirements without exposing credentials.

## Historical handoff — 21 October 2026

The September baseline below is historical, not a current full-system or production
certification. Recent increment-level verification passed the focused Inspector,
Warehouse and Ship for Me API regressions and all 33 isolated browser cases in
115.15 seconds, with zero failures/skips/errors. Inspection lost-response recovery
was checked against PostgreSQL: one decision, event and audit. The production
build, relevant static/policy/security checks and 288-operation API contract passed.
See `INSPECTION_REQUEST_INTEGRITY.md` and `E2E_TESTING.md` for scope and evidence.

The owner database has not been migrated by those tests. Before enabling the recent
supplier/inspection workflows, use `RECENT_WORKFLOW_RELEASE_CHECKLIST.md`; review
the actual target migration status rather than assuming tests updated that database.
No real supplier, payment, storage/scanning or other production provider was activated.

Open engineering risks include development-server stalls/timing errors and the
previously recorded five high-severity development dependency advisories. An earlier
combined test-server run timed out; the final API/browser phases passed on separate
fresh servers/schemas. That is not proof that the underlying stall is resolved.
The advisory count is historical, not a new dependency scan. Real-device/staging
acceptance, provider UAT and independent production security/load review remain due.

## Historical automated baseline — 9 September 2026

All 66 always-on release-candidate gates passed across the required development and optimized-production runtime checks. The protected-report cache assertion and final notification/marketing checks passed against the optimized production server, and the production application compiled and generated all 159 pages successfully. The clean database baseline contains 59 migrations and the versioned contract documents 266 API operations. The suite now also enforces Product Reels and the Sales/KAM opportunity pipeline alongside original-method refund, chargeback accounting, production-cookie test portability, and production dependency integrity; it adds security-cleanup and payment-operations-monitor gates, for 68 total, when `MAINTENANCE_JOB_SECRET` is configured. Every available `test:*` command is therefore represented by the release runner, either always or behind its required external configuration. The host sandbox prevented Turbopack's internal CSS worker from binding its local port, so the successful optimized build used Next.js's official webpack build mode. Scheduler-backed checks remain intentionally skipped because no local `MAINTENANCE_JOB_SECRET` is configured.

Verified areas:

- OpenAPI generation/contract, TypeScript, lint, clean migration reconstruction, zero schema drift, and observability.
- CSRF, Admin MFA, recovery, sessions, authorization/portal isolation, and safe audit logs.
- Customer profile/address, wishlist, cart, checkout rules, coupons, promotions, wallet/refund calculations, and financial journals.
- Admin-enabled customer countries, secure anonymous market persistence, signed-in country authority, cache-safe market ranking, Bangladesh/international catalog priority, and one adaptive market-aware homepage.
- Catalog, product reviews, seller stores/products, CSV imports, and fail-closed seller connector configuration.
- Public Product Reels, quality-weighted ranking, idempotent engagement, authenticated reactions, moderated comments, seller ownership and Admin moderation.
- Business-only Sales/KAM accounts, Admin assignment, row-level portfolio isolation, Account 360, immutable follow-ups, sourcing-request links and access revocation.
- Restricted goods, Compliance, Finance, Sourcing, Warehouse, Inspector, Logistics, Ship for Me, RMA, Customer Service, Help Centre, and AI-to-human handoff.
- Unique identifiers, QR/barcode assets, scan routing, labels, PWA-compatible pages, notification preferences, marketing delivery, scheduling, cancellation, and reporting.

No failing local application workflow was found by that September audit. Subsequent
defects and fixes are recorded in the increment notes; do not reuse this statement
as current acceptance evidence.

## Current release classification

The repository is a strong local/staging release candidate. It is not yet approved for a paid public production launch because external infrastructure, provider, policy, and physical-operation gates remain unfinished.

## P0 external launch blockers

1. Production HTTPS domain, hosting, PostgreSQL, connection pooling, CDN/WAF/DDoS protection, secret manager, logs/alerts, encrypted backups, restore drill, RTO/RPO, and rollback.
2. One real payment provider with hosted checkout, signed webhook verification, sandbox/UAT failure cases, refunds, reconciliation, settlement, chargeback handling, and approved credentials.
3. Production CAPTCHA/human verification and verified transactional-email delivery with sender-domain controls and bounce/suppression handling.
4. Private product/store/Reel/evidence media storage with signed uploads, MIME/signature/size checks, malware scanning, metadata removal, video transcoding/thumbnails, CDN delivery, and retention/deletion controls.
5. Approved legal identity, terms, privacy/cookie notice, returns/refunds, seller terms, restricted-goods/customer wording, wallet legality, marketing consent, and data-retention policy.
6. Real warehouse identity/address/hours, launch shipping lane/rates, carrier procedure, packaging rules, labels, scanner/printer/mobile-device acceptance, staff training, and escalation contacts.
7. Named Admin, Compliance, Finance, Warehouse, Inspector, Logistics, Sourcing, and Customer Service staff with separate accounts, MFA, least privilege, shifts, approval limits, and recovery procedures.
8. Independent penetration/dependency/infrastructure security review plus agreed load/soak tests and measured launch capacity.
9. A secret-manager-backed `MAINTENANCE_JOB_SECRET` and managed schedules/alerts for security cleanup, compliance catalog maintenance, support SLA processing, and scheduled marketing campaigns. This local audit skipped the scheduler-secret test because the secret is not configured.

Owners and Admins can record responsibility, deadlines, blockers, and reviewed non-secret evidence for these gates at `/admin/launch-readiness`. A recorded status is coordination evidence only; it does not itself activate or prove an external control.

That page now also presents six machine-checked, non-secret signals: database connectivity, production configuration, approved checkout lanes, approved country payment paths, warehouse records, and operational-role staffing. Deployment-dependent checks are explicitly marked `DEVELOPMENT` during local development and cannot silently convert the manual release gates into approval.

Admin can generate a current A4 evidence summary at `/admin/launch-readiness/report` and print or save it as PDF without sending operational records to a document provider. The report is protected, no-indexed, tested for environment-secret non-disclosure, and cannot claim readiness while any required gate remains unverified.

## Not launch blockers for the controlled first release

- Supplier and seller API synchronization.
- Additional countries, currencies, carriers, and payment methods.
- Flutter Android/iOS applications.
- Email/SMS/WhatsApp/push marketing.
- Image search, advanced recommendations, loyalty/referrals, and seller payouts.

These remain fail-closed and should be delivered sequentially after production stabilization.

## Next engineering action

The local anonymous-browser and 390 x 844 responsive smoke pass is recorded in `LAUNCH_BROWSER_ACCEPTANCE.md` with no reproducible P0/P1 application defect. Repeat the browser/device acceptance pass in staging with realistic seeded launch data and separate role accounts, then fix only reproducible P0/P1 issues. Provider adapters should begin only after the owner supplies the selected provider's official documentation, sandbox, secret-manager references, and approved business rules.

The repository now also contains a multi-stage, non-root Next.js standalone container, a fail-closed runtime configuration check, a liveness health check, a restricted build context, and a CI container-policy test. Before launch, the infrastructure owner must select the platform, private registry, scanner and signing system; pin the approved base image by digest; build, scan, sign, and deploy the exact release image by immutable digest; and enforce readiness, private networking, a read-only filesystem, dropped capabilities, resource limits, monitoring, and rollback.

The local container was built end-to-end on 1 September 2026. Its clean install reported zero npm vulnerabilities, its production build passed, the final image declares the non-root `nextjs` user and liveness check, and a no-secret startup test failed closed without disclosing values. Registry scanning/signing and a production-like deployment remain external launch gates.

## Private upload reservation follow-up — 6 November 2026

The internal storage adapter now has a durable PostgreSQL reservation/recovery
ledger. Component acceptance passed one-write idempotency, verified lost-response
recovery, namespace conflicts, corruption and stale-worker fencing. See
PRIVATE_PHOTO_UPLOAD_LEDGER.md. This does not complete private production intake:
identity/inspection linking, scanning, approved cleanup and authorized delivery
remain disconnected. No owner migration or AWS operation was performed.

## Private photo binding follow-up — 7 November 2026

Confirmed reservations can now be bound internally to existing identity or
inspection records with fresh role/session/warehouse/MFA authorization, scan/digest
and immutable database binding checks. Local PostgreSQL component acceptance
passed; scan proofs were synthetic. Existing readers and legacy encrypted evidence
remain unchanged. See PRIVATE_PHOTO_RECORD_LINKS.md. This does not activate private
S3 intake/delivery or complete scanning, recovery UI or retention integration.


## Private photo scan proof follow-up — 7 November 2026

The internal intake component now requires clean digest-bound scans of original
and normalized photos before encrypted storage, and records proof after storage
verification. Real PostgreSQL component acceptance covers scan/decode rejection,
metadata removal, idempotency, uncertain-write recovery and downstream bindings;
S3 and scanner responses were simulated. See SCANNED_PRIVATE_PHOTO_INTAKE.md.
This does not activate production HTTP intake, protected object-backed downloads,
quarantine/recovery UI or retention. No owner database or AWS account was changed.


## Protected object-reader follow-up — 7 November 2026

An internal private-photo reader now checks current Compliance/customer/staff/
Admin MFA access, immutable binding and both scan proofs before storage and again
after decryption, with fail-closed audits and no legacy fallback. Local PostgreSQL
acceptance includes in-flight authorization changes, storage corruption/outage
and audit-write failure. S3 and scan proofs were simulated. See
PRIVATE_PHOTO_DELIVERY.md. HTTP upload/download activation, quarantine/recovery UI,
retention/holds and live-provider certification remain required. No owner database
migration or AWS operation was performed.


## Admin private-photo quarantine — 7 November 2026

Admin → System → Private photo safety now provides a paginated redacted queue and
MFA-protected permanent quarantine with fixed reasons, explicit confirmation,
CSRF protection, bounded JSON, safe retries and audit. Immutable blocks prevent
ordinary upload recovery or binding from reopening a photo; object reads and
linked legacy downloads enforce them. Compliance object reads explicitly require
MFA. See PRIVATE_PHOTO_QUARANTINE.md. Production object routing, controlled release/
rescan/recovery, retention/holds, video and live-provider/full-system acceptance
remain unfinished. No owner migration or AWS operation was performed.


## Quarantine review history — 7 November 2026

Private photo safety now records immutable, version-checked next-action reviews
with case references and complete paginated history. Admin MFA, fresh roles/
sessions, CSRF, bounded JSON, confirmed blocked status, safe retries and atomic
audit are enforced. Concurrent decisions conflict rather than overwrite. All
outcomes leave quarantine and evidence unchanged; rescan/replacement tasks are
not executed or certified by recording them. See PRIVATE_PHOTO_REVIEW_WORKFLOW.md.
Actual rescan/replacement/release, retention/holds, production object routing,
video and staging/full-system acceptance remain unfinished. No owner migration
or provider operation was performed.

## 16 November 2026 — dependency audit and recovery drill

The full and production-only npm audit gates passed with zero findings. The
lockfile uses minimatch 11.0.4 only for TypeScript ESLint's ESTree parser. This
override crosses the parser's declared minimatch 10 range and was checked with
repository lint and the parser's project-service glob matching. Remove the
override when the supported upstream release includes a patched dependency.
The CI moderate threshold remains in effect.

The production build, TypeScript, dependency integrity, API contract, production
configuration, backup/restore safety, performance policy and container safeguards
passed. The local backup/restore drill used an empty restore target, verified the
archive checksum, and restored 136 application tables and all 81 migrations.
PostgreSQL 16 clients were used after the host's PostgreSQL 14 client could not
dump from the 16 server. The disposable database and backup were removed.
Provider, cloud and physical-device acceptance still require their own evidence.

The warmed local development runtime passed a bounded read-only performance
baseline across home, products and liveness. All 100 requests returned HTTP 200
at concurrency five, with 611 ms p95. The initial cold warm-up exceeded its
deadline. The rerun used preloaded pages and the canonical local hostname.

### Full local launch verification

All 110 ordered launch-candidate gates passed on 16 November after correcting
test-only cookie headers, classifying the standalone Docker and SQA commands,
and updating the anonymous-market assertions for the current homepage. The gate
list and audit threshold were preserved. The separate production build and Docker
runtime checks passed. The scanner container also passed acceptance with real
ClamAV and fresh definitions, invoking the engine probe inside its disposable
environment. The local launch runner removed its schema and database container.
Evidence is in /tmp/deshdak-launch-final.log. Live provider, staging, cloud and
physical-device acceptance remain separate release requirements.

### Linux browser acceptance confirmed 18 November 2026

The sequential run against de27e69 passed every one of the 105 declared Chromium
desktop/emulated-mobile checks, including the two Linux visual baselines.
Three shards passed 37 executions each, with six repeated setup executions
accounting for the 111 total. JUnit showed zero failures, errors or skips.
Combined project/file/full-title coverage was checked against Playwright's
declared inventory. The run removed its disposable databases and networks.
Evidence is in /tmp/deshdak-browser-linux-sequential.0bVjzDZf/.
This completes local Linux browser acceptance for that source revision.
Cloud/provider certification and physical-device/warehouse acceptance remain due.

## 18 November 2026 — private photo routing and new audit blocker

The identity and inspection photo HTTP routes now connect to the existing scanned,
encrypted S3 ledger behind PRIVATE_PHOTO_STORAGE_ENABLED=false by default. Subject,
immutable object binding and audit commit together. Website retries retain their
idempotency keys. Linked downloads use current authorization and exact-version
integrity checks. Migration 20261118120000_object_photo_intake adds reservation
scope metadata and permits object-backed PHOTO evidence to omit legacy ciphertext.
Existing database-backed evidence remains supported. See OBJECT_PHOTO_ROUTES.md.

Seven isolated affected suites passed, including the actual multipart identity
handler with a synthetic storage boundary. PostgreSQL transactions and encryption
were real. Original/normalized scans and S3 acknowledgements were simulated.
Five focused desktop/mobile browser checks passed, including setup. Clean migration,
zero schema drift, reference seed and repeat deploy passed on a disposable DB.
The production bundle and runtime/migration container acceptance passed. The
container check used the earlier photo-path snapshot before the final body-bound
and photo-only-null constraint adjustments; those adjustments have their own
current production-build and clean-migration checks. No owner DB or live provider
was activated. Retention, legal holds/deletion, controlled release/recovery, video
and cloud/scanner acceptance remain due.

The full 111-gate rerun stopped at test:dependency-audit. That full audit
reported 14 high-severity package-chain findings rooted in picomatch
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The official advisory lists no patched version; npm's current latest is 4.0.7.
Production-only audit reports zero. That result superseded the earlier clean full audit
for the 18 November release decision. No dependency downgrade or audit exemption was
applied. Full release and later system phases remain blocked at that gate.
Evidence is in /tmp/deshdak-object-launch-full.log and
/tmp/deshdak-object-audit-{full,production}.json.

## 19 November 2026 — clock regression and current audit

The scan-attestation recording time now comes from PostgreSQL, preventing an
application clock or timestamp rounding difference from invalidating a photo
binding. A deterministic two-second clock-skew test and clean migration, intake,
submission, binding and protected-delivery suites passed together. The current
production build also passed. Evidence is in /tmp/deshdak-photo-clock-verification.log
and /tmp/deshdak-photo-final-build.log.

A fresh full npm audit reports zero findings with no dependency changes or audit
exceptions (/tmp/deshdak-photo-current-audit.json). The subsequent full run passed
108 gates, then stopped at the old quarantine test expecting linked downloads to
fall back to legacy bytes while object storage was disabled. The corrected routes
preserve authorization and quarantine responses before object access, and the
regression now requires unavailable linked storage to fail closed while an
unlinked legacy document still opens. The full run is recorded in
/tmp/deshdak-photo-clock-full-launch.log; it must not be described as 111 passes.

The owner confirmed production accounts/staging are not ready and authorized
reasonable lifecycle defaults. NIloy/MEDIA_RETENTION_POLICY.md records provisional
24-hour abandoned-upload, 90-day identity and 180-day closed inspection eligibility,
with legal holds and separate approval required. No destructive cleanup is active;
Admin lifecycle configuration, approval/deletion implementation and staging
acceptance remain unfinished.

The follow-up in /tmp/deshdak-photo-quarantine-current.log passed all five selected
suites: quarantine, reviews, rescans, download authorization and object submissions.
It also exercised the real Admin forms at desktop/mobile sizes. Synthetic S3 and
scanner responses were used; no production storage was contacted. This closes
the observed fallback/response regression but does not turn the preceding full
run into a single successful 111-gate execution.

## 19 November 2026 — combined launch gate closed

A fresh full run against application revision fdd181c passed all 111 gates in
sequence in 4.8 minutes, including the full npm audit (zero vulnerabilities),
clean migration/drift checks, role workflows, clock-skew regression, object photo
submissions and the quarantine/review/rescan checks. The owned schema and Docker
database were removed. No owner DB or live provider was used. Raw local evidence:
/tmp/deshdak-full-release-current.log. This supersedes the earlier stopped run for
combined local acceptance without erasing its failure history.

The disposable runner now accepts --full as its only optional argument so the
full run can be repeated without modifying runner source. Default mode preserves
the selected role suites. Unsupported/extra arguments are rejected before Docker
or database access. Use npm run test:sqa:isolated -- --full. Production build and
cloud/provider/device acceptance remain separate gates. Retention/legal-hold and
deletion controls are still engineering work; this verification adds none of them.

The committed --full command was then exercised end to end and passed all 111
ordered gates in 5.6 minutes, with zero audit findings and owned-container/schema
cleanup confirmed. See verification/20261119-local-launch.json for the sanitized
ordered gate inventory, exact application revision, runner/lockfile hashes and
local log digest. Raw evidence is /tmp/deshdak-full-disposable-command.log.
Unsupported/extra runner arguments were separately rejected before Docker access.
The production bundle previously passed for the same application source; the
only code change in this verification increment is the disposable runner flag.

## 20 November 2026 — retention policy and scoped holds

Admin → Media retention and holds now provides immutable policy versions, hold
placement and paginated history. A different administrator with the Compliance
role and current MFA can release one hold. Upload/account/order/package scopes
are resolved against object-photo ownership and links at read time, so broad
holds cover photos linked later. SQL constraints preserve targets, versions,
independent release and immutable history. Fresh server authority, stable retry
keys and atomic success audits guard every change. The four versioned API
operations are authenticated and documented; mutations require idempotency keys.
The contract now contains 310 operations. No data deletion or provider activation
was added. Deletion eligibility, separate deletion approvals, worker/recovery,
legacy/video lifecycle and staging acceptance remain due.

The initial migration/workflow run and expanded lifecycle/Admin/readiness/photo
regressions passed in disposable PostgreSQL databases. Tests include concurrency,
role loss, immutable constraints, future linked-media scopes, policy/hold/release
audit rollback, bounded/redacted pagination, desktop/mobile forms and lost-response
retry. The full runner now declares 112 gates; its current execution is recorded
separately after completion. Local evidence: /tmp/deshdak-lifecycle-workflow.log
and /tmp/deshdak-lifecycle-workflow-expanded.log. Real storage was never contacted.

The combined run passed all 112 gates in 5.2 minutes with zero dependency audit
findings. The owned schema/container were removed. Evidence is in
/tmp/deshdak-lifecycle-full-launch.log. After the final text/CSS hierarchy polish,
the lifecycle API/desktop/mobile regression passed again and the production
bundle was rebuilt. No owner DB or production service was used. See
verification/20261120-media-lifecycle.json for the sanitized gate inventory,
evidence hashes and limits. Manual source checks were performed. The dedicated
security-review agent was unavailable in this session; independent production
security acceptance remains outstanding.

## 21 November 2026 — retention preview verification in progress

The protected Admin/API retention-review preview is implemented. It uses recorded
policy versions and a database clock, checks active holds, scan/storage metadata,
identity and delivery/claim records and related case closure, and returns no
storage paths, hashes or customer contact data. Purpose/upload-reference filters,
ten-row batches and bounded histories keep review requests limited. Ready means
ready for human review, never permission to delete. The versioned API contract
contains 311 operations. Index migration: 20261120170000_media_preview_indexes.

The production build passed for the final application source. An initial full
113-gate run stopped at gate 104, test:notification-read-actions: the DB count
was zero while the page was pending refresh. Its test now waits for the RSC
response headers before the unchanged UI assertions; waiting for the whole body
was rejected because development RSC responses can stay streamed.

After Docker resumed, all three affected suites passed together in a fresh owned
disposable database: notification read actions, retention preview (including the
routine-checkout regression), and immutable policy/hold/release workflows. The
schema/container were removed. A fresh full 113-gate run is in progress; do not
report it passed until completion. No owner DB, private storage, or production
provider was contacted, and no deletion or cloud activation was added.
Raw local evidence: /tmp/deshdak-preview-read-response.log and
/tmp/deshdak-preview-full-final.log. Live/independent security acceptance and
remaining deletion/video/provider engineering are still due.

The final rerun completed all 113 gates in 6.4 minutes with zero dependency audit
findings, including the new preview and existing lifecycle and notification
workflows. The owned schema and disposable Docker container were removed. The
final application source already had a passing production build; only test
synchronization and documentation changed afterward. See
verification/20261121-media-retention-preview.json for sanitized evidence.
This closes local acceptance for this increment, not production acceptance.

## 21 November 2026 — historical shipment claim-window safeguard

Before starting deletion approval implementation, source review found that the
retention preview queried only active outbound parcels. A retired parcel's
shipment could therefore be omitted even while its claim deadline was open.
A real disposable-PostgreSQL regression reproduced READY_FOR_REVIEW instead of
WAITING. The preview now checks active parcels plus every parcel on that order
with a shipment. Inactive unshipped repacking sources remain excluded. Shipment
links are bounded to two, enough to reject ambiguous assignments without loading
an unbounded list. No database schema or API contract changed.

The regression now preserves the historical claim window, blocks missing historical
claim deadlines, and accepts a closed historical shipment without blocking on an
unshipped repacking source. Both complete media preview and lifecycle suites passed,
including desktop/mobile workflows, followed by TypeScript, ESLint and a production
build under the same disabled-provider, owned disposable database environment.
Cleanup was confirmed. The preceding 113-gate full run predates this narrow fix;
it was not repeated. See verification/20261121-historical-shipment-claims.json.
No file deletion, deletion approval, storage access or production activation was
added. Authoritative deletion review/worker and live acceptance remain due.

## 24 November 2026 — independent deletion review controls

Implemented a protected Admin page and three versioned API operations for bounded
review history, ready-photo requests and independent decisions. Requests bind the
policy sequence, review schedule and private exact-upload/reference digest. The
SQL trigger sets an immutable 24-hour lifetime and permits only one pending request
per upload. Decisions require a different Admin with Compliance and MFA, preserve
immutable history, and have atomic audit/idempotent retry semantics. Approval
rechecks ready state, policy, reference snapshot, holds, related cases and expiry.
The upload metadata is share-locked during snapshot construction. This records a
review only; the worker still needs authoritative revalidation before any bytes
can be removed. No deletion executor or storage/provider operation was added.

Migration: 20261124150000_media_deletion_reviews. API contract: 314 operations.
Initial targeted suites, migration application, TypeScript, lint and contract
checks passed. The first full run stopped at photo-review history visibility:
the instant layout assertion raced the Admin pane's smooth scrolling. The test
now polls the same unobscured-heading requirement without sleeping or moving the
page artificially. All four final affected suites then passed, including current
role loss, concurrent decisions, exact-version/policy/hold/case conflicts, synthetic
clock expiry, audit rollback, immutable SQL history, lost-response retry and
real desktop/mobile forms. A fresh full verification/build outcome is recorded below.

Final 24 November acceptance: the fresh run passed all 114 gates in 6.2 minutes,
including the complete final review tests and unchanged toolbar-visibility
requirement. The production build then passed in the same disabled-provider,
owned-disposable environment. Schema/container cleanup was confirmed. See
verification/20261124-media-deletion-reviews.json for ordered gate and file-hash
evidence. Source/role/transaction checks were manual; independent production
security and live provider/device acceptance remain outstanding. No executor or
live private-storage activation was added.

## 24 November 2026 — exact-version storage deletion prerequisite

Before connecting execution, source review found that the existing storage
remove primitive accepted a DELETE acknowledgement without confirming version
absence. It now checks exact-version metadata, checksum, ciphertext size/type,
KMS key and a strong ETag, preserves reported holds/unexpired retention, sends an
ETag-conditional version-specific request without retention bypass, validates the
acknowledgement and confirms absence. A HEAD 404 must be followed by a successful
expected-owner/region bucket probe. Read-only confirmRemoval supports later
journalled uncertainty reconciliation without another DELETE. Its receipt is
version absence only, not complete erasure or execution authorization.

Expanded tests use real signed AWS SDK requests to a synthetic loopback server.
They passed metadata/hold/retention rejection, ETag races, lying/failed/lost
acknowledgements, retained versions, bucket/permission uncertainty, reconciliation
without repeat deletion and preservation of a newer version at the same key.
TypeScript and lint passed. A fresh full run then passed all 114 gates in 5.4
minutes with zero dependency audit findings, followed by a successful production
build under the same owned-disposable/disabled-provider environment. Schema and
container cleanup were confirmed. See
verification/20261124-storage-deletion-protocol.json for ordered/file-hash evidence.

There is no new migration, public/Admin execution endpoint, worker or activation
switch. The worker's durable journal, authoritative case/hold/permission guards,
subject/legacy-data transitions, backups/version reconciliation and live
acceptance remain unfinished. The relevant AWS references and role prerequisites
are recorded in PRIVATE_PHOTO_DELETION_PROTOCOL.md and the NIloy setup guide.


## 24 November 2026 — internal abandoned-upload cleanup journal

A default-disabled internal worker now supports only stored, unbound identity
uploads belonging to personal customers without transactional or case history.
It commits an immutable attempt and reservation audit before storage, rechecks
current independent authority/MFA, policy, holds, scope and exact references,
and fences changes with PostgreSQL locks. Duplicate execution never repeats
DELETE. An uncertain or interrupted result requires read-only reconciliation;
a confirmed exact-version absence atomically records an observation, audit and
cleared immutable upload tombstone. Intake retries and direct links are fenced.

Admin review history displays redacted journal state on desktop/mobile. No
production runtime, scheduler, execution endpoint or activation setting is
connected. Linked identity/inspection media, transactional accounts, replicas,
backups, video and full erasure remain outside this worker. Actual provider
credentials, staging security/failure/restore/load and device acceptance remain
required. See ABANDONED_PHOTO_CLEANUP.md and NIloy/.

The focused six-suite run passed using disposable PostgreSQL and simulated
storage, including database fault injection and observed FK-lock contention.
TypeScript and lint passed. Full-run acceptance is recorded separately after
completion; no owner database or customer file was touched.

Final acceptance: all 115 launch gates passed in 6.6 minutes, with zero dependency
audit findings, 314 API operations and a successful production build. The owned
disposable schema/container were removed. See
verification/20261124-abandoned-photo-cleanup.json. This is local acceptance for
the documented scope; no live-service certification or production activation.


## 24 November 2026 — combined SDK/database cleanup verification

The isolated abandoned-photo cleanup suite passed with seven additional scenarios
using the actual AWS SDK/photo-store code, loopback synthetic S3 HTTP responses and
real disposable PostgreSQL. It verifies journal-before-delete, storage hold and
checksum preservation, lost acknowledgement/bucket denial/audit-failure recovery,
no repeat deletion and preservation of a newer version. Existing worker RBAC,
fault/concurrency, API redaction and desktop/mobile checks also passed. Syntax,
ESLint and diff checks passed; schema/container cleanup was confirmed.

No production application code, schema or API changed in this verification
increment. The full 115-gate/build result above applies to its recorded revision;
this increment ran the focused worker suite only. Production cleanup remains
disabled. Broader linked-media/video engineering and live-service/security/device
acceptance remain unfinished. See verification/20261124-cleanup-sdk-database.json.


## 24 November 2026 — private-media implementation release guard

Admin now shows a seventh technical signal that fails for unfinished inspection
video, broader linked-media cleanup/recovery and missing cleanup runtime/scheduler.
The required private-media gate cannot be marked VERIFIED or made optional through
the API; attempted bypasses produce redacted audit records without changing the
gate. The dashboard remains blocked by that engineering status. Register/report
readiness also requires every technical signal to pass, so historical VERIFIED
records cannot override the failure. This is a release-reporting safeguard, not
implementation of the missing media workflows or activation of cleanup.

The isolated launch-readiness suite passed, including bypasses using renamed/
recategorized input and synthetic all-VERIFIED records, followed by the production
build (181 pages). API contract validation (314 operations), TypeScript, ESLint
and diff checks passed. Disposable schema/container were removed. No owner DB
was changed. Full launch/audit/device/live-provider acceptance was not rerun.
See verification/20261124-media-readiness-guard.json. NIloy stays local-only.


## 24 November 2026 — supported inspection capture options

The assigned-package evidence API now exposes a bounded, non-secret upload
capability description without changing existing evidence fields. Inspector and
Warehouse camera/device controls wait for that check, hide video in secure-photo
mode, reject unsupported video before POST, and handle unavailable, malformed and
failed responses with a retry. Explicit local development may still offer video;
production never uses that fallback. No production video processing was added.

The isolated Inspector, Warehouse and scanned-private-intake suites passed,
including actual assigned-staff API authorization and simulated capability/error
states at desktop 1440px and mobile 390px. Six pure capability-policy cases passed.
TypeScript, ESLint, API contract validation (314 operations), diff checks and the
production build (181 pages) passed. Disposable schema/container were removed; no
owner database/live provider was used. Full launch/audit and physical-device
acceptance were not rerun. See verification/20261124-inspection-upload-options.json.
Production video, broader linked-media cleanup/recovery and live acceptance
remain unfinished. NIloy stays local-only and ignored.


## 26 November 2026 — inspection safety fix handoff

The 24 November verification run passed all 115 launch gates in 7.3 minutes,
including the new quarantined-evidence attachment regressions, with zero dependency
audit findings and a successful production build (181 pages, 314 API operations).
Owned disposable schema/container cleanup was confirmed. This handoff records that
saved result; it is not a fresh 26 November dependency audit or live acceptance.

New inspection decisions reject linked quarantined, non-stored, cleanup-fenced or
wrong-purpose uploads inside the existing transaction. PHOTO and BASIC requests
with blocked evidence preserve package/order/inspection/event state and record
redacted denial audits. Staff selectors mark such records unavailable and disable
view/attachment controls. Existing historical idempotent results remain unchanged.
See INSPECTION_EVIDENCE_REVIEW.md and
verification/20261126-inspection-evidence-review.json.

Production video, broader linked-media cleanup/recovery and live-service/security/
device acceptance are still unfinished. Cleanup remains disabled. Owner-only
procedures and the final status summary stay in ignored NIloy and are not uploaded.


## 26 November 2026 — database time for private photo recovery

Private-photo Admin authorization now checks session expiry and future MFA against
database time. Rescan quota/deadline checks, replay expiry, history and final proof
freshness also use the database clock. A skewed adapter proof stays UNCONFIRMED;
CLEAN never releases quarantine. The recovery DTO receives explicit database time.

Seven isolated media suites passed, covering ±24-hour host drift, expired-session
and future-MFA denial before provider I/O, independently tested review expiry,
existing concurrency/audit boundaries and SDK cleanup recovery. TypeScript, ESLint,
diff checks and the production build (181 pages) passed. Owned schema/container
cleanup was confirmed. No schema/API shape change or owner/live service access.
Full launch/dependency audit and real provider/device acceptance were not rerun.
See verification/20261126-rescan-database-clock.json. Production video, broader
linked-media cleanup/recovery and live acceptance remain unfinished. NIloy stays
local-only; no production runtime was activated.


## 26 November 2026 — private file delivery and account mutation clock

Shared active-account mutation locks now check expiry with database time. Object
delivery checks expiry, future MFA and scan timestamps against database time,
including a final check after its subject/assignment lock waits and the repeated
authorization after storage. Legacy-file authorization uses the same account
guard and database expiry/MFA checks. Existing role/ownership/quarantine/audit
boundaries are preserved. See PRIVATE_PHOTO_DELIVERY_CLOCK.md.

The fresh isolated run passed all 115 gates in 5.8 minutes, with zero dependency
audit findings, 314 API operations and a successful production build (181 pages).
TypeScript/ESLint/diff checks passed; schema/container cleanup was confirmed.
Regressions cover ±24-hour host drift, expired-session/future-MFA denial before
storage, mid-read expiry and legacy authorization. No schema/API shape change,
owner-data access or live activation. Evidence:
verification/20261126-private-read-database-clock.json.

Production video, broader linked-media lifecycle/recovery and live service,
independent security and physical-device acceptance remain unfinished. Service
clocks must still be synchronized; this is local acceptance for the stated scope.
Owner-only procedures remain under ignored NIloy.


## 26 November 2026 — isolated inspection-video processor component

A separate authenticated private processor and strict HTTPS client now implement
bounded MP4 conversion and JPEG poster generation, with raw/converted/poster scan
checks and user-metadata removal. It runs in a dedicated non-root container with
read-only root, bounded noexec tmpfs, dropped capabilities, resource limits and
private networking. It does not accept caller filenames/URLs/FFmpeg options or
inherit provider credentials into decoder children. No web route or feature flag
connects it to inspection uploads; production video stays disabled.

Local container acceptance passed with actual FFmpeg, synthetic fixtures and
simulated ClamAV responses. It covers conversion/audio/poster, metadata stripping,
format/resource/digest/auth bounds, all three infected scan positions, stale/error
engines, concurrency, actual child cancellation, HTTP disconnect/admission recovery,
temporary cleanup and client response tampering. The owned container/image tag
were removed. Three existing photo-flow suites and production build (181 pages)
passed in disposable PostgreSQL; schema/container cleanup was confirmed. Type/lint,
workflow YAML and composition isolation checks passed. Full launch/audit and remote
CI were not rerun. The public API still has 314 operations and no schema changed.

A dedicated read-only GitHub verification workflow was added. The release runner
can optionally include the container test with VERIFY_PRIVATE_VIDEO_COMPONENT=true
(test-only; not activation). See services/inspection-video/README.md and
verification/20261126-private-video-component.json.

Engineering still must connect durable uploads/jobs, required original/derivative
storage, scan provenance, current role/package/hold checks, atomic evidence/audit
binding, recovery, authorized/range-safe delivery and retention. Real 30-MiB ClamAV,
image/ingress/containment/load/device and live acceptance remain unverified. The
Admin media engineering gate remains blocked; owner procedures stay in local NIloy.


## 26 November 2026 — real ClamAV video component acceptance

The isolated component now passes actual ClamAV 1.4.6 with fresh official
definitions: clean MP4/audio/poster, 9-MiB and exact 30-MiB inputs, independent
derivative scans, standalone EICAR detection, oversized rejection and engine
outage. A harmless custom NDB marker, loaded solely into the disposable engine,
verifies FOUND rejection through a valid MP4; it is not proof of detection of
arbitrary malware. The standard EICAR string inside MP4 padding was not detected.

The prior 8-second video scan budget rejected clean 30-MiB files with MaxScanTime.
Only dedicated video scanning now allows 25 seconds and a 30-second client
inactivity timeout, under the unchanged 90-second job deadline. Limit alerts and
30-MiB limits stay enabled; website/photo defaults remain unchanged. Scanner
protocol/timeout and synthetic video regressions, ESLint, syntax and workflow YAML
passed. Owned containers, anonymous volumes, networks, tags and token files were
removed; shared caches remain. No database/customer file/provider account used.

Evidence: verification/20261126-private-video-real-engine.json. Manual CI can
include real-engine acceptance; remote CI, full launch/build and dependency audit
were not rerun for this service-only increment. This supersedes only the earlier
unverified local 30-MiB engine check. Application upload/job/storage/provenance/
evidence/delivery/lifecycle integration, TLS/image/security/load/device and live
acceptance remain unfinished. Production video and the Admin engineering gate
remain disabled/blocked. Owner procedures stay in ignored local NIloy.


## 27 November 2026 — private video artifact storage component

An unwired server-only store now supports the three required inspection video
objects: original (30 MiB), normalized video (8 MiB), and JPEG poster (512 KiB).
Each role requires a distinct 256-bit application encryption key. Authenticated
encryption binds the role and opaque object key; storage additionally requires
expected account ownership, KMS, exact versions, encrypted checksums and private
conditional writes. Reads verify authenticated plaintext and remain size/time
bounded. Reconciliation can recover a write whose confirmation was lost. Invalid
persisted preparation is rejected before making any storage request.

SDK-signed synthetic loopback S3 tests, TypeScript, ESLint and workflow YAML pass.
The test is included in the launch gates and a dedicated read-only CI job. No AWS
account, production database, user file or live credential was used. No schema
or runtime route changed; full launch/build and remote CI were not rerun. Evidence:
verification/20261127-private-video-artifacts.json.

This component does not scan, approve, publish or delete media. It has no runtime
factory or environment flag. Durable jobs, multi-object recovery, upload/evidence
authorization and provenance, customer delivery, lifecycle/holds/cleanup and
staging/security/device acceptance remain unfinished. The production video and
Admin engineering gates remain blocked. NIloy stays local and ignored.


## 27 November 2026 — durable private video storage jobs

PrivateVideoJob and PrivateVideoArtifact now persist encrypted candidates for a
three-object storage bundle. Actor-scoped idempotency binds package, profile, all
three digests and namespace. Each object is journaled before network I/O; a later
ledger attempt reconciles an uncertain write instead of calling write again.
An absent uncertain object remains in review. Object references survive partial
failure; all three are required before bundle success clears staged ciphertext.
Leases use the database clock and replacement tokens fence old workers. Account
and package state are rechecked before successful mutations; audits are redacted.

Disposable PostgreSQL tests pass for failures at each object position, missing
objects/attempt limits, concurrent workers, expired/crashed workers, replacement
leases and account/package revocation. Storage SDK regressions, schema validation,
TypeScript, ESLint, clean migration deploy/zero drift/seed/repeat deploy and the
181-page production build passed. Both owned test databases, schemas and volumes
were removed. Full launch/audit and remote CI were not rerun. The release gates
and private-video CI now include job acceptance in disposable databases. Evidence:
verification/20261127-private-video-jobs.json.

This is storage staging after a processor result, not a durable transcoding queue
or a scan approval. No scheduler, public intake, role/warehouse/session access
workflow, evidence binding or customer delivery was enabled. Those integrations,
original/derivative holds/retention/cleanup, controlled recovery UI and independent
staging/security/device/live acceptance remain unfinished. Production video and
the Admin engineering gate stay blocked; NIloy remains local-only.


## 27 November 2026 — authorized processor-to-storage handoff

The internal video intake adapter now connects the strict processor client to
durable encrypted bundle storage. Actor/session IDs must come from verified
server authentication; there is no HTTP route. Inspector/warehouse portals require
matching roles and active warehouse assignments. Admin requires MFA within 15
minutes. Locked session/account/package/role/assignment checks use the database
clock and run before processing, around staging/storage transactions and before
returning state. Role or session snapshots are not accepted as upload authority.

Existing requests are bound to actor, package, original digest and namespace.
Replays resume the stored job without invoking the processor again. Processor
outages/tampering fail before staging; revocation during processing prevents job
creation and revocation during storage prevents successful intake. Responses
contain only opaque job state; failures use redacted audited reasons. Storage
completion still does not approve or publish inspection evidence.

Acceptance passed in owned disposable PostgreSQL with the actual strict client
and simulated HTTPS/cloud responses: inspector/warehouse/admin access, missing/
stale/future MFA, wrong portal/session ownership, session/role/assignment changes
during processing/storage, replay, recovery, processor errors and tampering.
The existing job recovery suite, TypeScript, ESLint, workflow YAML and 181-page
production build passed. The owned database/schema/volume were removed. No schema
changed and no owner database/provider account was used. Full launch/audit and
remote CI were not rerun. Evidence: verification/20261127-private-video-intake.json.

Still unfinished: pre-transcoding durable queue/provenance, atomic inspection
evidence binding, public intake transport limits/CSRF/rate controls, customer
playback/original access, retention/holds/cleanup/recovery UI and staging/security/
device/live acceptance. Production capture and the Admin engineering gate remain
blocked. The owner procedure folder NIloy stays local and ignored.


## 27 November 2026 — processing receipts and staged inspection evidence

The processor handoff now writes a local receipt atomically with encrypted
staging. Profile, source/video/poster digests and sizes are bound to the job and
verified against its prepared objects; receipts/job creation use the database
clock. Raw unproven storage jobs cannot bind evidence. These are local provenance
receipts, not provider-signed certificates or live-deployment acceptance.

The internal binder validates current uploader access, receipt chronology and
manifest, namespace, three exact references and authenticated object reads. It
rechecks access/references after I/O, then atomically creates normalized VIDEO
InspectionEvidence and its unique STAGED link. Concurrent retries reuse one link.
No original filename or raw original is published. Database constraints permit
only STAGED links and reject external video rows without a complete binding at
commit. Removing a link alone fails; evidence/link removal must be coordinated.

Existing list/download/inspection/customer paths explicitly block or exclude
staged records. Both VIDEO and BASIC attachment attempts fail without changing
package/order/inspection state. No public upload runtime or activation flag was
added. Publication, customer playback, lifecycle and original access stay disabled.

Six targeted suites passed in an owned isolated web server/PostgreSQL instance:
video intake/evidence/jobs, photo submissions/quarantine, and security regressions.
Coverage includes real HTTP guards, concurrent binding, access changes during
reads, malformed/missing/future proofs, unproven jobs, and database constraints.
The quarantine fixture exercises desktop and mobile UI. Clean migration deploy/
zero drift/seed/repeat deploy, schema/client, TypeScript, ESLint, workflow YAML,
314-operation API contract and the 181-page production build passed. Owned test
server/schema/database/volume cleanup was confirmed; generated test includes were
removed from tsconfig. Full launch/audit and remote CI were not rerun.

The photo fixture's positive MFA now uses the database clock; production checks
were not relaxed. A destination-stream warning coincided with the quarantine
browser's deliberate abort/retry scenario; browser assertions passed. That
association is inferred, and production stream behavior still needs acceptance.
Evidence: verification/20261127-private-video-evidence.json.

Remaining engineering: durable pre-transcoding queue, public upload/admission
controls, approved publication/range-safe customer delivery/original access,
retention/holds/cleanup and recovery UI. Staging service identity/TLS/image/scanner,
independent security, load, physical-device and live acceptance also remain. The
production media engineering gate stays blocked. NIloy remains local-only.
