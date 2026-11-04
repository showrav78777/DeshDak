# Restricted-goods screening increment

## Business outcome

Crossly now has an Admin-managed, server-enforced foundation for prohibited and restricted goods. Active rules screen customer sourcing submissions and cart checkout. No code edit is required to create, activate, pause, or archive a rule.

## Implemented scope

- Draft-first rules with unique rule codes, country-route scope, effective windows, keyword phrases, HS-code prefixes, customer-safe messages, legal references, optimistic versions, and immutable audit events. Future-dated rules enter an explicit `SCHEDULED` state and become active only when their window starts.
- Whole-phrase matching avoids simple substring false positives. HS codes are normalized before prefix matching.
- `BLOCK` rules reject the action immediately. `MANUAL_REVIEW` rules retain a review attempt and stop the action until Admin approves or rejects it.
- Ship for Me address issuance is screened before an order, warehouse recipient reference, or operational request is created.
- Initial seller-product approval and later seller product revisions are screened before the listing can become public. A blocked revision remains pending and the currently approved listing remains unchanged.
- Activating, pausing, or archiving a rule atomically rescreens every active product. Matching products are withdrawn from catalog APIs, ordinary/AI search, product and store pages, category counts, sitemap, public product codes, and cart mutations without deleting the product or its history.
- A manual catalog approval is bound to the exact normalized product content and active rule versions. Changed content or policy causes review again. Hard blocks always override prior approval.
- Approval applies only to an exact retry by the same customer with the same route, normalized product input, matched rule set, and rule versions. Product or policy changes invalidate the approval automatically.
- Screening attempts retain outcome evidence without storing another copy of raw product text. Internal criteria and legal references are not returned in customer errors.
- Admin workflow: `/admin/compliance`.
- Dedicated MFA-protected officer workflow: `/compliance`, with Admin-controlled access and no rule-configuration permission. See `docs/COMPLIANCE_PORTAL_INCREMENT.md`.
- Time-window maintenance activates due scheduled rules, pauses expired active or missed scheduled rules, and atomically rescreens active products. Scheduler runs avoid a full catalog scan when no transition is due; Admin can still force a controlled rescreen immediately. Production can call the secret-protected endpoint without exposing the control publicly.
- Mobile-compatible APIs:
  - `GET/POST /api/v1/admin/compliance/rules`
  - `PATCH /api/v1/admin/compliance/rules/{ruleId}`
  - `PATCH /api/v1/admin/compliance/screenings/{screeningId}`
  - `POST /api/v1/admin/compliance/rescreen`
  - `POST /api/v1/internal/maintenance/compliance-catalog` (scheduler-only bearer secret)

## Security and risk controls

- Admin portal RBAC and same-origin mutation protection are enforced server-side.
- Rules are inactive by default and archived rules cannot be reactivated.
- Hard blocks take precedence over previous manual approval.
- Manual decisions require a reason and use optimistic concurrency.
- Screening and decision events are auditable; customer responses reveal only a safe message and opaque screening reference.
- Unavailable or ambiguous products fail closed. No external provider, sanctions service, customs decision, or legal approval is represented as live.

## Verification

`npm run test:restricted-goods` covers Admin RBAC/CSRF, immediate and scheduled rule activation, phrase boundaries, atomic public withdrawal/restoration, hard blocking, manual review, exact approved retry, time-based rule expiry maintenance, sourcing enforcement presence, retained evidence, and response privacy. `npm run test:ship-for-me` verifies that a restricted description cannot issue an address or operational record. `npm run test:seller-product-revisions` verifies that restricted seller content cannot become public or consume the pending revision.

The increment also requires Prisma validation/migration verification, lint, TypeScript, API contract generation, and a production build.

## Remaining launch dependencies

The owner must obtain qualified legal review and authoritative country-specific prohibited/restricted lists, HS classifications, customs guidance, counterfeit/IP rules, update ownership, review SLAs, and escalation procedures. The production operator must schedule `POST /api/v1/internal/maintenance/compliance-catalog` at least hourly with `Authorization: Bearer $MAINTENANCE_JOB_SECRET`, monitor failures, and keep the secret outside source control. Sanctions/AML screening and external regulatory-data feeds remain separate future integrations and must fail closed until contracted and tested.
