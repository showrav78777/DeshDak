# Warehouse scan-to-receipt review — 22 October 2026

## Scope and governing requirements

References: Order & Logistics Workflow, RBAC & Security, Testing Strategy, and the local development process. Physical arrival must be confirmed by assigned warehouse staff, never inferred from supplier dispatch. Inspection waits for all expected parcels. API authorization, idempotency, event history, and customer-safe timelines remain unchanged.

The preceding 53-case run completed 52 cases but timed out waiting for a warehouse receipt POST inside the Admin multi-parcel scenario. Its report did not identify the exact cause of that missing request. This increment fixes two independently visible client-code defects in the affected path, without declaring either the sole proven cause of that prior timeout:

- Receipt submission had no pre-hydration guard or safe native form method. It now stays disabled until the handler is ready, uses POST as fallback, and explains disabled-JavaScript behavior. The existing bounded, idempotent receipt request is retained.
- The shared staff scanner did not catch network/JSON failures, leaving the action stuck. Lookup now has a 15-second deadline, same-origin credentials, redirect rejection, a concurrent-request guard, visible errors, and retry availability. Navigation is restricted to the current portal path. Camera streams stop on failure.

No database migration, permission change, real payment, live supplier call, or owner-data mutation is included.

## Regression checks

- Admin scenario checks receipt fallback with JavaScript disabled, then physically confirms each of two synthetic supplier parcels and verifies customer-safe status progression. Receipt response waits are bounded and named for clearer diagnosis; mutations are not automatically retried.
- Three staff scanner cases cover aborted network, malformed JSON, rejected external navigation, and disabled-JavaScript fallback.
- The isolated browser wrapper accepts `E2E_GREP` for targeted diagnostics. Filtered runs are not full-suite acceptance. Fresh-schema and post-run integrity checks remain in place; CI snapshot-update restrictions are unchanged.

## Evidence

Targeted ESLint, TypeScript, the existing redirect/forwarded-IP security regression check, and production build passed. The final isolated Webpack browser run passed all 7 selected cases (3 setup checks, the Admin scenario, and 3 scanner recovery scenarios), with no retries. Both parcels were received; post-run database checks passed for immutable dispatches, receipt/history counts, private supplier evidence, unchanged totals, independent correction approval, capacity rejection, and session-state cleanup. The isolated schema was removed. HTML/JUnit evidence is in `playwright-report-admin-scanner/` and `test-results-admin-scanner/`.

Two intermediate runs failed on the new fallback explanation and a strict selector matching a hidden retained Admin tree; both were corrected before the final pass. The previously timing-out scenario now completes, but this does not prove a single exclusive cause for its historical failure. The final run also logged a React hydration attribute warning when a native correction `<details>` was opened before hydration; that warning remains to inspect and is not represented as resolved by the barcode/scanner work.

Physical cameras, thermal printers, mobile devices, all-page review, production penetration/load testing, and provider activation are outside this increment. The 7-case filtered run does not replace the full browser suite or page-by-page acceptance.

The test-image dependency installation reported five high-severity audit findings. They require dependency-specific triage; no force-upgrade or claim of production security clearance is made here.

## Follow-up: correction disclosure hydration

The native summary could toggle `open` before React attached, producing an attribute mismatch. `SupplierRecordCorrection` now shares `useClientReady` and marks its disclosure inert until ready. The pending/no-JavaScript explanation sits outside the inert subtree and remains readable. Native disclosure behavior resumes after hydration. POST fallback, disabled submission, private reasons, API authorization/MFA, and independent-review rules are unchanged. No warning suppression was added.

The no-JavaScript case now verifies the inert attribute, visible guidance, an attempted pointer interaction that does not open the disclosure, and disabled submit. The hydrated path verifies removal of inert, normal correction reporting, failed-request recovery and successful independent replacement. The Admin-page console listener asserts no hydration warnings during the scenario.

Verification: targeted ESLint, TypeScript, redirect/forwarded-IP security regressions and production build passed. The isolated Admin run passed all 4 selected cases (3 setup checks and the Admin end-to-end scenario), no retries, with post-run integrity/session checks and schema removal. Reports: `playwright-report-correction-hydration/` and `test-results-correction-hydration/`. This closes the observed correction disclosure warning in this tested path, not every potential application hydration issue.

Read-only npm audit follow-up: the five high alerts are package-chain effects of `braces` stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm through `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, and `eslint-config-next`. `npm ls` places this chain under lint tooling; `npm audit --omit=dev --json` reports zero findings, and the production-only dependency tree does not include those three transitive packages. This is not proof of overall production security. The full audit remains nonzero; npm suggests a major downgrade of the Next ESLint configuration, which was not applied. Tooling remediation still requires a compatible reviewed fix. No dependencies or lockfiles changed in this follow-up.
