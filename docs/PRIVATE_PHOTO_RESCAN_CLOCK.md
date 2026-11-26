# Private photo rescan time authority


## Database clock controls — 26 November 2026

Private-photo Admin authorization now uses database time for session expiry and
rejects MFA timestamps in the future. Rescan quota windows, attempt deadlines,
pending/expired replays and review-history state also use the database clock.
CLEAN completion validates proof time against a fresh database reading after the
provider work and authority/context recheck. No quarantine is released.

A scanner adapter timestamp that is skewed or stale is unconfirmed, not silently
replaced with a successful proof. The clock-drift tests separately supply
database-valid proof timestamps to test the completion gate, and verify that the
normal host-stamped adapter fails closed under ±24-hour skew. Actual service
clock synchronization and real provider acceptance remain staging requirements.

No schema, API shape, runtime activation, video processing or deletion behavior
changed. The internal DTO receives explicit database time. No live service or
customer file is used by these isolated tests.
