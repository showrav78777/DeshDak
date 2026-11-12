# Bangladesh SMS and Meta WhatsApp

Owner preference recorded 11 November 2026: Bangladesh SMS gateway plus Meta
WhatsApp Cloud API. No account has been created, contacted or purchased here.

## Recommended SMS starting point: SSL Wireless ISMS Plus

I recommend requesting an enterprise proposal from [SSL Wireless](https://www.sslwireless.com/).
Its official site describes OTP and enterprise messaging. This recommendation is
based on documented integration features, not independent delivery/uptime testing.

The indexed [ISMS Plus API documentation](https://ismsplus.sslwireless.com/api-documentation)
lists OTP messaging, API tokens, registered sender IDs, request-IP allowlisting
and client message references. Direct page retrieval timed out during review;
confirm the current account-specific contract before implementation. Use the SMS
service credentials supplied for it; payment merchant keys are not an SMS API token.

Ask their enterprise team for:

- Transactional OTP and order-status access, sandbox/test access and current API documentation.
- Sender-name approval, required company documents and permitted English/Bangla content.
- Required stable outbound server IPs and the allowlisting process.
- Delivery receipts/status lookup, callback authentication, duplicate-reference behavior and outage handling.
- Written pricing including Unicode/multipart segments, operator/MNP charges, taxes, sender/onboarding fees, minimum purchase and balance expiry.
- Confirmed coverage for your customers' destination countries. Do not assume a Bangladesh route reaches USA/Australia numbers.

Do not buy a large package before controlled tests establish the required route,
latency, content and receipt behavior. Do not send passwords or API tokens here.

## Alternative: BulkSMSBD

[BulkSMSBD's official FAQ](https://bulksmsbd.com/faq.php) links to its account portal
and documents OTP/API support. It distinguishes submission from delivery and
notes sender/content-language conditions. Confirm those conditions and receipt
integration before choosing it. Several similarly named domains exist; use the
portal linked by the provider's own documentation.

## WhatsApp: Meta Cloud API directly

Use [Meta's official Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
and [getting-started guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).
The collection identifies the prerequisites: Meta business portfolio, WhatsApp
Business Account, business phone number and appropriate messaging permissions.
Some console documentation requires your login.

Owner/operator steps:

1. Complete Meta's business/sender onboarding and confirm the account's approved use.
2. Arrange server-side access credentials, app secret and phone-number/WABA identifiers through a secret manager. Confirm token lifetime and rotation; do not assume every token is permanent.
3. Obtain approved authentication and transactional templates/languages for the actual use cases. Record customer opt-in and opt-out handling.
4. Supply current approved API/version and webhook documentation to engineering. The old Meta Node SDK documentation is archived; do not install it merely from an old example.
5. Test controlled recipients, delivery/read/failure receipts, duplicate/out-of-order events, expired credentials and revocation before enabling the channel.

No working WhatsApp callback or provider environment-variable contract is
implemented yet. Do not register an invented callback URL or paste credentials
into placeholder Admin fields. Meta approval and WhatsApp reachability are not
proof that every international customer has a usable verification channel.

## What remains engineering

The selected providers still need reviewed sending adapters, encrypted delivery
orchestration, authenticated receipts, retry/uncertain-send handling and controlled
staging acceptance. Existing SMS keys are reserved placeholders; production phone
verification remains disabled. Existing WhatsApp channel records do not deliver
messages. Do not enable a service simply to clear a readiness item.

Phone-code account/number binding and concurrent profile/revocation checks are
implemented. See [the API guide](API_CONNECTION_GUIDE.md) and
[the SQA runbook](SQA_RUNBOOK.md) for the current boundaries and tests.

### Secure OTP protocol progress — 12 November 2026

An isolated server-side SSL Wireless secure OTP transport now has simulated
protocol, validation and timeout tests. It is not connected to phone requests or
a worker and has sent no SMS. No new live environment variables are available.
The encrypted queue, receipt/reconciliation path and controlled account acceptance
remain required. See [transport boundaries](../docs/SSL_WIRELESS_OTP_TRANSPORT.md).

Encrypted OTP job payloads and dispatch preflight checks are now implemented and
tested with synthetic secrets. They remain disconnected: no jobs are persisted or
sent. The worker still needs atomic job claims, locked account/session/token
revalidation, reconciliation and receipt handling before controlled provider tests.
Do not enable production SMS yet.
