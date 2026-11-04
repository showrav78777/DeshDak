# Crossly Development Process

## Required methodology

Crossly uses all four requested methods as one controlled delivery system:

1. **Waterfall controls the major system phases.** A phase must satisfy its documented completion gate before the next phase starts. Critical requirements, security controls, data integrity, tests, and owner acceptance cannot be postponed merely to show progress.
2. **Agile controls the work inside the active phase.** The active phase is divided into small, usable increments. Each increment is reviewed against the business documentation and can incorporate owner feedback without changing an already approved phase silently.
3. **Spiral controls risk in every increment.** Each increment repeats planning, design, implementation, testing, and risk assessment. High-risk financial, identity, authorization, privacy, logistics, and external-integration work receives deeper review and stronger tests.
4. **DevOps controls integration and operation.** Every increment must remain deployable and must pass automated schema, lint, type, test, build, security, and runtime checks appropriate to its risk. Environment configuration and external credentials remain outside source code.

These methods are not interchangeable. Waterfall provides the phase boundary; Agile provides short feedback cycles; Spiral provides repeated risk control; DevOps provides automation and operational reliability.

## System phases

### Phase 0 — Requirements and traceability

- Read the binding business documentation.
- Identify the exact workflow, roles, states, data, API contracts, security requirements, external dependencies, and acceptance criteria.
- Record provider/API/legal/operational work that cannot be completed locally in `idea.txt`.
- Resolve material conflicts using the authority order in `AGENTS.md`.

**Completion gate:** Requirements and acceptance criteria are explicit, conflicts are resolved or recorded, and critical risks have owners or safe gates.

### Phase 1 — Architecture and design

- Design database ownership, immutable history, state transitions, RBAC, audit events, API contracts, caching, idempotency, privacy, error handling, and mobile compatibility.
- Define failure behavior and ensure unavailable providers fail closed.
- Confirm no public response exposes internal supplier identities, credentials, private costs, or administrative data.

**Completion gate:** The design satisfies the governing documentation and has no unresolved critical security or data-integrity risk.

### Phase 2 — Implementation

- Implement server-side business rules first.
- Implement stable versioned APIs reusable by the website and future Flutter applications.
- Add customer, seller, administrator, and operations interfaces only for authorized workflows.
- Keep configuration in protected Admin workflows rather than requiring source-code edits.

**Completion gate:** The increment is complete end-to-end, contains no knowingly fake live integration, and has appropriate audit and authorization enforcement.

### Phase 3 — Verification and security review

- Validate the Prisma schema and database interaction.
- Run linting, TypeScript checks, relevant automated tests, and a production build.
- Test authorization boundaries, invalid input, idempotent retries, state conflicts, sensitive-data exposure, and provider failure.
- Test relevant pages and API responses at runtime, including responsive/mobile-safe behavior where applicable.
- Reassess risks discovered during implementation and return to design or implementation when necessary.

**Completion gate:** All required checks pass, critical/high defects are resolved, and remaining external limitations are explicitly gated and recorded.

### Phase 4 — Owner acceptance and controlled release

- Present the completed outcome and exact Admin workflow.
- Identify real-world information, approvals, credentials, contracts, or provider configuration still required from the owner.
- Do not activate production financial, logistics, AI, sourcing, or identity providers until their readiness requirements are met.
- Release through reviewed environment configuration and CI/CD with rollback, monitoring, and auditability.

**Completion gate:** The owner accepts the increment, production prerequisites are satisfied, and rollback/monitoring are ready.

## Agile increment rules

Every increment must be small enough to verify fully and must have:

- A documented business outcome.
- In-scope and out-of-scope boundaries.
- Acceptance criteria.
- Dependencies and risks.
- Implementation and database/API impact.
- Security and privacy checks.
- Test evidence.
- Owner-facing handoff notes.

Feedback may change the active increment. A change that materially alters an approved requirement, financial rule, security boundary, database contract, or later phase must be documented and re-reviewed before implementation.

## Spiral risk review

At the start and end of each increment, review at minimum:

- Authentication, authorization, session, and MFA risks.
- Payment, wallet, refund, FX, rounding, reconciliation, and duplicate-processing risks.
- Personal data, consent, retention, logging, and data-exposure risks.
- Order, inventory, shipment, seller, and administrator state-transition risks.
- External API authenticity, availability, quota, timeout, retry, and data-quality risks.
- Performance, caching, database concurrency, backup, and recovery risks.
- Website/mobile API compatibility and breaking-change risks.

Critical risks block the completion gate. Risks that require an external provider, business decision, legal approval, or production infrastructure must fail closed and be recorded in `idea.txt`.

## DevOps quality gate

Use the checks relevant to the increment, including:

```text
Prisma schema validation
Database migration or development schema synchronization
ESLint
TypeScript compilation
Automated unit/integration/workflow tests
Next.js production build
Runtime page and API checks
Authorization and sensitive-response checks
Dependency/security scanning before production
```

CI/CD must eventually enforce these checks before deployment. Production deployment must use environment-separated secrets, reviewed migrations, health checks, monitoring, alerting, backup/restore readiness, and a rollback procedure.

## Definition of done

Work is complete only when:

- The documented business workflow works end-to-end.
- Server authorization and state rules are enforced.
- Data and financial history remain auditable.
- Public and mobile-safe APIs expose only approved data.
- Required verification passes.
- The UI works for its relevant role and does not pretend an unavailable external service is live.
- External owner/provider work is recorded clearly.
- No unresolved critical or high-risk defect remains.
