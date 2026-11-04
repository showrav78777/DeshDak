# Support Ticketing and Customer Service Increment

## Business outcome

Crossly now has a durable Phase 4 support workflow for the website and future Flutter clients. A signed-in customer can open a ticket, attach an owned order or RMA, follow the response SLA, exchange messages, and see the complete customer-visible history. Customer Service uses a separate protected portal with load-based assignment and assigned-customer visibility. Admin can grant or safely revoke access, monitor every active ticket and transcript, reassign work, set priority, and escalate without impersonating Customer Service.

## Web workflows

- Customer support center: `/support`
- Customer ticket: `/support/{ticketId}`
- Customer Service login: `/support/login`
- Customer Service queue: `/support/tickets`
- Assigned Customer Service workspace: `/support/tickets/{reference}`
- Admin support operations and staffing: `/admin/support`
- Admin transcript and controls: `/admin/support/{ticketId}`

Admin grants Customer Service access by entering the exact email of an existing active, verified account. The administrator never sees or changes that person's password. The agent then signs in through `/support/login`.

## API contract

- `GET/POST /api/v1/tickets`
- `GET /api/v1/tickets/{ticketId}`
- `POST /api/v1/tickets/{ticketId}/messages`
- `GET /api/v1/support/tickets?scope=mine|unassigned`
- `PATCH /api/v1/support/tickets/{ticketId}/actions`
- `GET/POST /api/v1/admin/support-agents`
- `DELETE /api/v1/admin/support-agents/{agentId}`
- `PUT /api/v1/admin/support-agents/{agentId}/profile`
- `PUT /api/v1/admin/support-quality-reviews/{ticketId}`
- `GET/PUT /api/v1/admin/support-policy`
- `POST/DELETE /api/v1/admin/support-holidays[/{holidayId}]`
- `POST/DELETE /api/v1/admin/support-shifts[/{shiftId}]`
- `POST /api/v1/internal/maintenance/support-sla`
- `POST /api/v1/tickets/{ticketId}/satisfaction`

Consequential creation and message calls require an idempotency key. Message keys are bound to the authenticated sender, ticket conversation, and validated payload; reuse for different content returns a conflict. Browser mutations require a trusted same-origin request. APIs keep the standard success/error envelope and use stable identifiers suitable for a later generated Flutter client.

## State and SLA rules

Ticket states are `OPEN`, `ASSIGNED`, `WAITING_FOR_CUSTOMER`, `WAITING_FOR_SUPPORT`, `RESOLVED`, and `CLOSED`. State changes use optimistic version checks and immutable ticket events. Closed tickets cannot receive messages. A customer reply to a resolved ticket safely reopens it as waiting for support.

The default first-response target is five business days. Admin now manages the timezone, business weekdays, opening/closing time, one-to-ten-day response target, approaching-alert threshold, holidays, and optional shift-gated assignment at `/admin/support/settings`. Each new ticket snapshots its exact due and approaching timestamps so later policy changes cannot rewrite historical promises. The protected SLA maintenance endpoint uses those snapshots, records escalation, and creates idempotent in-app alerts for the assigned agent and administrators. A production scheduler must invoke it with the maintenance bearer secret.

Automatic assignment considers only active Customer Service accounts that are available, accepting new tickets, and below their configured active-ticket capacity. Assignment selection compares utilization ratios rather than raw ticket totals so differently sized workloads remain balanced. A database advisory lock serializes assignment decisions and prevents concurrent intake from silently exceeding capacity. Admin configures availability, assignment acceptance, capacity, languages, and a handover note from the web application; updates use optimistic version control and audit logs.

Admin can record a quality review only after a ticket is resolved or closed and has an assigned agent. Reviews contain a 1–5 score, outcome, evidence summary, and a mandatory action for coaching/escalated outcomes. Reviews use optimistic version control, create audit evidence, notify the agent, appear in the agent workspace, and contribute to rolling 30-day Admin/agent metrics.

## Privacy and security boundary

- Unassigned queue responses contain account type and ticket context but no customer name, email, or phone.
- A Customer Service agent can read full customer context only after the ticket is assigned to that agent.
- Customer access requires the customer's own ticket and a customer-portal session; a different portal session cannot reuse that identity to read or reply.
- Another customer or another agent receives a not-found response rather than resource-existence information.
- Internal staff notes never appear in customer APIs or pages.
- Customers cannot create internal notes or control priority/assignment.
- Admin can monitor transcripts, assign/reassign, reprioritize, and escalate, but cannot publish replies, internal notes, or Customer Service lifecycle resolutions.
- Customer Service access cannot be removed while the agent owns an active ticket. Safe revocation removes the role and immediately revokes all active support sessions.
- Payment, provider credentials, internal costs, and unrelated customer records are never returned.
- Every creation, reply, assignment, escalation, state change, role grant/revocation, and sensitive access denial is audited.

## Deliberately gated work

This increment uses durable REST APIs and server-rendered refreshes. WebSocket presence, typing indicators, instant queue push, secure file upload, chatbot transcript handoff, and external email/SMS delivery require approved production infrastructure and providers. The current system must not claim those capabilities are live.

## Exclusive Customer Service boundary delivered

Customer-facing support is exclusive to active users holding the dedicated Customer Service role in the separate Support portal. Customers communicate only inside their own tickets, and assigned agents access only their authorized queue and assigned customer context. Sellers, Warehouse, Inspector, Logistics, Admin, and unrelated roles cannot answer customer-support tickets.

Admin remains responsible for staffing, assignment, priority, SLA oversight, audit review, abuse investigation, and policy configuration. The server rejects and audits Admin reply and lifecycle attempts. No emergency reply override exists. If the owner later approves one, it must be a separately reviewed, time-limited, reason-required, MFA-protected, fully audited break-glass workflow.

## Verification

`npm run test:support-workflow` verifies trusted-origin enforcement, private attachment references, payload-bound idempotency, capacity-aware auto-assignment, offline claim rejection, unassigned-queue PII minimization, customer-portal and assigned-agent row isolation, internal-note privacy, exclusive Customer Service replies, SLA evidence, resolution/reopen, immutable customer-only satisfaction, Admin oversight-only controls, versioned quality reviews and agent feedback, safe role grants/revocation and session invalidation, denial auditing, notifications, and customer/agent pages.
