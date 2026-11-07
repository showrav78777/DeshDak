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
   manager. This adapter does not yet consume new environment switches.
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
