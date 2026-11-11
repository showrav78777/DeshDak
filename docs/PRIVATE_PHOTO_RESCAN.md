# Quarantined stored-photo rescan

## Increment and boundary

This increment adds an Admin/MFA-controlled rescan of an existing normalized,
encrypted private-photo object. It does not activate production identity or
inspection intake/download routing, retain/rescan original uploaded bytes, release
quarantine, certify the document or complete video/retention/replacement workflows.
Requirements follow the master architecture, RBAC/security and notification/privacy
boundaries in the binding business documentation and DEVELOPMENT_PROCESS.md.

## Workflow

1. An administrator with a current Admin session and MFA opens Private photo safety.
2. The photo must have an immutable quarantine and a current `RESCAN_REQUIRED`
   review. Match the approved incident before processing private evidence.
3. On review history, authorize scanning the stored copy and confirm that it stays
   quarantined. Setup must be approved and configured before the control appears.
4. The server records an immutable request before provider work, bound to actor,
   latest review, upload, storage namespace, exact reference and a 60-second deadline.
5. It reads the recorded object version, verifies storage/encryption/checksum and
   plaintext integrity, scans the unchanged bytes, then validates image decoding.
6. Current session/MFA/role, reference, review and deadline are checked again before
   recording clean proof. A changed or unverifiable context cannot produce CLEAN.
7. Reload history to inspect the result. No outcome grants download or release.

## Safety and failure handling

- One attempt per review, one unexpired pending attempt per file, at most five
  requests per file per rolling day. Application locks and PostgreSQL triggers
  enforce the constraints. Requests/results cannot be edited or deleted.
- A UUID idempotency key is bound to the actor. Retrying it reads the same attempt
  instead of repeating external I/O. A new review is needed for a new attempt.
- A fresh matching scanner digest is required. Infection, bad/missing proof,
  corruption, provider outage, audit failure or changed context leaves no clean proof.
- Interrupted work can remain PENDING, then become EXPIRED in the DTO. A failed
  attempt records UNCONFIRMED where possible. Neither state is an automatic retry.
- Authorization loss after processing is recorded without granting new access.
- Responses/history contain safe metadata only, not object keys, encryption keys,
  digests, signed storage URLs, original bytes or raw provider diagnostics.
- The S3 client is closed in the route's finally block. Missing configuration fails
  closed. Credential presence is not staging certification.

## Deployment/configuration

Migration: `20261107230000_private_photo_rescans`, after earlier private-photo,
quarantine and review migrations. Use the reviewed migration job with backup and
rollback planning; do not edit statuses or SQL to activate recovery.

`PRIVATE_PHOTO_RESCAN_ENABLED` defaults to false. When enabled, startup and runtime
share validation for private storage bucket/region/expected owner/KMS, independent
identity/inspection application keys, approved HTTPS scanner URL and independent
scanner token. Public-media scanner origin/token cannot substitute for the private
service. The Docker migration and runtime images include the shared validator.

The current web runtime uses its workload identity. The rescan operation itself
only needs scoped exact-version reads and reviewed KMS access, not object write or
delete permission. Restrict private prefixes and approve scanner processing,
logging, data residency and retention before sending real documents. See the
[owner checklist](../NIloy/PRIVATE_PHOTO_STORAGE_SETUP.md) and the primary
[AWS GetObject permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

## Acceptance scope

`test:private-photo-rescans` requires a generated disposable local PostgreSQL
schema and local application. It tests immutable requests/results, idempotent
pending/replay behavior, revocation, context changes, scan/storage failure,
corruption, quotas, expiry and unchanged quarantine. API tests cover authorization,
invalid input and disabled setup; Admin page checks cover desktop/mobile layouts.
S3/scanner interactions are simulated. A configured successful live HTTP scan,
actual IAM/KMS policies and provider deployment are not certified by these tests.

Live release remains gated on real storage/scanner acceptance, production routing,
retention/holds, replacement/recovery, video and wider release acceptance.
