# Durable private photo upload ledger

Local acceptance: 6 November 2026, Asia/Dhaka.

This increment connects the storage adapter to a PostgreSQL reservation/recovery
component. It remains internal and is not wired to identity/inspection HTTP routes.
It does not activate production uploads or publish evidence to customers.

## State and integrity controls

- A transaction locks the actor row, checks ACTIVE status and creates one durable
  encrypted reservation per actor/idempotency key before storage I/O. A fingerprint
  binds purpose, normalized photo bytes and MIME type. Reusing a key with different
  content fails; different actors have separate keys.
- The stored namespace is derived from the storage configuration and application
  encryption keys. Changing the bucket, KMS/account configuration or application
  keys cannot silently replay an existing reservation against a different store.
- PREPARED contains ciphertext and a private prepared reference, not plaintext or
  a public URL. A worker uses a 60-second tokenized lease and fenced completion.
  Successful completion records an exact verified object version, clears the
  temporary encrypted body and lease, and records one stored audit event.
- The first attempt can issue one conditional PUT. Later attempts only confirm
  that write and read/authenticate its bytes; they never issue a second PUT. A
  missing object after an uncertain attempt therefore stays in review instead of
  guessing whether a resend is safe. Five attempts is the upper bound.
- Uncertain writes, missing/invalid ciphertext, failed integrity checks or inactive
  actors remain REVIEW_REQUIRED, preserving recovery evidence. A stale worker
  cannot overwrite a newer worker's state. Database/provider diagnostics are
  reduced to fixed safe errors.
- PostgreSQL constraints bound statuses, purposes, attempt count and ciphertext
  length. STORED requires a version reference and purged temporary payload/lease.
  The actor foreign key restricts deletion until evidence retention is reviewed.

`STORED` means storage was confirmed, not that identity is verified, inspection is
approved, a domain record exists or a customer may view the photo. The caller must
still authorize, decode/normalize and scan before reservation, and separately
recheck business authorization before linking or delivery. No new API is exposed.

## Verification

`test:private-upload-ledger` runs only against a generated disposable local schema.
The migration applied successfully there. Real PostgreSQL plus the real encryption
adapter and simulated S3 operations verified durable encrypted reservations,
scoped idempotency, one PUT, configuration/key namespace conflicts, lost-response
confirmation, bounded retries, corrupt retrieval, concurrent leases, stale-worker
completion fencing, purged temporary payload and single private audit events.
Database failure diagnostics were redacted. The existing SDK-signed HTTP simulator
storage suite also passed. No AWS account or customer file was used.

Prisma validation/generation, lint, TypeScript, the unchanged 300-operation API
contract and production build passed. The generated schemas and disposable
container were removed. This is scoped component acceptance, not a full production
or browser workflow certification. The owner database was not migrated.

## Release prerequisite and remaining engineering

Migration `20261106190000_private_photo_upload_ledger` must be reviewed and applied
through the normal backed-up staging/release job before matching code uses it.
Do not apply it directly to the owner database as part of local tests.

Remaining: transactional identity/inspection linking, original/normalized scanning
integration, recovery/review job and Admin controls, approved retention/holds,
exact-version cleanup, authorized delivery/revocation, backwards compatibility
with existing database evidence and live IAM/KMS/S3 acceptance. There is no automatic
orphan deletion or legal-retention duration. Do not manually remove pending records
or their objects to hide an uncertain outcome. Keep production intake disabled.
