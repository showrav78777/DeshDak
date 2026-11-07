# Protected private photo reader component

Date: 7 November 2026. This is an internal server component, not an activated
HTTP download path. Existing identity/inspection routes and legacy data remain
unchanged. No public URL, presigned browser URL or storage reference is returned.

## Scope and access

`createPrivatePhotoDelivery` accepts a verified server session ID, record kind and
subject ID. The caller must derive session identity from verified authentication;
never pass a session ID supplied in request JSON. Subject IDs cannot specify an
object key or version. The component resolves the immutable record binding and
checks stored status, storage/key namespace, original/normalized scan proof,
purpose and exact owner/digest/MIME/size metadata.

Identity documents require an active Compliance session in the Compliance portal.
Customer ownership alone and Admin membership do not grant document access.
Inspection photos require the personal customer owning the order, an Inspector or
Warehouse session assigned to the package's current warehouse, or an Admin session
with completed MFA. Portal, active account, current database roles, session expiry
and revocation are rechecked for every read. Video is excluded.

Authorization and metadata are checked in short transactions before storage I/O
and again after the exact-version read/decryption completes. No database
transaction spans network I/O. A session/role/assignment/ownership/status change
during the read blocks delivery. Final authorization and a successful private
view audit are required before returning bytes; audit failure also blocks the
result. Access decisions linearize at the final check: bytes already delivered
cannot be recalled by a later revocation.

The S3 adapter verifies version, encryption, ciphertext checksum, authenticated
decryption and plaintext digest. The reader additionally checks returned size and
digest. Failures never fall back to legacy ciphertext. The return value contains
only bytes and MIME. Success/blocked audits contain fixed action/kind/outcome and
internal identifiers, with no photo body, object key, namespace, scan digest,
provider diagnostic, document number or filename. Blocked access is audited even
when it is rejected before storage. Audit unavailability fails closed.

## Acceptance

`test:private-photo-delivery` uses actual PostgreSQL and application encryption,
with synthetic scan attestations and simulated S3 responses. It tests Compliance,
customer, Inspector, Warehouse and Admin MFA boundaries; missing records; wrong
warehouse/namespace; missing scan proof; non-stored status; denial before storage;
in-flight session/role/assignment/order-owner/status changes; expired/wrong-portal
sessions; storage outage/corruption; invalid returned bytes; audit-write failure;
redacted audits; and unchanged legacy evidence. The intake and binding regressions
also run against a generated disposable schema. No AWS account or customer files
are contacted.

## Activation and remaining work

No migration or production activation switch is added. No current download route
imports this reader. Production HTTP upload/domain creation and download routing
still need integration with request authentication, rate limits, no-store/
nosniff/same-origin response headers, consistent API errors and browser/mobile
acceptance. Quarantine/recovery Admin controls, approved retention/holds,
exact-version deletion, staging IAM/KMS/TLS acceptance and video remain unfinished.
A REVIEW_REQUIRED reservation blocks this reader, but is not a durable quarantine
policy: existing recovery may make a reservation stored again. Do not use it as a
replacement for the pending quarantine/hold workflow. Do not delete legacy
ciphertext or enable production uploads merely because the reader tests pass.

Local result: delivery, scanned-intake and binding acceptance passed on 7 November
2026. Full ESLint, TypeScript, Prisma validation, the unchanged 300-operation API
contract, security regressions, dependency integrity and production build passed.
Generated schemas and the owned disposable database were removed. No owner
database migration, live AWS action, browser-route activation or full-system SQA
was performed in this increment.
