# Private photo quarantine and Admin workflow

7 November 2026. Scope: permanent quarantine, redacted Admin queue, and enforced
blocks on reservations, bindings, object reads and linked legacy downloads.
This does not activate production object uploads or downloads.

## Operator workflow

Open Admin → System → Private photo safety (`/admin/private-photos`).
The page explains each step: match the private upload reference to an approved
incident review, choose a fixed reason and confirm quarantine. Admin MFA is
required. The queue supports pagination and a quarantined-only filter; it exposes
purpose, storage state, reference, time and linked/quarantine status, not photo
content, identity numbers, account contacts, object paths, ciphertext or keys.

A browser retry preserves the same reason, confirmation and UUID idempotency key.
The form freezes those fields after an attempt, reports an uncertain response and
supports safe retry. Native validation, hydration gating and pending guards avoid
accidental/duplicate submission. Desktop and 390-pixel mobile layouts provide
44-pixel actions and wrapping references. No JavaScript means no mutation.

Quarantine is permanent in this increment. It is independent of storage state:
ordinary upload/recovery completion cannot release it. It does not delete a file,
clear legacy evidence, verify identity, change inspection approval or move an
order stage. Controlled release/rescan and retention/hold/deletion require separate
reviewed workflows; never manually delete a block to recover an upload.

## Enforcement and API

Migration `20261107170000_private_photo_quarantine` adds a unique per-upload block,
actor/key idempotency, fixed reason constraint, restrictive references and a trigger
rejecting updates/deletes. Inserts lock the upload row. Binding has a database
trigger rejecting new links and link removal for quarantined reservations, in addition to application checks.
Upload claim/completion and scan attestation use the same row-lock boundary.
Network I/O is not inside these transactions. A PUT already in flight may still
create an encrypted object, but quarantine remains and completion cannot mark it
stored. Preserve that reservation/object for future approved recovery/retention.

The internal object reader checks quarantine before storage and after decryption.
Linked legacy identity/inspection GET routes also check before returning bytes and
record blocked-view audit events. Unlinked legacy photos are not covered by this
queue. Access changes after the final authorization decision cannot recall bytes
already delivered. No automatic photo migration or legacy ciphertext deletion runs.
Compliance object reads now explicitly require MFA, matching the governing policy;
soft-deleted actors are rejected by private components even if still marked active.

Versioned protected APIs:
- `GET /api/v1/admin/private-photos?page=1&state=all|quarantined`.
- `POST /api/v1/admin/private-photos/{uploadId}/quarantine`, UUID
  `Idempotency-Key`, JSON `{reason, confirmed:true}`. Allowed reasons:
  SUSPECTED_MALWARE, PRIVACY_REVIEW, INTEGRITY_FAILURE.

The mutation requires trusted origin, fresh active Admin/MFA/session/role checks,
a strict bounded JSON body with a deadline, explicit confirmation and transactionally
persisted audit. Same-key replay returns the original block; changed requests or
another review conflict. Provider configuration/credentials are not needed to block.
The API contract now documents 302 operations.

## Acceptance and limits

Real PostgreSQL, migrations and application encryption are used with simulated
S3 and synthetic scan proofs. Tests exercise MFA/CSRF/validation, paginated redacted
DTOs, concurrent retries, immutable/direct-database enforcement, object and legacy
download blocks, binding denial, in-flight read/PUT quarantine and recovery fencing.
The actual Admin form is exercised in Chromium at desktop/mobile sizes, including
a deliberately lost committed response followed by an idempotent retry. Screenshots
are inspected locally. The affected upload/delivery/binding regressions also run.

Permanent synthetic fixture blocks are not deleted individually; the generated
disposable schema is dropped by the isolated runner. The owner database is not
migrated. These tests do not certify live AWS, a production scanner or physical
mobile devices, and do not replace the full-system acceptance suite.

Remaining: authenticated production object intake/domain creation and download
routing, controlled release/rescan/recovery, approved legal retention/holds and
exact-version cleanup, video, staging provider acceptance and final full SQA.


Local result: the affected delivery, ledger, scanned-intake, binding, legacy-upload
and quarantine acceptance group passed. Final Chromium desktop/mobile and lost-
response retry checks passed after waiting for the hydrated Admin panel; inspected
screenshots had no horizontal overflow. Clean migration deploy, zero drift, seed,
repeat deploy and schema cleanup passed. Full lint, TypeScript, Prisma validation,
302-operation API contract, security regressions, private upload safety, dependency
integrity and production build passed. CI installs Chromium for this acceptance
and runs permanent-quarantine fixtures last before discarding the isolated schema.
No owner migration or live AWS/provider operation was performed. This is targeted
acceptance, not a current full-system or physical-device completion certificate.
