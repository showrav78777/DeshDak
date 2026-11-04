# Browser mutation security boundary

## Outcome

Every `/api/v1` request that both changes data and carries a Crossly browser-session cookie must provide same-origin browser evidence. The check executes in the Next.js proxy before route code or database work.

## Enforcement

- `GET`, `HEAD`, and `OPTIONS` remain safe/read-only and do not require an `Origin` header.
- Anonymous requests and future Flutter/API requests without browser cookies are not subjected to cookie-CSRF checks; their endpoint authentication and authorization still apply.
- `POST`, `PUT`, `PATCH`, and `DELETE` requests carrying either supported browser session cookie require an exact same-origin `Origin` value.
- Missing, opaque (`null`), malformed, or foreign origins are rejected with `403 UNTRUSTED_ORIGIN`.
- A `Sec-Fetch-Site: cross-site` signal also causes rejection.
- Rejections use the standard JSON error envelope, disable caching, and retain the request correlation ID.

## Compatibility boundary

External signed webhooks and internal service jobs must authenticate without a Crossly browser cookie. Future Flutter clients must use their dedicated bearer/refresh-token model and therefore remain independent of browser CSRF protection. Cross-origin credentialed browser access is intentionally unsupported.

## Verification

Pure rule tests cover safe methods, non-cookie clients, valid same-origin requests, missing and opaque origins, malformed origins, foreign origins, and Fetch Metadata conflicts. Runtime verification confirms the proxy blocks requests before route validation while allowing anonymous and same-origin requests through.
