# Consent-based marketing campaign delivery

## Business outcome

Administrators can send controlled promotional messages from Admin → Notifications without database access. The first safe stage delivers only in-app messages to active customers who explicitly enabled `Marketing · In app` in their notification preferences.

## Delivered controls

- Audience preview and delivery by personal/business account, English/Bangla profile language, all opted-in customers, or one specifically selected opted-in customer.
- English content, optional Bangla content, and an optional public Crossly product, store, help, or trust link.
- Administrator confirmation before sending; Admin role, Admin portal, completed MFA, trusted-origin, validation, and no-store boundaries remain mandatory.
- Consent is evaluated again inside the serialized send transaction. No preference record or a disabled preference means no delivery.
- Each recipient stores the exact consent preference identifier/update time plus locale and account-type snapshots.
- A 24-hour per-customer marketing frequency limit suppresses repeated campaigns.
- A maximum of 1,000 synchronous recipients prevents a browser request from becoming an unbounded bulk job. Narrower audiences work locally; larger production campaigns require an approved queue/worker.
- Payload-bound idempotency prevents duplicate sends and rejects changed-content key reuse.
- Every notification has a durable in-app delivery record, and every campaign has permanent recipient/suppression counts and Admin audit evidence.
- Every campaign in Admin history opens a protected delivery report. Administrators can search recipients by name, email, or customer ID and review the account/language snapshot, consent timestamp, delivery state, and read state. Report page access is itself audited.
- Delivery reports calculate campaign-wide recipient, read, unread, and read-rate metrics directly from durable notification records. Searching or paging recipient evidence never changes those aggregate results.
- Administrators can schedule an in-app campaign from five minutes to one year ahead and cancel it while it is waiting. The actual recipient set is never frozen early: consent, active-account eligibility, audience membership, frequency suppression, and the 1,000-recipient safety cap are evaluated again at delivery.
- Admin can process due campaigns from the campaign history. Production automation uses the separately authenticated maintenance endpoint, a global database lease prevents overlapping runners, and each run processes at most 25 campaigns with permanent run summaries and safe failure states.

## External channels

Email, push, SMS, and WhatsApp campaign sending remains disabled. Activating these requires approved providers, sender/domain/brand verification, jurisdiction-specific consent and unsubscribe rules, suppression lists, quiet hours, cost controls, retry/dead-letter workers, signed webhooks, provider reconciliation, and abuse monitoring. Provider credentials belong only in the production secret manager.

Production scheduling additionally requires a managed scheduler to call `POST /api/v1/internal/maintenance/marketing-campaigns` with the secret-manager-backed `MAINTENANCE_JOB_SECRET`. Its cadence, alerting, retry policy, and ownership must be approved before launch.

## Verification

```text
npm run db:generate
npm run db:deploy
npm run test:marketing-campaigns
npm run db:migration:verify
npm run api:generate
npm run api:contract
npm run lint
npm run typecheck
npm run build
```

The workflow proves access isolation, explicit opt-in, audience filtering, safe public links, CSRF protection, exact idempotent replay, changed-payload denial, future-time bounds, cancellation races, delivery-time consent evaluation, frequency suppression, bounded due-campaign execution, consent snapshots, in-app delivery/read evidence, searchable protected campaign reports, report-access audit evidence, customer visibility, Admin history, and cleanup.
