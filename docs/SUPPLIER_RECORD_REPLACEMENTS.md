# Independent supplier-record text correction — 20 October 2026

## Requirements and scope

Governing baseline: database design immutable evidence and sourcing integration
manual-provider normalization. This increment completes correction of supplier
names, references and variant descriptions after a linked Sourcing-stage hold.
It deliberately excludes item, quantity, warehouse, original cost, supplier payment,
refund, inventory and external cancellation changes. Those need separate business
review; do not use a text correction to claim goods or money were recovered.

## Admin workflow

1. Report a mistake under the active record. This puts the whole order on hold.
2. A different MFA-verified Admin opens the held order in Purchases → Supplier
   references & items. Held sourcing orders remain visible in that queue.
   Both the original recorder and hold reporter are blocked from approval.
3. Verify the real supplier confirmation, enter corrected text and a private reason,
   confirm the independent review and approve replacement.
4. One transaction appends a new record, links it to the unchanged original and
   latest hold, writes private audit plus safe customer history/notification, and
   returns the order to Sourcing. It does not mark purchased or verify payment.
5. Superseded records remain visible but do not count toward purchase quantities.
   A later mistake must be reported against the currently active replacement.

Only the latest linked supplier-record hold can be released here. Unrelated,
legacy/unlinked holds, wrong-order records and altered allocations fail closed.
An older hold without a history-linked audit needs operations escalation; this
increment does not manufacture or rewrite historical evidence. A second Admin
account is an operational prerequisite, not an invitation to share credentials.

## Technical controls

POST `/api/v1/admin/orders/{orderId}/supplier-records/{recordId}/correction` requires
Admin authorization, trusted origin, strict text-only body and idempotency key.
Serializable transactions and the order lock prevent concurrent replacements.
Matching retries replay; changed payloads/actors or stale holds conflict. Unique
original/replacement/hold links and database append-only triggers preserve evidence.
Active supplier-reference uniqueness moves from the old all-history unique index
to server validation under the same serializable order lock, allowing a correction
to retain a genuine original external reference. All record creation paths use
this lock. The total retained-record limit remains 100, including superseded rows.

Migration `20261020090000_supplier_record_corrections` is required. Back up and review
before `npm run db:deploy`; regenerate Prisma and restart. No migration is applied
to the owner's database by isolated tests. Do not roll back by deleting evidence;
disable mutation access while retaining records and correction links if needed.

## Acceptance and release gates

Verify independent approval, self-approval rejection, stale hold, foreign record,
forbidden quantity/warehouse fields, retry replay, concurrent/stale requests,
unchanged original and monetary total, single active quantity allocation, immutable
correction links and customer privacy. Test the actual mobile Admin form, browser
network recovery, schema, TypeScript, lint, API contract and production build.
Live suppliers remain disabled. Financial/receipt/inbound/claim work, general
correction of allocation mistakes and production security acceptance remain pending.

## Verification evidence — 20 October 2026

The initial 33-case browser suite passed in 3.0 minutes. The final suite with held
purchase-queue navigation passed all 33 cases in 3.2 minutes, with no skips or
retries. Actual two-Admin MFA sessions verified independent approval, rejection of
self-approval, forbidden quantity changes and stale holds, failed-request recovery,
idempotent replay, conflicting retry denial and mobile overflow. Real PostgreSQL
assertions verified unchanged original evidence, quantity, warehouse and order
total, immutable correction approvals, safe hold/release history and the independent
approver link. The migration applied successfully only in the disposable schema.

Prisma validation, targeted ESLint, TypeScript, supplier/purchase policy tests,
security regressions, 287-operation OpenAPI validation and production build passed.
HTML/JUnit reports were exported before the disposable containers/network were
removed. No deployment or application-database migration was performed. Known
development dependency advisories and previously observed development timing-console
errors remain tracked separately; this is not full production security acceptance.

## Capacity guidance follow-up — 21 October 2026

The replacement form now receives the server-counted retained record total and
shows an operations-review notice instead of an impossible approval at 100 or
more records. It explicitly says to retain evidence and keep the order on hold.
If capacity changes after loading the form, the API's RECORD_LIMIT response is
shown as an actionable hold/escalation message rather than a generic retry error.
Creation and replacement use the same capacity predicate; the limit and independent
approval rules are unchanged. No migration or new hold-release path is introduced.

Mock transaction tests reject replacements at 100 and 101 without a replacement,
correction link, status history or audit, and preserve ON_HOLD and original text.
A replacement at 99 succeeds, and its matching retry still replays after the count
reaches 100. These checks do not replace PostgreSQL concurrency or browser testing.
Targeted policy, TypeScript and lint checks passed. The exact capacity notice has
not yet received a fresh browser acceptance run at that handoff; see the subsequent
verification below.

### Browser acceptance — 21 October 2026

The fresh disposable suite passed all 33 cases in 263.23 seconds, zero failures,
skips or errors. A synthetic 100-record held order verified the visible mobile
capacity notice, absent add/approval buttons, no horizontal overflow and direct
independent-Admin API rejection with RECORD_LIMIT. PostgreSQL assertions confirmed
100 retained records, one unchanged hold history, no correction link and no
replacement audit. Existing below-limit independent correction and complete
warehouse/inspection/delivery checks passed. Focused Inspector, Warehouse and
Ship for Me API regressions also passed. HTML/JUnit reports were exported before
the disposable schemas, containers and network were removed; the owner database
was unchanged. Slow development compilation was still observed and is not cleared
by this passing workflow run.
