# Crossly deployment, backup, restore, and rollback runbook

## Safety rule

Never deploy a migration without a verified pre-deployment backup. Never test restoration against staging or production. The supplied restore command accepts only an empty, separately provisioned database named `crossly_restore_drill_<identifier>` and requires exact host and database-name confirmations.

## Named owners required

Before a release, record the release approver, migration operator, monitoring owner, rollback decision-maker, database owner, incident commander, Finance sign-off, Compliance sign-off, and Operations sign-off. Approve the maintenance window, RTO, RPO, rollback window, and customer-communication channel.

## Pre-deployment sequence

1. Freeze the release commit/image and record its immutable identifier.
2. Confirm staging acceptance has no open P0/P1 issue.
3. Run `npm run verify:launch` against the release candidate.
4. Run `npm run config:production:check` inside the final runtime environment.
5. Confirm liveness/readiness probes, centralized logs, alerts, WAF/rate limits, database capacity, secret rotation, and rollback access.
6. Create and verify a PostgreSQL custom-format backup using the command below.
7. Restore that exact archive into a new empty drill database and retain the output, duration, table/migration counts, archive checksum, operator, and timestamps.
8. Confirm the previous application image remains deployable and database-compatible throughout the rollback window.

## Create a verified backup

Set these values through the operator shell or secret manager; never place credentials in a command, ticket, chat, screenshot, or source file:

```text
DATABASE_URL=<secret-manager injected PostgreSQL URL>
BACKUP_CONFIRM_DATABASE_HOST=<exact database hostname>
BACKUP_OUTPUT_DIR=<absolute encrypted backup directory>
npm run ops:backup
```

The command uses libpq environment variables so the password is not placed in process arguments. It creates a compressed custom archive, validates its catalog with `pg_restore --list`, and writes a SHA-256 sidecar using restrictive permissions. The infrastructure owner must then copy both files to approved encrypted, access-controlled, retention-managed storage.

The output directory must be outside the application checkout, owned by the
backup operator and private (`0700`). A symbolic-link output directory or an
existing directory readable by group/other users is rejected. New archives and
checksums use `0600`, unpredictable exclusive filenames and a restrictive umask.
Failed backups remove only their newly reserved partial files. Database command
failure output is withheld because PostgreSQL diagnostics can contain credentials
or private data; investigate through approved restricted infrastructure logs.
These controls do not encrypt the archive: use an encrypted volume and approved
encrypted off-site storage. Do not loosen permissions or move archives into
`public/` to download them through the website.

## Perform the restore drill

Provision a new empty database whose name begins with `crossly_restore_drill_`. The script never creates, cleans, drops, or deletes the database.

```text
RESTORE_DRILL_DATABASE_URL=<secret-manager injected drill PostgreSQL URL>
RESTORE_CONFIRM_DATABASE_HOST=<exact drill hostname>
RESTORE_CONFIRM_DATABASE_NAME=<exact crossly_restore_drill_... name>
RESTORE_DRILL_BACKUP_FILE=<absolute path to the .dump archive>
npm run ops:restore-drill
```

The command verifies the SHA-256 sidecar, rejects a non-empty target, restores without ownership/privilege statements, and checks for restored application tables plus successful Prisma migration evidence. After evidence is retained, remove the drill database only through the approved infrastructure procedure.

Archive restoration uses a single transaction: a SQL error during `pg_restore`
rolls back changes from that restore rather than leaving a partially restored
schema. Subsequent verification of table/migration counts runs after commit;
a failure in those checks still requires operator investigation. Use a dedicated
drill database with no concurrent writers and sufficient disk/WAL capacity.
The empty-target guard checks user relations, functions, types and custom schemas,
so a database containing only a view, sequence or enum is also rejected.

## Deployment sequence

1. Put risky new capabilities behind disabled configuration and keep live provider adapters fail-closed.
2. Create the verified backup and complete the restore drill.
3. Deploy the new application image while the previous image remains available.
4. Run `npm run db:deploy` once through the controlled release job; never run `prisma db push`.
5. Wait for readiness, then send only limited canary traffic.
6. Run `SMOKE_BASE_URL=https://<production-domain> npm run ops:smoke`.
7. Verify sign-in, one read-only role journey, logs, request IDs, error/latency alerts, scheduler health, and business dashboards.
8. Increase traffic gradually while monitoring database connections, error rate, latency, payment failures, order-state failures, and support impact.
9. Record the final decision and retain release evidence.

## Rollback decision tree

- If deployment fails before a migration is applied, keep or restore the previous application image; do not change the database.
- If a migration is incomplete or failed, stop the rollout and diagnose the exact Prisma/database state. Use `prisma migrate resolve` only after a reviewed corrective decision matches reality.
- If the migration succeeded and remains backward-compatible, return traffic to the previous compatible image or deploy a forward corrective image.
- If data integrity may be damaged, stop writes, preserve logs/evidence, declare an incident, and let the named database owner decide point-in-time recovery or restoration from the verified backup.
- Never improvise reverse SQL, delete migration records, run `prisma db push`, or restore over the live database.

## Post-deployment and hypercare

Repeat smoke checks immediately and after the first traffic increase. Monitor continuously during the approved hypercare window. Confirm scheduled maintenance jobs, backups, customer notifications, payment reconciliation, order transitions, and staff portals. Close the release only after the rollback window and evidence-retention requirements are satisfied.

## External evidence still required

These scripts cannot prove encryption-at-rest, off-site retention, point-in-time recovery, provider SLA, multi-zone availability, network isolation, production permissions, measured RTO/RPO, or staff readiness. The infrastructure owner must supply that evidence before paid launch.
