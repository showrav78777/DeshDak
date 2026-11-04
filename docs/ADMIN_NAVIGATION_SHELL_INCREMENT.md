# Admin navigation shell increment

## Business outcome

Authenticated administrators use one persistent left-side menu. The independently scrollable menu opens each protected Admin workflow in the full right-side content area. On smaller screens it becomes an accessible drawer.

## Scope and acceptance criteria

- Group all existing Admin workflows into understandable navigation sections.
- Show the active destination and administrator's display name.
- Keep sidebar options and desktop content independently scrollable.
- Provide a mobile drawer, backdrop, close controls, keyboard focus indicators, and a skip link.
- Keep login, initial setup, and the 80 mm package-label print view outside the shell.
- Keep server-side page and API authorization as the security boundary; the shell is navigation only.

## Architecture and risk controls

The server Admin layout verifies the signed, database-backed session and only provides the shell for an MFA-complete Admin portal session. A small client component reads the current pathname for active-link and drawer behavior. It does not receive email, permissions, credentials, or business data; only the administrator display name is rendered. Existing page-level authorization remains unchanged.

No database, API contract, financial rule, order state, or external integration changed in this increment. Mobile applications remain API consumers and are unaffected.

## Verification

- `npm run test:admin-shell`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Owner handoff

Open `/admin/login`, complete MFA if required, and use the Menu button on mobile or the permanently visible left navigation on desktop. This increment needs no external API, credential, or owner-supplied configuration.
