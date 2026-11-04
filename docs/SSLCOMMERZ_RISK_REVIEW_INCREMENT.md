# SSLCommerz payment risk review increment

## Business outcome

An SSLCommerz transaction that is valid but returned with `risk_level=1` is held without releasing the order. An MFA-verified administrator can investigate it at `/admin/payment-risk` and record one permanent approval or rejection with a mandatory reason.

## Server controls

- Admin role, Admin portal, completed MFA, trusted same-origin request, and a unique idempotency key are required.
- The server rechecks that the payment is SSLCommerz, `PENDING`, has validated held evidence, and has no prior final decision.
- Approval changes the payment to `SUCCEEDED` and releases the order through the same verified-payment service used by normal IPN processing.
- Rejection does not falsely mark captured funds as failed. It preserves the payment as financially unresolved for refund or settlement investigation.
- A database uniqueness rule permits only one decision per payment.
- The database prevents update or deletion of decision records. Amount, currency, validation evidence, reviewer, reason, request fingerprint, and review time are snapshotted.
- Both outcomes create an Admin audit event. The API returns no gateway credential or raw secret.

## Admin workflow

1. Sign in at `/admin/login` and complete MFA.
2. Open **Payment risk review** under **Customers and finance**.
3. Compare the customer, Crossly order/request, exact amount/currency, provider status, validation reference, and provider risk reason with authorized merchant evidence.
4. Enter a specific review reason.
5. Approve only when identity and transaction evidence are satisfactory. Otherwise reject and send the case to Finance for refund or settlement resolution.

## Verification evidence

`npm run test:payment-risk-review` verifies the MFA Admin boundary, trusted origin, immutable database enforcement, idempotent replay, changed-payload conflict, rejection hold, approval, audit evidence, and order release. Prisma validation, TypeScript, lint, API generation, and production build remain part of the release gate.

## Remaining external and policy work

- Approve the exact fraud/risk evidence checklist, reviewer training, decision authority, response SLA, escalation contact, and retention period.
- Define the Finance workflow and deadline for rejected-but-captured payments, including original-method refund, settlement discrepancy, chargeback, and customer communication.
- Complete official SSLCommerz sandbox/UAT and production merchant approval before enabling production checkout.
