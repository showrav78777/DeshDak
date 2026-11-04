# Anonymous shopping-market preference increment

Status: implemented and locally verified on 2 September 2026.

## Customer behavior

- An anonymous visitor can choose a shopping market from the countries activated by Admin. Bangladesh remains the safe initial default before any country records exist.
- The choice is stored for 180 days in a first-party, `HttpOnly`, `SameSite=Strict`, path-scoped cookie. Crossly does not silently infer residence from an IP address.
- The saved market controls public catalog, keyword-search, and shopping-assistant ranking. Bangladesh visitors see global products first; other markets see products from their selected country first and then the global catalog.
- The homepage adapts to that market without creating separate websites: Bangladesh visitors are guided toward global sourcing into Bangladesh, while international visitors are guided toward approved Bangladesh stores and exportable products for their selected destination.
- After login, the verified account residence country overrides the anonymous cookie. A signed-in customer changes country through the protected profile workflow.
- API/mobile clients can pass `marketCountry` when no authenticated account is present. An authenticated account always remains authoritative.

## Safety and administration

- Additional markets are accepted only when their country is active in Admin. Registration enforces the same rule server-side rather than trusting the form options.
- An existing customer may retain an unchanged country if Admin later disables new selection for that market.
- Cookie-personalized catalog and search responses are `private, no-store`; they cannot be served through a shared public cache under another visitor's market.
- The endpoint is documented at `POST /api/v1/catalog/market`; the versioned contract now contains 231 operations.

## Verification

- Malformed, unavailable, disabled, and manually forged cookie markets fail closed to Bangladesh.
- Secure cookie attributes, persistence, cache isolation, catalog policy, and explicit API override passed the integration test.
- The same test verifies the international homepage copy and route behavior against a temporarily activated market, then restores the original Admin country state.
- Registration, protected profile updates, and the eight-control market-ranking policy passed regression testing.
- TypeScript, lint, OpenAPI generation/verification, and the optimized production build passed.
- At 390 × 844, the market selector remained visible with no header overflow and no browser-console error.
