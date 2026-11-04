# Customer cart workflow increment

## Business outcome

The customer web application and future Flutter client share one private cart contract. Customers can add a product option, replace its quantity, review totals and availability, and remove it before checkout.

## Security and integrity

- Every cart read and mutation requires a customer account; item lookup is always scoped to the authenticated owner.
- Browser mutations pass through the global trusted-origin/CSRF boundary.
- Quantity is limited to 1–99 and cannot exceed known inventory.
- Active product, clear compliance, active category, stock, inventory, and approved-seller status are rechecked by the server.
- Suspending a seller immediately marks retained cart items unavailable, removes their value from the payable subtotal, and blocks new adds or quantity changes.
- Seller-marketplace and sourced-import items cannot be mixed in one cart.
- Cart and API responses are private and `no-store`.

## Mobile API contract

`GET /api/v1/cart`, `POST /api/v1/cart/items`, and `PATCH`/`DELETE /api/v1/cart/items/{itemId}` publish exact request, response, availability, totals, fulfillment, path, and business-error schemas in `/openapi.yaml`.

Mobile bearer authentication is intentionally not advertised yet. Flutter will use these same data contracts after the dedicated access/refresh-token boundary is implemented and enforced.

## Verification

Run `npm run test:cart`. The isolated workflow covers authentication, trusted origin, owner isolation, inventory limits, totals, suspended-seller handling, update, removal, and cleanup.
