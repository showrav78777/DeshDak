# Private-page cache security increment

Status: implemented and verified against the optimized production server on 7 September 2026.

## Outcome

Crossly's authenticated Admin, customer, seller and operational web pages now carry `Cache-Control: private, no-store, max-age=0, must-revalidate`. Sensitive page responses also remain no-indexed, and the global security policy denies framing.

The protected paths cover Admin, customer dashboard/profile/orders/wallet/cart/checkout/wishlist/notifications/security/returns, seller workspace, Warehouse, Inspector, Logistics, Customer Service, Finance, Compliance, Sourcing, scanning and protected print views.

## Boundary

The policy applies to private HTML pages, not public catalog APIs. Public categories, products, stores and other approved anonymous resources retain their short shared-cache policies. Private APIs continue to set their own explicit no-store headers.

Middleware applies the policy as defense in depth, while `next.config.ts` supplies the final response headers because Next.js development rendering may replace middleware cache headers. The strict assertion is verified against the optimized production server rather than weakened to accept development-only `no-cache` behavior.

## Verification

The launch-readiness runtime test proves the protected report has `private` and `no-store`, `X-Frame-Options: DENY`, and `X-Robots-Tag: noindex`, while a public catalog response remains publicly cacheable. The same test verifies Admin isolation, controlled evidence rendering and environment-secret non-disclosure.
