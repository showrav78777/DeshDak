# Session authorization hardening — 12 November 2026

The shared session resolver now accepts only ACTIVE, non-deleted accounts with an
owned, unrevoked and unexpired database session. PENDING_VERIFICATION accounts
already could not log in by password, but an existing cookie previously remained
usable if account status changed back to pending. Google callback account checks
now follow the same ACTIVE-only rule and do not silently reactivate a pending user.

Last-seen updates are guarded against expired/revoked sessions and inactive/deleted
accounts. If a heartbeat is needed, identity, roles and MFA are read again after
that write. This prevents a request from authorizing against its earlier snapshot
when the write waits behind session revocation or related account changes. Normal
concurrent heartbeats remain valid. This is not a substitute for row locking and
fresh authorization in consequential business mutations.

Effective roles continue to be derived from database grants and the session portal,
with MFA required for privileged portals. Unknown role codes now fail closed rather
than becoming effective roles implicitly. Identity-role metadata remains available
for the existing portal/MFA flows; JWT role/name claims do not grant privileges.
New supported roles require an explicit reviewed portal mapping in engineering.

No cookie name, signing secret, database schema, token lifetime or public API shape
changed. Active users keep their normal sessions. Login, recovery and public browsing
are separate from the effective privileged role checks. Production provider and
independent security acceptance are still required.

The dedicated test uses actual module code and disposable PostgreSQL. Coverage
includes pending/suspended denial, real private API denial, forged/unknown role
isolation, MFA scope, a snapshot followed by concurrent revocation, role removal,
MFA clearing and expiry during heartbeat updates, plus healthy concurrent refresh.
No owner database or live provider is used. See the SQA runbook for verified results.

## Notification read-state follow-up

The first broad rerun stopped on a mobile unread-counter assertion. The focused
rerun passed without reproducing it. Review found a separate pending-state gap:
read controls cleared their busy state after PATCH confirmation but before the
server-component refresh finished. The controls now track that refresh with a
React transition, keeping the initiating control disabled until fresh UI data
arrives. No artificial delay or higher assertion timeout was added.

The browser regression deliberately holds both the mutation and subsequent RSC
refresh, proving the pending guard covers both phases. Failure diagnostics capture
the database unread count and UI state for future ambiguous refresh failures.
This preserves the existing backend snapshot/arrival isolation rather than forcing
an optimistic zero counter. Final SQA evidence is recorded in the acceptance log.


## Final selected-suite verification — 13 November 2026

All 36 declared suites passed together in a clean disposable database run. The
session tests include actual role/MFA/expiry/revocation changes after the initial
snapshot. The notification browser tests hold refresh responses to verify the pending
state. The SMS review screenshot locator now waits for the Admin workspace and
selects its visible card, avoiding the temporary Suspense fallback copy. These are
explicit readiness conditions; assertion timeouts and retries were not increased.
The schema/server/container were removed and transient Next.js includes cleaned.
No owner database, live provider or production account was used.
