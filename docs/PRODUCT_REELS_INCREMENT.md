# Product Reels increment

Status: implemented and locally verified on 9 September 2026.

## Delivered workflow

Public visitors can browse a vertical product-video feed without signing in. The feed supports watch/completion measurement, share and product navigation; signed-in customers can like, save and submit comments. Buy Now uses the existing protected cart rather than creating a second checkout path.

Approved Bangladesh sellers can create, edit, submit and archive Reels from `/seller/reels`. A Reel must belong to that seller, link to an active compliance-cleared product, and use a video that has completed media security review. Administrators moderate submitted Reels and comments at `/admin/reels`, including removal of published comments with a recorded reason. All moderation mutations use role/portal checks, trusted-origin enforcement, optimistic concurrency and audit logs.

## API and data contract

Migration `20260909070000_product_reels_v1` adds stable Reel identifiers and normalized Reel, engagement, reaction and comment records. Ten versioned API operations cover the public feed, engagement, reactions, comments, seller management and Admin moderation. The public DTO excludes storage keys, user identifiers, source-provider details and internal pricing data, preserving the backend contract for the future Flutter clients.

## Ranking and abuse controls

Ranking v1 weights completion, watch quality, engagement, product affinity, freshness and deterministic exploration. A newly approved Reel with fewer than ten views receives a bounded initial-distribution boost that fades to zero within 24 hours, so it can collect real quality signals instead of being permanently hidden by established content. Raw views have only a small logarithmic influence, so a large low-quality view count cannot dominate. Engagement writes are rate-limited and UUID-idempotent; likes and saves are unique per customer; anonymous association is consent-gated; comments remain private until moderation.

## Verification evidence

`npm run test:reels` passed seller ownership, scanned-video eligibility, state transitions, public privacy, ranking quality, idempotent counters, authenticated reactions, comment moderation, page rendering and audit evidence. Lint, TypeScript, security regressions, Admin-shell verification, production configuration, the 255-operation OpenAPI contract, clean 55-migration reconstruction and the optimized 155-page webpack build also pass.

## External production work

The code does not pretend to provide media infrastructure. Before enabling real videos, the owner must provision private object storage, signed multipart uploads, content-signature/MIME/size validation, malware scanning, metadata removal, transcoding, thumbnails, CDN delivery, deletion/retention rules and an HTTPS `PUBLIC_MEDIA_BASE_URL`. Production-like load/soak testing, moderation staffing, copyright/content rules, abuse response, accessibility acceptance, analytics consent review, ranking monitoring and A/B guardrails also require real infrastructure, policy and people. Advanced ML ranking must wait for enough consented production evidence; ranking v1 remains deterministic and inspectable.
