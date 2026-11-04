# Implementation foundation

## First delivery scope

This repository is a modular monolith: Next.js App Router provides the customer, seller, and later staff interfaces plus versioned server API routes. PostgreSQL is the system of record through Prisma.

The first supported lane is China to Bangladesh. It is represented as data, not hard-coded business logic, so an administrator can later configure more countries, shipping lanes, providers, carriers, payment methods, and compliance profiles.

## Seller portal boundary

Bangladesh sellers are a distinct account type with their own sign-in path and `SellerProfile`. A seller is not a staff member and cannot access internal supplier costs, FX spread, operations, or finance data. The initial workflow is seller onboarding, admin verification, seller product submission, and admin review before a product becomes customer-visible.

Seller onboarding, moderated store identity, manual product management, CSV preview/import, catalog-connection control, seller-order preparation, inventory checks, and customer return/refund foundations are implemented. Seller payout, commission, reserve, and settlement automation remain intentionally disabled until their commercial and legal rules are approved.

## Supplier integration boundary

Pinduoduo, 1688, and Alibaba integrations are represented by `SourcePlatform` and `IntegrationAccount`. Secrets are stored only as a server-side secret-manager reference. Browser clients receive normalized product data only; they never receive provider credentials or raw tokens.

## Local setup commands

1. Copy `.env.example` to `.env` and set a safe `AUTH_SECRET`.
2. Start PostgreSQL with `docker compose up -d`.
3. Run `npx prisma migrate dev --name init`.
4. Run `npx prisma generate`.

Authentication, customer registration, seller onboarding, Admin review, staff portals, customer commerce, operational tracking, wallet/refund controls, and the versioned API foundation are implemented. The current engineering stage is release-candidate verification; external provider adapters remain fail-closed until approved contracts, sandboxes, credentials, policies, and operational evidence are supplied.

## Admin bootstrap for local development

After the first migration, create an initial administrator locally with a strong password:

```bash
ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="use-a-long-unique-password" npm run admin:create
```

Then sign in at `/admin/login`. This command is for controlled development/operations setup only; production admin access must be provisioned through the deployment process and never via a public endpoint.
