# Public AI Chat and Customer Service Handoff Increment

## Business outcome

The homepage shopping assistant now preserves a short-lived anonymous conversation and can transfer it into the existing Customer Service queue after the visitor signs in. General product and shipping guidance remains public. The server does not access or invent private order, payment, wallet, tracking, refund, pricing, provider, or administrative data.

## Workflow

1. A public visitor opens the assistant from the unified homepage search.
2. `POST /api/v1/ai/chat` validates and rate-limits the message, applies Stage 1 safety/rule-based guidance, and stores the user/assistant turn.
3. The browser receives an opaque `HttpOnly`, `SameSite=Strict` chat cookie. Only its SHA-256 hash is stored in PostgreSQL.
4. `GET /api/v1/ai/chat` restores the safe public transcript without returning token hashes, safety labels, internal configuration, system instructions, or provider information.
5. Low-confidence, policy-sensitive, personal, or explicit human requests offer a Customer Service transfer.
6. `POST /api/v1/ai/chat/handoff` requires a valid customer session, customer portal, trusted mutation origin, and idempotency key.
7. The transaction binds the anonymous conversation to that customer, copies the complete transcript into one or more bounded ticket messages, auto-assigns the least-loaded active Customer Service agent, records the ticket event/audit/activity history, and creates transactional notifications.
8. A retry returns the same ticket. A handed-off conversation cannot be claimed by a different customer and a later public message starts a fresh anonymous conversation.

## Security and privacy controls

- No user/database identifier, identity, credential, external provider name, private cost, or hidden prompt is stored in the browser chat cookie.
- Raw cookie tokens are never stored in the database.
- Anonymous conversations expire after the Admin-configured 15–1,440 minute retention window; the safe default is 24 hours.
- The protected maintenance cleanup deletes expired anonymous transcript records in bounded batches. The copied support-ticket transcript remains part of the auditable business support record.
- Turn keys prevent duplicate user/assistant messages on normal retries.
- Ticket creation is protected against anonymous access, cross-site mutation, cross-customer ownership, duplicate transfer, and unassigned-agent transcript access.
- The assistant refuses prompt-injection attempts and does not call personal-account tools in this Stage 1 increment.
- Public and protected endpoints keep versioned JSON envelopes and no-store response headers for web and future Flutter clients.

## Admin and owner workflow

- Admin can control the chatbot status, anonymous request limit, and transcript retention at `/admin/ai`.
- Chatbot retention cannot be reduced below 15 minutes while handoff is enabled.
- Admin manages Customer Service roles at `/admin/support`; assigned agents work at `/support/tickets`.
- Customers open transferred or manually created requests at `/support`.

## Verification

Run:

```text
npm run test:ai-chat-handoff
npm run test:support-workflow
npm run test:security-cleanup
npm run api:contract
npm run lint
npm run typecheck
npm run build
```

The workflow test covers cookie protection, hashed-token storage, retention, injection refusal, public restoration, retry idempotency, authentication and origin gates, transcript completeness, load assignment, row-level privacy, notifications, audit/activity evidence, post-handoff renewal, and expiry.

## Deliberately out of scope

- WebSocket presence, typing indicators, and instant live message delivery.
- External LLM/RAG activation, semantic confidence scoring, and personal order/tracking tools.
- Production Redis/device-aware distributed throttling, queue workers, provider delivery, and advanced moderation services.

These remain fail-closed until their approved infrastructure, providers, credentials, policies, monitoring, and security reviews are available.
