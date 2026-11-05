# Private upload intake security increment

Verified: 5 November 2026, Asia/Dhaka. This increment hardens the existing
**development-only** encrypted database intake. It does not implement or certify
production private object storage, malware scanning, signed delivery or video
processing. Both production upload gates remain closed even if development flags
are set.

## Problems corrected

- Identity intake previously checked image magic bytes but did not fully decode
  photos or remove metadata. It now rejects corrupt, animated and over-24-megapixel
  photos, applies orientation, re-encodes without EXIF/location metadata and checks
  processed size before authenticated encryption. Inspection photos receive the
  same animation/decoder failure protection and processed-size check.
- Content-Length alone did not bound a chunked upload. Both routes count actual
  streamed bytes before parsing multipart data, reject invalid/compressed requests,
  bound total body-read time to 15 seconds, and cancel oversized/stalled streams.
  Identity requests allow 5 MB plus 128 KB form overhead; evidence requests allow
  31 MB total, with their existing per-file image/video limits still enforced.
- Duplicate document/media file fields are rejected.
- Identity POST returned the whole created database row, including ciphertext,
  authentication tag, IV and storage hash. Its explicit response projection now
  contains only submission details and non-sensitive photo type/size metadata.
- Concurrent customer submissions could leave multiple pending reviews. A
  parameterized user-row lock serializes replacement of that user's pending
  submission. Already verified identity remains protected from replacement.

## Verification and limits

`npm run test:private-upload-safety` uses synthetic images to check orientation,
metadata stripping, authenticated encryption tamper rejection, decoder limits,
animation rejection, MIME mismatch, malformed files, actual streamed byte limits,
header mismatch, malformed multipart, compression rejection, timeout/cancellation
and production fail-closed gates.

`test:private-upload-workflow` is restricted to generated local isolated schemas.
It checks chunked oversized bodies, duplicate files, undecodable photos, anonymous
and cross-origin rejection, safe response fields, one pending review after two
simultaneous submissions, three immutable submission audits, Compliance MFA and
role isolation, metadata-free authorized viewing, customer data isolation and
preservation of verified identity. The first test fixture lacked Compliance MFA
and was correctly denied; it was corrected to test denial before MFA and successful
access after MFA verification.

The Inspector portal API suite also passed with development capture enabled:
Warehouse upload, validation/encryption, CSRF, warehouse/role isolation,
customer-owned viewing and order-page evidence visibility. These were HTTP/API
workflows with generated photos, not physical camera/device acceptance.

Lint, TypeScript, Prisma schema validation, the 300-operation API contract,
security regressions and production build passed. No migration was required.
No owner database, actual identity document, real customer or external service
was used. The isolated schemas were removed.

The isolated runner now enables these development-only paths and supplies fresh
per-run identity/evidence encryption keys, so future full isolated verification
exercises intake rather than silently skipping it. Never copy these switches or
synthetic credentials into production.

## Remaining production engineering

Implement the approved private object-storage adapter, upload quarantine and
malware scanning, safe photo/video processing, retention/deletion, encryption-key
management and short-lived authorized delivery. Connect these to existing role,
warehouse and customer ownership controls and certify failure/expiry/revocation
in staging. Keep production intake disabled until that complete pipeline passes
review. Accounts or keys alone do not satisfy this requirement.
