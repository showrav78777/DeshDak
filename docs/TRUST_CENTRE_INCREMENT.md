# Public Trust Centre increment

## Business outcome

Anonymous visitors can review Crossly's current trust controls and service boundaries before creating an account or transacting. The page explains seller and product review, operational evidence, money handling, claims, privacy, and support without claiming that unavailable external services are live.

## Scope

- Public `/trust` route with route-specific metadata.
- Persistent public-header entry and homepage call to action.
- Accurate distinction between Buy & Ship and Ship for Me claims.
- Seven-day shipment-level claim timing summary.
- Honest wallet, payment-provider confirmation, privacy, seller-approval, and product-moderation wording.
- Responsive and keyboard-navigable page structure.

## Deliberately out of scope

- A legal Terms of Service, complete Privacy Notice, guarantee, insurance contract, licensed escrow representation, or production contact directory.
- A new seller identity-verification engine, public seller score, verified-purchase review system, or dispute decision workflow.
- Live payment-provider or external refund capability.

## Acceptance criteria

1. `/trust` is available without authentication.
2. Public text does not expose supplier/provider identities or promise unavailable external operations.
3. Buy & Ship and Ship for Me protection boundaries match Company Policies v1.1.
4. Claim timing is described per shipment rather than per order.
5. The route works at desktop and narrow mobile widths and passes lint, TypeScript and production compilation.

## External owner work

Before production publication, qualified counsel and the business owner must approve the complete customer terms, privacy notice, liability language, company identity, support contacts, business hours, complaint channels, jurisdiction-specific wording and any buyer-protection marketing claim.
