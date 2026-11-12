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

Remaining live integration: protected transactional token dispatch, scheduling,
quota controls, secret resolution,
authenticated delivery receipts and uncertain-send reconciliation. Controlled provider
acceptance must confirm recipient format, credential constraints, approved sender,
IP allowlisting, error/receipt contracts and international coverage. Independent
security review and live provider certification remain outstanding.

## Encrypted dispatch payload — 12 November 2026

`phone-otp-payload.ts` seals only the minimum OTP dispatch fields with the existing
AES-GCM outbox encryption. The payload binds user, issuing session, token, exact
phone and expiration; the code must match the phone-bound HMAC. A random 20-character
client reference stays stable when the same encrypted job is reopened. Tokens and
metadata alone do not reconstruct or expose the code.

Dispatch preflight requires explicit active account/session, unused token and
unverified phone evidence, rechecks the exact binding and rejects expiry within
15 seconds. Wrong keys, corruption, oversized records and unsupported formats fail
with one redacted error. The returned plaintext is worker-only and must never be
serialized to customers, audit metadata or logs.

This helper does not read the database, acquire locks, persist jobs or authorize
sending. A future worker must supply fresh authoritative context while serializing
account/session/token changes, persist a one-attempt claim and reconcile unknown
outcomes. Reopening a payload is not a sending claim. No API calls this helper and
no SMS worker is enabled. The email retry worker must not process OTP SMS jobs.

`npm run test:phone-otp-payload` covers binding changes, state/expiry rejection,
tampering, key mismatch/missing production key, stable references and randomized
ciphertexts using synthetic secrets. Transport tests additionally cover caller
reference mutation during in-flight I/O. Database race and live dispatch acceptance
remain outstanding until the worker exists.

## Durable job core — 12 November 2026

`phone-otp-jobs.ts` now provides transactional enqueue and an internal worker core
using the existing notification delivery table. Enqueue validates the locked user,
session and phone token, stores only the encrypted payload and serializes duplicate
producers by token. Rollback removes the whole enqueue. No schema migration is needed.

The worker revalidates authoritative account/session/token state under database
locks. Its committed claim sets attempts to one and removes the encrypted OTP before
provider I/O. A minimal audit record preserves the random client reference for
reconciliation. A timeout, process death or failed acknowledgement persistence leaves
an unconfirmed claim; it is never reclaimed or automatically retried, even if its
status is accidentally reset. This prioritizes avoiding duplicate sends over guaranteed
delivery after a crash. Requesting a fresh code requires the protected issuance flow.

Provider acceptance stores an opaque reference and does not mark DELIVERED. Stale
account/session/phone/token evidence cancels the queued job and purges its payload.
A decryption failure stops processing with a redacted operator error and preserves
the record for key/corruption review. Do not blindly reset claims or replace keys.

Account changes that commit before the claim are honored. A change after the claim
commits may race with the already authorized send; the existing phone-bound token
confirmation rules must still reject invalidated/expired codes. No database locks are
held across network calls. The worker expects the reviewed sender's bounded deadline.

Real disposable PostgreSQL tests passed for duplicate producers, concurrent workers,
rollback, stale/used/expired/verified/disabled/revoked states, revocation during lock
wait, corruption, unknown outcomes, ciphertext purge and persistence failure after
acceptance. Transport calls were simulated. The broader SQA runner now includes this
suite (34 selected suites); only this new suite was run in this increment.

No public route, scheduler or Admin control connects this core to live sending.
Production SMS remains unavailable. Protected issuance/rate-limit integration,
reconciliation operations, authenticated delivery receipts, retention controls,
provider/account certification and independent review remain release gates.
