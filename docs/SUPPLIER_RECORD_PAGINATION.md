# Private supplier-record browsing — 20 October 2026

## Requirements and design

The API specification requires bounded pagination and backward-compatible v1
contracts; the UI/UX design system requires usable mobile staff screens. Supplier
records must remain private, ordered and auditable. This increment adds browsing,
not more purchasing authority or a higher evidence write limit.

Admin supplier records show 20 cards per screen with accessible Previous/Next
links, page/total counts and stable ascending createdAt/id ordering. The page query
accepts one canonical integer from 1 through 10000. Invalid or out-of-range UI
pages return not-found. The maximum supported UI browse window is 200000 records;
orders exceeding it need operational export/review, not unbounded queries.

### Capacity guidance follow-up — 21 October 2026

The add-record form now stops at exactly 100 retained records, matching the server
creation limit (previously the UI offered a form at 100 that could never save).
At or above capacity the page explains that superseded evidence counts and directs
Admin to operations without deleting records or creating duplicate orders. The
shared UI/creation predicate is tested at 0, 99, 100 and 101; mock transaction tests
confirm rejected capacity requests create no record or audit. This does not raise
the cap, change replacement authority, implement larger-order aggregate readiness,
or add a migration. Targeted policy/type/lint checks pass; browser acceptance for
this exact-capacity message has not been rerun in this follow-up.

GET `/api/v1/admin/orders/{orderId}/supplier-records` retains its default first
100 records and existing record fields. Optional `page` selects another 100-record
page. Additive `data.pagination` reports page, pageSize, total and pages. Invalid,
repeated, fractional, signed, exponent or oversized page inputs return 422. Valid
API pages beyond the result return an empty list. Count/list share a RepeatableRead
snapshot. Admin/session/MFA and private no-store behavior remain unchanged.

Pagination is not a cross-request snapshot: concurrent append-only writes may
change totals between visits; createdAt/id tie-breaking stabilizes each query.
Do not interpret navigation as business evidence or a customer-visible event.

## Safety boundaries

The existing 100-record creation/replacement cap remains enforced in server APIs.
Legacy/import fixtures above that cap are browseable, not evidence of permission
to create larger orders. Such orders show no new-record form. The bounded overview
still reads at most 100 records and suppresses guidance counts/readiness if the
total exceeds that. For normal orders, guidance/allocation totals use all records,
not only the current 20-card page. Private supplier details never enter public or
customer list responses. No migrations, finance changes or provider activation.

## Acceptance

Unit tests verify strict page parsing, bounds, offsets and empty/final metadata.
Isolated browser/API tests use a synthetic 101-record legacy order to verify
100+1 API records, empty later page, 422 validation, private cache headers/customer
denial, UI next/final-page navigation, creation-form suppression, 390px layout and
404 beyond the UI results. Existing procurement, correction, dispatch, receipt,
inspection and delivery scenarios must still pass. Keep OpenAPI, type/lint,
schema/security checks and production build current.

## Verification evidence — 20 October 2026

All 33 isolated PostgreSQL/browser tests passed in 111.80 seconds with zero
failures, skips or errors. The 101-record fixture verified 100+1 API retrieval,
empty later API pages, invalid/repeated parameter denial, private no-store/customer
boundaries, UI page 1→2 and final page 6, no creation form above the legacy cap,
mobile overflow and out-of-range not-found. The captured mobile pagination control
was visually reviewed: Previous records and Page 6 of 6 fit without clipping.

Strict parsing/metadata unit tests, existing sourcing/receipt policies, targeted
ESLint, TypeScript, schema validation, security regressions, updated 288-operation
OpenAPI contract and production build passed. HTML/JUnit and screenshot evidence
were exported; disposable schema/containers/network were removed. No new migration,
owner database change or live provider activation was performed. This does not
certify production readiness or resolve the separately recorded runtime/dependency
issues, aggregate summaries for legacy orders, claims or dispatch corrections.
