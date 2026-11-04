# SSLCommerz adapter foundation increment

## Delivered

- A server-only BDT adapter core for official SSLCommerz v4 sandbox and live hosts.
- Hosted-session creation with fixed TLS endpoints, same-origin Crossly callbacks, strict provider redirect allowlisting, bounded timeouts and response sizes, and validated response shapes.
- Server-side transaction validation that requires `VALID` or `VALIDATED` and exactly matches Crossly's reference, amount, and currency before returning valid evidence.
- `risk_level=1` produces `REVIEW_REQUIRED`; it is never treated as an automatically fulfilled payment.
- Returned evidence is deliberately redacted and never includes the Store Password.
- Mocked, offline regression tests cover trusted endpoints, callback/redirect attacks, mismatches, invalid status, and risk holds.
- Production configuration now requires the Store ID/password pair and an explicit `sandbox` or `live` environment.
- Authenticated external checkout now creates a hosted session from the locked Crossly payment intent and returns the trusted SSLCommerz redirect URL to the browser.
- The customer UI redirects only to the allowlisted SSLCommerz host.
- A public, bounded IPN route validates `val_id` against SSLCommerz before an idempotent serializable database transition creates/releases the paid order.
- Success, failure, and cancellation return routes only navigate back to Crossly. They never mark a payment paid.

## Security decision

The older PHP project at `/Applications/XAMPP/xamppfiles/htdocs/g&g/SSLCommerz-PHP-master` was treated only as a flow reference. Crossly does not copy its configuration, credentials, direct SQL patterns, localhost TLS exceptions, redirect-as-proof behavior, or tolerance-based amount comparison. The official SSLCommerz v4 contract is authoritative.

## Deliberately not live yet

Customer hosted checkout, validated IPN processing, and safe browser returns are connected. This increment does not automatically clear a risk-level hold, submit original-method refunds, ingest settlements, reconcile provider records, process chargebacks, or activate `PAYMENT_ADAPTERS_ENABLED` in production. Those operations must remain unavailable until official sandbox/UAT evidence, Finance controls, monitoring, and operational approvals are complete.

## Next implementation order

1. Rotate the sandbox credential formerly stored in the legacy PHP project, then configure the replacement through Crossly's environment/secret manager.
2. Run hosted-checkout and IPN testing on a public HTTPS sandbox URL; SSLCommerz cannot call a laptop-only localhost IPN.
3. The MFA-protected Admin risk-review queue and immutable decision record are complete at `/admin/payment-risk`.
4. Implement approved original-method refund, settlement, reconciliation, chargeback, alerting, and recovery workflows.
5. Pass sandbox/UAT, security, failure, and finance review; only then permit controlled production activation.

## Verification

Run `npm run test:sslcommerz-adapter`, followed by `npm run typecheck`, `npm run lint`, and the launch-candidate verification.
