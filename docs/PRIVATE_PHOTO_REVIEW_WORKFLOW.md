# Quarantine review decisions and history

7 November 2026. Scope: audited next-action decisions for an existing private-photo
quarantine, immutable history, version conflicts and safe browser retries.

## Workflow

Admin → System → Private photo safety shows the latest review number and decision.
Open Record quarantine review or View review history. The history page provides
all previous decisions with pagination, reviewer display name, case reference and
time, plus a form for recording the next action using the latest sequence.

Choices are Keep blocked, Rescan required (not performed), or Replacement photo
required. Enter an existing controlled incident reference beginning INC, SEC, KYC
or OPS, using uppercase letters/numbers/hyphens. Do not enter personal information,
identity numbers, contact details, credentials or URLs. Confirm that the decision
leaves the photo quarantined. The application records the provided reference; it
does not independently certify the referenced investigation.

These are decisions, not release approvals. No option performs a scan, sends a
replacement request, changes an inspection/identity approval, moves an order,
modifies scan proofs, deletes evidence or releases quarantine. Actual scanning,
replacement intake and controlled release remain separate unfinished workflows.
The original block remains immutable and ordinary recovery cannot clear it.

## Integrity and authorization

Migration `20261107220000_private_photo_quarantine_reviews` adds immutable review
rows with a restrictive parent relation, positive ordered sequence, fixed decision,
constrained case reference and per-actor UUID retry key. A database trigger rejects
updates/deletes and out-of-order inserts while serializing on the upload row.

Fresh active Admin/MFA/session/role checks run inside the transaction. The current
sequence must match the submitted expected sequence. Concurrent different reviews
cannot overwrite one another: one commits and a stale decision receives conflict.
Same-key/same-payload replay returns the original record even after a later review;
changed payload or key reuse for another record is rejected. Record creation and
its audit commit together; audit failure rolls the review back. Raw provider or
database errors never appear in the response or audit metadata.

The UI freezes a submitted payload and reuses its UUID after an uncertain response.
It supports native validation, a confirmation checkbox, hydration/pending guards,
keyboard labels and mobile controls. History/queue output excludes object paths,
encryption material, photo bytes, retry keys and account contact details; protected
history displays the reviewer's current account display name for accountability.

## API and contract

- GET `/api/v1/admin/private-photos/{uploadId}/quarantine/reviews?page=1` returns
  up to 50 records, page/hasMore and the latest sequence, with private no-store.
- POST at the same path requires UUID `Idempotency-Key`, trusted Admin origin,
  strict bounded JSON with a deadline, decision, caseReference, expectedSequence
  and blockedConfirmed:true. It returns the recorded review and quarantined:true.

The shared bounded JSON reader also serves the existing quarantine action.
The 304-operation contract distinguishes mutation retry headers from read-only
requests; GET/HEAD/OPTIONS no longer incorrectly inherit a mutation retry-header
requirement merely because another handler shares their route file.

## Acceptance

Tests use actual PostgreSQL/migrations and synthetic blocked-photo fixtures.
They cover role/MFA/CSRF, invalid decisions/references/body limits, concurrency,
idempotency and conflict, immutable sequence/history, audit-failure rollback,
51-record pagination, and preserved quarantine, upload metadata and legacy bytes.
No storage/scanner provider is contacted. Chromium exercises desktop and mobile
forms, actual history navigation and a deliberately lost committed response with
safe retry. Screenshots are inspected locally.

Synthetic permanent records are removed by dropping the generated disposable
schema. No owner database is migrated. This component does not certify real
provider scanning, physical devices, production deployment or full-system SQA.

## Remaining work

Actual rescanning, safe replacement intake, controlled release/recovery policy,
retention/holds and exact-version deletion, production object routes, video and
staging/live-provider acceptance remain required. No manual SQL or status edit is
an approved release mechanism. Owner instructions: NIloy/PRIVATE_PHOTO_STORAGE_SETUP.md.


Local result: clean migration/zero-drift/seed/repeat-deploy checks and affected
private-photo regressions passed. Review API/database and Chromium desktop/mobile
acceptance passed, including lost-response replay and the history heading staying
below the sticky Admin toolbar. Screenshot review found and corrected the toolbar
scroll offset; no horizontal overflow remained. Full lint, TypeScript, Prisma
validation, the 304-operation contract, security regressions, private upload safety,
dependency integrity and production build passed. The owned test database and
schemas were removed. This is targeted component acceptance, not full production
or whole-system certification. No owner migration or live provider call occurred.
