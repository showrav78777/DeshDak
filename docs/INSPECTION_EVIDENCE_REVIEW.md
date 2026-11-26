# Evidence under safety review

24 November 2026. Quarantined evidence was blocked from delivery but could still
be selected for a new inspection. The inspection API now rejects a linked upload
that is quarantined, cleanup-fenced, non-stored or has the wrong purpose. This
also applies to a BASIC decision that supplies an evidence reference.

The check runs inside the existing serializable inspection transaction, with
shared evidence/upload row locks. Rejection rolls back package/order/event and
inspection changes. A separate redacted denial audit is recorded before the API
returns EVIDENCE_UNDER_REVIEW (409). An audit failure cannot permit approval.
Existing idempotent inspection results remain historical records; replay does
not create a new decision or release quarantine.

The assigned-staff evidence list adds availableForInspection. The selector marks
unavailable evidence as under safety review, omits its view link and disables
attachment. Server enforcement applies even when a caller bypasses the UI. This
list is descriptive; a later mutation must still repeat the transaction checks.
No content, storage identifiers or quarantine case details are exposed.

No schema migration, retention deletion or quarantine release was added. This
change does not provide production video processing or certify live services.
Broader linked-media lifecycle/recovery and independent staging/security/device
acceptance remain open. The ignored NIloy folder retains local owner procedures.


Verification ran on 24 November: all 115 gates passed in 7.3 minutes with zero
audit findings, followed by the production build. Handoff recorded 26 November.
See verification/20261126-inspection-evidence-review.json for the exact source
hashes and limits. No fresh 26 November audit or live acceptance is claimed.
