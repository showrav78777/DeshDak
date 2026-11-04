# Basic coupon and promotion increment

## Delivered scope

Crossly now implements the Phase 1–2 coupon foundation defined by the binding Marketing & Promotions specification:

- Admin creates coupon drafts from `/admin/coupons`; no code edit is required.
- Percentage and fixed-BDT product discounts are supported.
- Minimum product total, optional maximum discount, global usage, per-customer usage, daily usage, account-type eligibility, first-order eligibility, and validity windows are enforced by the server.
- Draft, paused, expired, not-yet-started, ineligible, exhausted, and invalid coupons fail closed at checkout.
- Activation, pause, and permanent expiry are Admin-only, version-checked, and audited.
- Coupon code, name, rule version, type/value, eligible subtotal, and discount amount are snapshotted in an immutable redemption record attached to the order.
- `productTotal`, `discountTotal`, and `grandTotal` are stored separately. Payment uses the discounted `grandTotal`; existing refunds proportionally net `discountTotal` and never reissue a coupon.
- Coupon claims are serialized with a PostgreSQL transaction advisory lock, so simultaneous checkouts cannot bypass global, daily, or customer limits.
- Checkout idempotency is payload-bound with a SHA-256 fingerprint. An identical retry replays the same order; a changed address, lane, cart, or coupon with the same key is rejected.
- Admin creates automatic cart rules at `/admin/promotions`; they use the same validity, account, first-order, minimum, cap, and usage-limit controls.
- When multiple automatic rules are eligible, the engine applies exactly one: the rule producing the largest customer saving. Priority resolves equal-value ties deterministically.
- A coupon and automatic promotion stack only when both immutable rules explicitly permit stacking. Otherwise the larger discount wins; an unused coupon is not consumed.
- Automatic applications preserve immutable rule name, customer message, type/value, eligible subtotal, rule version, and discount amount on the order.

## Deliberately deferred

Product/category targeting, shipping-only discounts, stacking between multiple automatic promotions, advanced audience segments, campaign scheduling, external-channel delivery, A/B testing, referral/loyalty, payment-method targeting, device/payment-link fraud correlation, and margin reporting remain later-phase work. Consent-controlled in-app campaign delivery is implemented separately. Loyalty and referrals are explicitly out of scope for v1 in the master architecture.

## Operational rules

1. Create a draft and review all financial rules before activation. Rule fields are intentionally immutable in this increment; create a replacement coupon instead of changing historical meaning.
2. Pausing stops new redemption but does not alter existing orders.
3. Permanently expiring a coupon is terminal.
4. Refunds and cancellations do not restore redemption availability.
5. Coupon discounts cannot reduce the product payment to zero until a reviewed zero-payment order workflow exists.
6. Automatic promotions that would reduce the product payment to zero are skipped. If a stacked pair would do so, the single larger discount is used.
7. Activating an automatic checkout rule never sends a campaign automatically. Administrators may separately send preference-controlled in-app campaigns from `/admin/notifications`; external marketing channels remain disabled until their production controls are implemented.

## Verification

Run `npm run test:coupon-workflow`. The test covers Admin RBAC, the draft activation gate, percentage and fixed discounts, caps, immutable evidence, payload-bound replay, financial totals, and usage-limit abuse controls.

Run `npm run test:automatic-promotions`. The test covers best-value selection, limit-aware fallback, mutual stacking consent, immutable automatic/coupon breakdowns, and refund-nettable order totals.
