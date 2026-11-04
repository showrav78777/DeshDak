# DeshDak website appearance delivery

 Admin entry: `/admin/website-content`.

 Implemented: database-backed logo image address, up to ten homepage banners,
 desktop/mobile image addresses, accessible descriptions, optional overlay copy,
 visibility, ordering, and explicit publishing. Updates require the admin portal
 and role, write an audit record, and reject stale versions. Public responses
 include enabled banners only. Storefront clients load published settings without
 rebuilding. Existing static artwork is the default until a record is published.

 Deployment prerequisite: apply migration `20261102160000_website_appearance`
 through the normal reviewed deployment migration process. It has not been applied
 to the owner's database during local verification.

 Verification on 2 November 2026: Prisma validation/generation, TypeScript,
 targeted ESLint, and the 290-operation OpenAPI contract passed. The migration
 executed successfully in disposable PostgreSQL 16; a stale-version SQL update
 affected zero rows after a successful update. Validation rejected unsafe URLs,
 embedded credentials, local path traversal, and empty or fully disabled carousels.
 The disposable database container was removed. These checks do not constitute
 browser acceptance or production provider/storage certification.

 Image upload/library increment: direct JPEG/PNG/WebP uploads now validate size
 and file signature, bound request-body reads, re-encode to metadata-free WebP,
 and store optimized images in PostgreSQL. Production requires the configured
 HTTPS scanning adapter to return a clean result. Development bypass without
 scanner configuration is explicitly not production scanning evidence.
 Admin can search/reuse images as logos or banners and delete unused images.
 Publishing verifies library references under the same transaction lock used by
 deletion. Unpublished media requires Admin access; public access requires an
 enabled published reference. Library capacity is capped at 200 images.

 On 2 November 2026 the isolated API workflow applied all migrations to a fresh
 disposable PostgreSQL schema and passed upload, private preview, publishing,
 public delivery, stale-version rejection, in-use deletion rejection, replacement,
 successful unused deletion, removed-reference rejection, forged-file rejection
 and audit assertions. The schema and disposable container were removed. The new
 test is included in the isolated launch runner. The first run exposed a missing
 password hash in the synthetic fixture; that fixture was corrected before the
 successful run. No owner database was migrated or changed.

 Desktop/mobile browser acceptance on 2 November 2026: isolated Chromium at
 1440×1000 and 390×844 completed actual file upload, library logo selection,
 preview, approval, publishing and storefront logo verification. The first mobile
 run found horizontal overflow; fieldset/input sizing and library grid minimums
 were corrected. The rerun passed both sizes with no horizontal overflow. Screenshots
 are in ignored `test-results-media/appearance-{1440,390}.png`. Run with
 `WEBSITE_MEDIA_BROWSER=1` through the isolated `test:website-media` runner.
 These are local Chromium checks, not physical-device or production certification.

 Remaining: apply the migrations in the target environment, wider browser-level
 authorization/publishing/responsive acceptance, production scanner certification,
 direct video-file/object-storage support and broader release acceptance.

 Promotional video increment, 2 November 2026: Admin can configure a licensed
 YouTube watch/short link, title and visibility, preview it, and place its section
 in homepage order. The browser loads the privacy-enhanced player only after a
 visitor clicks Load video. Server validation accepts only exact supported hosts
 and valid video IDs; unsafe protocols, credentials and lookalike hosts were
 rejected in verification. Disabled video configuration is omitted from public
 appearance responses. TypeScript, targeted lint and API contracts passed.
 Desktop/mobile Chromium acceptance passed for Admin video editing, publishing,
 homepage section placement, no iframe/network request before Load video, and
 creation of the validated privacy-enhanced embed after clicking. External player
 responses were mocked; owner-provided licensed video playback remains pending.
 This is an embedded-video workflow, not a direct video-file upload. The disposable
 schema and database container were removed after verification.

 Production scanner safety, 2 November 2026: the persistent
 `test:website-media-safety` release check passed file-signature/size rejection,
 cropped dimensions, metadata removal, URL validation, missing production scanner
 configuration, infected/pending results, malformed JSON, service failure and
 network exceptions. Only a clean authenticated response was accepted. Scanner
 responses were synthetic and no real scanner was certified. TypeScript and
 verification-command classification passed; the safety check is now included in
 the release runner.

 Project integration gate, 2 November 2026: full-project ESLint, production Next.js
 build, TypeScript, API contract, security regressions, media safety and 16
 container-security controls passed. The first sandboxed production build stalled
 without active compilation and was stopped; the unrestricted retry completed
 compilation, type checks and prerendering successfully. CI explicitly runs the
 media-safety check. Generated temporary/PDF output is excluded from Git.
 A candidate-file check found 1,088 files totaling about 9.4 MB, no files over
 25 MB and no matches for the checked private-key/AWS/GitHub/OpenAI credential
 patterns. This limited scan is not a guarantee that every possible secret or
 business-sensitive document has been reviewed. Nothing has been pushed.

 Full browser regression, 4 November 2026: all 105 checks passed in one fresh
 isolated schema on Next.js 16.4.5, with zero skips/failures (5.8 minutes).
 Includes desktop/mobile visual comparisons, public catalogue/search recovery,
 support and sourcing workflows, employee receipt/scanning/inspection/measurement,
 shipment events/customer timeline, account/session/identity and profile/address
 recovery assertions. An initial run passed 103, failed one login after unrelated
 portal tests exhausted the shared IP budget, and skipped one serial successor.
 Account-review default and explicit contexts now share a separate synthetic
 client address only inside generated verification schemas. Login thresholds,
 server code and production ingress proof were not changed. Security regressions
 passed; final TypeScript/lint/whitespace checks passed. HTML/JUnit reports for
 both runs were retained; the disposable schemas and database container were
 removed. Browser execution used the development runtime with synthetic data
 and explicit provider mocks. It does not establish live provider acceptance,
 full cross-browser/physical-device coverage or production readiness.

 Framework maintenance, 4 November 2026: upgraded Next.js and eslint-config-next
 from 16.4.3 to exactly 16.4.5 with registry integrity hashes in the lockfile.
 Full ESLint, TypeScript, dependency integrity (11 direct/104 locked production
 packages), the 297-operation API contract, synthetic website-media safety and
 the production build passed. Isolated security regressions, Admin MFA setup and
 nine targeted desktop/mobile authentication/setup checks passed on the patched
 runtime. The disposable schema/container were removed; owner data was not
 migrated. Post-update production audit reported zero vulnerabilities; full audit
 still reported 16 moderate findings through the lint toolchain. No audit gate
 was disabled and no incompatible override or suggested package downgrade was
 applied. This check does not certify Docker images rebuilt from the new lockfile,
 the complete browser suite, physical devices or live provider acceptance.

 Dependency recheck, 2 November 2026: production-only npm audit reported zero
 vulnerabilities. The full audit still reported 16 moderate findings in the lint
 dependency chain rooted in minimatch advisory GHSA-g3hv-75wg-m249. Registry
 inspection still showed minimatch 3.1.5 as the newest 3.x release and
 eslint-plugin-react 7.37.5 depending on ^3.1.2. No incompatible 11.x override,
 package downgrade suggested by npm audit, or audit suppression was applied.
 The moderate-level release gate remains blocking. README now documents the
 actual setup, content controls, verification commands and deployment limitations.

 Banner schedules, 2 November 2026: Admin can set optional publishing/expiration
 times using local datetime controls; stored values include UTC offsets. Public
 banner responses and library-image delivery enforce enabled state and active
 schedule on the server. Pending/expired media is not made public merely by being
 referenced in a banner. Images also used as the published logo remain public.
 Preview labels scheduled/expired banners. When no campaign is eligible, the
 client retains official default artwork. Persistent safety checks passed future,
 expired and start/end boundary conditions and rejected invalid schedule order.
 TypeScript, targeted lint and API contract passed. Browser schedule-editing
 acceptance remains pending; this check does not certify a deployed scheduler.

 Banner browser acceptance, 2 November 2026: desktop/mobile runs added eligible
 and future-dated banners through Admin, published them, confirmed the public
 response excluded future banners, and observed the visible carousel advance
 from slide 1 to slide 2 within 7.5 seconds with the configured five-second timer.
 Both checked that no carousel buttons existed. The first run exposed a Next
 fill-image parent-position warning; positioning was corrected and the rerun
 passed with a dedicated assertion rejecting that warning. The crop-preview blob
 image was subsequently switched to a native image to retain its natural aspect
 ratio; lint and TypeScript cover that small rendering change. Disposable schema
 and database container were removed. These checks do not certify production
 clock synchronization, external artwork availability or physical devices.

 Broader rebrand regression, 2 November 2026: updated obsolete DUAR display-name
 expectations in verification scripts/browser assertions and the generated API
 title, including deployment smoke markers and manifest name. Technical session
 cookies, legacy mobile user-agent matching and immutable identifiers were kept.
 A fresh isolated PostgreSQL/server run passed session management, launch-readiness,
 notification preferences, Help Centre, rich catalog and SSLCommerz adapter checks.
 These use synthetic fixtures; the adapter result does not certify live payments.
 Full ESLint, production-configuration checks and test-command classification
 passed. The isolated schema/container were removed. The full browser visual
 baseline review remains separate and pending.

 Full functional browser review, 2 November 2026: the 99-test inventory ran in a
 fresh disposable PostgreSQL schema with visual comparisons disabled. Initial
 result: 96 passed, two visual cases skipped, one Admin quote/MFA failure. The
 quote fixture incorrectly placed a UTC string into a datetime-local input; on
 this host's browser timezone it represented an expired quote. The test now
 derives the future local input in the browser timezone. No server expiry rule,
 assertion, retry count or timeout was relaxed. The targeted rerun passed all four
 selected tests (three setup plus the failed workflow) in 34.4 seconds. Together
 these runs cover all 97 unique functional cases successfully; they are not one
 uninterrupted all-green full-suite run. The two visual baselines remain pending.
 Preserved HTML reports: `playwright-report-full-functional-20261102/` and
 `playwright-report-quote-fixed-20261102/` (ignored local artifacts). Deployment
 smoke checks passed health/live, health/ready, homepage, OpenAPI and manifest on
 the disposable server. Recovery safety and all 16 container controls also passed.
 Temporary/reference documents are excluded from the Docker build context.
 The test schema/container and temporary authentication-state files were removed.

 macOS visual review, 2 November 2026: both desktop/mobile sign-in comparisons
 passed initially within the unchanged 1% tolerance, despite references still
 depicting DUAR. Explicit snapshot regeneration now uses --update-snapshots=all
 so approved branding changes below the tolerance can be captured deliberately.
 Both refreshed macOS images were opened and inspected: DeshDak logo/name and
 account wording are correct, with no layout clipping. A final comparison with
 snapshot updates disabled passed five selected tests (three setup and two visual)
 in 12.1 seconds. The report is preserved in
 `playwright-report-visual-deshdak-20261102/`. Combined with the functional run and
 corrected quote rerun, all 99 unique test cases have passed on this macOS runtime
 across the documented runs. This is not one uninterrupted green full-suite run.
 Linux container references were not regenerated in this increment and still need
 their own pinned-environment review. The disposable database was removed.

 Linux visual closeout, 2 November 2026: used the cached Playwright 1.64.1 Linux
 arm64 runtime with a fresh npm ci from the current lockfile and explicitly copied
 application/test files. No host environment files or credentials were copied.
 Desktop/mobile comparisons passed against existing Linux references. Both
 references were then regenerated for DeshDak, opened and inspected for branding,
 layout and clipping. A final comparison with updates disabled passed five tests
 (three setup and two visual) in 11.7 seconds. HTML/JUnit evidence is in ignored
 `playwright-report-linux-visual-20261102/` and
 `test-results-linux-visual/junit.xml`. No screenshot tolerance was relaxed.
 The isolated schema and both containers were removed. The original large
 base-image download/build was cancelled in favor of the compatible cached
 runtime; this is test-runtime verification, not a new production-image release.
 Linux amd64 CI and physical-device acceptance remain separate from this arm64 run.

 Library replacement usability, 2 November 2026: employees can select a destination
 (logo, new banner, or an existing banner's desktop/mobile image) and apply a
 library image without copying URLs. Missing/stale banner positions are rejected
 in the editor, and any change clears the prior preview/approval state. The first
 browser run exposed an imprecise dropdown label; it was corrected with an explicit
 label association. The rerun passed desktop/mobile upload, destination selection,
 preview/publishing and a database assertion that the mobile banner received the
 selected library image, plus the existing rotation, video and deletion checks.
 Targeted lint, API contract and TypeScript passed; disposable schema/container
 were removed. This is image replacement in appearance, not in-place mutation of
 shared media bytes.

 Banner action editing, 4 November 2026: optional button label/destination can be
 edited and previewed per banner. The primary storefront action follows the active
 rotating slide; existing banners retain default market actions. Server validation
 requires both fields together and rejects unsafe protocols, scheme-relative URLs,
 backslashes, control characters and URL credentials. Browser checks passed draft
 saving, reordering, publishing and the correct action on slide 2 on desktop/mobile.
 Native desktop drag checks explicitly scroll both compact target cards into view.
 The first run without that step did not persist the drag order; its assertion
 was retained and the corrected visible-target rerun passed. Carousel config loads
 now reset the active index to prevent a late response leaving it out of range.
 Safety checks, TypeScript and targeted lint passed; disposable database removed.

 Customer authentication recovery, 4 November 2026: sign-in/signup now catch
 connection and malformed-response failures, release submission state, preserve
 fields and provide conservative recovery instructions. Signup distinguishes an
 unconfirmed creation from a confirmed account whose local verification failed,
 avoiding instructions to blindly register again. Failed submissions reset the
 associated Turnstile widget so a consumed challenge is not reused. Four new
 desktop/mobile browser cases passed abort/malformed response handling, field
 preservation, button re-enabling, challenge reset and interrupted verification.
 Seven selected tests including setup passed in 12.2 seconds. Authentication and
 CAPTCHA responses were mocked; no account was created by those UI fixtures.
 The initial test selectors also matched the Next route announcer; they were
 scoped to the form's alert. TypeScript and targeted lint passed; disposable
 schema/database were removed. These four cases extend the prior 99-test inventory.

 Deployment handoff, 3 November 2026: added a separate non-root Docker migration
 target with the production configuration gate and an explicit migration-only
 Compose profile. Production Compose consumes reviewed app/migration images and
 an external environment file, binds the app to host loopback for a TLS proxy,
 drops capabilities, prevents privilege escalation, uses a read-only app root
 with bounded writable temporary/cache mounts, and limits logs/processes/resources.
 Docker Compose validation with synthetic variables passed without starting any
 service. Container-security policy passed 23 controls; targeted lint passed.
 Concrete Docker/AWS deployment and acceptance steps are in
 `NIloy/DOCKER_AND_AWS_SETUP.md`. No AWS resource, live secret, production database
 migration or deployment was performed. This is a validated deployment template;
 building/running the new migration target, read-only runtime acceptance and load
 testing on production-like staging remain required before release.

 Production-container acceptance, 4 November 2026: built the runtime and migration
 targets. A stalled clean dependency install was stopped; npm cache mounts,
 bounded fetch timeout/retries and foreground install output were added. Build-time
 npm audit was disabled only for installation; the separate moderate-severity
 release audit remains enabled and blocking. The migration target passed its
 production configuration gate and applied all migrations to a disposable private
 PostgreSQL database using synthetic credentials.

 The runtime image started as UID 1001 with read-only root, bounded writable
 /tmp/cache mounts, dropped capabilities and no privilege escalation. Liveness,
 readiness, homepage, login, manifest and appearance routes returned 200. Admin
 content redirected anonymous users to Admin login. Root writes failed while
 temporary/cache writes worked; no .env file was present in the runtime image.
 Health status reached healthy. Missing configuration correctly refused startup.

 Acceptance exposed a real CAPTCHA deployment issue: the client read a public
 site key frozen at build time. The widget now fetches only the public site key
 from a no-store runtime endpoint and initializes explicitly after script readiness.
 The corrected image was rebuilt and passed the same runtime checks. The saved
 ops:widget-check script passed login/registration initialization in Chromium using
 a mocked provider script and checked the no-store, site-key-only response. The
 server secret was not returned. Real CAPTCHA challenges were not certified.
 TypeScript, targeted lint, 295-operation API contract, production-config tests
 and 23 container controls passed. Disposable containers/network/image tags and
 synthetic credential files were removed. No owner database or AWS service was
 changed. This local HTTP/plaintext internal-DB fixture is not production TLS,
 network, provider, load or operational acceptance.

 Live-setup guide update, 4 November 2026: added a required website-media card
 explaining migration, cropping/library publishing, authenticated scanning,
 scheduling/deletion/restore acceptance and remaining direct video/object-storage
 engineering. The guide now contains ten required and three optional setup areas;
 it still exposes only whitelisted variable names and presence status. Integration
 acceptance is not inferred from credentials being present. API checks passed
 anonymous/wrong-portal protection, no-store and scanner-token redaction. Desktop
 and mobile browser checks passed (five selected tests including setup) in 12.8
 seconds, including no-JavaScript rendering and overflow checks. The isolated
 database/schema were removed; TypeScript and API contract passed.

 Scanner startup hardening, 4 November 2026: production configuration now requires
 scanner URL/token together when either is supplied, an independent non-placeholder
 token of at least 32 characters, and a clean HTTPS endpoint without URL credentials,
 query parameters or fragment. Both absent remains valid with uploads disabled.
 The scanner request path also rejects URL query parameters. Regression checks
 passed configured/disabled states, missing pairs, short tokens, HTTP, embedded
 credentials, query strings and redacted errors. Media safety and targeted lint
 passed. These checks do not certify an actual scanning provider.

 Banner ordering completion, 4 November 2026: added desktop drag handles and
 keyboard/mobile Move up/Move down controls. Reordering invalidates the previous
 preview/approval and requires publishing. Early expanded-card browser attempts
 did not persist drag order; cards were changed to compact expandable editors
 and drop handling uses a synchronous drag reference/capture handlers. The final
 desktop drag test and mobile Move down test both passed persisted-order assertions
 and preserved the selected mobile image after publishing. Existing upload,
 schedule, rotation, video and overflow assertions also passed. TypeScript,
 targeted lint and API contract passed. Disposable database/schema were removed.

 Saved appearance drafts, 4 November 2026: added a separate versioned database
 draft with save/discard APIs, Admin-only access, audited mutations and shared
 transaction locking with publishing/deletion. Saving does not update the public
 appearance; media referenced only by a draft remains private and is protected
 against deletion. Publishing verifies the expected draft revision and clears
 the saved draft atomically. Editor reload restores a saved draft, marks unsaved
 edits and clears preview approval on changes. Draft fields must pass appearance
 validation before saving. Missing draft migration is explained in Admin.
 API tests passed anonymous denial, stale save/publish/discard rejection, private
 draft delivery, in-use media protection and successful publish/discard. Desktop
 and mobile tests saved, reloaded and published a draft while retaining reorder,
 mobile-image, crop, schedule, video and overflow assertions. TypeScript, lint and
 297-operation API contract passed. Migration was applied only to the disposable
 database; production application still requires the reviewed new migration.

 Homepage section controls, 2 November 2026: Admin can enable/disable and reorder
 ten supported sections with a preview list and reset action. Published order and
 visibility are read on the homepage server; product filtering and authorization
 remain unchanged. Legacy appearance records receive the original section order.
 Validation rejected duplicate/unknown sections and preserved configured order.
 Desktop/mobile browser runs published a hidden Popular searches section and
 confirmed its absence on the storefront alongside the crop/upload/publish flow.
 Both viewports passed overflow checks. The disposable database was removed.

 Authentication recovery increment, 4 November 2026: password-reset and
 email-verification forms now renew their own CAPTCHA after submissions, so a
 consumed challenge does not prevent retrying after a connection failure. Fixed
 concurrent widget initialization on the email-verification page by handling both
 shared-script load completion and later mounts. Desktop/mobile regression tests
 confirmed connection-failure feedback, restored buttons, retained email fields
 and challenge resets; all nine targeted checks passed (six browser cases and
 three setup checks). TypeScript, targeted ESLint, whitespace checks and the
 production build passed. The restricted build stalled and was stopped; the
 retry with local process permissions completed successfully. Disposable test
 schema and database container were removed. CAPTCHA responses were synthetic;
 real provider configuration/hostname acceptance remains a deployment check.

 Cropping increment, 2 November 2026: upload-time crop controls show a selection
 rectangle with percentage coordinates. The server validates bounds, applies EXIF
 orientation before extraction, resizes and strips metadata. Processing checks
 confirmed exact dimensions and rejected invalid values. The desktop/mobile
 browser workflow cropped a 120×40 image to 60×40, uploaded it, selected it as the
 logo, previewed/published it and verified storefront output. Both viewport tests
 and the API workflow passed; the disposable schema/container were removed.
