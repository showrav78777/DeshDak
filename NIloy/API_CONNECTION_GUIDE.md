# Connect DeshDak to external services

Reviewed 11 November 2026 against repository code and the official references below.
This is an account/setup checklist, not certification that services are live.
Use Admin → System → Live setup guide to track configuration and acceptance.

## Start here

1. Establish your business domain, HTTPS staging and production environments, and a deployment secret manager. Keep production and test accounts separate.
2. Connect transactional email and Google sign-in, then test account recovery and verification.
3. Configure the conversational assistant with a restricted server-side API key and usage controls.
4. Select one SMS provider; finish its delivery adapter before enforcing phone verification for real customers.
5. Obtain a supplier sandbox and capability documentation before paying for a long-term plan. Keep supplier activation locked until integration acceptance.
6. Add WhatsApp if you want that notification channel. It is separate from SMS and email.
7. Complete payment, private storage/scanning, backups and monitoring through the linked guides before launch.

Do not paste credentials into chat, this folder, Git or customer-facing Admin fields.
Environment variable names below describe current code; they do not prove a working connection.
Deployment secrets require a restart/redeployment. Admin supplier settings store secret references, not credentials.

## 1688: official access

Your supplied solution page could not be inspected because browser site-safety policy blocked access. Its account-specific eligibility and permissions remain unverified; no alternate access was attempted after the block.

Use your own 1688 Open Platform console and ask its support which application category permits DeshDak to serve downstream customers. Do not assume a self-use solution permits a customer-facing marketplace. Alibaba's public partner agreement describes approved partner roles and commerce capabilities, but it does not establish your account's access. See the [official partner agreement](https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20231024161027594/20231024161027594.html).

Owner steps:

1. Register/verify the eligible developer/business account and complete the platform's current onboarding requirements.
2. Create the approved application and request the exact capabilities: keyword/image/link search, product details, SKU/variant stock and price tiers. Request purchasing, tracking, cancellation and refunds separately if needed.
3. Obtain the application identifier/secret and any authorization credentials required by that application's documentation. Confirm authorized merchants/accounts, expiry/refresh rules, signing method, quotas, commercial/content rights and sandbox availability.
4. Supply the approved documentation and credential **reference names** to the deployment operator. Do not share secret values here.
5. Register in Admin → Source integrations, then complete the adapter, secret resolution, normalization, risk filtering, health checks and controlled tests before activation.

Current code: `SOURCE_1688_API_KEY` is a placeholder for an **unconfigured adapter**. Filling it does not enable search or buying. No working supplier OAuth callback has been established; do not register an invented callback URL.

## Pinduoduo: official access

