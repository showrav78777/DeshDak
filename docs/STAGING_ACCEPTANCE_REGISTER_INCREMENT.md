# Staging acceptance register increment

Status: implemented and locally verified on 6 September 2026.

## Business outcome

The role-by-role staging checklist is now represented by four required baseline gates in the protected Admin launch-readiness register:

- Production-like staging environment.
- Role-by-role journey acceptance.
- Device, PWA and accessibility acceptance.
- Release freeze and approval.

Administrators manage owners, deadlines, blockers, safe evidence references, review notes and final verification at `/admin/launch-readiness`. This keeps release acceptance in the web application while `STAGING_ROLE_ACCEPTANCE.md` remains the detailed execution checklist.

## Integrity boundary

The gates reuse the existing same-origin Admin mutation boundary, evidence validation, explicit verification confirmation, optimistic concurrency, verifier identity, audit log and append-only version history. They do not manufacture staging infrastructure or test evidence. Separate real role accounts, approved data, devices, provider sandboxes and named testers are still required from the owner and operational team.

## Database and compatibility

Migration `20260906010000_staging_acceptance_gates` inserts the four stable baseline keys and their initial immutable history events. It is idempotent by key, changes no existing record, adds no API route and preserves the existing Flutter-compatible launch-readiness response.

## Verification

The clean 59-migration reconstruction passes with zero schema drift. `npm run test:launch-readiness` checks that all thirteen required baseline keys and their initial history exist, in addition to the existing authorization, evidence, audit, technical-signal and secret non-disclosure controls. On 12 September 2026, the current verification baseline covered 66 always-on gates, the 266-operation API contract, and an optimized 159-page production build. Security-cleanup and payment-operations monitoring raise the suite to 68 gates after the owner provisions `MAINTENANCE_JOB_SECRET` through the production secret manager.
