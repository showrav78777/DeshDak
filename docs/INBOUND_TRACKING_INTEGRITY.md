# Inbound tracking identity — 20 October 2026

## Scope and rationale

The master/database/logistics specifications require reliable package identities
and auditable receiving. Supplier dispatch already checks tracking ignoring case,
and scanning/receiving also compare ignoring case. The old case-sensitive unique
constraint nevertheless allowed simultaneous legacy/import writes such as
`ABC123` and `abc123`, making scan resolution ambiguous.

Migration `20261020120000_inbound_tracking_case_uniqueness` adds a PostgreSQL
unique expression index on `lower(Package.inboundTracking)` for non-null tracking.
It protects inserts and updates across all writers, including concurrent requests.
Existing case-sensitive uniqueness remains; null tracking remains supported.
The original spelling is preserved. No order, event, dispatch, financial record or
customer notification is rewritten. No new API or provider is activated.

This preserves the application's existing global tracking-identity policy; it
does not introduce carrier-scoped reuse, split parcels or tracking corrections.
Whitespace/punctuation normalization and carrier-specific identifier rules are not
changed. Such changes require a separate identity/operational review.

## Controlled deployment

1. Back up the target database; pause package/import/dispatch writers during the
   reviewed deployment window.
2. Run `npm run db:tracking:check` against the intended environment. This read-only
   preflight reports only conflict-group/package counts, not tracking values or
   customer information. Exit 1 blocks deployment on conflicts or check failure.
3. Authorized operations must investigate conflicts using restricted database
   access and original evidence. Do not delete packages or rewrite immutable
   dispatch/history to make a migration pass. There is no automatic remediation.
4. Apply reviewed migrations with `npm run db:deploy`, regenerate Prisma and
   restart. The index creation itself fails closed if conflicts appear after the
   preflight. PostgreSQL may lock package writes while creating the index; schedule
   a suitable maintenance window, especially on a large table.
5. Resume writers only after migration status and smoke tests pass. A clean
   preflight alone does not establish that the index is installed.

The SQL expression index is not representable in Prisma schema syntax; retain the
SQL migration and verify it during future schema changes. Do not replace reviewed
migrations with `db push`. Application rollback should retain this integrity index.
The owner's database is not migrated by isolated tests.

## Acceptance checks

Use disposable PostgreSQL to apply the actual migration and verify simultaneous
mixed-case inserts yield one package and one uniqueness conflict, a conflicting
update fails, distinct references and multiple null references succeed, and the
read-only preflight passes without logging tracking values. Rerun the existing
33-case role/browser suite and schema/lint/type/API/build gates. Existing receipt
and dispatch APIs already translate uniqueness conflicts to safe 409 responses.

## Remaining gates

Split/merged supplier parcels, dispatch corrections, private scanned procurement
evidence, original-currency costs/FX accounting and supplier claims remain separate
work. Live provider access and production infrastructure/security acceptance are
not established by this database guard.

## Verification evidence

The final isolated PostgreSQL/browser suite passed all 33 tests in 124.54 seconds
with zero failures/skips/errors. Direct database fixture checks verified one winner
for concurrent case-only inserts, rejected conflicting updates, distinct references
and multiple null references. A separate disposable-schema experiment verified the
preflight's conflict counts, unchanged source rows, no reference leakage, clean
success and safe missing-table failure; that schema was removed afterward.

Two earlier browser runs each had one failure: a 10-second Inspector refresh wait
expired during an approximately 18-second development render, then an unscoped
correction locator matched a retained inactive route. The assertion now waits up
to 30 seconds without replaying its mutation; correction actions target the visible
record card. The final full run passed after those test corrections. The first
run also logged a development "destination stream closed early" error; this is
not an error-free runtime or performance/security sign-off.

Schema, targeted ESLint, TypeScript, API contract (288 operations), supplier/
receipt/manual-purchase policy tests, security regressions and production build
passed. HTML/JUnit evidence was exported and disposable containers/network removed.
Known development dependency advisories remain recorded in idea.txt. The owner's
database was not migrated, and no live supplier/provider was activated.
