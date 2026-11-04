# Customer Marketplace Shell Increment

## Outcome

The public marketplace and authenticated customer areas now share one responsive customer shell. Staff portals keep their own role-specific navigation.

## Included

- Sticky desktop header with Crossly branding, global product search, a prominent Reels action, cart, authentication/account actions, and market selection.
- Secondary marketplace navigation for categories, products, Buy & Ship, Ship for Me, tracking, Bangladesh stores, and support.
- Category dropdown populated from active admin-managed categories.
- Mobile-first header plus the existing fixed five-item navigation: Home, Explore, Reels, Cart, and Account.
- Shared customer footer linking only to implemented marketplace, service, help, policy, and account routes.
- Reels access remains public and visually prominent.
- Customer chrome is excluded from Admin, Seller, Warehouse, Logistics, Inspector, Finance, Compliance, Sourcing, Sales, staff Support, print, and scan routes.

## Architecture

- `StoreHeader` is the single customer header implementation.
- `CustomerNav` delegates to `StoreHeader`, preventing public and signed-in navigation from drifting apart.
- `hidesCustomerChrome()` centralizes route exclusions used by the footer and mobile navigation.
- Active categories come from the database; new categories can be activated through administration without editing header code.

## Verification

- TypeScript typecheck
- ESLint
- Production build
- Desktop browser render and navigation inspection
- Responsive styles, focus states, reduced-motion handling, and portal exclusions

## Next Increment

Build the environment-gated demo seed foundation using existing domain models. Demo records must use fictional `.test` identities and must be impossible to seed accidentally in production.
