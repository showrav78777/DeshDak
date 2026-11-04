# Catalog market-priority increment

Crossly now applies the owner-approved customer market policy in the shared backend catalog:

- A customer whose confirmed residence country is Bangladesh receives global-origin products first, followed by Bangladesh-origin products.
- A customer in another country receives products originating in that same country first, followed by the global catalog.
- Anonymous discovery uses Bangladesh as the safe first-launch default. Public API clients may send a two-letter `marketCountry`; an authenticated customer's stored country always takes precedence.

The policy changes ranking, never product moderation or visibility. Products must still be active, compliance-clear, in an active category, and attached to an approved seller where applicable. A preferred product is not automatically deliverable: checkout separately enforces active lanes, payments, FX, compliance, warehouse/carrier readiness, and international availability.

Normal catalog browsing uses the market cohort as its primary ordering rule and preserves deterministic newest-first ordering within each cohort. Text and AI-assisted search preserve relevance first, then use market preference to break comparable scores so an exact product-name match is not buried. The catalog and search APIs return `marketCountry` and `rankingPolicy` metadata for future Flutter clients.

Authenticated responses are private and not shared-cacheable because their ordering is personalized. Anonymous country-specific responses remain cacheable by their complete URL.

Run `npm run test:catalog-market-ranking` for the pure policy regression checks. Database-backed page ordering remains covered by the catalog/API production and workflow gates once PostgreSQL is running.
