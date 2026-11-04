# Crossly launch fast track

## Decision

Freeze new feature development until the first controlled launch candidate is complete. The fastest safe release is a web-first, Bangladesh-focused operational pilot using only workflows that are genuinely ready. Supplier synchronization, additional countries, mobile apps, external marketing channels, advanced AI/image search, seller payouts, and other expansion work continue after launch.

## First-launch scope

### Included

- Public browsing, keyword search, categories, products, approved Bangladesh seller stores, wishlist, cart, and customer accounts.
- Customer checkout only for an explicitly approved country lane and a payment method whose real adapter has passed sandbox and failure testing.
- Admin purchase review before procurement.
- Customer order timeline and notifications.
- Seller onboarding, moderated store/product management, CSV preview/import, and manual order preparation.
- Warehouse, inspection, logistics, compliance, finance, sourcing, customer-service, wallet/refund, audit, QR/barcode, PWA, and help workflows already implemented locally—enabled only where their real operational prerequisites are ready.
- Consent-controlled in-app campaigns. External marketing channels remain disabled.

### Deferred until after launch

- Live supplier or seller API synchronization until official contracts, credentials, rights, mappings, and adapters are approved.
- Additional origin/destination countries until their lanes, customs, payments, FX, compliance, and logistics are approved.
- Flutter Android/iOS applications; the versioned web APIs remain the shared backend.
- Email/SMS/WhatsApp/push campaigns, image search, advanced recommendations, loyalty/referrals, seller payouts, and unrestricted media features.
- Any claim of unlimited traffic, 24/7 support, automatic legal compliance, or a provider capability that has not been contracted and tested.

## Critical path

### Track A — Engineering launch candidate

1. Stop net-new feature work and create a release candidate branch/environment.
2. Run every implemented role journey against one staging database: anonymous customer, registered customer, seller, Admin, Warehouse, Inspector, Logistics, Support, Compliance, Finance, and Sourcing.
3. Fix only launch-blocking defects: broken navigation, authorization/data leaks, incorrect financial/order states, failed mobile layouts, missing error handling, and PWA/runtime failures.
4. Complete production configuration validation, secrets inventory, database migration rehearsal, backup/restore test, health probes, logs/alerts, rate limits, and rollback procedure.
5. Connect and certify only the launch payment, CAPTCHA, transactional-email, private-media, and infrastructure providers chosen by the owner. Everything else remains fail-closed.
6. Run the full API, migration, security, workflow, browser, performance, and production-build gates; freeze the release after all P0/P1 defects are closed.

Use `npm run verify:launch` for the repeatable local release-candidate gate while the application is running. Use `npm run verify:launch -- --skip-build` during rapid defect cycles, then run the complete command before accepting a release candidate. Scheduler-secret checks remain a separately configured production/staging gate.

### Track B — Owner and nontechnical team, in parallel

1. Supply company identity, domain/DNS, support contacts, legal pages, privacy/cookie wording, return/refund policy, seller terms, prohibited-goods policy, and approved marketing copy.
2. Contract the production host, PostgreSQL, CDN/WAF, secret manager, object storage/media scanning, CAPTCHA, transactional email, payment gateway, and required carriers.
3. Provide sandbox credentials through a secret manager—not chat, source code, screenshots, or Admin text fields.
4. Configure the real warehouse address, operating hours, receiving rules, shipping rates, staff roster, approval limits, escalation contacts, and one launch country lane through Admin.
5. Prepare a small licensed launch catalog with complete titles, descriptions, variants, prices, dimensions, origin, compliance classification, and approved media.
6. Perform physical QR/barcode, label printer, scanner, phone-camera, packaging, warehouse Wi-Fi, and delivery handoff tests.
7. Train each staff role with separate MFA-protected accounts; never share Admin or employee accounts.

## Release gates

The paid public launch is blocked until all of these are true:

- Production HTTPS domain, environment-separated secrets, backups, restore drill, monitoring, alerts, WAF/rate limits, and rollback are verified.
- Real payment checkout, signed webhooks, failure handling, refunds, reconciliation, and settlement have passed sandbox/UAT.
- Final legal/privacy/compliance policies and customer wording are approved by qualified owners.
- The launch warehouse, shipping lane, rates, staff, labels/scanners, and customer-service rota pass physical acceptance.
- Product/store media is served through approved private storage, validation, malware scanning, processing, and CDN controls.
- Critical end-to-end journeys pass on desktop and representative mobile devices with no open P0/P1 defects.

If a payment gateway or production infrastructure is not ready, release only an internal/staging pilot. Do not collect real customer money or represent unavailable operations as live.

## Fastest realistic timing

- **Engineering release candidate:** approximately 5–10 focused working days if scope remains frozen.
- **Controlled operational pilot:** approximately 7–14 working days if the owner supplies staging infrastructure, business data, staff, and provider sandboxes immediately.
- **Public paid launch:** commonly 2–4+ weeks because payment, legal/compliance, media, infrastructure, carrier, and physical acceptance timelines are external to coding.
- **Full original vision:** delivered sequentially after launch through measured increments; it should not delay the first controlled release.

These are planning ranges, not promises. Missing provider approval or failed physical/security acceptance moves the launch date even when application code is complete.

## Daily operating rhythm

- Morning: choose one launch blocker and define its acceptance test.
- Development: complete that blocker end-to-end; do not start a second unfinished feature.
- Parallel owner work: credentials/contracts/content/physical checks proceed without waiting for engineering.
- End of day: run relevant automated checks, update the blocker register, and record external dependencies in `idea.txt`.
- Every 2–3 days: deploy the current candidate to staging and perform role-based browser/mobile acceptance.
- Launch day: use a controlled rollout, monitor health/errors/orders/payments, retain rollback authority, and limit initial traffic.

## Post-launch sequence

1. Stabilize production defects and measure performance/support demand.
2. Complete supplier API adapters and catalog reconciliation one approved provider at a time.
3. Add secure seller/product media and authorized seller synchronization.
4. Add approved countries, carriers, currencies, and payment methods one lane at a time.
5. Connect external notification channels and campaign workers.
6. Build Flutter applications against the stabilized versioned API.
7. Add advanced discovery, automation, analytics, and scale improvements based on measured demand.
