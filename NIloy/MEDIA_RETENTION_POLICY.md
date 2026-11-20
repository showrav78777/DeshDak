# Private media lifecycle defaults

Selected for the owner's review on 19 November 2026 after authorization to choose
reasonable defaults. These are provisional deployment settings, not a statement
of statutory retention requirements or an implemented deletion service.

## Proposed time limits

- Unbound, abandoned uploads become eligible for review after 24 hours.
- Identity photos become eligible 90 days after a final verification decision.
  Pending reviews and account investigations are excluded.
- Inspection photos/videos become eligible 180 days after delivery and closure of
  every linked claim, refund, dispute or investigation, whichever happens last.
- Incomplete multipart uploads may be aborted after 24 hours. This must not delete
  a completed evidence object or its historical versions.

Eligibility means a review can begin. It does not authorize automatic deletion.
Compliance must check applicable business requirements before enabling a policy.
Keep deletion disabled until the workflow below has been implemented and tested.

## Available Admin controls — 20 November 2026

Apply migration 20261119150000_private_media_lifecycle through the reviewed,
backed-up deployment job before using Admin → Media retention and holds.

1. An administrator with completed MFA can view policy/hold history and place a
   preservation hold on an upload, customer account, order or package reference.
2. An administrator who also holds the Compliance role can record a new policy
   version. Existing versions are immutable; a stale form must be reloaded.
3. A different administrator with the Compliance role and completed MFA can
   release one hold after independent case review. They cannot release their own
   hold. The original hold and release remain in history. Other holds stay active.
4. Use controlled INC/SEC/KYC/OPS case references only. Do not put identity numbers,
   names, phone numbers, credentials or URLs in these fields.
5. On an uncertain response, retry the same request or reload history before
   making another decision. The forms keep the same retry key and payload.

The object-photo scope resolver checks upload, customer-account, order and package
holds together, including photos linked after a broad hold was placed. It returns
up to 100 active blockers; any returned hold prevents future eligibility. It is
not a deletion worker. All media remains retained while deletion is disabled.
A preservation hold does not block authorized viewing; quarantine is the separate
control for blocking unsafe access.

## Remaining implementation and controls

1. Show eligible items, the reason, policy version and related open cases in Admin.
2. Require a Compliance approver distinct from the deletion requester. Recheck holds,
   authorization and subject state immediately before each deletion.
3. Use a separate deletion role and exact bucket, key and version identifiers.
   Preserve minimal audit records without retaining the deleted document content.
4. Account for object versions, backups, replication and failed deletion retries.
   A delete marker alone is not evidence that sensitive bytes were erased.
5. Test held evidence, concurrent case reopening, revoked approval, partial storage
   failure and replay in staging before scheduling any destructive cleanup.

The current app has scanned photo intake, protected delivery, quarantine/review,
versioned retention settings and scoped preservation holds. Deletion eligibility,
independent deletion approvals, legacy-media/video handling and the deletion
worker still require engineering. No automatic cleanup is enabled. Do not
configure a broad S3 expiration rule as a substitute.
