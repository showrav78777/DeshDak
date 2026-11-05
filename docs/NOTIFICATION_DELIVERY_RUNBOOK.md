# Notification delivery runbook

## What is now implemented

DeshDak stores notification requests in an encrypted outbox, delivers in-app
messages immediately, and can submit queued email through a scheduled, server-only
worker. The worker claims each delivery atomically, uses the delivery key as the
provider idempotency key, retries transient failures with bounded backoff, and
stops after five attempts. Attempt ownership fences prevent late completions
from overwriting a newer attempt. Provider responses and recipient addresses are
never written to application logs.

A successful provider send request records `SENT` and its provider reference,
with `deliveredAt` unset. Accepted messages are excluded from automatic resend,
including after the sending lease ages. Admin shows these as **Email accepted** /
**delivery unconfirmed**. The worker result adds `accepted`; its existing
`delivered` count remains zero for compatibility. Signed delivery receipts now confirm recipient-server acceptance separately.
Bounce, complaint and provider-suppression receipts block future email to that
recipient. The implementation is tested with synthetic transport; keep live email
disabled until provider staging certification is complete. This distinction follows the provider's
[event definitions](https://resend.com/docs/webhooks/event-types).

Earlier versions recorded API acceptance as delivery. This change does not
rewrite historical records: review those entries against verified provider
evidence before using them as delivery proof. Do not bulk-demote or resend them.

## Required production configuration

Set these values only through the production secret manager:

```text
EMAIL_DELIVERY_ENABLED=false
RESEND_API_KEY=<provider API key>
EMAIL_FROM=DeshDak <no-reply@your-verified-domain.example>
RESEND_WEBHOOK_SECRET=<whsec signing secret from the provider webhook settings>
EMAIL_SUPPRESSION_HASH_KEY=<independent cryptographically random 32-byte base64 key>
```

The verified sender domain and DNS records must be approved in the provider account before enabling this capability. The production configuration gate rejects partial/malformed configuration and reused encryption/hash keys. Apply migration `20261105130000_email_delivery_receipts` in reviewed staging, with backups and rollback planning, before deploying matching code. The owner database has not been migrated by this verification.

Register `https://<your-domain>/api/v1/notifications/email-events` for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` and `email.suppressed`. Use the endpoint signing secret, not the API key. Certify controlled delivery, permanent bounce, replay, out-of-order events and suppression, then enable `EMAIL_DELIVERY_ENABLED=true` and scheduling. Never use real customers for failure simulations.

## Scheduler

Run the following protected endpoint every minute from the platform scheduler. Send `MAINTENANCE_JOB_SECRET` only in the server-to-server authorization header; never expose it in browser code, links, or logs.

```text
POST /api/v1/internal/maintenance/notification-delivery
Authorization: Bearer <MAINTENANCE_JOB_SECRET>
```

Monitor queued-delivery age, terminal failures, worker failures, and provider webhook/bounce signals. Keep `EMAIL_DELIVERY_ENABLED` false until the provider sender, suppression policy, webhook verification, and on-call ownership have passed staging acceptance.

The protected maintenance endpoint reports processed, accepted, delivered, failed
and retried counts. Acceptance alone must not count as successful recipient
delivery in dashboards or alerts. An expired fifth unconfirmed attempt becomes a
failed record requiring review rather than starting a sixth provider request.

For local verification, use the generated isolated-schema runner with
`test:notification-delivery` and `test:email-receipts`. They exercise the real PostgreSQL claims and retries
with a synthetic provider transport, including simultaneous workers, stale
success/failure completions and disabled-provider safety. It sends no email and
does not prove live provider delivery.

## Still external to the codebase

Private document object storage, malware scanning, backup retention, live monitoring, and device-farm testing are infrastructure/provider controls. The current document upload route remains intentionally unavailable in production until that approved pipeline exists.

## Receipt and recipient privacy controls

Callbacks verify the exact bounded raw body using Svix HMAC signatures and a
five-minute timestamp tolerance. Keep server clocks synchronized. Receipt IDs
and body hashes detect duplicate/replayed or conflicting events. A callback that
arrives before the send commit remains pending and is reconciled when its send
reference is stored. Unknown or ambiguous references and legacy negative receipts
without recipient snapshots remain pending for evidence review; do not guess a
recipient. Admin displays their pending count. Unsupported signed event types
are acknowledged without retaining their payload.

The ledger stores event identity/type/time, send reference and payload hash,
not the raw payload, address, subject or message. Recipient matching uses a stable
keyed hash, separate from encrypted outbox payloads. Preserve
`EMAIL_SUPPRESSION_HASH_KEY` across outbox encryption-key rotations. Replacing it
requires a reviewed dual-key migration; changing it directly can bypass existing
blocks. Purged or mismatched recipient snapshots fail closed before a retry.

Permanent bounce, complaint and suppression are sticky delivery failures. Late
positive receipts cannot erase them. A generic provider send failure does not
automatically suppress an address. Delivered means the recipient mail server
accepted the message; it does not prove that the recipient read it.

## Admin review of blocked recipients

Open **Admin → Notifications → Review blocked email addresses**. Admin portal
access with completed MFA is required. Verify the original recipient using the
private send reference and controlled provider evidence: the linked account's
current contact may differ. Check correction/consent and provider-side suppression,
enter a safe evidence reference and reason, then record the verified release.
Never paste credentials or full email contents. Releasing a local block does not
release the provider's block and never resends existing failed messages.

Reviews are versioned, audited and safe to retry with the same body after an
uncertain response. A newer negative event reactivates the block and invalidates
stale reviews. Old negative receipts predating a release do not reactivate it.
Already in-flight provider requests can finish when a new block arrives; the
block prevents subsequent sends. Review active/released records using the native
filter. JavaScript is required to submit a release; the fallback disables mutation.

Live DNS, mailbox placement, provider retries and operational monitoring still
require staging certification. This increment does not certify AWS or production
email delivery, or rewrite historical records that incorrectly equated acceptance
with delivery.
