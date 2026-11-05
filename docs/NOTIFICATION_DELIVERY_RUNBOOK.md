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
`delivered` count remains zero for compatibility. Verified delivery events must
be handled separately; signed delivery/bounce callbacks and suppression processing
remain engineering/certification work. Keep live email disabled until these are
complete. This distinction follows the provider's
[event definitions](https://resend.com/docs/webhooks/event-types).

Earlier versions recorded API acceptance as delivery. This change does not
rewrite historical records: review those entries against verified provider
evidence before using them as delivery proof. Do not bulk-demote or resend them.

## Required production configuration

Set these values only through the production secret manager:

```text
EMAIL_DELIVERY_ENABLED=true
RESEND_API_KEY=<provider API key>
EMAIL_FROM=DeshDak <no-reply@your-verified-domain.example>
```

The verified sender domain and DNS records must be approved in the provider account before enabling this capability. The production configuration gate rejects a partial or malformed email configuration.

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
`test:notification-delivery`. It exercises the real PostgreSQL claims and retries
with a synthetic provider transport, including simultaneous workers, stale
success/failure completions and disabled-provider safety. It sends no email and
does not prove live provider delivery.

## Still external to the codebase

Private document object storage, malware scanning, backup retention, live monitoring, and device-farm testing are infrastructure/provider controls. The current document upload route remains intentionally unavailable in production until that approved pipeline exists.
