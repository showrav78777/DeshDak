# Procurement save completion — 21 October 2026

## Outcome and boundaries

The UI/UX and RBAC baseline requires clear action outcomes without weakening
server authorization or immutable evidence. Dispatch and independent correction
forms previously cleared request identity and re-enabled submit immediately after
a confirmed save, while `router.refresh()` was still pending. A slow refresh could
therefore offer an obsolete action with a fresh request key.

After a confirmed response with a dispatch/record ID, these two forms now retain
the attempt identity, mark completion synchronously in a ref and in visible state,
disable fields and submission, and announce success with role=status. If refresh
does not complete, the instruction is to reload and review evidence, not repeat
the mutation. Inputs are not reset into a new apparent task.

Network/timeout or malformed-success uncertainty still leaves the matching key
available for an identical retry. Non-success responses do not mark completion.
Server authorization, independent approval, stage guards, capacity rules and
idempotency remain authoritative. No API contract, migration, provider activation,
automatic mutation retry or financial posting is added. Multi-record creation is
not changed in this increment; it requires a distinct refreshed-capacity design.

## Acceptance

Browser tests pause the purchase page's RSC refresh after dispatch and correction
saves. Before releasing it, they verify disabled success buttons and fields plus
the success announcement; existing failed-request retry and server replay/conflict
assertions remain. Run the isolated browser suite, focused role APIs, targeted
lint/TypeScript, procurement policy tests and production build. Record final
results below; these tests do not certify production performance or live providers.

## Verification status — incomplete

Targeted TypeScript, lint, procurement policy tests and production build passed.
Focused Inspector, Warehouse and Ship for Me API regressions passed. The new Admin
delayed-refresh assertions passed in the final browser run, including existing
below-limit independent approval and MFA recovery. Full regression acceptance is
not complete and this increment is not release-approved.

Three browser runs were attempted. The first had 32 passing tests and failed on a
test helper removing interception before a paused route finished (Route already
handled). The helper now waits for active continuations. The second had 32 passes
and an Admin navigation timeout despite a rendered page. That navigation now waits
for DOMContentLoaded and its required controls rather than the global load event.
The third passed the Admin scenario but reached the existing 600-second global
limit: 27 passes, two Inspector failures, one flaky Logistics scenario and three
not run, with runner-level errors. Development cache writes/compaction and slow
rendering were observed; their root cause is not established. No timeout increase
or new automatic retry was introduced.

Final HTML/JUnit failure reports were exported; earlier evidence is retained under
`/private/tmp/duar-save-completion-first-junit.xml` and
`/private/tmp/duar-save-completion-second-results`. Disposable schemas and containers/
network were removed. The owner database was unchanged. Next action is to diagnose
the isolated runtime slowdown and rerun required gates, not activate providers or
claim a clean full-system pass.

## Admin diagnostic follow-up — 21 October 2026

Bounded correction navigation/opening steps and 5-second logout cleanup now keep
cleanup failures from replacing an existing test error. Cleanup still fails the
test if it is the only error. This exposed a strict locator ambiguity: the held
order link matched two retained route trees. The test now selects visible matches
and explicitly requires exactly one, rather than silently taking the first.

The initial diagnostic run had 32 passes and that locator failure. After the
locator fix, the complete Admin scenario passed, including delayed-refresh saves,
independent correction and MFA recovery. The final full run still failed: 31 passed,
one shipment-tracking failure and one flaky customer-profile scenario (6.8 minutes).
A shipment event request and filesystem cache write each took about 4.4 minutes;
the recurring development runtime stall is not resolved. Existing deadlines and
retries were not increased. Focused role APIs, targeted TypeScript/lint and diff
checks passed; no application code or migration changed in this follow-up.

HTML/JUnit reports were exported and temporary schemas/containers/network removed.
The owner's database remains unchanged. The earlier locator failure JUnit is kept
at `/private/tmp/duar-admin-diagnostic-locator-junit.xml`. Full regression approval
remains blocked despite the now-passing Admin scenario.

## Subsequent baseline pass — 22 October 2026

After correcting a read-only layout assertion racing navigation, the full existing
33-case suite passed in 260.68 seconds with zero failures/skips/errors under the
explicit Webpack isolated runtime. Delayed-refresh dispatch/correction, capacity,
independent approval, inspection retry, measurement and delivery assertions passed,
as did focused role APIs and post-browser database integrity checks. Reports were
exported and temporary schemas/containers/network removed; owner data unchanged.
This supersedes the incomplete result for the current increment's existing
workflow suite only. Earlier failures remain recorded; no global Turbopack/runtime
fix, all-page UI review or production acceptance is claimed.
