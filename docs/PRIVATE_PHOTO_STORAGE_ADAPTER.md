# Private photo storage adapter core

Verified locally: 6 November 2026, Asia/Dhaka.

This increment supplies a server-only AWS S3 adapter using the pinned official
SDK. It is deliberately not imported by any upload/download route and provides
no activation switch. The production intake gates remain closed. This is one
component of the unfinished private identity/inspection lifecycle, not a completed
production upload feature.

## Implemented boundary

The adapter accepts a validated bucket, AWS region, expected account and matching
KMS key ARN, plus separate 32-byte application encryption keys for identity and
inspection photos. The SDK uses its standard server-side credential provider
chain; deployment must use an approved workload IAM role. No browser credentials,
public URLs or custom production endpoint setting are provided. Configured SDK
endpoint URL overrides are ignored by the default client.

Preparation creates a random opaque key below a fixed purpose prefix. It accepts
already-scanned, normalized photo bytes only; decoding, malware scanning and
business authorization remain caller responsibilities. Identity photos are capped
at 5 MiB and inspection photos at 8 MiB. AES-256-GCM authenticates the ciphertext
and binds it to its purpose/key through associated data. Plaintext and ciphertext
integrity digests, IV, size and MIME metadata belong only in controlled backend
records. No filenames, document numbers, user IDs or original photo metadata are
sent to S3. The object body is ciphertext plus its authentication tag.

Writes require the expected bucket owner, explicit SSE-KMS, ciphertext SHA-256
checksum, octet-stream content type and If-None-Match:*; no ACL is sent. A versioned
write acknowledgement with matching KMS/checksum metadata is mandatory. The
reference contains an exact immutable object version, never a public URL.

If a write response is lost or incomplete, `confirm` can verify the unique prepared
key's metadata and recover an exact version. It rejects mismatched size, type,
owner, checksum or encryption. The orchestration must persist the prepared
reference **before** network I/O and keep it pending until recovery and validation
finish; a successful HEAD alone is not business approval or malware certification.

Reads address the exact version, require expected owner/encryption/type/length/
checksum metadata, bound actual streamed bytes and the whole read duration,
verify ciphertext integrity, authenticate GCM and verify plaintext integrity.
Mismatched key/purpose/IV/version, tampering, invalid references and stalled reads
fail closed. Deletion requires an exact validated version. Errors contain a fixed
message with no raw provider diagnostics or secret-bearing cause.

## Verification

`npm run test:private-photo-storage` runs an ephemeral local HTTP S3 simulator with
synthetic static credentials. The real AWS SDK signs its requests. Checks cover
opaque/encrypted writes, SSE-KMS and owner headers, checksum and conditional-write
headers, absence of ACLs, exact versions, non-overwriting retries, response-loss
recovery, rejected unversioned/wrong-encryption responses, tampering, invalid
references, overlong/stalled streams, exact-version deletion and redacted errors.
No AWS account, actual KMS operation or customer file was used.

Lint, TypeScript, production build, the 300-operation API contract, existing private
upload safety checks and dependency integrity passed. Production npm audit: zero
findings; full audit: eight pre-existing moderate tooling findings. This does not
replace the full-system suite or live IAM/KMS/S3 certification. No database schema
or owner database was changed.

## Remaining engineering before activation

- Durable pending-upload/object-reference records and transactional linking to
  identity/inspection records, including uncertain-write recovery and orphan review.
- Integrate photo validation, original/normalized scanning, authorization, rate
  limits, audit evidence and authenticated delivery without exposing references.
- Backward-compatible handling of existing encrypted database evidence; no implicit
  bulk migration or key rotation.
- Reviewed retention/hold/deletion workflows, exact-version cleanup and recovery
  evidence. Never infer legal retention durations from this adapter.
- Staging IAM/KMS, blocked public access, versioning, integrity, outage, replay,
  expiry/revocation, deletion and restoration acceptance. Video remains separate.

Owner infrastructure prerequisites are under `NIloy/PRIVATE_PHOTO_STORAGE_SETUP.md`.
Primary AWS references:
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html

## Durable reservation follow-up, 6 November 2026

The adapter is now connected to an internal PostgreSQL reservation/recovery
component with scoped idempotency, storage/key namespace fencing, verified
completion and private audit history. See PRIVATE_PHOTO_UPLOAD_LEDGER.md.
Business-record linking, scanning, approved cleanup and delivery remain unfinished;
no upload/download route or production activation switch was added.
