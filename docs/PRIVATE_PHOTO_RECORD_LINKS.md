# Verified private photo record bindings

Local acceptance: 7 November 2026, Asia/Dhaka.

This increment links a confirmed photo reservation to an **existing** identity or
inspection evidence record. It is an internal staging/migration component, not a
new public upload endpoint or active S3 download path. Legacy ciphertext and
current download authorization remain unchanged. Production intake stays disabled.

## Binding controls

The caller must derive the session ID from an already verified server session,
never from request-body fields. The component rechecks the database session's
expiry/revocation, portal, account status and current roles. Identity binding
requires the customer portal and personal-customer role. Inspection binding
requires the matching Inspector/Warehouse role and active warehouse assignment,
or an Admin session with completed MFA. The upload and target must belong to the
same actor. A revoked role or assignment also blocks replay of an existing link.

The reservation must be STORED in the expected storage/key namespace, with a
valid reference and a clean-scan attestation matching the stored plaintext digest.
The attestation must follow reservation creation and cannot be future-dated beyond
the clock tolerance. The target must have the same digest, MIME and byte size;
inspection evidence must be a photo. Wrong owner, purpose, metadata, portal,
namespace or missing/mismatched scan proof is rejected.

One reservation can bind to only one subject. Each subject can bind to only one
reservation. Concurrent identical requests return one link and one audit event;
reusing a reservation for another record fails. PostgreSQL foreign keys, unique
constraints, a single-subject check and an immutable-binding trigger enforce the
stored/scan/owner/purpose/metadata boundary independently of the service. The
service uses row locks and returns safe errors rather than database diagnostics.
Its DTO/audit excludes storage keys, object references, ciphertext and namespaces.

Binding does not verify the person's identity, approve an inspection, change an
order timeline or replace/delete the legacy photo. It does not certify that a
scanner ran: the clean attestation must be produced by the unfinished controlled
intake/scanning pipeline. Do not populate those fields manually to clear a gate.

## Verification

Real PostgreSQL isolated checks passed:

- Owned identity and assigned Inspector/Warehouse photo bindings.
- Cross-customer and wrong-warehouse rejection; denied Logistics access.
- Missing/wrong scan digest, wrong storage namespace and wrong portal rejection.
- Revoked sessions, expired sessions, suspended accounts, removed roles/assignments
  and Admin-before-MFA rejection; Admin-after-MFA acceptance.
- Concurrent idempotent binding, one private audit, conflict rejection, database
  trigger rejection of unscanned/cross-owner writes and immutable link updates.
- Existing encrypted evidence remained unchanged. Scan attestations were synthetic
  fixtures; no actual S3, scanner, customer file or AWS account was contacted.

The upload-ledger regression, private upload safety, Prisma validation/generation,
lint, TypeScript, security regressions, 300-operation API contract and production
build passed. This is component acceptance, not new browser/full-system acceptance.
The owner database was not migrated; disposable schemas/container were removed.

## Release and remaining integration

Review migration `20261107110000_private_photo_bindings` through backed-up staging
and release procedures before matching code uses the component.

Next: original/normalized photo scanning with durable attestations, authenticated
HTTP intake, controlled domain creation/linking, object-backed authorized delivery
and revocation, quarantine/recovery Admin work, retention/holds and exact-version
cleanup. The current readers still serve legacy evidence; a binding alone must
not be treated as a storage handoff or a quarantine/revocation mechanism. Do not
clear legacy ciphertext or activate production intake until that lifecycle passes
staging and live-provider acceptance. Video remains separate.


Follow-up, 7 November: original/normalized scanning and durable proof production
are now implemented internally; see SCANNED_PRIVATE_PHOTO_INTAKE.md and migration
`20261107140000_private_photo_original_scan`. Binding now requires both proofs.
The HTTP, delivery, quarantine and retention limitations above still apply.
