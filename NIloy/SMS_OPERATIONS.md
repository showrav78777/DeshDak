# SMS operations handoff — 12 November 2026

Open **Admin → Notifications → Review SMS verification jobs**. An Admin portal
session with MFA is required. The page is read-only and works without enabling SMS.
Use its filters, page links and expandable review instructions. It intentionally
shows no phone numbers, codes, encrypted payloads or customer contact details.

- Queued: no attempt has been claimed.
- Unconfirmed: a committed attempt has no confirmed acceptance reference. Do not
  resend it, reset its status or zero its attempt counter.
- Accepted: submission acknowledgement exists; handset delivery is unconfirmed.
- Cancelled: the job was stopped before sending.
- Unexpected state: deployment/operator investigation is required.

For an uncertain attempt, search its client reference in the controlled messaging
account. Compare the send reference and account evidence; preserve the original
claim and escalate conflicting/missing evidence. The UI has no manual “delivered”
override. A new code must come from a fresh protected request after its cooldown.
Do not copy OTPs, recipient information or credentials into notes/screenshots.

The [public provider documentation](https://ismsplus.sslwireless.com/api-documentation)
reviewed for this increment documents submission responses. We could not verify a
receipt endpoint, authentication/signature contract or final-delivery event mapping.
Obtain these account-specific details from SSL Wireless before implementing or
registering a callback. Do not invent a callback URL. No provider was contacted.

The internal cleanup service can remove expired, used or missing-token payloads
from unattempted jobs, recording the change in audit history. It preserves active
queued jobs and attempted/reconciliation records and uses no decryption key or
sender. Scheduling this cleanup through authenticated maintenance remains engineering
work; there is no owner CLI, Admin mutation button or live cleanup endpoint yet.

Production SMS remains disabled. Public issuance, scheduling, secret resolution,
receipt processing, operator reconciliation mutations and live provider acceptance
are not completed by this review page. See [SMS/WhatsApp setup](SMS_WHATSAPP_SETUP.md).
