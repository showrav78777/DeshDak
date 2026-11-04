# SSLCommerz original-method refund adapter increment

## Outcome

Crossly now has a server-only SSLCommerz adapter for initiating a refund to the original payment method and querying its provider status. It is connected to a protected Finance workflow that accepts only independently approved RMAs backed by verified payment evidence and a matched settlement row.

## Security and correctness controls

- Fixed sandbox/live HTTPS hosts; redirects are rejected.
- Store credentials are read only by the server caller and are never returned.
- Mandatory bank transaction ID and unique refund transaction ID are validated against the provider's documented length limits.
- Monetary values use exact two-decimal formatting; remarks and references are bounded.
- Provider responses are size-limited and schema-validated.
- Network failures and timeouts return generic codes without leaking credential-bearing request URLs.
- Only `success` or `processing` with a provider refund reference counts as an accepted initiation.
- Status synchronization accepts only `refunded`, `processing`, or `cancelled`; cancellation is conservatively treated as failure, never as money returned.

## Finance workflow

- Finance reserves the exact server-calculated amount in `PROCESSING` before contacting the provider.
- The provider bank transaction ID is read only from validated gateway evidence; the browser cannot submit or replace it.
- Active reservations participate in over-refund protection.
- Initiation and status checks create append-only provider-operation evidence with request fingerprints and accountable Finance identities.
- Only a provider `refunded` result completes the RMA, customer notification, balanced refund journal, and eligible full-order state.
- Unknown network outcomes stay unresolved and explicitly tell Finance not to create another refund.

## Remaining work before production activation

1. Connect the private attention queue to production monitoring and approve the processing-refund escalation SLA. Recovery already reuses the original unique refund transaction ID and cannot create a second reservation.
2. Add scheduled provider-status synchronization only after SSLCommerz confirms safe polling limits and production operations approve the schedule.
3. Confirm the accounting account names, gateway-fee treatment, partial-refund settlement behavior, and chargeback overlap policy with Finance/accounting advisers.
4. Complete owner/provider sandbox UAT and independent security/Finance review before allowing production configuration.

The implementation follows SSLCommerz's current v4 Refund API contract, including the `refund_trans_id` parameter introduced on 24 February 2025.
