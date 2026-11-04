# Marketing, performance, SEO, and design-system increment

## Business outcome

Crossly should look credible and attractive while remaining fast, accessible, secure, search-friendly, and suitable for global growth. The customer experience must market the platform's real capabilities without promising unmeasured capacity, unavailable integrations, or round-the-clock staffing that has not been contracted.

## Design decision

The storefront uses one coherent hybrid system:

- Accessible minimalism for navigation, search, checkout, account, order, and operations workflows.
- Bento-grid composition for marketing hierarchy and responsive discovery.
- Soft clay/neomorphic depth for selected non-critical cards.
- Restrained glass treatment only on controlled dark/gradient surfaces with sufficient contrast.
- Motion is optional, short, and disabled by `prefers-reduced-motion`.

Maximalism, brutalism, heavy skeuomorphism, and liquid-glass effects are not mixed throughout the application. Those treatments would reduce consistency, legibility, runtime performance, and customer trust if applied indiscriminately.

## Delivered locally

- Marketing-oriented Bento section connecting search, Bangladesh stores, tracking, support, and trust.
- Responsive visual tokens with restrained gradients/depth, keyboard focus visibility, reduced-motion behavior, and mobile layouts.
- Expanded global search and sharing metadata.
- Search-engine robots rules that keep private portals and APIs out of public crawling.
- Response-level `X-Robots-Tag` protection for private account, authentication, payment, operations, support, scanning, printing, and API routes; public products, stores, seller application, homepage, and Trust Centre remain indexable.
- A database-backed sitemap for approved public products, categories, and Bangladesh stores.
- Safe `WebSite` JSON-LD describing Crossly and the existing unified public product-search URL, without fabricated reviews, ratings, offers, addresses, or organization claims.
- Dedicated titles, descriptions, canonical URLs, and social-sharing metadata for the Product Catalog, Bangladesh Store directory, store profiles, Trust Centre, Help Centre, and published help articles.
- Active category pages use category-specific indexable metadata and canonical URLs that match their sitemap entries. Free-text searches and unavailable categories remain no-index and canonicalize to the stable Product Catalog.
- Approved product pages receive product-specific titles, safe descriptions, canonical URLs, and sharing metadata. Unavailable or non-public products return no-index metadata, and React request memoization prevents the metadata and page render from duplicating the product database query.
- Clear infrastructure/security/support dependencies recorded in `idea.txt`.

## Production dependencies

The owner must supply the final HTTPS domain and `APP_BASE_URL`, hosting/CDN/WAF provider, capacity and SLO targets, managed database/cache/queue/object-storage choices, licensed brand/media assets, analytics and consent decisions, support staffing, and external security testing. Capacity claims must be based on measured load and soak tests.

## Acceptance criteria

- Public storefront content is crawlable; private operational and account routes are excluded from robots guidance and from the sitemap.
- Sitemap entries include only active public records and do not expose internal source identities.
- The homepage remains usable on mobile, with keyboard focus and reduced-motion support.
- Decorative effects do not block core content, require JavaScript, or expose private data.
- Production-only claims remain gated until measured or contracted.
