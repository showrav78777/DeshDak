# Private photo storage: owner infrastructure prerequisites

Do not enable private identity or inspection uploads yet. The S3 adapter core is
implemented and locally tested, but route/lifecycle integration remains engineering
work recorded in docs/PRIVATE_PHOTO_STORAGE_ADAPTER.md. No production bucket or
AWS resource was provisioned and no credentials are required in chat.

When the integration is ready for staging, your deployment operator must:

1. Create a separate approved private S3 bucket per environment with all four
   Block Public Access controls, bucket-owner-enforced ownership/ACLs disabled,
   versioning, TLS-only access and approved region/data-residency controls.
2. Create the approved KMS encryption key in the same region/account. Record only
   the bucket name, region, account ID and key ARN in controlled deployment
   configuration; actual authentication/encryption secrets belong in the secret
   manager. Production intake/download activation remains unavailable; the optional
   stored-copy rescan configuration is described below.
3. Give the app workload role only the required object PutObject and
   GetObjectVersion/checksum permissions for the private purpose prefixes and the
   corresponding KMS GenerateDataKey/Decrypt permissions. Review exact actions
   against AWS IAM before acceptance. Avoid static AWS credentials in source,
   browsers or image builds. Give exact-version deletion only to a separately
   approved retention/cleanup role; the web role need not delete evidence.
4. Approve retention durations, legal holds, deletion approvals and noncurrent
   version handling with Compliance. Do not attach an arbitrary lifecycle rule
   that deletes identity evidence or makes an object version disappear early.
5. Enable approved object-access auditing, encryption/access monitoring, alerts,
   backups/recovery and operational ownership. Never log document bodies, tokens
   or customer identifiers in storage keys or infrastructure evidence.
6. Supply separate strong application encryption keys for identity and inspection
   through the secret manager. Define rotation/read compatibility and recovery
   before any production records use them.
7. After engineering integration, certify role/owner isolation, denied public
   access, invalid files, scanner outage, version/checksum enforcement, uncertain
   upload recovery, unauthorized downloads, revocation, approved deletion and
   restore behavior. Record reviewed evidence in Admin launch readiness.

No manual editing of application code is requested here. Existing development
upload flags must stay disabled in production. Video, quarantine/orphan handling,
retention and live-service certification are not completed merely by adding keys.

## Durable reservation migration

A durable upload/recovery component is now implemented and tested locally.
Before a later staging/release integration uses it, review and apply migration
`20261106190000_private_photo_upload_ledger` through the normal migration job with
backup/rollback acceptance. It was applied only to disposable test schemas here.
This adds no activation switch; identity/inspection linking, scanning, retention,
Admin recovery controls and delivery are still engineering tasks. Do not delete
uncertain reservations/objects or rotate their encryption keys to clear a warning.

## Record binding migration

A staged existing-record binding component now checks ownership, current sessions,
roles/warehouse assignments, file metadata and scan attestation. Review migration
`20261107110000_private_photo_bindings` through the normal backed-up staging/release
job before it is used. No owner database was migrated here. Do not manually mark
uploads scanned, clear legacy photo data or activate production intake: scanning
attestation, new HTTP intake, object-backed authorized delivery and retention
integration still need engineering and acceptance.


## Original and processed image scan proofs — 7 November 2026

The internal intake component now scans the original and metadata-stripped image
and persists digest-bound proof only after encrypted storage is verified.
Review migration `20261107140000_private_photo_original_scan` with the previous
private-photo migrations in backed-up staging before integration. No owner
migration has been run. Do not backfill or manually mark scan proof fields.

Approve a separate private scanner deployment/token, location, access policy and
retention/logging contract for identity and inspection photos. Do not route these
files to a public/shared website scanner merely because it is available. The
internal client requires HTTPS and digest-bound acknowledgements. There is no
production activation switch yet: authenticated HTTP intake, domain-record
creation, object-backed protected downloads, quarantine/recovery controls and
retention still require engineering and staging acceptance. Existing development
flags stay disabled in production. No AWS account or customer files were used.


## Protected reader component — 7 November 2026

The internal object reader now supports current-role/session/owner checks and
rejects access changes during a storage read. It does not add an activation flag
or replace current download routes. No new credentials or owner migration are
needed for this component. Complete the storage/private-scanner prerequisites
above; routing, quarantine/recovery controls, approved retention/holds and
staging acceptance still require engineering. Do not clear legacy evidence or
manually change reservation status to activate access.


