# Public/customer workflow review, batch 1 — 22 October 2026

## Scope

Governing references: UI/UX Design System, Testing Strategy and RBAC/Security.
This batch adds desktop and Pixel 7 emulation checks for `/forgot-password`,
`/reset-password`, `/verify-email`, `/help`, `/stores` and `/trust`. It is not
acceptance of all 131 pages or every possible state on these six routes.

The recovery request forms could retain a disabled button after fetch/JSON failure
and dereferenced a React event currentTarget after asynchronous work. Forms now
capture the DOM form synchronously, use a per-form pending guard, bound network
requests to 15 seconds, catch errors, and release pending state in finally.
Success is shown only after a valid response; reset uses the captured form.
Confirmation forms and the development verification handoff share bounded response
handling. Fragment tokens remain private to the existing hook and are not logged
or persisted. No backend auth, CAPTCHA, token or session rule is relaxed.

## Acceptance boundaries

- Recovery request tests mock network failure then a generic successful response;
  verify visible error, retry enabled, generic success and input reset. No actual
  email is sent or eligible account disclosed.
- Missing-token reset/verification checks assert visible guidance and no mutation.
  Real valid/expired/replayed token and session-revocation checks belong to the
  existing isolated auth-recovery API gate, not these mocked UI scenarios.
- Help and store searches use real local queries that return no matching fixtures;
  verify useful empty states, query/language preservation and protected-support link.
- Trust navigation reaches its protection section. All added cases check viewport
  fit on desktop and mobile; that alone is not manual visual/accessibility sign-off.

TypeScript, targeted ESLint, security regressions and production build passed before
browser execution. Final browser evidence and any defects found are recorded below.
No migration, owner database mutation, production provider or real email activation.

## Pre-hydration privacy defect found

The first expanded run logged a synthetic correction reason in a native GET query:
the report form submitted before its client handler was ready. The correction and
recovery forms now use POST as native fallback and keep submit disabled until
hydration. With JavaScript disabled, clear guidance is shown and no submission is
offered. Tests inspect the actual server-rendered fallback and guard against a
reason query after reporting. Backend RBAC/MFA and JSON contracts are unchanged.

The observed query used disposable synthetic data. Whether older real sessions
ever submitted sensitive fields this way is unknown. Authorized privacy/operations
staff should assess relevant historical logs, analytics and browser-history exposure
under approved retention/remediation rules; do not automatically rewrite evidence
or claim that historical exposure has been ruled out by this fix.

## Browser evidence

The expanded 53-case run completed 52 cases and timed out in the Admin multi-parcel receipt scenario. Its HTML/JUnit reports remain in `playwright-report-docker/` and `test-results-docker/`. This was not a full green run. The follow-up described in `WAREHOUSE_SCANNER_RECOVERY_REVIEW.md` passed 7 targeted checks, including that Admin scenario, after scanner/receipt safeguards and test fixes. It does not substitute for rerunning the complete suite or reviewing every page.

The subsequent combined 56-case suite passed on 23 October after the separately documented logout transaction correction, including global session cleanup and post-run integrity checks. See `LOGOUT_TRANSACTION_RECOVERY.md` and `playwright-report-full-final/`. This supersedes the combined-run blocker for that configured suite, not the manual all-page review.
