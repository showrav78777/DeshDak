# Crossly launch browser acceptance

Last verified: 2 September 2026, Asia/Dhaka

## Result

The local web application passes the completed anonymous-browser and responsive smoke checks with no reproducible P0/P1 application defect. It remains a staging release candidate, not a paid public-production release, until the external gates in `LAUNCH_READINESS_STATUS.md` are complete.

## Browser evidence

Tested against `http://localhost:3000` in the Codex in-app browser.

- Homepage rendered with one primary heading, public product discovery, public Bangladesh-store discovery, source-country messaging, and provider-neutral public wording.
- The homepage uses one unified search control for keyword, image, and AI-assisted discovery; no separate search page is required to start those modes.
- Keyword search for `Laptop` navigated to `/products?q=Laptop`, showed the query and a truthful zero-result state, and produced no console error.
- `/products`, `/stores`, `/trust`, and `/help` rendered public content without requiring authentication. The empty store directory correctly reported that no approved public stores are currently seeded.
- Source verification confirmed that the store directory has a semantic `h1`; a transient locator timeout was not an application defect.
- `/login`, `/warehouse/login`, and `/admin/login` rendered their role-specific sign-in experience with a primary heading and no console error.
- Anonymous navigation to `/cart` redirected to `/login?next=/cart`, preserving the intended destination after authentication.
- At a 390 x 844 viewport, the homepage header, unified search, hero actions, and marketplace choices remained usable without a console error. The temporary viewport override was reset after testing.
- The anonymous market selector exposes only the safe Bangladesh default plus Admin-activated countries. At 390 x 844 it remained visible, the header stayed within the viewport, and no console error occurred.
- Automated HTTP acceptance additionally verified the international homepage variant against a temporarily activated destination and verified that a forged disabled-market cookie falls back to Bangladesh. A visual international-market pass remains part of staging acceptance with realistic catalog data.
- No hydration, runtime, or browser-console error was observed in the accepted routes.

## Coverage boundary

This browser pass used the current empty/limited local catalog and an anonymous session. It does not certify real payment, provider, media, carrier, email, CAPTCHA, or warehouse-device behavior.

Authenticated customer and staff workflows remain covered by the automated launch verification suite. Before production approval, repeat browser acceptance on staging with separate MFA-protected accounts for Customer, Seller, Admin, Warehouse, Inspector, Logistics, Customer Service, Compliance, Finance, and Sourcing, plus realistic approved products, orders, payments, refunds, tracking events, and media.

## Next acceptance action

The owner should now supply staging infrastructure, named test accounts, realistic launch-lane data, and approved provider sandboxes. Engineering should then execute the role-by-role staging checklist, fix only reproducible P0/P1 defects, run `npm run verify:launch`, and freeze the accepted release candidate.