Start at the [official developer platform](https://open.yangkeduo.com/application/). Its public page is JavaScript-only here, so your private console must establish eligibility, application category, scopes and credentials.

Complete developer certification, create the permitted application and confirm whether it supports your purchasing model. Ask specifically about search, image search, SKU details, stock, pricing, orders and logistics. Affiliate/promotion access must not be treated as authorization to purchase on customers' behalf.

Obtain the client identifier/secret and authorization/token information specified by the approved API package. Confirm quotas, token lifecycle, account/merchant authorization, data-use rights and refund coverage. Engineering must then implement and certify those approved endpoints. `PINDUODUO_API_KEY` currently selects an unconfigured adapter; it is not a completed connection.

## Alternative: one supplier aggregator

An aggregator gives one commercial API interface to multiple marketplaces. It can reduce the number of interfaces DeshDak must maintain, but coverage, licensing, cost and uptime become dependencies on that provider.

The existing OTAPI transport is read-only: `SearchItemsFrame` and `GetItemFullInfo`. It is **not connected to the live source registry** and does not complete purchasing or shipment synchronization.

Request a test key and documentation from [OT Commerce](https://otcommerce.com/key-payments/otapi-documentation/). Confirm 1688 **and** Pinduoduo coverage in writing for your account; do not infer Pinduoduo access from a general catalog subscription. Before subscribing, ask for:

- Licensed search/image/detail content, SKU/stock/price-tier coverage and refresh guarantees.
- Test access, rate limits, usage costs, uptime and support commitments.
- Whether purchasing, tracking, cancellations and refunds are included or separate.
- Credential type, signing requirements and approved production hosts.

The transport expects an instance key, optional signing secret and explicit approval/secret resolution. There is no automatic “paste a key and connect both marketplaces” switch. Use one approved provider path first; avoid paying for duplicate direct and aggregator access before a sandbox proves the required capabilities.

## Google login and Gmail are different

For Google login/signup, create a Google Cloud project, configure branding/consent and create a Web application OAuth client following [Google's OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect).

Set these server-side:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Optional `GOOGLE_OAUTH_REDIRECT_URI`, which must match the application's callback exactly.

Register `https://YOUR-DOMAIN/api/v1/auth/oauth/google/callback` using the actual production domain. A separate local test client can register `http://localhost:3000/api/v1/auth/oauth/google/callback`. Keep each environment's base URL, credentials and registered redirect consistent.

The OAuth implementation exists. Test signup, returning login, denial/cancellation, email/account-linking boundaries and session expiry before production acceptance.

**Gmail API is not required to send verification emails with the current implementation.** Gmail mailbox access is a separate, unimplemented feature with separate scopes and token management; sensitive/restricted scope review may apply. See [Gmail authorization scopes](https://developers.google.com/workspace/gmail/api/auth/scopes). Google sign-in does not grant the app permission to read inboxes.

## Email verification, password recovery and notifications

The code uses Resend. Email verification is an application workflow using that email sender; it does not require another verification API subscription.

1. Create a Resend account and verify a domain/subdomain you own using its DNS instructions. Public Gmail addresses cannot substitute for an owned sending domain. See [verified domains](https://resend.com/docs/dashboard/domains/introduction).
2. Configure `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` and an independent 32-byte base64 `EMAIL_SUPPRESSION_HASH_KEY` in the deployment secret manager.
3. Keep `EMAIL_DELIVERY_ENABLED=false` during setup. Register the implemented HTTPS webhook at `https://YOUR-DOMAIN/api/v1/notifications/email-events` and configure delivery scheduling.
4. Certify controlled deliveries, verification-link expiry/reuse, password recovery, bounces, duplicate/out-of-order receipts and suppression. Provider acceptance is not proof of inbox delivery.
5. Enable delivery only after acceptance; monitor queued age, failures and receipt status.

Follow [the detailed email checklist](EMAIL_LIVE_SETUP.md) for migrations, scheduler and webhook steps. The email adapter exists, but account/DNS setup and real provider acceptance remain required.

## OpenAI conversational assistant

Create an API project, arrange API billing/model access, and use a project service-account key for deployment. Store it server-side following [OpenAI's API-key guidance](https://developers.openai.com/api/docs/guides/api-keys).

Set `OPENAI_API_KEY`; optionally set `OPENAI_CHAT_MODEL`. The current code default is `gpt-5.5`; confirm your project has access to the configured model. Configure usage monitoring and application-enforced limits; budget alerts alone must not be assumed to stop spending.

The app calls the Responses API with `store:false` and redacted public-shopping context. Its REST response parser was corrected to read completed assistant text from `output[].content[]`, rather than relying on the SDK convenience field. See [official text-generation documentation](https://developers.openai.com/api/docs/guides/text).

Run `npm run test:ai-provider-response` for simulated parser/failure tests. Then perform approved live staging tests of normal conversation, public catalog facts, private-data denial, quota/timeouts and fallback. No paid requests were made for this change. This does **not** connect image/vector search: its reviewed provider, private-upload scanning/retention and catalog integration remain separate engineering work.

## Mobile messages / phone verification

Choose one contracted SMS provider with confirmed Bangladesh delivery, sender registration and destination coverage. Obtain its API documentation, sandbox, credentials, sender identity and delivery-receipt requirements. Check [Bangladesh SMS guidelines](https://www.twilio.com/en-us/guidelines/bd/sms) if considering Twilio; confirm actual account eligibility and pricing before purchase.

**Current limitation:** `SMS_PROVIDER_API_KEY` and `SMS_PROVIDER_SENDER_ID` are reserved placeholders. No sending adapter is connected, so production code requests and confirmations now return unavailable even when keys or the development flag are set. The profile hides code-entry controls and explains the unavailable service. Existing verified numbers remain verified; ordering guards are not bypassed. Explicit `development`/`test` mode with `ALLOW_DEV_AUTH_LINKS=true` generates a local test code, clearly says no SMS was sent, and creates no SMS outbox record.

Engineering must implement authenticated delivery, bounded retries, expiry handling, receipts, spend/abuse limits and truthful delivery status; then test controlled numbers and invalid/expired codes. A reviewed sender and acceptance must replace the current unavailable gate before enabling live verification.

[Twilio Verify](https://www.twilio.com/docs/verify/api) is a managed OTP alternative. Choosing it requires changing both request and confirmation to its verification workflow; its service credentials cannot simply be inserted into the generic placeholder fields.

## WhatsApp

WhatsApp delivery is not connected. A schema channel named `WHATSAPP` does not implement sending, templates or callbacks.

Choose Meta Cloud API directly or a supported business messaging provider. Arrange business onboarding, a WhatsApp Business Account, a registered business sender number, production credentials, required permissions, customer opt-in and approved templates. Confirm the provider's account-specific onboarding requirements. Twilio offers a [WhatsApp sandbox and setup guide](https://www.twilio.com/docs/whatsapp/quickstart); sandbox access is not production sender approval.

Engineering still needs the sender adapter, secret resolution, template mapping, authenticated webhook/signature validation, delivery receipts, retry/idempotency controls and opt-out handling. No working WhatsApp callback or supported environment-variable contract exists in this project yet. Do not put credentials in invented fields.

## Other launch dependencies

- **Payments:** approved merchant account, sandbox/live credentials and webhook/refund/reconciliation certification. The merchant must confirm international card acceptance, permitted customer countries/currencies and settlement with the chosen gateway.
- **Files:** private object storage, KMS/encryption, scanner deployment, authorized upload/download lifecycle, retention and restoration. See [private storage prerequisites](PRIVATE_PHOTO_STORAGE_SETUP.md) and [scanner setup](MEDIA_SCANNER_SETUP.md).
- **Hosting:** HTTPS domain, database, deployment secrets, workers/schedules, monitoring and verified backups. See [Docker/AWS setup](DOCKER_AND_AWS_SETUP.md).
- **Physical logistics:** approved route/rate data, warehouse measurements and courier/carrier acceptance. Supplier API access does not create carrier integration or final shipping prices.

## What to provide next

Share service **names and setup status only**: chosen supplier path, selected SMS/WhatsApp providers, Google project/consent status, Resend domain verification status and OpenAI project/model availability. Keep credentials in the deployment secret manager. Missing adapters, security clearance and live acceptance remain engineering work, not tasks that adding keys can finish.
