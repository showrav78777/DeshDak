# Crossly launch workstream closeout

Date: 22 September 2026

## Engineering result

Crossly is a verified local release candidate for the implemented V1 scope. The optimized production build succeeds, the OpenAPI contract contains 270 operations, all 60 migrations deploy with zero drift, and the isolated workflow runner passes 65 standard launch gates. Two scheduler-operation gates are additionally enforced wherever `MAINTENANCE_JOB_SECRET` is configured.

This is engineering completion, not authorization for a public paid launch. External services, contracts, physical operations and independent acceptance cannot be truthfully completed from source code and remain fail-closed.

## Nine-workstream disposition

1. **Critical journeys:** automated role and workflow coverage passes for customer, seller, Admin, warehouse, inspector, logistics, Finance, Compliance, sourcing, Sales/KAM and support. Final stakeholder visual acceptance on target devices remains an evidence gate.
2. **Responsive and UI states:** responsive application layouts and protected page rendering are implemented. Final device/browser accessibility acceptance with approved content remains an evidence gate.
3. **Staging and build:** Docker standalone production packaging, health checks, migration verification, smoke tooling, rollback runbook and complete isolated CI verification are ready. A real staging deployment needs the owner's hosting account, domain, managed database and secrets.
4. **Payments/refunds:** SSLCommerz initiation, callback validation, risk review, reconciliation, chargebacks, wallet refunds and original-method refund controls pass automated tests. Sandbox/live merchant credentials and signed provider UAT must be supplied and approved by the owner/provider.
5. **Email, Google OAuth and CAPTCHA:** secure configuration boundaries and email-verification workflows are implemented and fail closed. Verified domains, OAuth consent/client credentials, transactional-email provider credentials and production Turnstile keys require owner/provider action.
6. **Private media:** catalog/Reels media eligibility and moderation boundaries exist. Production object storage, CDN, signed upload/download, transcoding, malware scanning, metadata removal and retention configuration require selected providers and credentials.
7. **Role testing:** automated authorization, portal isolation, assignment, revocation and workflow checks pass for every launch role. Named real staff, training and signed business acceptance remain owner-controlled.
8. **Security and operations:** dependency, container, CSRF, session, MFA, rate-limit, database, performance-policy, backup/restore safety, monitoring boundaries and rollback checks pass. Independent penetration/load tests, real backup restoration, alert routing and production rollback rehearsal require deployed infrastructure and named operators.
9. **Real launch data:** Admin-managed countries, destinations, staff, compliance, content, campaigns and operational configuration are supported. Approved real products/content, people, warehouses, carrier routes, rates, policies and launch settings must be entered and verified by the business owner.

## Reproducible verification

Run against local PostgreSQL only:

```bash
npm run verify:launch:isolated
npm run build -- --webpack
```

The isolated runner refuses non-loopback databases. Production deployment must use the controlled steps in `docs/DEPLOYMENT_RECOVERY_RUNBOOK.md`; never use `prisma db push` against staging or production.

## Release decision

The software may move to a properly configured staging environment. Public paid launch remains **BLOCKED** until every required item in `/admin/launch-readiness` has an owner, reviewed evidence and independent verification. Credentials must remain in the hosting secret manager and must never be entered into the launch register or committed to source control.
