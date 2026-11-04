# Payment, session, and caching security plan

## Gateway boundary

We will use official hosted checkout / tokenized gateway flows. The application must never collect, log, cache, or store card PAN, CVV, PIN, mobile-wallet PIN, or gateway secrets. The database records a platform payment reference, idempotency key, provider transaction ID, amount, currency, status, and an auditable normalized gateway payload only.

## Payment flow

1. Server validates the order, amount, currency, customer authorization, and an `Idempotency-Key` before creating a payment intent.
   An identical owner retry returns the original result; reusing the key with a different order, quotation, or provider fails closed.
2. Server creates the gateway session using secret credentials and returns only a gateway redirect/token to the browser.
3. Browser completes payment on the official gateway surface.
4. Gateway sends a signed webhook to the server.
5. Server verifies the exact raw webhook body and signature, rejects duplicates, records the event, and updates payment/order state atomically.
6. The return URL is informational only; a customer redirect never marks an order paid.

## Sessions and caching

- Production cookie: `__Host-crossly_session`; Secure, HttpOnly, SameSite=Strict, host-only, eight-hour maximum lifetime.
- Authentication and payment responses: `Cache-Control: no-store`.
- Logout clears the secure session cookie and browser cache/cookie/storage data.
- Public catalog/category pages may be cached. Account, cart, checkout, orders, invoices, payment, seller, admin, and any personalized responses must never be cached by browser, CDN, or application cache.

## Before real payments

Choose the gateway(s), obtain sandbox and production credentials, identify official webhook-signature and retry rules, configure allow-listed callback URLs, and test duplicate webhook, payment timeout, cancelled payment, replay, partial refund, and reconciliation scenarios. No payment provider is connected until these details are reviewed against its official documentation.

The current gateway-intent route does not prove payment success and never marks an order paid from a browser return. Wallet payments are the only locally completed payment adapter; external checkout, signed webhook processing, settlement reconciliation, disputes, and original-method refunds remain disabled until an approved provider adapter is implemented and tested.
