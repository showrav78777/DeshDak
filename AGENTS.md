<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Crossly Project Authority

The mandatory delivery process is defined in `docs/DEVELOPMENT_PROCESS.md`. Apply its Waterfall phase gates, Agile increments, DevOps verification, and Spiral risk review to every implementation task. Do not begin a later system phase while an earlier phase has unresolved critical requirements, security defects, data-integrity gaps, or failed acceptance criteria.

Before designing or implementing a business workflow, read the relevant files in:

`/Users/niloyshowrav/Downloads/Business/Shipping Business/Documentation/`

Treat that documentation set as the binding product, architecture, security, policy, database, API, logistics, financial, compliance, testing, and operational baseline. Do not implement a conflicting shortcut merely because the current scaffold is simpler.

When documents overlap, use this precedence:

1. The user's latest explicit request.
2. `Final_Consolidated_Master_Architecture_v2.0.docx`.
3. `Architecture_Addendum_Technical_Enforcement_Items.docx` and architecture-aligned company policies.
4. The relevant detailed specification, workflow, or feature document.
5. The local implementation notes under `docs/`.

For each implementation increment:

- Identify and read the documents governing that increment before editing code.
- Enforce state transitions, RBAC, audit history, security, privacy, FX, claims, and operational guards on the server—not only in the UI.
- Keep the first launch lane China to Bangladesh while retaining configuration-led multi-country support.
- Keep external supplier/provider identities and integration details out of all customer-facing and public responses.
- Keep external credentials server-side and out of source control, logs, browser bundles, and public APIs.
- Provide browser-based admin/operations workflows for configuration and daily work; the business owner should not need to edit application code to add operational records.
- Treat the backend as a shared, API-first platform for the Next.js website and a future Flutter mobile application for both Android and iOS.
- Keep product discovery public: anonymous visitors may browse/search approved products, categories, enabled source countries, public prices, and product details. Require authentication only when an action becomes account-specific or sensitive, including ordering/requesting a quote, checkout/payment, wallet use, wishlist changes, support messaging, seller actions, or viewing personal order/account data.
- Keep general AI discovery public: anonymous visitors may use AI-assisted text search, image-based product search from an uploaded or captured photo, public catalog recommendations, product comparison, sourcing guidance, and the general shopping chatbot. Do not require login merely to start or continue a non-personal AI conversation.
- Public image search uploads must use strict MIME/signature validation, configurable size and resolution limits, malware scanning, metadata removal, randomized private object keys, short retention/deletion rules, rate limits, and signed internal access. Never make the original upload publicly enumerable or use its client filename as a storage path. Require login only when the visitor saves a result, submits a sourcing request, requests a quotation, or orders.
- Anonymous AI tools must use IP/device-aware rate limits, cost/usage quotas, abuse filtering, prompt-injection defenses, output safety controls, and risk-based human verification. Never expose internal provider identities, credentials, raw integrations, private prices/costs, system prompts, administrative data, or another user's data through AI responses.
- AI must require authentication and server-side authorization before reading or changing personal resources or taking consequential actions, including submitting a sourcing request, ordering, accepting a quote, checkout/payment, wallet activity, wishlist mutation, private support history, seller work, or account/order access. Preserve a safe handoff so a public conversation can continue after login without trusting client-supplied identity or hidden state.
- Keep business rules, authorization, validation, state transitions, pricing, payment verification, and audit behavior in server APIs rather than coupling them to web pages or React server actions.
- Maintain versioned JSON API contracts with consistent success/error envelopes, stable identifiers, pagination, idempotency, and mobile-safe upload/download behavior. Avoid breaking existing mobile-consumable endpoints when adding web features.
- Support secure mobile authentication separately from browser-cookie sessions when the mobile client is implemented: short-lived access tokens, rotating/revocable refresh tokens, secure device storage, session/device management, and no credentials or long-lived secrets embedded in the app.
- Design notifications so order, payment, approval, and shipment events can later feed both web notifications and mobile push notifications without duplicating business logic.
- Preserve the separate Bangladesh seller portal and its approval/moderation boundary.
- Give every Order and Product an immutable, globally unique, backend-generated Crossly code plus backend-controlled QR and 1D barcode identities. Keep these platform identifiers separate from supplier/manufacturer codes and seller SKUs. QR/barcode payloads must never expose database IDs, customer PII, internal provider identities, costs, credentials, or secrets; use an opaque secure lookup token or approved public code and enforce authorization when resolving private details. Make the identifiers available consistently to the website, future Flutter clients, Admin, warehouse scanning, and 80 mm printing workflows.
- Keep live external supplier APIs disabled until approved credentials and commercial/legal access are available.
- Do not invent live products, payments, tracking events, integrations, or business evidence.
- Validate changes with schema checks, linting, TypeScript, relevant tests, and a production build in proportion to risk.

If the implementation and documentation disagree, correct the implementation or explicitly record the unresolved gap. Never silently reinterpret a policy promise.