## Admin quarantine — 7 November 2026

After backed-up staging review, deploy migration
`20261107170000_private_photo_quarantine` with the earlier private-photo migrations.
Only disposable test schemas were migrated during development. Admin → System →
Private photo safety lists redacted reservation references and provides an audited
permanent quarantine. Match the reference to your approved incident review, choose
a reason and confirm. A network failure can occur after the block commits: retry
the same request or reload the queue. Do not edit SQL, delete a block or change
storage status to release a file. The block preserves evidence and applies to
linked legacy photos as well as the internal object reader. Unlinked legacy
photos need the separate migration/review workflow. No provider credentials are
needed to quarantine; production object intake/delivery remains disabled.

Approve operational incident handling, retention/holds and a separate reviewed
release/rescan procedure before live use. Release/recovery, deletion and production
routing still need engineering; adding keys or this migration does not finish them.


## Recording quarantine reviews — 7 November 2026

Review and deploy migration `20261107220000_private_photo_quarantine_reviews` in
backed-up staging with the earlier private-photo migrations before using the new
review screen. Only disposable schemas were migrated during development.

In Admin → System → Private photo safety, record the next action or open View
review history. Choose Keep blocked, Rescan required (not performed), or Replacement
photo required. Enter an existing INC/SEC/KYC/OPS case reference and confirm that
the photo stays blocked. Do not enter personal data or secrets. The history page
lists earlier decisions and reviewer names. A stale review requires a reload;
a lost response can be retried with the same decision. Never remove the quarantine
or edit SQL/status to recover a file.

Assign an authorized investigation owner to carry out the required scan or safe
replacement separately. Recording a decision does not perform that work or certify
it. Fresh rescanning, replacement intake, release/recovery and retention policies
still need engineering and approval; no new provider credentials enable them here.

## Controlled stored-copy rescanning — 11 November 2026

This supersedes the earlier statement that all rescanning remains unimplemented.
The controlled Admin stored-copy workflow now exists; production object intake,
delivery routing, release/replacement, retention and video remain unfinished.

Before enabling this optional workflow in staging:

1. Review migration `20261107230000_private_photo_rescans` with all earlier
   private-photo/quarantine/review migrations. Apply through the migration job
   after backup. Development verification uses disposable schemas only.
2. Have Compliance approve the private scanner's processing, data residency,
   logging and retention. Deploy an authenticated HTTPS endpoint separately from
   the public website-image scanner; certify exact-byte digest acknowledgements,
   rejection, outages, fresh signatures and timeouts.
3. Configure `PRIVATE_PHOTO_STORAGE_BUCKET`, `PRIVATE_PHOTO_STORAGE_REGION`,
   `PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER`, `PRIVATE_PHOTO_STORAGE_KMS_KEY_ARN`,
   `PRIVATE_PHOTO_SCANNER_URL` and an independent `PRIVATE_PHOTO_SCANNER_TOKEN`
   through deployment settings/secret management. Preserve the separate existing
   `KYC_DOCUMENT_ENCRYPTION_KEY` and `INSPECTION_EVIDENCE_ENCRYPTION_KEY` with
   reviewed read/rotation compatibility. Never paste secrets into Admin or Git.
4. Use workload identity and narrowly scoped exact-version private-object access.
   This rescan handler does not need S3 write/delete permission. Review required
   `s3:GetObjectVersion` and SSE-KMS permissions against the
   [AWS GetObject documentation](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
   and verify blocked public access and bucket ownership against
   [AWS security guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
   Certify the actual policies with the deployment operator.
5. After staging approval, set `PRIVATE_PHOTO_RESCAN_ENABLED=true`, run production
   configuration checks and redeploy. A green configuration check proves field
   validation only, not provider approval. Keep the flag false otherwise.

In Admin → System → Private photo safety, open a quarantined reference, record
Rescan required with its incident reference, and open review history. Choose Scan
stored copy and confirm. Review the recorded outcome; even a clean result leaves
quarantine in place. The original upload is not rescanned. A lost response must be
retried with the same request or checked in history before any new reviewed
attempt. One attempt is allowed per review, one pending per photo, and five per
photo per rolling day. Never delete a block or alter SQL to release the photo.

See [engineering scope and acceptance](../docs/PRIVATE_PHOTO_RESCAN.md). Account,
scanner and policy setup require your authorized deployment/operator team; missing
routing/recovery/retention code remains engineering work.
