# Notification delivery runbook

## What is now implemented

DUAR-360 stores notification requests in an encrypted outbox, delivers all in-app messages immediately, and can send queued email through a scheduled, server-only worker. The worker claims each delivery atomically, uses the delivery key as the provider idempotency key, retries transient failures with bounded backoff, and fails permanently after five attempts. Provider responses and recipient addresses are never written to application logs.

## Required production configuration

Set these values only through the production secret manager:

```text
EMAIL_DELIVERY_ENABLED=true
RESEND_API_KEY=<provider API key>
EMAIL_FROM=DUAR-360 <no-reply@your-verified-domain.example>
```

The verified sender domain and DNS records must be approved in the provider account before enabling this capability. The production configuration gate rejects a partial or malformed email configuration.

## Scheduler

Run the following protected endpoint every minute from the platform scheduler. Send `MAINTENANCE_JOB_SECRET` only in the server-to-server authorization header; never expose it in browser code, links, or logs.

```text
POST /api/v1/internal/maintenance/notification-delivery
Authorization: Bearer <MAINTENANCE_JOB_SECRET>
```

Monitor queued-delivery age, terminal failures, worker failures, and provider webhook/bounce signals. Keep `EMAIL_DELIVERY_ENABLED` false until the provider sender, suppression policy, webhook verification, and on-call ownership have passed staging acceptance.

## Still external to the codebase

Private document object storage, malware scanning, backup retention, live monitoring, and device-farm testing are infrastructure/provider controls. The current document upload route remains intentionally unavailable in production until that approved pipeline exists.
