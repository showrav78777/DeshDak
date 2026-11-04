# Isolated runtime comparison — 21 October 2026

## Scope and controls

The prior Turbopack run hit the unchanged 600-second browser deadline after long
cache writes/compaction and unrelated Inspector/Logistics timeouts. This experiment
compares the supported Next development Webpack runtime, not production load.
Binding references: Testing Strategy and DevOps/Cloud specifications; local Next
Turbopack reference documents `next dev --webpack` as supported.

`ISOLATED_TEST_BUNDLER=webpack` selects that runtime in the isolated runner and
Compose test environment only. The default remains Turbopack. Only the two exact
values `turbopack` and `webpack` are accepted, before opening Prisma connections
or creating a schema; no arbitrary flags are interpolated. Port/local-database
guards, API/browser isolation, assertions, worker count, timeouts and retries are
unchanged. No application runtime, production compiler or business rules change.

Reproduce the diagnostic against the disposable Compose database only:

```sh
node scripts/verify-isolated-dev-arguments.mjs
ISOLATED_TEST_BUNDLER=webpack docker compose -f compose.e2e.yml up --build --abort-on-container-exit --exit-code-from browser
```

Export reports before `docker compose -f compose.e2e.yml down`. These commands
do not migrate the owner's database or activate external providers.

## Result and interpretation

The focused Inspector, Warehouse and Ship for Me API checks passed. Browser results
were 32 passing and one Admin scenario timeout (6.3 minutes overall). This is a
failed gate, not a fix or release approval. Webpack did not reproduce the later
Inspector failures in this run, but the Admin correction/navigation stall remains
and switching bundlers is not a sufficient remedy. One run per runtime does not
establish causation or reliable performance.

A Webpack container snapshot reported 3,332,071,424 bytes memory.current,
memory.max=max, zero recorded OOM/kill events and zero cgroup CPU throttling.
These are instantaneous/container counters, not peak memory, host pressure data
or proof that resources never constrained the run. No memory-limit increase,
timeout increase, automatic retry increase or global cache override was applied.

HTML/JUnit evidence is exported locally under `playwright-report-webpack-diagnostic`
and `test-results-webpack-diagnostic`. Temporary schemas, containers and network
were removed. Argument tests, targeted lint and whitespace checks passed. No new
production build was needed for this test-runner-only increment; the preceding
application build passed. Full browser verification remains incomplete.

Next: isolate the Admin correction/navigation step and ensure cleanup errors do
not obscure its original timeout location. Keep runtime and test-harness hypotheses
separate; do not raise deadlines or classify the application production-ready.

## Follow-up — 22 October 2026

With visible held-order link scoping and a navigation-safe read-only layout check,
the existing 33-case browser suite passed in 260.68 seconds, no failures/skips/errors,
using the explicit Webpack option. Focused role APIs and database postconditions
passed. The previous comparison's sole failure was execution-context replacement
during a layout read, not measured horizontal overflow. Normal defaults remain
unchanged; this successful run does not establish the cause of prior cache stalls
or make Webpack a proven production/performance remedy. See
`PAGE_WORKFLOW_ACCEPTANCE.md` for the separate outstanding page-by-page review.
