# Customer account and saved-address increment

## Business outcome

The authenticated customer account backend now supports profile retrieval and updates, privacy-consent management, and the complete saved delivery-address lifecycle required by the website and future Flutter clients.

## Delivered behavior

- Customers can list and create saved delivery addresses.
- Customers can edit only their own active addresses and can select a new default address.
- Customers cannot leave a non-empty address book without a default address by directly unsetting the current default.
- Deleting the default automatically promotes the most recently updated remaining address.
- Address deletion is recoverable soft deletion; deleted records are excluded from customer reads and mutations.
- A partial PostgreSQL unique index guarantees at most one active default address per customer, including under concurrent requests.
- Address writes use serializable transactions and return a safe retry response for database conflicts.
- Customer responses omit internal ownership, deletion, password, and session-owner fields.
- Profile, privacy, and address mutations remain protected by the application’s trusted browser-origin boundary.
- Every profile, consent, address creation, update, and deletion change retains the existing audit/event evidence appropriate to that workflow.

## Customer web experience

- `/profile` provides a protected, responsive account page using the same versioned APIs intended for future Flutter clients.
- Customers can review their permanent customer code, email, account status, and KYC state without exposing credentials or internal session data.
- Customers can update their name, optional phone, language, personal/business preference, and an available preferred currency.
- The delivery address book supports adding, editing, selecting a default, and confirmed removal. Country choices come from Admin-managed active countries while retaining Bangladesh and any previously saved country.
- Optional analytics consent is available on the same page with its last-recorded timestamp.
- Customer menus and signed-in navigation now link directly to Profile; displayed names remain current because every session verification hydrates identity details from PostgreSQL.

## Checkout reuse

- Checkout lists every saved address that is valid for the current cart and selects the default address first.
- A sourced-product cart accepts only Bangladesh addresses. A seller-marketplace cart accepts its domestic origin and only international destinations that currently have an approved shipping lane and runtime-ready payment option.
- Selecting a saved international address also selects its available destination lane. Switching to a new address resets the form to the cart's domestic destination.
- Edits made to a selected saved address apply only to that order; permanent edits remain in the protected Profile address book.
- A new checkout address can be saved for later. Exact duplicates are not created, while genuinely different addresses in the same country are retained.
- Checkout-created addresses generate dedicated audit evidence and the first active saved address becomes the default.

## API contract

Exact OpenAPI contracts are published for:

- `GET/PATCH /api/v1/users/me`
- `GET/POST /api/v1/users/me/addresses`
- `PATCH/DELETE /api/v1/users/me/addresses/{addressId}`
- `GET/PATCH /api/v1/users/me/privacy`

The schemas are suitable for future generated Flutter models, but mobile bearer authentication is intentionally not advertised until the server implements and enforces that separate authentication flow.

## Database integrity

Migration `20260830150000_address_default_integrity` creates the filtered unique index `Address_one_active_default_per_user_key` over active default addresses. Soft-deleted addresses are excluded from the index.

## Verification

Run:

```text
npm run db:migration:verify
npm run db:deploy
npm run test:customer-account
npm run api:generate
npm run api:contract
npm run lint
npm run typecheck
npm run build
```

The workflow verifiers create isolated customers and sessions, then prove private profile access, trusted-origin enforcement, consent updates, response-field minimization, address ownership isolation, default transitions, soft deletion, the signed-in Profile page, checkout rendering of only fulfillment-eligible addresses, exact-address deduplication, retention of distinct same-country addresses, and cleanup.
