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
