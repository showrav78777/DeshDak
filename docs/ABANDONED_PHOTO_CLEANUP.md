# Internal abandoned identity-photo cleanup worker

Implemented for local verification on 24 November 2026. No production runtime,
HTTP execution endpoint, scheduler, activation setting or automatic job connects
to this module. Its constructor defaults to disabled. Review approval alone
never runs it. Tests enable it only with simulated storage.

## Supported scope

Only an unbound, stored identity upload can qualify. It must have no submission
scope, document/evidence link, quarantine or lease. The owner must be an active,
personal customer with exactly the personal-customer role and KYC not required.
The recorded policy/review must be current, independently approved, unexpired,
and bound to unchanged upload/reference metadata and storage namespace.

Owners with wallet, order, identity, inspection, sourcing, shipment-request,
case, business or other non-whitelisted domain history are rejected even if the
metadata preview permits human review. Only ordinary sessions, addresses,
uploads, audit/notification/security records, events, carts and wishlist activity
are whitelisted. New list relations default to rejection; schema changes must
also reassess one-to-one relations and foreign-key assumptions.

Linked identity, inspection media, transactional accounts, legacy ciphertext,
replicas/backups and complete erasure are outside this initial worker.

## Durable two-phase execution

1. An explicit confirmed internal call needs a current Admin/Compliance session
   with MFA and an executor different from the review requester. Current requester
   and reviewer authority is rechecked. An immutable attempt and reservation audit
   commit before any storage call. Request and upload references are unique.
2. A second transaction repeats the authority, scope, policy, hold, metadata,
   expiry and namespace checks. It serializes preservation controls and locks the
   relevant users, roles, session and upload. Immediate User FKs fence new customer
   context while the restricted no-domain-history rule is checked. Existing role
   rows/definitions and the upload cannot change during storage work.
3. Only that first, still-valid attempt can dispatch remove(). The two-minute
   dispatch deadline and session/review must leave at least 60 seconds. Preflight
   must finish within 30 seconds. The 120-second transaction budget exceeds the
   trusted store's four bounded 12-second operations; do not race a timer against
   storage and release its database fences while the request can still execute.
4. A matching version-absence receipt, observation, upload tombstone and audit
   commit atomically. The tombstone clears stored/prepared references, ciphertext,
   submission scope, scan proof and lease fields. It preserves minimal identifiers
   and the private journal, not document contents.

See [PostgreSQL row locking](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS)
for the lock compatibility model. Local integration tests observe an actual
pending case INSERT waiting in PostgreSQL until the worker releases the parent
row. This relies on the current immediate foreign keys and conservative scope;
it is not a generic guard for arbitrary future case/relationship schemas.

## Uncertainty and recovery

PENDING means an attempt was reserved but its final outcome is unconfirmed.
BLOCKED and UNCERTAIN preserve the attempt; VERSION_ABSENT is terminal. At most
ten immutable observations are allowed. Replaying execute returns journal state
and NEVER sends another DELETE, including after a process or database failure.

Explicit reconcile performs only confirmRemoval(), rechecks live authorization
and current eligibility, and can record version absence without resending DELETE.
If the version remains present, authority/holds/context changed, or the original
review expired, it stays uncertain/blocked for controlled investigation. This
module does not force recovery or manufacture a successful outcome.

A journal fences intake retries and direct document linking from reservation
onward. A confirmed removed-upload tombstone cannot be restored or edited. New
uploads need their own identifiers. An audit failure after storage success rolls
back the observation/tombstone while retaining the precommitted attempt, so the
next action is read-only reconciliation, not another deletion.

A late hold cannot undo a request already dispatched to storage. Crash/revocation,
backup/restore and incident recovery must be certified in staging before any live
connection. Version absence is not proof of complete erasure or absence of other
versions, provider logs, replicas or backups. Journal metadata needs its separately
approved retention policy.

## Operations and verification

Admin → Media retention and holds → Independent deletion reviews displays a
bounded, redacted journal summary. It has no execute/retry-deletion button. Apply
reviewed migration 20261124190000_abandoned_photo_cleanup through the normal
backed-up staging/release job before deploying this version. No owner database
has been migrated during development.

The workflow suite uses disposable PostgreSQL, actual SQL constraints/locks and
simulated storage. It covers durable ordering, duplicate calls, role/MFA/scope and
TTL guards, state changes between phases, immutable observations/tombstones,
reservation/audit faults, uncertainty reconciliation, intake/link fences and
responsive redacted history. Actual storage protocol tests remain separate.
Independent production security, real storage/IAM, failure/restore/load and device
acceptance, broader media scope and production service wiring remain unfinished.


## Combined SDK/database acceptance — 24 November 2026

The worker suite now also connects the actual S3 SDK and photo-store implementation
to a loopback-only synthetic HTTP service while using disposable PostgreSQL. Seven
scenarios cover normal removal, a lost acknowledgement, a storage legal hold, a
checksum mismatch, bucket-access denial after removal, audit failure after removal,
and preservation of a newer version at the same key. The simulator verifies signed
requests, expected owner, conditional exact-version deletion and the committed
reservation audit before DELETE. Replays/reconciliation must not repeat DELETE;
object retention/absence must agree with the database journal and tombstone.

The targeted worker suite, including its existing authorization, concurrency and
responsive Admin checks, passed. This increment changes verification and corrects
the storage protocol documentation; production application behavior is unchanged.
It does not replace real S3/KMS/IAM, staging failure/restore/load, independent
security or device acceptance. See
verification/20261124-cleanup-sdk-database.json.
