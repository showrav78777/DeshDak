# Tracking and inspection evidence verification

## Verified workflows

The database-backed warehouse, inspector, logistics, cart, customer-account,
Ship-for-Me, RMA, and financial-rule scripts passed during this implementation.
They exercise assignment boundaries, receiving, ordered shipment transitions,
multiple shipments, delivery proof, immutable events, claims, refunds, and
customer ownership. These checks do not constitute a complete manual review of
every employee page or physical mobile device.

The expanded Admin regression opened the overview and all 32 destinations in
the shared navigation successfully. Finance, Compliance, Sourcing, Support,
Seller product/store revision and session-management regressions also passed.
The 390px homepage browser check showed a 390px document width without horizontal
page overflow. Direct customer and Finance PDF download authorization passed.
The generated multi-page PDF was rendered and visually inspected.

Next.js was updated to 16.3.8 and Sharp to 0.35.5. The production dependency audit
reported zero vulnerabilities. Five high-severity development-only findings
remain in the braces/micromatch/fast-glob lint-tooling chain; npm's suggested
forced remediation downgrades framework tooling and was not applied. TypeScript,
ESLint, Prisma validation and the production webpack build passed.

The inspector regression script additionally tests private image upload by an
assigned warehouse worker, media signature validation, encrypted persistence,
CSRF rejection, owner access, customer order visibility, and rejection of
anonymous, unrelated inspector, and logistics access. Enable the local adapter
on both the server and the test process to execute those additional assertions:

```sh
ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS=true npm run dev
ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS=true npm run test:inspector-portal
```

## Staff workflow

### Employee form reliability follow-up

- Logistics selects an allowed next status after refreshed shipment state rather
  than retaining a previous status that the server no longer accepts.
- Support ticket actions use an inline operational-note form with Confirm and
  Cancel controls. Failed requests keep the note available for retry.
- Support replies recover from network errors without clearing the message and
  reuse the request key for an unchanged retry to avoid duplicate messages.
- Warehouse and Inspector forms offer separate photo, video and device-file
  controls, accessible labels, larger mobile targets and numeric measurement
  inputs. Physical-device camera testing remains a release check.

### Package flow

1. Warehouse receives the physical package and opens its package task.
2. Under operational information, capture a photo or choose an MP4 video.
3. Inspector opens the assigned package, reviews captured evidence, selects the
   matching evidence type, and records the inspection decision.
4. The customer opens the order and selects a private warehouse photo/video.
5. Warehouse measurement and Logistics shipment transitions retain their
   existing separate permissions.

Photos are decoded with a 24-million-pixel limit and re-encoded to remove EXIF
metadata. Image uploads are capped at 8 MB and video uploads at 30 MB. The local
adapter encrypts bytes with AES-256-GCM, limits upload rate, and serves content
only through authenticated routes with no-store response headers.

## Launch verification follow-up — 16 October 2026

- All 67 automated launch gates passed across the main isolated run (64 gates)
  and targeted reruns of launch readiness, notification preferences and marketing
  campaigns. This was not one uninterrupted 67-gate run.
- Final TypeScript, ESLint and webpack production build passed. Each isolated
  verification schema was removed by the runner after completion.
- Fixed the inspection-evidence MIME schema/migration mismatch and the anonymous
  market test's missing Bangladesh fixture without relaxing market guards.
- Checkout has an explicit transaction budget and a structured retryable response
  for expired transactions. Launch-readiness creation atomically batches its
  initial event and audit record instead of a timing-sensitive callback.
- Notification tests verify that disconnected optional email cannot be enabled;
  successful preference changes use in-app delivery. UI copy now distinguishes
  queued essential security emails from unavailable optional email delivery.
- Local execution contained long request delays, so these functional results do
  not establish production latency or load capacity. Live email delivery remains
  unverified until a provider is connected.

## Remaining release gates

### Catalogue filter and sorting follow-up

