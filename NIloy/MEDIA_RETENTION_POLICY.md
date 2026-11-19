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

## Required implementation and controls

1. Persist configurable durations and policy versions in protected Admin settings.
2. Support legal holds on evidence and its related account, package and order.
   A hold overrides every retention deadline and storage lifecycle rule.
3. Show eligible items, the reason, policy version and related open cases in Admin.
4. Require a Compliance approver distinct from the requester. Recheck holds,
   authorization and subject state immediately before each deletion.
5. Use a separate deletion role and exact bucket, key and version identifiers.
   Preserve minimal audit records without retaining the deleted document content.
6. Account for object versions, backups, replication and failed deletion retries.
   A delete marker alone is not evidence that sensitive bytes were erased.
7. Test held evidence, concurrent case reopening, revoked approval, partial storage
   failure and replay in staging before scheduling any destructive cleanup.

The current app has scanned photo intake, protected delivery and quarantine/review
controls. The lifecycle settings, approval workflow and deletion worker above still
require engineering. Do not configure a broad S3 expiration rule as a substitute.
