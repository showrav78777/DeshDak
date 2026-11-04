# Crossly staging role acceptance

Use this checklist after staging has realistic launch data and separate role accounts. Record evidence links, the tester, date, and any defect ID beside every checked item. A shared account is not acceptable evidence.

Track the four required staging milestones through `/admin/launch-readiness` using the baseline gates `staging-environment`, `role-journey-acceptance`, `device-accessibility-acceptance`, and `release-freeze-approval`. Store only safe ticket/report references and review summaries there—never credentials, tokens, personal identity documents, or raw secrets. A milestone may be verified only after every applicable checklist item below has acceptable evidence.

## Entry gate

- [ ] Staging uses HTTPS, a staging-only database, staging-only secrets, and production-like storage.
- [ ] The current migrations are applied and the complete `npm run verify:launch` gate passes.
- [ ] Test products, prices, fees, FX values, country lane, warehouse, shipping rates, and policies are approved—not invented.
- [ ] Each role below has its own least-privilege account; privileged roles have MFA and recovery tested.
- [ ] Browser console, server logs, audit events, and notification delivery can be inspected during the run.

## Anonymous visitor

- [ ] Browse the homepage, products, categories, Bangladesh stores, public product detail, Trust Centre, Help Centre, and Support.
- [ ] Use keyword search and the homepage image/AI entry controls without signing in.
- [ ] Confirm private prices, provider identities, internal costs, unpublished products, and other users' data are never exposed.
- [ ] Start Cart, Wishlist, quote/order, and account-specific actions; confirm sign-in is required and the intended destination is preserved.
- [ ] Install and reopen the PWA on one supported desktop browser and one real mobile device.

## Customer

- [ ] Register, verify email/phone as configured, sign in, sign out, recover access, and revoke another session.
- [ ] Manage profile and addresses; add an approved product/variant to Wishlist and Cart.
- [ ] Submit a Buy & Ship order for Admin review and confirm no supplier purchase occurs automatically.
- [ ] Complete the real sandbox checkout, including success, cancellation, duplicate callback, and failed-payment cases.
- [ ] View the immutable order code, QR/barcode where authorized, timeline, notifications, invoices, wallet entries, refund, and support history.
- [ ] Confirm another customer cannot read or change any of these records.

## Bangladesh seller

- [ ] Apply, complete verification, create the store identity/logo/details, and wait for approval before public visibility.
- [ ] Create a product with variants, dimensions, origin, price, inventory, images/video, and compliance data; verify moderation prevents premature publication.
- [ ] Preview/import a valid and invalid CSV without partial unsafe writes.
- [ ] Configure a seller-product connector only with approved credentials; confirm missing or invalid configuration fails closed.
- [ ] Receive an order, prepare it, print/use identifiers, and confirm the seller cannot access another store or Admin-only data.

## Admin

- [ ] Sign in with MFA, use the left navigation, search operational records, sign out, and revoke sessions.
- [ ] Review and approve/reject sellers, stores, products, country lanes, categories, and operational configuration through the web application.
- [ ] Review a customer order, record the purchase decision, and verify every transition creates an immutable audit event.
- [ ] Manage staff roles without privilege escalation or shared credentials.
- [ ] Send a consent-filtered test notification/campaign, review delivery/reporting, schedule one, and cancel one.
- [ ] Confirm secrets cannot be entered into ordinary Admin content fields or returned by any UI/API response.

## Sourcing and Compliance

- [ ] Sourcing processes an approved order using the authorized operational reference without exposing provider identity to the customer.
- [ ] Compliance reviews restricted-goods classification and approves/rejects with recorded reasons and evidence.
- [ ] Invalid state transitions and self-approval beyond policy limits are rejected server-side.

## Warehouse and Inspector

- [ ] On a real phone/scanner, Warehouse signs in separately and scans product, order, shipment, QR, and 1D barcode identifiers.
- [ ] Receive, locate, consolidate, measure, weigh, and hand off a test package; verify every update appears in the customer timeline only when appropriate.
- [ ] Print and scan the 80 mm label on the intended printer; confirm no PII or secret is encoded in QR/barcode payloads.
- [ ] Inspector records pass/fail, photos/evidence, discrepancy, and reinspection; confirm files are private and access-controlled.
- [ ] Test duplicate scans, damaged labels, unknown codes, offline/poor Wi-Fi recovery, and wrong-role access.

## Logistics

- [ ] Create/assign the approved shipment method and carrier reference, then move the package only through allowed states.
- [ ] Test customer-visible tracking updates, delivery evidence, failed delivery, return, and reconciliation.
- [ ] Confirm rates, weight, fees, and destination follow the approved lane configuration.

## Customer Service

- [ ] Receive a customer request, reply, assign/escalate, meet/violate the test SLA, and close/reopen according to policy.
- [ ] Handle AI-to-human handoff without exposing another user's conversation or trusting client-supplied identity.
- [ ] Confirm Customer Service cannot perform Finance, Compliance, Warehouse, or Admin-only actions.

## Finance

- [ ] Reconcile payment, order charges, fees, refund, wallet credit/debit/hold/release, settlement, and immutable journal entries.
- [ ] Exercise full and partial refund rules, duplicate webhook/idempotency behavior, failed settlement, and chargeback test cases.
- [ ] Confirm balances cannot be edited directly and another role cannot approve restricted financial actions.

## Exit gate

- [ ] No open P0 or P1 defect; every accepted risk has a named owner and deadline.
- [ ] Payment, email, CAPTCHA, storage/media scanning, carrier, scheduler, monitoring, backup/restore, rollback, and incident contacts have real staging evidence.
- [ ] Desktop and real-device mobile runs pass; accessibility and keyboard checks cover the critical journeys.
- [ ] Logs and audit records contain useful correlation identifiers but no password, token, secret, raw payment data, or unnecessary PII.
- [ ] The release commit/image, migration version, environment inventory, test evidence, rollback decision, and launch approver are recorded.
