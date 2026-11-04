# Admin-Managed Help Centre Increment

## Outcome

Crossly now has a public, searchable Help Centre backed by protected Admin content management. The owner can create categories and bilingual guidance in the browser without editing application code. Anonymous visitors, signed-in website customers, and future Flutter clients can read only approved, published content.

## Web workflows

- Public Help Centre and search: `/help`
- Published article: `/help/{slug}`
- Admin content management: `/admin/help`

The public store header, authenticated customer navigation, Admin control centre, customer Support page, robots policy, and XML sitemap now include the Help Centre where relevant.

## Content lifecycle

1. Admin creates a category. It starts private.
2. Admin creates an English article with optional Bangla localization. It always starts as a private draft.
3. Admin reviews and activates the category.
4. Admin publishes the article. Only a published article in an active category can appear publicly or be featured.
5. Admin may return published guidance to draft while revising it.
6. Admin may archive obsolete guidance. Archiving is permanent; revised guidance must be created as a new draft so historical content cannot be silently rewritten.

Category and article URL slugs are stable and cannot be edited after creation. Optimistic version checks prevent one Admin session from overwriting another session's changes. Every creation, edit, publication state change, and archive is audited without copying the complete article body into the audit log.

## Security and privacy

- Admin mutations require the Admin role in the Admin portal and a trusted same-origin browser request.
- Drafts, archived articles, private categories, staff identities, audit data, and internal identifiers are never returned by public endpoints.
- Article bodies are stored and rendered as plain text. React output encoding prevents stored markup from becoming executable HTML.
- Content validation limits titles, summaries, body length, keywords, stable slugs, and sort order.
- No customer data, credentials, provider identities, raw integration details, private costs, or unsupported legal promises should be entered into public guidance.

## API contract

Public, mobile-safe endpoints:

- `GET /api/v1/help/categories`
- `GET /api/v1/help/articles?q=&category=&locale=&limit=&offset=`
- `GET /api/v1/help/articles/{slug}`

Protected Admin endpoints:

- `GET/POST /api/v1/admin/help/categories`
- `PATCH /api/v1/admin/help/categories/{categoryId}`
- `GET/POST /api/v1/admin/help/articles`
- `PATCH /api/v1/admin/help/articles/{articleId}`

Public list responses support bounded pagination and return only approved content fields. Response caches are public and short-lived; Admin responses are private and uncached.

## Verification

`npm run test:help-centre` verifies:

- Admin role, portal, and trusted-origin enforcement;
- draft and private-category isolation;
- active-category publication requirement;
- optimistic concurrency conflicts;
- bilingual public search and detail pages;
- public staff-data minimization;
- safe stored plain-text rendering;
- permanent archive behavior;
- audit evidence and Admin/public page rendering.

## Production follow-up

The owner must appoint content owners and reviewers, supply approved English and Bangla guidance, approve legal/policy wording, define review/expiry frequency, and establish an urgent correction and archive process. Search relevance, zero-result queries, article helpfulness, and support-ticket deflection should be measured only after analytics consent and privacy rules are approved. At much larger content volume, benchmark PostgreSQL full-text/trigram indexing and add it through a reviewed migration before claiming a specific search-latency target.
