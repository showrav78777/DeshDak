# Finance portal increment

## Business outcome

Crossly now separates audited financial operations from platform administration. Authorized Finance officers use an MFA-protected portal for versioned exchange rates and evidence-approved wallet refunds.

## Delivered scope

- Dedicated `/finance/login` and `/finance` application, with `/finance/fx-rates` and `/finance/refunds` workspaces.
- `finance` role provisioned by migration and reference seed; the role is effective only in an MFA-verified Finance session.
- Admin grant/revoke workflow at `/admin/finance`; revocation closes every live Finance session.
- Finance can create immutable FX drafts and record Finance approval, but cannot record Compliance approval. Activation requires both approvals and a valid time window.
- Finance refunds require an exact RMA amount already approved through the claim/inspection workflow. The server preserves promotion netting, original FX evidence, idempotency, over-refund protection, audit evidence, and balanced wallet journals.
- Every refund decision now stores the named Admin decision-maker and decision timestamp directly on the claim. Finance cannot post legacy/missing decision evidence, cannot post a different amount, and cannot post a refund when the Finance officer is the same person who made the claim decision.
- Admin and Finance workspaces display the preserved decision identity. The Finance queue hides same-person work before submission, while the API independently enforces the boundary.
- `/finance/reports` provides a bounded trial balance, per-currency debit/credit totals, recent journal evidence, wallet-liability totals, payment/refund summaries, and explicit journal-integrity exceptions. It exposes no customer identity or gateway payload.
- The reporting API limits each request to 366 days and inspects at most the 250 newest journals in that window for interactive integrity alerts; full statutory exports and close-period archives require a separately approved reporting policy.
- Versioned Finance APIs exist for the website and future Flutter clients under `/api/v1/finance/*`.

## Deliberately unavailable

Original-method gateway refunds, settlement-file ingestion, automated reconciliation, chargeback processing, bank payouts, and provider credentials are not simulated. They remain disabled until contracted providers, production secrets, signed webhooks/files, and reconciliation procedures are supplied and tested.

## Verification

`npm run test:finance-portal` verifies real password login, mandatory MFA, portal isolation, Admin denial, balanced accounting reporting, report-window limits, Finance-only approval, protection against forged Compliance approval, and immediate role/session revocation. `npm run test:rma-workflow` additionally verifies named decision evidence, same-person denial, independent Finance posting, and exact amount linkage. Financial/refund, Admin MFA, session, migration, OpenAPI, lint, type, build, and runtime checks remain required regressions.
