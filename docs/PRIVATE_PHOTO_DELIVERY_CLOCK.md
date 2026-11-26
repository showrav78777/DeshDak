# Database time for private file delivery

26 November 2026. Private file reads and account mutation locks previously used
the application host clock for some session-expiry checks. A slow clock could
accept an expired session; a fast clock could deny a valid one.

The shared active-account guard now reads database time after account/session
locks. Protected object delivery checks database time in both authorization
phases, including after subject/assignment lock waits. Future MFA timestamps and
future scan metadata are evaluated against that clock. Final authorization runs
again after storage I/O and before the success audit and file response.

Legacy DB-backed file authorization uses the same active-account guard and a
fresh database-time check after its remaining authorization locks. It rejects
future MFA and preserves the existing role, ownership, warehouse and quarantine
checks. A failed audit or database-clock lookup never permits delivery.

The regression suite shifts the application clock ±24 hours while PostgreSQL
keeps its actual time. It checks valid owner/Compliance reads, expired-session
and future-MFA rejection before storage, expiry during storage, and both object
and legacy authorization. Actual encryption/PostgreSQL are used; storage is
simulated. No production service or customer file is accessed.

No schema, API shape, provider activation or quarantine release changed. The
shared account guard also affects account mutations, so verification uses the
full isolated release suite. This does not implement production video or broader
linked-media cleanup/recovery. Real staging/security/device acceptance remains
separate. Owner procedures stay local-only in the ignored NIloy folder.
