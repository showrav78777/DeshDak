# Payment settlement reconciliation increment

## Outcome

Finance can import a bounded SSLCommerz merchant-panel settlement report from the protected web portal. The server matches each row against Crossly payment evidence and creates an exception queue without automatically changing a payment, order, wallet, refund, or ledger balance.

## Controls

- Finance or Admin portal session with completed MFA.
- Same-origin mutation and mandatory idempotency key.
- Maximum 1,000 rows per import; exact decimal, currency, date, and net/gross/fee validation.
- Exact match requires the Crossly transaction reference, `SUCCEEDED` local status, currency equality, amount equality, and no unresolved risk flag.
- Missing, non-successful, mismatched, duplicated, and held payments remain exceptions.
- Imported batches and rows are immutable at the database layer; the import action is audited.
- Credentials and uploaded files are not persisted. Only normalized reconciliation evidence and SHA-256 fingerprints are stored.

## Operator workflow

1. Download the settlement report from the authenticated SSLCommerz merchant panel.
2. Convert only the required evidence into the displayed Crossly CSV template.
3. Sign in to `/finance/login` with MFA and open `/finance/payment-reconciliation`.
4. Enter the provider report reference, date, currency, and rows; import once.
5. Investigate every exception against the merchant panel and bank evidence. Do not mark funds resolved merely because the browser return page showed success.

## Exception resolution

- A Finance or Admin user proposes a resolution type, detailed reason, and external evidence reference.
- Corrected-payment proposals are accepted only when the replacement reference identifies an exact successful payment for the same provider, currency, and gross amount and has not already been settled.
- A different Finance or Admin user must approve or reject the proposal. The database independently rejects self-review.
- A rejected proposal remains immutable and a corrected proposal may be submitted. An approved resolution permanently closes further proposals for that entry.
- Proposals and decisions are append-only, idempotent, audited records. Resolution classifies the reconciliation evidence only and never changes payments, orders, refunds, wallets, or ledger entries.

## Deliberately out of scope

- Automated merchant-panel report retrieval, because no documented settlement-report API was found.
- Original-method refund initiation and refund-status synchronization.
- Automated bank-statement matching or provider dispute submission. Confirmed chargebacks now use this queue's existing maker/checker control and post one balanced company-side journal only when the duplicated provider row exactly matches a successful payment and no refund overlaps it.
- Production gateway activation. These remain fail-closed until provider and owner certification is complete.