- Added `test:catalog-sorting`, which requires a disposable local verification
  schema. Run with `npm run verify:launch:isolated -- test:catalog-sorting`.
  It passed using 28 products with deliberately mismatched first variants,
  checking two pages each of ascending, descending and name sorting. Fixtures
  and the isolated schema were removed after execution.
- Store catalogues now expose sorting, preserve it through filter changes,
  choose matching variants and offer an empty-result reset. The mobile sort
  control wraps instead of extending beyond the screen.

- Mobile catalogue filters can be expanded/collapsed; desktop retains the full
  sidebar. Selected filter links expose their active state to assistive tools.
- Cards select the lowest matching variant for price/availability filters,
  preventing an out-of-range variant price from appearing on a matching card.
- Explicit catalogue price/name ordering now precedes pagination. Price ordering
  groups matching variants by product, uses their minimum price, has a stable
  product-ID tie-breaker, and puts unpriced products last. Recommended retains
  market-priority pagination. No checkout prices or authorization rules changed.
- Browser verified ascending page boundary (1715 → 1770 BDT), descending page,
  filter preservation while sorting, mobile filter toggling, desktop sidebar,
  and empty-result reset restoring 24 product cards. Mobile views fit 390px.
- Search-query results retain the existing 500-candidate discovery limit;
  exhaustive search over larger catalogues remains a separate scaling concern.

### Mobile shipping-selector follow-up

- Deduplicated destination names and labelled multiple shipping services as
  services rather than counting them as separate destination countries.
- Product details fit 320px and 768px viewports. Small-phone sign-in and
  registration initially overflowed (352px and 489px at a 320px viewport).
  Auth grid sizing, form controls and Google-button wrapping now fit 320px
  without hiding overflow. Both customer auth pages use the shared DUAR-360 logo.

- At 390 × 844, verified the top Close and footer Apply controls are within the
  viewport. Sea-freight filtering renders one compact route rather than a
  stretched option.
- Close now discards an unconfirmed route choice; Apply confirms it. Verified
  cancellation retained air cargo and applying sea freight updated its rate.
- Dialog opening focuses Close, Shift+Tab wraps to Apply, Escape dismisses the
  dialog, and dismissal restores focus to the comparison button.
- Removed a stale first-lane rate from the separate shipping summary. It now
  refers to the selected route above. Local-order wording depends on matching
  origin and destination, not merely Bangladesh product origin.
- TypeScript and ESLint passed after the selector changes. These checks do not
  establish physical-device compatibility or enable live shipping charges.

- Production evidence capture requires private object storage, malware scanning,
  video transcoding/metadata removal, retention/deletion policy, and signed
  delivery. The development database adapter always refuses production uploads.
- Direct PDF download and browser print/save-PDF are available for customer order
  summaries and Finance reports. Order summaries are not tax invoices. Formal
  invoice issuance, numbering and immutable invoice snapshots remain separate work.
- The Admin graph shows confirmed BDT order value. Recognised income, bank
  settlement and profit must be derived from approved accounting postings.
- Finance reports now separate product and shipping payment totals by currency
  and current payment status. They use payment-creation dates, not receipt or
  recognition dates. Journal totals use journal posting dates consistently with
  the journal list. Integrity coverage exposes inspected and total journal
  counts, including an explicit sample warning when the 250-journal limit applies.
- The Finance regression verified a backdated posting whose entries were
  created later, along with authorized PDF export and MFA/role boundaries.
- Complete manual desktop/mobile review of all employee routes, real device
  camera permissions and video playback still needs execution.

## Admin design sources

The overview prioritises actionable queues, progressively discloses the full
tool directory and exposes text values behind the sales graph. References:

- https://www.w3.org/WAI/tutorials/forms/
- https://www.ibm.com/docs/en/technical-content?topic=practices-progressive-disclosure
- https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-testing-dashboards-for-design-and-accessibility/
- https://designsystem.digital.gov/components/data-visualizations/
