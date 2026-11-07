# Scanned private photo intake component

Date: 7 November 2026. Scope: server-only identity/inspection photo component;
production HTTP upload and delivery remain disabled.

## Acceptance and flow

An active actor submits an internal File and scoped idempotency key. The component
bounds identity photos to 5 MiB and inspection photos to 8 MiB, scans the original,
fully decodes JPEG/PNG/WebP with a 24-million-pixel limit, rejects animation,
applies orientation and strips metadata, then scans the normalized photo. The
HTTPS scanner client requires an exact clean acknowledgement bound to SHA-256,
bounded JSON, a deadline and generic failures; no development bypass exists.

The durable upload ledger encrypts normalized bytes before storage and verifies
the exact object version before marking it stored. Only then does an actor-locked
transaction persist original/normalized digests and scan timestamps with a private
audit event. It returns only state/upload ID. Replays cannot replace original
proof, even if a different original normalizes to the same pixels. Uncertain
writes remain unproved until verified recovery succeeds without another PUT.

Migration `20261107140000_private_photo_original_scan` adds paired original proof
fields and tightens the existing binding trigger: both proofs and coherent times
are mandatory. Existing reservations are not automatically marked scanned.
Callers must derive actor/session identity from authenticated server state and
apply authorization, rate limits and request bounds before calling this internal
component. No browser endpoint imports it yet. Existing legacy encrypted records
and protected readers remain unchanged. A scan proof is not ongoing quarantine,
revocation or a complete retention policy.

## Verification

`test:private-photo-scanner` exercises strict responses, digest mismatches,
malformed/oversized JSON, cancellation, HTTPS/token requirements and generic
failures with simulated transport. `test:scanned-private-intake` uses real
PostgreSQL migrations and application encryption with simulated S3/scanner
responses: original/normalized rejection before writes, decode failure, EXIF
removal, proof idempotency/conflict, interrupted-write recovery, suspended actors
and downstream identity binding. `test:private-photo-links` checks missing and
future original proofs at both service and database boundaries.

`test:media-scanner` uses a simulated daemon. Container acceptance separately
checks real ClamAV with a harmless image and standard antivirus test string;
it does not certify AWS, production TLS, customer files or independent detection
coverage. No public API contract changes are introduced.

## Remaining integration

Authenticated HTTP intake and domain creation/linking, object-backed authorized
downloads, quarantine/recovery Admin controls, approved holds/deletion and exact
version cleanup remain required. A dedicated private scanner/token and privacy
approval are prerequisites. Owner steps: NIloy/PRIVATE_PHOTO_STORAGE_SETUP.md.
Do not clear legacy ciphertext or enable production flags until these workflows
pass staging and provider acceptance.


Local result: scanner transport, simulated daemon, actual ClamAV container,
scanned intake, ledger and binding acceptance passed on 7 November. The container
run verified the digest-bound acknowledgement using actual ClamAV. Disposable
schemas and scanner resources were removed. This result is component acceptance;
current full-browser/physical-device SQA and production acceptance are separate.

Prisma validation, full ESLint, TypeScript, the unchanged 300-operation API
contract, private upload safety, dependency integrity, security regressions and
production build passed. No owner database migration was performed.
