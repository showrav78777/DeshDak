# DUAR-360 supplier access: owner setup

## What is ready, and what is not

Implemented: read-only OTAPI request transport, signing, bounded input/response
handling, offline tests, an internal product-candidate validation contract and
Admin source/account configuration with activation locks and setup guidance.

Not implemented/live: secret-manager resolution, provider-specific product/variant
mapping, automatic catalog import, supplier purchasing/cancellation/tracking,
distributed quota enforcement, live health checks and provider-specific image search.
Supplying keys alone will not complete these workflows. Do not launch or accept
supplier-dependent customer orders based on these offline checks.

## Where to obtain access

For an aggregator trial, contact OT Commerce through
https://otcommerce.com/pinduoduo-api-dropshipping/ or its official account portal
https://account.otcommerce.com/ . Ask for API-only trial access covering both 1688
and Pinduoduo, rather than a replacement hosted storefront. Confirm marketplace
coverage and contractual rights before paying. Verify current pricing directly.

For direct integrations, apply separately through https://open.1688.com/ and
https://open.pinduoduo.com/ . Each provider must confirm your business eligibility,
permissions and authorization requirements. Direct integration is not currently
implemented; an official key cannot be used as an OTAPI instance key.

## Message to send to the provider

We operate DUAR-360, a cross-border commerce platform initially sourcing from China
to Bangladesh. Please provide trial API access for 1688 and Pinduoduo and confirm:

- Product search, product details, variants/SKUs, stock freshness and image-search support.
- Catalog coverage, permitted display/caching of content and image licensing.
- Whether purchasing, cancellation, refunds and tracking are supported for our account,
  or require a separate purchasing agent. Please do not treat catalog access as order access.
- Supported buyer account authorization and origin-warehouse delivery arrangements.
- Current API documentation/export, version, provider identifiers and redacted example
  requests/responses for each enabled capability.
- Signing/token renewal requirements, credential expiry and safe secret delivery.
- Rate limits, daily/monthly allowances, per-call and full-detail charges, trial limits,
  service availability and support arrangements.

Please send documentation separately from secrets; provide a secure credential
provisioning method. We will perform compatibility testing before a paid commitment.

## Where to add configuration

1. Sign in as Admin and complete MFA.
2. Open `/admin/source-integrations` (Admin > Source integrations).
3. Create or edit the appropriate source records; avoid duplicates. Use China (`CN`)
   as the source/origin country. Destination shipping is configured separately.
4. Keep sources inactive. Capability checkboxes record intended configuration only;
   they do not install or verify an adapter. Do not enable unsupported capabilities.
5. Ask the infrastructure administrator to provision an approved secret manager.
   Its resolver must be implemented and verified for this deployment before use.
6. Store the actual instance key/signing secret (or official app credentials) there.
   Never put credentials in chat, source control, client variables or these forms.
7. Add an inactive account with only its reference, for example
   `secret://duar/sourcing/trial`. This is illustrative, not a pre-provisioned secret.
8. Enter the provider-approved request limits, daily budget and expiry if applicable.
   Record trial budgets conservatively. Saving does not contact the supplier.
9. Give engineering non-secret identifiers, API exports and redacted fixtures. Then
   verify the chosen connector, secret lookup, normalization, compliance, usage audit,
   quota controls and live trial responses. Operations approval remains required.

## Acceptance before activation

Both sources need verified search/detail/variant behavior and explicit stock semantics.
No public DTO may expose supplier identifiers or raw prices. Currency conversion must
use the existing FX/pricing workflow. Product media needs approved storage and content
validation. Purchasing needs separate authorization, idempotency, audit and reconciliation;
tracking needs documented event mapping and warehouse receiving linkage. An aggregator
catalog subscription is not evidence that these capabilities are granted.

Local checks: `npm run test:source-settings-request`, `npm run test:source-readiness`,
`npm run test:otapi-client`, `npm run test:supplier-candidate`, `npm run typecheck`.
The four supplier suites are also included in the launch-verification runner.
These tests use synthetic fixtures and do not prove live connectivity.
