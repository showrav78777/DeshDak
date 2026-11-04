# Phase 1 refund financial controls

## Business outcome

Administrators no longer type the final amount credited to a customer wallet. They enter the approved gross claim value before promotion, and the server calculates the promotional netting and settlement amount using the original payment FX snapshot.

## Calculation contract

Calculation version: `PROMO_NET_LOCKED_FX_V1`

For each refund:

1. Start from the approved gross base-currency claim amount.
2. Allocate the order-level promotional discount proportionally using cumulative gross refunds.
3. On the final refund, allocate the exact remaining promotion to eliminate rounding leakage.
4. Subtract promotional allocation to obtain the net base-currency refund.
5. Convert only from the original payment snapshot relationship; never fetch or apply a current FX rate.
6. On the final refund, use the exact remaining settlement balance to eliminate currency-rounding leakage.

The sum of all successful/approved refunds cannot exceed either the gross order basis or the original settlement payment.

## Stored evidence

Every new refund records:

- Approved gross base amount
- Promotion netted in base currency
- Net base amount
- Base and settlement currencies
- Actual credited settlement amount
- Original `fxSnapshotId`
- Calculation version
- SHA-256 request fingerprint bound to its `Idempotency-Key`
- Approving administrator, reason, processing time, and immutable audit metadata

The second migration is expand-only and adds nullable evidence fields so existing records remain readable. New application writes always populate them. A later reviewed migration may enforce database non-null constraints only after legacy records are backfilled and verified.

## Security and state controls

- Administrator authorization requires a completed Admin MFA session.
- Mutations require a same-origin Admin request to reduce CSRF risk.
- External-payment refunds cannot be redirected to the wallet without explicit customer consent.
- An identical idempotent retry returns the original result; a changed payload with the same key is rejected.
- Serializable transactions and conditional order updates prevent concurrent over-refunds.
- Wallet credits create balanced debit/credit journal entries.
- When the entire payment has been refunded and the current order state permits it, the order moves to `REFUNDED` with immutable status history.
- Delivered or other operationally terminal orders retain their logistics status; their financial result remains visible through refund records rather than rewriting delivery history.

## Current boundary

Wallet payments can be returned to their original wallet method locally. An external payment may be credited to the wallet only with recorded consent. Returning money through an external gateway remains disabled until an approved provider exposes certified refund APIs, signed webhooks, reconciliation, and failure handling.

## Acceptance evidence

- Unit checks cover full and partial promotional allocation, cumulative rounding, locked-FX settlement, over-refund rejection, and order state guards.
- End-to-end verification covers MFA-backed authorization, same-origin enforcement, external-payment wallet consent, two partial refunds, exact final totals, idempotent replay, payload mismatch, over-refund rejection, stored calculation evidence, balanced journals, and terminal refund history.
- The committed migration deploys cleanly with zero Prisma drift and isolated cleanup.
