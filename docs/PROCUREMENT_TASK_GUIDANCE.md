# Procurement task guidance — 20 October 2026

## Requirements and design

The UI/UX design system requires clear hierarchy, responsive operations screens
and accessible status feedback. The order/logistics workflow distinguishes supplier
recording, actual purchase, dispatch and physical receiving. The existing generic
supplier-record introduction incorrectly implied that no action on this page could
change an order stage, despite its separate dispatch form.

This display-only increment adds a server-rendered "What to do next" panel to the
Admin supplier-record page. Four numbered steps identify the current procurement
task with `aria-current="step"`; wording states which role acts next. Counts show
active records, dispatches, expected parcels and parcels with receipt-or-later
statuses. Superseded supplier evidence is excluded. No prices or provider data are
added to public/customer views or client props.

Guidance is not authorization and does not enable any transition. Existing APIs,
Admin/MFA restrictions, quantity checks, audit and warehouse assignments remain
authoritative. No new endpoint, schema migration, financial posting or live API.

## Safety and scope

Held orders do not show an active action step. Inactive parcels, missing quantity
coverage and inconsistent dispatch/order stages point to operations review rather
than suggesting invented purchases or receipts. Later stages remain read-only.
The page still displays at most 100 supplier records; an independent total count
now exposes truncation. If the list is incomplete, the panel suppresses counts
and readiness, and warns that the full records need review. Full pagination is
not implemented by this original increment. The later browsing increment in
docs/SUPPLIER_RECORD_PAGINATION.md adds navigation while retaining the bounded
overview warning. Existing mutations still validate complete records on the server.

The panel is a summary of current persisted data, not an immutable audit event,
confirmed inspection or supplier receipt document. Staff must verify real evidence.

## Acceptance and risk review

Unit cases cover Sourcing with missing/complete/overallocated quantities,
Purchased, partial receiving, holds, inactive parcels, superseded evidence,
later stages and truncated lists. The mobile Admin browser scenario must verify
two pending dispatches, one remaining, both expected, then receiving complete;
existing private-data/role checks must still pass. Check 390px layout, semantic
region/current-step markup, schema, lint, TypeScript, API contract and build.
Do not infer completion of production security, live sourcing, supplier claims,
split parcels, dispatch correction or financial cost accounting from this UI pass.

## Verification evidence

The isolated PostgreSQL/browser suite passed all 33 cases in 106.81 seconds with
zero failures, skips or errors. The 390px Admin scenario verifies stage guidance
with two pending dispatches, one remaining, both expected, then receiving recorded
with no active procurement step or dispatch button. Existing role/privacy,
independent correction, receipt/inspection, wallet and delivery checks passed.
Policy unit cases, targeted ESLint, TypeScript, 288-operation API contract,
security regressions, receipt policy and schema validation also passed.

The initial sandboxed build stalled during compilation and was interrupted; only
that task's build process was stopped. The retry with local compiler-worker
permissions completed successfully, including production TypeScript and page
generation. The user's development server was not stopped. HTML/JUnit reports
were exported and disposable test containers/network removed. No owner database
migration or live provider activation was performed. Earlier recorded runtime and
production readiness issues are not certified resolved by this increment.
