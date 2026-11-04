# Customer market segmentation increment

Crossly now records a customer-confirmed country of residence and required international-format phone number at registration. The residence country creates two operational views: `BANGLADESH` when the ISO code is `BD`, and `INTERNATIONAL` for every other configured country.

This is one customer identity system, not separate databases, accounts, or websites. The same versioned API data can serve the Next.js web app and future Flutter applications. Admin can filter `/admin/customers` and `GET /api/v1/admin/users` by Bangladesh or International market, while each record keeps its exact two-letter country code.

## Safety and business rules

- The customer explicitly confirms country. IP/geolocation may later suggest a value only after privacy/consent review; it must never silently overwrite the profile.
- Phone input is normalized and stored in E.164 form, such as `+8801...` or `+1...`. Recording a number does not mean it is verified; SMS/OTP verification remains disabled until an approved provider is connected.
- Existing records are backfilled as Bangladesh because the original first-launch system was Bangladesh-only. Those customers can correct the value in Profile, and the change is audited.
- Country of residence is not a delivery promise. Registration choices come from Admin-enabled countries, but checkout must still require an active destination lane, payment method, compliance profile, currency/FX configuration, carrier/warehouse readiness, and approved customer wording.
- Public product browsing and public AI discovery remain available without registration.

## Verification

Run `npm run test:customer-markets` with the local app and PostgreSQL running. The test rejects missing country/phone, verifies an international signup, checks ISO/phone normalization in PostgreSQL, and removes its synthetic customer.
