# Support Satisfaction Increment

## Outcome

After an assigned Customer Service agent resolves a ticket, the owning customer can submit one private satisfaction response from the Crossly web application. The response records a one-to-five score, whether the customer considers the issue resolved, an optional comment, the ticket version being rated, and the submission time. The same versioned endpoint is suitable for the future Flutter application after mobile bearer authentication is added.

## Customer workflow

- Open the resolved or closed request at `/support/{ticketId}`.
- Select a one-to-five rating and confirm whether the issue was resolved.
- A comment is required for scores of one or two or when the issue is not resolved.
- Submit once. The response is immutable and cannot be edited or replaced.
- The submitted summary remains visible on the customer's own ticket.

The support home page now reads its first-response target, timezone, and operating hours from the protected Admin policy instead of hardcoded customer-facing wording.

## Authorization and privacy

- Only the ticket owner using the Customer portal can submit feedback.
- The ticket must be resolved or closed, have a resolution timestamp, and have an assigned agent.
- Another customer, another portal, or a staff role cannot submit feedback for the customer.
- Admin can read feedback only in protected support oversight. A Customer Service agent can read feedback only for their assigned ticket and in their own aggregate metrics.
- The customer's raw comment is not copied to audit metadata or notification bodies.
- Low scores or unresolved responses generate a generic, protected in-app alert for active administrators. No external delivery provider is implied.

## Data integrity and API

`POST /api/v1/tickets/{ticketId}/satisfaction` requires a trusted browser origin, strict JSON validation, and an `Idempotency-Key` header. A SHA-256 request fingerprint binds the key to the customer, ticket, and validated payload. Safe retries return the original response, changed retries fail with a conflict, and a unique ticket constraint prevents duplicate responses under concurrent requests.

The database preserves the assigned agent and ticket version at submission time. An audit event records the score, resolved flag, agent, and immutable rating identifier without duplicating the private comment.

## Reporting

- Admin `/admin/support`: rolling 30-day customer satisfaction, customer-confirmed resolution rate, and follow-up count.
- Admin `/admin/support/{ticketId}`: complete authorized satisfaction response.
- Agent `/support/tickets`: the signed-in agent's rolling 30-day customer rating and confirmed-resolution rate.
- Agent `/support/tickets/{reference}`: feedback only for the assigned ticket.

## Verification

`npm run test:support-workflow` verifies premature-submission rejection, cross-customer and cross-role denial, trusted-origin protection, immutable one-response enforcement, payload-bound idempotency, audit privacy, generic Admin follow-up notification, and authorized customer/agent page visibility.

## Production follow-up

The owner must approve the customer wording, whether and when supervisors contact dissatisfied customers, response-retention rules, CSAT targets, minimum reporting sample size, complaint/escalation ownership, staff coaching policy, and whether aggregate results may ever be published. External email/SMS/push delivery and analytical warehousing remain gated on approved providers, privacy review, and production infrastructure.
