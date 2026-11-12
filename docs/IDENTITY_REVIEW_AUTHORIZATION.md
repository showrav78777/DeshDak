# Identity review authorization — 13 November 2026

## Outcome

Identity decisions now recheck the reviewer's ACTIVE account, current session,
Compliance portal, role grant and MFA inside the transaction that saves the
decision. Initial request authorization still rejects invalid callers and origins.
A session/role/MFA change while the request is waiting now returns the existing
403 code without changing the submission or customer KYC status. A minimal
`identity_verification.review_denied` audit records ACCESS_CHANGED without a
document number, review note or photo.

The transaction locks reviewer/customer accounts in identifier order before the
submission update. Customer resubmission already locks its account first. This
removes the previous submission-first/account-second ordering in review and makes
replacement and review serialize through the customer account. Pending status
and submitted version remain mandatory; stale/conflicting decisions return the
existing 409. The submission decision/version, customer status and success audit
commit together. No schema, API response shape, credential or production upload
activation changed. Backend service identity comes only from the verified session.

## Acceptance

Three selected suites passed together in an owned disposable PostgreSQL database:
`test:identity-review-authorization`, `test:private-upload-workflow` and
`test:compliance-portal`.

The new suite submits real HTTP decisions and holds a database lock until the
review reaches transactional authorization. Revocation, grant removal, cleared
MFA and pending reviewer status each return 403, preserve both pending records,
write one denial audit and create no verification success audit. Concurrent
opposing reviewers produce one 200 and one 409, one version increment and one
success audit. A customer-first replacement during a held review returns 409 and
preserves the replacement and customer PENDING status. Valid rejection, untrusted
origin and customer-role boundaries are also tested. Synthetic encrypted photos
only; no real identity document or owner database was used. Disposable schema and
container cleanup completed.

Local evidence: `/tmp/deshdak-identity-review-auth-20261113.log`. The selected SQA
runner now contains 39 suites; this increment does not claim a complete 39-suite
run. The earlier full 36-suite acceptance remains the latest complete selected
run. Production/provider/cloud/device and independent security acceptance remain
separate gates. Production identity intake stays disabled pending integration.

Lint, TypeScript, production build, the 306-operation API contract, security
regressions and dependency integrity passed. Build evidence:
`/tmp/deshdak-identity-review-build-20261113.log`. No dependency gate was waived.
