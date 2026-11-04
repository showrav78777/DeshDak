# Sourcing Agent portal increment

## Business outcome

Crossly now separates supplier-product investigation and quote preparation from customer-visible price approval. Sourcing Agents work in a dedicated portal; Admin independently reviews every draft before it can appear to the customer.

## Delivered scope

- Dedicated `/sourcing/login` and `/sourcing` application using the existing `sourcing_agent` role.
- The role becomes effective only in a Sourcing session; it no longer leaks through customer or other workforce portals.
- Agent queue exposes the customer name and Crossly person code required for work, but not email, phone, addresses, sessions, payment, wallet, or identity documents.
- Agents can open only the customer-supplied product URL and prepare a bounded quote draft. They cannot publish it, approve purchases, configure integrations, or enter Admin.
- Drafts remain private. Admin reviews them at `/admin/sourcing`; approval changes the immutable version to `SENT`, records reviewer/time/note, notifies the customer, and changes the request to `QUOTED`.
- Rejection records evidence and returns the request to the Agent queue for a new version. Expired drafts cannot be approved.
- The draft creator cannot approve their own quote, even if the same identity holds multiple roles.
- Admin grants/revokes Sourcing Agent access in the sourcing control page; revocation immediately closes active Sourcing sessions.
- Versioned APIs exist under `/api/v1/sourcing-agent/*` and `/api/v1/admin/sourcing-*` for the website and future Flutter staff application.

## Security and integrity

Server-side portal RBAC, same-origin mutation validation, serializable draft creation, optimistic review state, immutable quote versions, audit logs, reviewer evidence, and customer-side status filtering protect the workflow. Public APIs do not reveal internal source platform identities, supplier costs, fees, FX evidence, staff identities, or integration configuration.

## Owner follow-up

Define supplier-verification evidence, acceptable quote age, price/FX variance limits, service-fee authority, escalation rules, staff shifts, review SLA, prohibited supplier/link policy, and periodic access reviews. Official source APIs, credentials, automated availability/price verification, and supplier contracting remain external dependencies recorded in `idea.txt`.
