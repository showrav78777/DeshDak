# China source-provider integration plan

## Non-negotiable boundary

The customer browser never calls Pinduoduo, 1688, or Alibaba. Every provider request is made by a server-side adapter. Keys, raw provider data, supplier costs, rate-limit configuration, and order-placement actions remain private.

## Delivery sequence per provider

1. Operations obtains the provider's written authorization, API documentation, sandbox/test account, permitted customer-display rules, and rate limits.
2. We map the official provider contract to `SourceAdapter` and store credentials in the production secret manager.
3. We implement search, product detail, variant/price/stock sync, then test it against the sandbox.
4. We add manual sourcing approval and provider-order placement only after catalog sync is stable.
5. We add order-status/tracking webhooks or polling with idempotency and audit logs.

## Current state

The adapter registry exists for Pinduoduo, 1688, and Alibaba. Each is intentionally disabled until its authorized API contract and credentials are available. This avoids unreliable scraping and protects provider credentials.

## Catalog model

The customer catalog displays only normalized active products. A product can come from an external provider or an approved Bangladesh seller, while the customer UI uses the same safe product shape.
