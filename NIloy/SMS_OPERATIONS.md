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

## Run or schedule expired-payload cleanup

Open **Admin → System → System maintenance**, sign in through the Admin portal
and complete MFA. Review the saved policy, choose **Run cleanup now**, and inspect
**Recent cleanup runs** for “SMS jobs inspected” and “SMS payloads removed”. This
existing job also cleans other documented technical artifacts and releases expired
inventory reservations. The SMS review page links directly to this control.

Cleanup removes obsolete OTP ciphertext only from jobs that have never been
attempted. Active tokens and attempted/reconciliation evidence remain intact. Each
purge is audited. It does not send SMS or mark messages delivered. Each run inspects
a bounded batch of 100 SMS jobs; repeat scheduled runs drain larger backlogs.

The deployment operator can use the existing authenticated scheduler route:
`POST /api/v1/internal/maintenance/security-cleanup`. Resolve the bearer value from
`MAINTENANCE_JOB_SECRET` in the secret manager; it must be at least 32 characters.
Use HTTPS in production. Do not put a secret in a URL, source file, shell history,
public CI logs or browser code. No SMS-provider secret is needed for cleanup.

A conservative starting schedule is every five minutes, adjusted after observing
backlog and run duration. Monitor completed runs and failures; overlapping runs are
blocked. Configure and verify the scheduler in your chosen hosting account—no cloud
schedule was created here. Rotate the maintenance secret through the approved
process and test unauthorized requests fail. Follow the wider deployment runbook.

If a run request times out or loses its response, check recent run history before
retrying. The controls recover from failed requests and permit another attempt once
the actual run state is known. Cleanup uses the saved retention policy; never reduce
business or audit retention as a workaround.

Production SMS remains disabled. Public issuance, scheduling, secret resolution,
receipt processing, operator reconciliation mutations and live provider acceptance
are not completed by this review page. See [SMS/WhatsApp setup](SMS_WHATSAPP_SETUP.md).
