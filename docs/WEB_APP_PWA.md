# Crossly Web App and PWA Policy

## Delivery order

1. Complete and stabilize the responsive web application.
2. Validate the production HTTPS deployment on supported mobile and desktop browsers.
3. Build Flutter Android and iOS clients later against the same `/api/v1` contracts.

## Installation

- Android and supported desktop browsers can use the in-app **Install app** control or the browser installation menu.
- On iPhone and iPad, use **Share → Add to Home Screen**.
- The installed application opens in standalone mode and includes shortcuts for products, customer orders, and the Warehouse scanner.
- Authentication, role checks, human verification, cookies, sessions, and API authorization work the same way in an installed web app as in the browser.

## Security and caching

- The service worker caches only public application icons.
- It does not cache HTML pages, API responses, authentication data, orders, wallet information, admin pages, or warehouse tasks.
- Camera access is limited to this origin and still requires explicit browser/user permission.
- Production installation requires HTTPS, a valid certificate, and testing on the approved device/browser matrix.

## Flutter readiness

Web pages remain separate from the backend contracts. The later Flutter applications must use the existing versioned APIs and their mobile authentication/session model; they must not scrape or embed the website.
