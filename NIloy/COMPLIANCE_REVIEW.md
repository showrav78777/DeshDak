# Review a restricted-goods case

1. Sign in to the Compliance portal and complete MFA. Admin can also review cases
   under Compliance in its own portal; rule configuration remains Admin-only.
2. Open the pending screening and check the customer/product, route and matched
   rule codes. Follow the approved business policy and evidence review process.
3. Choose **Approve exact retry** or **Reject** and write the evidence/reason.
   Approval applies to this exact screening, not a general exemption from rules.
4. Press **Record decision** once. Wait for saving and queue refresh to complete.
5. If the decision could not be confirmed, refresh the queue and inspect the case
   before retrying. A timeout does not establish that the save failed.
6. If another reviewer already changed the case, refresh and use the current
   result. If access changed, sign in again with an authorized MFA account.

The system checks current access and screening version when saving. Hard blocks
remain enforced. This improvement needs no new owner setting or API key. Final
business/compliance policy and production acceptance remain separate requirements.

## Admin: maintain screening rules

1. Sign in to Admin with MFA and open Compliance.
2. Enter a unique rule code, name, action, customer-safe message and matching
   keywords or HS prefixes. Select country scope and effective dates if needed.
   Use only an approved business policy; test with synthetic phrases in staging.
3. Press **Create draft rule** once. After confirmation, check the new draft in
   the list. Creation does not activate the rule.
4. Use **Activate or schedule** to apply it now or at its future start time.
   Current rules are applied to catalog visibility; test effects before release.
5. **Pause** temporarily stops a rule. **Archive** is terminal; create a new draft
   for a replacement rather than trying to reactivate an archived record.
6. If a save could not be confirmed, refresh and check the rule's code/status
   before retrying. Resolve version conflicts using the current saved record.

No new owner configuration is required for these control/security fixes.
