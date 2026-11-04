# Crossly database migration foundation

## Business outcome

Crossly now has a version-controlled PostgreSQL migration history instead of relying on development-only `prisma db push`. A clean environment can be created through the same forward-only deployment command that CI and production will use.

Initial migration: `prisma/migrations/20260825170000_initial_baseline/migration.sql`

## Safety properties

- The initial baseline is generated from the reviewed Prisma schema and contains creation, index, uniqueness, and foreign-key statements.
- It contains no `DROP`, `TRUNCATE`, or `DELETE` operation.
- CI deploys migrations with `prisma migrate deploy`; it does not generate or modify migrations automatically.
- The verifier creates a cryptographically unique `crossly_migration_verify_*` PostgreSQL schema, deploys the committed migration, checks for drift, seeds reference data, repeats deployment to confirm no-op behavior, and removes only that temporary schema.
- The verifier derives the expected application-table and migration counts from the committed schema/history, requires every migration to finish without rollback, and checks seven roles plus eight initial categories.
- Migration diagnostics redact PostgreSQL connection URLs.
- `20260830150000_address_default_integrity` adds a filtered unique index so each customer has at most one active default delivery address while retaining soft-deleted history.
- `20260830170000_customer_wishlist` adds the persistent customer/product wishlist relation with uniqueness and lookup indexes.

## Developer workflow

For a new schema change:

1. Update `prisma/schema.prisma`.
2. Generate a named development migration with `npm run db:migrate -- --name descriptive_change_name` against a disposable or backed-up development database.
3. Review every generated SQL statement. Financial, identity, audit, order, inventory, and status-history changes require explicit data-integrity review.
4. Run `npm run db:migration:verify`.
5. Run Prisma validation, lint, TypeScript, relevant workflow tests, API contract verification, and the production build.
6. Commit the schema and migration together. Never edit an already-deployed migration; add a new corrective migration.

Production and CI deploy only with:

```text
npm run db:deploy
```

Never use `prisma db push` against staging or production.

## Existing local database adoption

The current developer database was created before migration history existed. Do not run the baseline SQL over that non-empty schema and do not reset it merely to mark the baseline.

Before baselining an existing environment:

1. Take and verify a backup.
2. Compare the live schema to `prisma/schema.prisma` with `prisma migrate diff`.
3. Resolve every difference before continuing.
4. Mark `20260825170000_initial_baseline` as applied with `prisma migrate resolve --applied 20260825170000_initial_baseline`.
5. Run application smoke tests and verify migration status.

This adoption is intentionally not automated because silently accepting drift could lose constraints or production data.

## Roll-forward and recovery policy

Prisma production migrations are forward-only. Rollback does not mean blindly running reverse SQL.

- If deployment fails before a migration is applied, stop the release and leave the previous application active.
- If a migration fails partway, diagnose the exact database state, correct or complete it through a reviewed migration, and use `prisma migrate resolve` only when its recorded state matches reality.
- If a successful migration introduces an application defect but preserves data, deploy the previous compatible application or a forward corrective migration.
- If a migration damages or removes data, stop writes and restore the verified pre-deployment backup according to the disaster-recovery runbook.
- Destructive column/table removal uses expand-and-contract releases: add the replacement, backfill and verify, switch application reads/writes, wait through the rollback window, then remove obsolete data in a later approved release.

Production rollout still requires external backup storage, restore testing, approved RTO/RPO, maintenance-window ownership, monitoring, and a named rollback decision-maker as recorded in `idea.txt`.
