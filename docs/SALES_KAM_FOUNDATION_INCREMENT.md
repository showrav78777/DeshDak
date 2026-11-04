# Sales and Key Account Management foundation

Status: implemented and locally verified on 12 September 2026.

## Delivered scope

Administrators can grant and revoke the KAM role and manage Business customer assignments at `/admin/sales`. Creating an account requires an existing active customer whose account type is Business and an existing active KAM. Reassignment deactivates the previous primary assignment without deleting its history.

Customer registration now explicitly supports Personal and Business accounts. Every customer keeps the common `customer_personal` access role so established shopping, order, wallet and account journeys continue to work; Business customers additionally receive `customer_business` for KAM segmentation. Changing account type through the protected profile API synchronizes those roles transactionally.

KAM staff use the separate `/sales/login` portal. `/sales` contains only actively assigned accounts, and `/sales/accounts/{accountId}` provides the documented basic Account 360 view: customer contact details, recent orders, sourcing requests, support history and relationship activities. It deliberately excludes supplier costs, margins, payment credentials, credit decisions and unrelated customers.

KAMs can record calls, meetings, emails, notes and follow-ups. Activities are immutable, carry generated `ACT-` identifiers, require UUID idempotency keys and may link only to a sourcing request owned by the same Business customer. Role changes, assignments and activities create audit evidence. KAM revocation also deactivates assignments and revokes active Sales sessions.

The V1 opportunity pipeline is available through the versioned Sales API. An assigned KAM can create an `OPP-` opportunity for an assigned account, optionally link one RFQ owned by that account, record an estimated public selling value and advance it through Discovery, Qualified, Quoted, Negotiation, Won or Lost. Creation and stage changes are payload-bound and idempotent, stage updates use optimistic versions, history is database-immutable, and terminal opportunities cannot be reopened by a KAM. Won requires a linked RFQ that has converted to an order.

## Verification

`npm run test:sales-kam` verifies Business-only enrollment, Admin assignment, row-level portfolio isolation, sourcing-request ownership, idempotent activity and opportunities, optimistic versions, conversion and terminal guards, immutable history, portal rendering, role/session revocation and audit evidence. `npm run test:customer-account` additionally verifies that Business classification preserves common customer access. The latest migration is `20260910120000_sales_opportunity_pipeline`; the complete versioned API contract now contains 266 operations.

## Later documented phases

Sales Manager team hierarchy, computed health scoring, inactivity and invoice alerts, special price lists, credit terms, Finance maker/checker approval and margin-permissioned reporting are deferred beyond V1. Their business rules, financial authority, thresholds and retention requirements must be approved before those higher-risk phases are implemented. The owner must also approve the initial pipeline stage names before production; changing stage semantics requires a reviewed migration, not silent reinterpretation.
