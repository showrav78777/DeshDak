# Customer notification-preferences increment

## Business outcome

Customers can now control available notification delivery choices directly on `/notifications` while Crossly keeps essential security and transaction messages enabled. The page clearly distinguishes working, queued, and not-yet-connected channels instead of implying that external providers are live.

## Delivered behavior

- The notification center includes responsive settings for Orders and payments, Account security, and optional Offers and discovery.
- In-app delivery is available now. Email choices are stored and email deliveries remain queued until the approved provider worker confirms delivery.
- Push, SMS, and WhatsApp are visibly unavailable and cannot be enabled until reviewed providers are connected.
- Essential transactional in-app messages and security in-app/email messages cannot be disabled.
- Marketing delivery is off by default and may be enabled independently for available channels.
- Preference language follows the customer's Profile language.
- Every successful change is audited; rejected changes do not create misleading preference records.
- API responses are private and non-cacheable, and browser mutations retain the trusted-origin boundary.

## API contract

Exact OpenAPI contracts cover `GET/PATCH /api/v1/notifications/preferences`, including the full 15-item category/channel matrix, effective state, readiness, lock state, validation, and stable business errors. The same contract can support the future Flutter client after mobile authentication is implemented.

## External follow-up

The owner must still contract and configure transactional email, push, SMS, and WhatsApp providers as documented in `idea.txt`. Provider credentials, sender verification, delivery webhooks, bounce/suppression handling, retries, costs, consent rules, and regional messaging laws cannot be completed through this local feature.

## Verification

Run:

```text
npm run test:notification-preferences
npm run api:generate
npm run api:contract
npm run lint
npm run typecheck
npm run build
```

The workflow proves private access, complete safe defaults, essential locks, fail-closed unavailable channels, CSRF/trusted-origin protection, Bangla profile-language rendering, audit evidence, and cleanup.
