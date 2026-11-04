# Customer Service Workforce and Quality Increment

## Outcome

Crossly now applies Admin-controlled Customer Service availability and workload limits to real assignment decisions. It also provides an auditable supervisor quality-review workflow for completed tickets. The controls are available through protected web pages and versioned APIs reusable by the future Flutter application.

## Assignment rules

- Eligible agents must be active, hold the Customer Service role, be `AVAILABLE`, accept new tickets, and remain below their active-ticket limit.
- Accounts without a workforce profile retain the safe launch default: available, accepting, maximum 20 active tickets, Bengali and English.
- Automatic assignment chooses the lowest capacity-utilization ratio and then the lowest ticket count.
- Automatic intake, claims, and Admin reassignment share a serialized database lock and repeat capacity checks inside the transaction.
- If no agent is eligible, the ticket remains safely unassigned rather than bypassing workforce controls.
- Profile writes require Admin portal authorization, trusted origin, validation, optimistic version control, and an audit entry.

## Quality rules

- Only Admin oversight can create or update a review.
- The ticket must be resolved or closed and retain an assigned Customer Service agent.
- Score is restricted to 1–5.
- Outcome is `PASS`, `COACHING_REQUIRED`, or `ESCALATED`.
- Coaching/escalated outcomes require an action record.
- Updates require the current review version to prevent lost updates.
- Every review revision is audited and notifies the reviewed agent.
- The agent sees feedback only for a ticket assigned to that agent.

## Web access

- Admin workforce and rolling metrics: `/admin/support`
- Admin transcript and quality review: `/admin/support/{ticketId}`
- Agent capacity, personal metrics, and queue: `/support/tickets`
- Assigned ticket feedback: `/support/tickets/{reference}`

## Production dependencies

The owner must still approve support hours, rota ownership, language coverage, ticket-capacity policy, quality sampling frequency, pass/coaching thresholds, escalation ownership, coaching privacy/retention, and staff training. External notification channels and real-time presence remain disabled until approved providers and infrastructure are connected.
