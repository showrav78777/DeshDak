# Admin launch-readiness register increment

Status: implemented and locally verified on 6 September 2026.

## Business outcome

Administrators can manage external launch dependencies at `/admin/launch-readiness` without editing source code. The system creates thirteen required baseline gates: infrastructure, payments, human verification/email, private media, legal/compliance, warehouse/lanes, staffing, independent security/capacity review, production schedulers, production-like staging, role-journey acceptance, device/PWA/accessibility acceptance, and final release freeze.

The Admin control center displays verified, remaining, blocked, and overdue gate status with a direct link to the register, so launch risk remains visible during ordinary operations.

Each item records its category, owner, target date, status, blocker, safe evidence reference, evidence review note, verifier identity, verification time, and optimistic version. Admin may add additional requirements through the same page. Required gates remain visible and the page never claims a paid launch is ready unless every required item is verified.

Every saved version also creates an append-only decision event. The event preserves the transition, owner, deadline, safe evidence reference and note, blocker, actor, and timestamp. Admin can inspect the latest 20 events per gate without replacing historical evidence.

The page also shows six live, non-secret technical signals for database connectivity, production configuration, approved checkout lanes, approved payment paths, warehouse configuration, and required operational-role coverage. Deployment-dependent signals display `DEVELOPMENT` outside production so a local setup cannot be mistaken for launch approval. These checks support the register; they do not replace contracts, legal decisions, provider acceptance, staff training, penetration testing, or physical warehouse evidence.

Admin may open `/admin/launch-readiness/report` to review or print an A4 launch evidence summary. The report is Admin-only, no-indexed, fail-closed, and remains visibly blocked until every required gate is verified. It contains safe operational evidence fields but never raw environment values or credentials.

## Security and integrity

- Admin role and Admin-portal isolation are enforced server-side.
- Browser mutations require the trusted same-origin boundary.
- Evidence-like values containing credential patterns are rejected. Passwords, tokens, API keys, and private keys belong only in the approved secret manager.
- A blocked item requires a blocker reason. Evidence-recorded and verified states require both an evidence reference and review note. Verified also requires explicit confirmation.
- Optimistic versions reject stale concurrent edits.
- Verification stores the responsible Admin identity and timestamp. Every create and update creates an immutable, non-secret audit event.
- A database uniqueness constraint permits only one immutable decision event for each gate version. Gate deletion is not exposed, and event rows restrict deletion of their parent gate.
- Baseline items are inserted by the database migration so a new environment receives the same launch controls.

## Mobile/API boundary

The protected versioned endpoints are `GET/POST /api/v1/admin/launch-readiness` and `PATCH /api/v1/admin/launch-readiness/{itemId}`. They are part of the generated contract for future authorized operational clients; no public or customer access is provided.

## Verification

`npm run test:launch-readiness` covers access isolation, baseline records, CSRF/origin enforcement, validation, secret rejection, evidence rules, version conflicts, verifier identity, audit history, all six technical signals, environment-value non-disclosure, and Admin page rendering. The generated 245-operation OpenAPI contract includes the technical-signal response shape.
