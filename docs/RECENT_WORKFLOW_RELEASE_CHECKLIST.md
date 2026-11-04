# Recent workflow release checklist — 21 October 2026

## Scope

This is a controlled handoff for the recent manual procurement, inbound receipt
and inspection increments, not production approval. No release command was run
against the owner's database while preparing this checklist. Existing launch gates
and the governing business specifications still apply.

## Before deployment

1. Select the intended environment and exact reviewed application revision. Confirm
   database identity through approved tooling without displaying connection secrets.
   Review migration status and all pending migrations, not only the names below.
2. Back up the target and verify the recovery procedure. Agree a maintenance window
   and pause package/import/dispatch/inspection writers. Assign separate named staff
   accounts and MFA-enabled independent Admins; never share an approver account.
3. Review these migration dependencies in order:
   - `20261019090000_manual_supplier_order_records`
   - `20261020090000_supplier_record_corrections`
   - `20261020110000_supplier_inbound_dispatch`
   - `20261020120000_inbound_tracking_case_uniqueness`
   - `20261020130000_inspection_request_identity`
4. Before the tracking uniqueness migration, run `npm run db:tracking:check` on the
   intended target. A conflict or check failure blocks release. Authorized staff
   must investigate original evidence; do not delete parcels or rewrite history.
   A clean preflight does not prove the unique index is installed.
5. Only after deployment approval, apply reviewed migrations with `npm run db:deploy`,
   then `npm run db:generate` and restart using the environment's release procedure.
   Do not use `db push` or a development reset against the target. A rollback must
   retain evidence and integrity constraints; disable affected mutations and escalate
   rather than dropping tables or removing history.

## Staging acceptance before resuming operations

Use explicitly labelled staging fixtures and separate role accounts, not invented
live evidence or payments. Confirm the migration status is clean before testing.

1. Admin records item/quantity coverage; incomplete coverage cannot mark purchased.
   A mistake holds the order; a different eligible Admin may replace supplier text
   only. Original evidence remains, and allocation/financial edits stay blocked.
2. Admin records real test dispatch references. Partial manifests do not mark the
   whole order shipped. Supplier details stay private from customers.
3. Assigned Warehouse staff scan/receive each expected parcel. Duplicate/uncertain
   retries do not create stock twice. Partial arrivals cannot unlock inspection.
4. Assigned Inspector submits a decision with a stable request key. Matching retry
   returns the original decision; altered requests or competing decisions cannot
   overwrite it. Older mobile/API clients must supply trusted Origin and the key.
5. Continue the applicable measurement, quote, shipment and delivery scenario; check
   customer-safe tracking and notifications without exposing supplier identities,
   internal costs or private evidence storage paths. Do not bypass payment gates.
6. Check desktop/mobile task screens, role denials and audit history. Stop release
   on an unexplained state change, duplicate event, privacy leak or failed guard.

## Evidence and limits

The latest disposable run passed 33 browser cases and focused Inspector/Warehouse/
Ship for Me checks. It did not run on the owner's database, prove every historical
record is compatible, or replace staging/device/provider/security acceptance.
HTML/JUnit exports are local artifacts, not permanent release records; archive
approved reports with the release revision in the organization's evidence store.

Source notes: `SUPPLIER_RECORD_REPLACEMENTS.md`, `SUPPLIER_INBOUND_TRACKING.md`,
`INBOUND_TRACKING_INTEGRITY.md`, `WAREHOUSE_RECEIPT_HARDENING.md`,
`SUPPLIER_RECORD_PAGINATION.md` and `INSPECTION_REQUEST_INTEGRITY.md`.
Original-currency costs/FX, private procurement receipts, claims, general allocation
corrections and split/merged parcels remain separate increments. Real providers,
private storage/scanning, production backups/monitoring and security/load approval
remain gated. Development stalls and dependency advisories are not cleared here.
