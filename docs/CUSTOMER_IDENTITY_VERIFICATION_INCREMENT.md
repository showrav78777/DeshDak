# Customer identity and phone verification increment

## Ordering gate

The order API now rejects a new checkout unless the customer has both a verified phone number and `KycStatus.VERIFIED`. This is enforced inside the serializable checkout transaction, so changing browser UI state cannot bypass it.

## Phone verification

Customers request a six-digit, single-use code from their Profile page. Codes are HMAC-hashed in `SecurityToken`, expire after ten minutes, are rate limited by trusted client/IP and phone, and are never returned in production responses. An encrypted SMS delivery payload is queued for the approved notification provider. Development may display a code only when `ALLOW_DEV_AUTH_LINKS=true`.

## Identity workflow

Customers select one approved document category: National ID (NID), Passport, or Driving Licence, enter only the issuing country and final four document characters, and upload one clear JPEG, PNG, or WebP photo up to 5 MB. The photo is signature-checked, AES-256-GCM encrypted before it is stored, has no public URL, and can be opened only by a signed-in Compliance reviewer through a no-store response. The customer cannot approve their own identity. Each submit and reviewer view is audited.

The current document-photo implementation is intentionally **development/staging-only** and is enabled only with `ALLOW_DEV_KYC_DOCUMENT_UPLOADS=true`. Production image/PDF intake remains blocked until private object storage, upload malware scanning, metadata removal, retention/deletion rules, access logging, restricted reviewer access, and a legally reviewed privacy/retention policy are connected and approved. Do not bypass that guard by setting a feature flag in production.

## Owner configuration still required

- Connect and test an approved SMS provider using `SMS_PROVIDER_API_KEY` and `SMS_PROVIDER_SENDER_ID` in deployment secrets.
- Approve the KYC evidence collection, reviewer procedure, retention period, privacy notice, escalation rules, and Bangladesh legal/compliance thresholds.
- Do not use the fictional demo identities or development OTP display in production.
- Implement and certify the production KYC evidence adapter before enabling real document uploads. It must scan before persistence, strip metadata, store encrypted objects under randomized private keys, enforce a retention schedule, and record every access.
