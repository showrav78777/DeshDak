# Crossly Demo Environment

## Safety boundary

Demo data is allowed only when both conditions are true:

1. The application is not running as production.
2. `DEMO_DATA_ENABLED=true` is explicitly supplied.

All demo identities use the reserved `example.test` domain. No real customer, phone, payment, supplier, or credential data is included.

## Commands

```bash
# Start the isolated local database
docker compose up -d postgres

# Apply schema and baseline records
npm run db:deploy
npm run db:seed

# Populate or update demo records
DEMO_DATA_ENABLED=true npm run seed:demo

# Remove only records owned by this seed
DEMO_DATA_ENABLED=true npm run demo:clear

# Clear and rebuild the seeded demo dataset
DEMO_DATA_ENABLED=true npm run demo:reset
```

Set `DEMO_ACCOUNT_PASSWORD` to choose a shared local testing password. If omitted, the non-production default is `CrosslyDemo!2026`.

## Seeded accounts

- Customers: `customer01@example.test` through `customer24@example.test`
- Admin: `admin@example.test`
- Customer service: `support01@example.test`, `support02@example.test`
- Warehouse: `warehouse01@example.test`, `warehouse02@example.test`
- Inspector: `inspector01@example.test`
- Logistics: `logistics01@example.test`
- Sourcing: `sourcing01@example.test`
- Finance: `finance01@example.test`
- Compliance: `compliance01@example.test`
- Sellers: `seller01@example.test`, `seller02@example.test`

Use the normal role-specific login page for each account. Demo credentials must never be displayed when `NODE_ENV=production` or `APP_ENV=production`.

## Seeded marketplace coverage

- 24 customer profiles, including Bangladesh and international market preferences
- 10 operational staff accounts covering the roles implemented by the application
- 2 approved fictional Bangladesh seller stores
- 64 active fictional products across active admin-managed categories
- Single- and multi-variant stock, MOQ, out-of-stock, low-stock, and international-availability cases
- 20 active product Reels with varied engagement counts
- Published and rejected Reel comments for public display and moderation testing

Demo product media records are metadata-only until an approved media origin is configured with `PUBLIC_MEDIA_BASE_URL`. This intentionally preserves the platform's secure-media fail-closed behavior.

## Next demo increments

The next seed modules should reuse the domain workflows instead of writing impossible states directly:

1. Carts, wishlists, browsing events, and recommendations
2. Buy & Ship and Ship for Me scenarios
3. Orders, warehouse parcels, inspections, and assignments
4. Air/Sea shipment estimates, final measurements, and invoices
5. Payments, refunds, wallet activity, and accounting
6. Tickets, messages, notifications, campaigns, coupons, and analytics

Each increment must remain repeatable, fictional, and production-blocked.
