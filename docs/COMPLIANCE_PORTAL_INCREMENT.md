# Compliance review portal increment

## Business outcome

Crossly now separates compliance review work from platform administration. Administrators retain rule and workforce configuration; authorized Compliance officers use a dedicated MFA-protected portal to decide pending manual screenings.

## Delivered scope

- Dedicated `/compliance/login` and `/compliance` review application.
- `compliance` role provisioned by migration and reference seed.
- Mandatory TOTP/recovery-code MFA before the role becomes effective in a Compliance session.
- Admin-managed grant/revoke workflow for existing active verified accounts at `/admin/compliance`.
- Revocation immediately removes the role and revokes every live Compliance session.
- Oldest-first review queue with only necessary customer/product references, route, rule codes, and screening evidence.
- Compliance officers can approve or reject pending manual reviews with a required note and optimistic version check.
- Rule creation, rule states, catalog maintenance, Admin navigation, credentials, payments, and provider integrations remain unavailable to Compliance sessions.
- Admin retains full oversight and decision authority.
- Versioned APIs for the website and future Flutter staff client:
  - `GET /api/v1/compliance/screenings`
  - `PATCH /api/v1/compliance/screenings/{screeningId}`
  - `GET/POST /api/v1/admin/compliance-staff`
  - `DELETE /api/v1/admin/compliance-staff/{staffId}`

## Security and data integrity

- Portal-specific session filtering prevents a Compliance role from becoming effective in customer, seller, support, operations, or Admin sessions, and prevents customer roles from leaking into privileged staff sessions.
- Server-side RBAC and same-origin mutation validation protect every decision and access change.
- Decisions reuse the canonical compliance workflow, including exact state/version enforcement, product visibility effects, and immutable audit evidence.
- Queue responses exclude passwords, tokens, raw product input, rule keywords, legal references, internal descriptions, supplier identities, costs, and provider configuration.

## Verification

`npm run test:compliance-portal` covers real password login, MFA enrollment/challenge, recovery codes, portal isolation, queue authorization, and application rendering. `npm run test:restricted-goods` covers Admin/Compliance separation, officer decisions, Admin workforce visibility, role/session revocation, and the existing screening/catalog workflow. The increment also requires migration verification, ESLint, TypeScript, OpenAPI verification, production build, and runtime checks.

## Owner follow-up

The owner must nominate trained Compliance officers, verify their accounts, grant access in Admin, require secure authenticator enrollment, define review and escalation SLAs, approve decision guidance, and perform periodic least-privilege access reviews. Legal interpretation and authoritative prohibited/restricted rules still require qualified counsel.
