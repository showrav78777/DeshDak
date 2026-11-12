# Private upload commit authorization — 13 November 2026

## Outcome and scope

The development identity-photo and inspection-evidence routes previously checked
access before multipart decoding and media processing. Access could change before
the database write. Both routes now authorize again inside the saving transaction.
This increment hardens existing development intake; it does not activate or
complete production object storage, malware scanning, video processing or release
lifecycle integration.

## Enforcement

- Lock the account and session and require an ACTIVE, non-deleted account with a
  current, unrevoked session belonging to that account.
- Inspection intake also locks the package and requires an active outbound record
  beyond EXPECTED. Non-Admin staff must hold the appropriate portal/role and an
  active assignment to the package's current warehouse. Admin requires its portal,
  grant and MFA. Identity intake requires the personal-customer portal/grant.
- Lock relevant assignment and user-role grant rows; evaluate grants and session
  expiry after potentially blocking locks. File processing happens before these
  transaction locks, with no provider network call while locks are held.
- Changed access returns the existing 403 error code without persisting media,
  verification/evidence records or success audits. A committed denial records
  `private_upload.commit_denied` with only intake kind and ACCESS_CHANGED reason;
  no filename, photo, hash or storage reference is added to that audit.
- Existing encryption, file validation, ownership checks and verified-identity
  conflict rules remain. No schema, credential or API response shape changed.

## Acceptance evidence

Three selected suites passed together against an owned disposable local database:
`test:private-upload-authorization`, `test:private-upload-workflow` and
`test:inspector-portal`. The new test submits real multipart synthetic photos and
holds a database lock until initial request authorization has passed, then changes
access before the write. Cases cover customer revocation, pending status and role
removal; inspector revocation, role removal, assignment deactivation, package move,
EXPECTED status and inactive outbound eligibility. Each verifies denial, no domain
record/success audit and one denial audit. Positive capture/upload, encrypted
viewing, ownership, concurrent identity submission and staff isolation tests pass.

Lint, TypeScript, production build, the 306-operation API contract, security
regressions and dependency integrity passed. Local diagnostic evidence:
`/tmp/deshdak-private-upload-commit-final.log` and
`/tmp/deshdak-private-upload-commit-build-20261113.log`.

The isolated SQA selection now includes 37 suites. Only the three relevant suites
were rerun for this increment; the latest complete selected run remains the
36-suite acceptance recorded earlier on 13 November. Disposable schema/container
cleanup passed; no owner database or live provider was used. This is not an
independent security audit, all-page review or production certification. Dependency
audit, provider, cloud and physical-device acceptance gates remain open.
