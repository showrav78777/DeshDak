# Existing private download authorization — 13 November 2026

## Problem and change

The DB-backed identity-document and inspection-evidence HTTP routes checked roles
and ownership before decryption, but could return a file after those permissions
changed. They now perform a final transactional check before returning bytes.
This protects existing development records; the staged object-storage reader and
production upload activation remain separate, unfinished integration work.

The final check locks the account/session, subject record, inspection package and
order where relevant, warehouse assignment and user-role grants. It reads current
authorization after blocking locks and rejects revoked/expired sessions, inactive
accounts, wrong portals, removed roles, cleared privileged MFA, lost assignments,
changed order ownership or a changed file digest. Compliance document viewing
requires its portal, grant and MFA; Admin does not gain document access. Inspection
viewing retains own-customer, assigned Warehouse/Inspector and MFA Admin boundaries.
Linked quarantine is checked again after authorization waits. No transaction spans
external storage or provider I/O. Authorization linearizes at the final transaction;
a later revocation cannot recall bytes already returned.

Successful reads write their view audit inside that transaction. Changed access
records a minimal `private_photo.legacy_view_blocked` audit and returns the existing
403 code without file bytes. Audit failure prevents delivery. No filenames, media,
storage references or document numbers are included in the new audit metadata.
Inspection files now also carry `Cross-Origin-Resource-Policy: same-origin`, matching
identity files. Both retain private/no-store and nosniff headers. No database
migration or API shape change is required.

## Verification

Three suites passed together in one owned disposable local PostgreSQL environment:

- `test:private-download-authorization`: real HTTP reads using synthetic encrypted
  photos, with a database lock held until the final authorization query waits.
  Nine concurrent-change cases cover Compliance revocation, role removal, MFA
  clearing and pending status; Inspector revocation, role removal, assignment
  deactivation and package movement; and customer order-ownership transfer. Each
  returns JSON denial with no file bytes/success audit and one denial audit.
  A positive Compliance read checks exact bytes and no-store headers.
- `test:private-upload-workflow`: real identity intake, encryption, concurrent
  submissions, privacy and valid MFA Compliance delivery.
- `test:inspector-portal`: assigned capture/viewing, customer ownership, role and
  warehouse isolation plus the existing inspection workflow.

Evidence: `/tmp/deshdak-private-download-auth-20261113.log`. Schema/container cleanup
completed; no owner database, customer documents or live providers were used.
The isolated runner now selects 38 suites; this increment does not claim a new
complete 38-suite acceptance. The preceding full 36-suite run remains historical
acceptance. Cloud/provider, dependency-audit, device and independent security gates
remain open. Production private uploads remain disabled.

Lint, TypeScript, production build, the 306-operation API contract, security
regressions and dependency integrity passed. Build evidence:
`/tmp/deshdak-private-download-build-20261113.log`.
