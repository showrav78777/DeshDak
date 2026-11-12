# Secure OTP transport increment — 12 November 2026

The server-only transport implements the secure OTP request format documented in
[SSL Wireless ISMS Plus](https://ismsplus.sslwireless.com/api-documentation).
It uses AES-CBC envelopes and HMAC signatures, a fixed HTTPS endpoint, canonical
Bangladesh mobile numbers and an explicit approval argument. Provider acceptance
is not delivery confirmation. Provider echoes and error details are discarded.

This is a disconnected protocol component. No route, worker, environment flag or
Admin field activates sending. Existing SMS placeholder keys remain insufficient.
No schema, customer API or owner database changes are included.

Verification: `npm run test:ssl-wireless-otp` exercises the actual TypeScript module
with simulated HTTP, an independently generated OpenSSL/Python encryption/signature
fixture, random IVs, invalid inputs, rejected/mismatched acknowledgements, bounded
response reading and stalled connection/body deadlines. No SMS is sent.

A request is attempted once. Timeout, malformed acknowledgement or duplicate
response is unconfirmed and must be reconciled rather than automatically retried.
The caller must allocate unique client references; this component does not persist
idempotency records. The vendor's CBC protocol is not a general encryption utility.

Remaining engineering: encrypted outbox, transactional token dispatch, account and
phone revalidation before sending, expiry handling, quota controls, secret resolution,
authenticated delivery receipts and uncertain-send reconciliation. Controlled provider
acceptance must confirm recipient format, credential constraints, approved sender,
IP allowlisting, error/receipt contracts and international coverage. Independent
security review and live provider certification remain outstanding.
