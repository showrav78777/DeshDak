# Email setup that requires the owner / deployment operator

1. Review backups and the staging migration `20261105130000_email_delivery_receipts` before deploying this version. No owner database was migrated during isolated testing.
2. Create the provider account, verify your sending domain and DNS, and select the approved sender. Keep `EMAIL_DELIVERY_ENABLED=false` until certification.
3. Set `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, and independent cryptographically random 32-byte base64 `EMAIL_SUPPRESSION_HASH_KEY` through the secret manager. Do not put actual secrets in Git or Admin evidence.
4. Register your public HTTPS `APP_BASE_URL` plus `/api/v1/notifications/email-events` in the provider webhook dashboard. Subscribe to email sent, delivered, delivery_delayed, bounced, complained, failed and suppressed events. Copy that endpoint's `whsec_` signing secret. Maintain synchronized server clocks.
5. Test approved controlled recipients: delivery confirmation, permanent bounce, duplicate replay, out-of-order receipts, blocked future sends, Admin evidence review/release, and a new negative event. The code's synthetic acceptance tests do not replace provider certification.
6. Use Admin → Notifications → Review blocked email addresses to review correction/consent and provider-side suppression, then record a reason and safe evidence reference. A local release does not release a provider block or resend old failed messages. The current account contact may differ from the original recipient: verify the private send reference.
7. Record certification and on-call ownership, enable email, configure the protected notification-delivery scheduler, and monitor queued age, accepted/unconfirmed messages, pending receipts, terminal failures and blocks.
8. Preserve the suppression hash key across outbox encryption-key rotations. Replacing it needs a reviewed dual-key migration; direct replacement loses matching against old blocks.

See [the notification runbook](../docs/NOTIFICATION_DELIVERY_RUNBOOK.md) for the scheduler, privacy controls and failure handling. Live account access, DNS, secrets, staging acceptance and deployment remain manual. Do not enable production email simply because configuration fields are present.
