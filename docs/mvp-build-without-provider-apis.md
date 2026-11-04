# MVP build before provider APIs

The application can be completed and tested before 1688, Pinduoduo, Alibaba, payment, courier, or SMS APIs are connected. The external integrations remain disabled adapters; internal screens and lifecycle rules remain real.

## Built now

- Customer, seller, and administrator access boundaries.
- Human verification, secure sessions, logout, no-store rules, audit trail, and payment intent data model.
- Product-link Buy & Ship request, sourcing queue, versioned quotes, customer acceptance, and payment-intent creation.
- Provider adapter registry, multi-country/lane data model, catalog data model, and local seller moderation.

## Built next without external APIs

1. Internal operations order queue and state timeline.
2. Warehouse receive, measure, inspection, package label, and shipment tracking structures.
3. Customer order timeline and support/claim request shell.
4. Admin country, lane, provider, payment-method, and compliance configuration screens.
5. Notifications/outbox and operational audit views.

## Connect later

Each API is attached at one clear adapter boundary: source provider, payment gateway, courier, SMS/OTP, email, storage, or notification provider. External credentials are stored only in the deployment secret manager; no integration will require exposing a secret to the website.
