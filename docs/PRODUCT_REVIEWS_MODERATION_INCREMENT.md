# Product Reviews and Moderation Increment

## Business outcome

Crossly now supports trustworthy product ratings without fabricating social proof. Only the owner of a delivered `OrderItem` can submit one review for that item. Every submission remains private until an administrator publishes it.

## Workflow

1. A customer opens a delivered order and submits a one-to-five rating, optional title, and review text.
2. The server verifies the customer portal, trusted browser origin, order ownership, delivered order status, product/item match, and one-review-per-item rule.
3. The review enters `PENDING_MODERATION`; it does not affect public counts or ratings.
4. Admin reviews it at `/admin/reviews` and may publish or reject it. Rejection requires a reason.
5. A published review may later be removed only with an Admin reason. Every decision is preserved in `ProductReviewModeration` and the security audit log.

## API contract

- `GET /api/v1/catalog/products/{productId}/reviews` is public and returns only published reviews, aggregate count, average rating, and pagination.
- `POST /api/v1/catalog/products/{productId}/reviews` requires an authenticated customer session, trusted origin, and `Idempotency-Key`.
- `PATCH /api/v1/admin/reviews/{reviewId}` requires an Admin session in the Admin portal, trusted origin, a valid state transition, and optimistic version.

Public review responses contain only review content, rating, publication date, verified-purchase status, and the customer's first name. They never return email, phone, address, person code, order number, order-item ID, idempotency data, internal moderation notes, or audit metadata.

The authenticated submission response is also minimized: it returns the submitted rating/title/body, verified-purchase flag, moderation status, and timestamps, but not customer ID, order-item ID, idempotency key, request fingerprint, or moderator identity.

## Integrity and security

- PostgreSQL enforces one review per order item and rating values from one through five.
- Idempotency keys are bound to the authenticated customer, product, item, rating, title, and body.
- Changed-payload key reuse, duplicate reviews, undelivered orders, foreign orders, wrong portals, untrusted origins, stale moderation versions, and invalid moderation transitions fail closed.
- Public product pages and rating aggregates read only `PUBLISHED` rows.
- Rejection/removal reasons stay private to authorized Admin workflows.

## Verification

Run `npm run test:product-reviews`. It covers delivery eligibility, ownership, portal isolation, CSRF, idempotent retry, duplicate prevention, moderation, immutable decision history, public aggregates, product-page rendering, removal, and PII minimization.

## External owner work

The owner must approve the production community-content policy, prohibited-content categories, appeal process, moderation response targets, evidence retention period, and staff training before customer launch. Automated toxicity/spam/media moderation is not represented as live.
