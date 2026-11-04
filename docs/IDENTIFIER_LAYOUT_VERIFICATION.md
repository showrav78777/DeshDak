# Barcode layout correction — 22 October 2026

Scope: the shared order/product identifier panel, including its 80 mm print sheet. No identifier payload, API, authorization, or database changes.

The barcode previously supplied fixed 430 × 100 image attributes while CSS used the SVG's intrinsic height. SVG geometry varies with the encoded code, so this could modify only one rendered dimension and trigger Next.js's sizing warning. The panel now gives the image a positioned, responsive frame and uses Next.js `fill` with `object-fit: contain`. This preserves the SVG without cropping or stretching. Print styling sizes the frame to the existing 70 × 18 mm area inside the label.

Acceptance evidence:

- `test:identifier-layout`: passed in local Chromium using the actual server-rendered component, generated synthetic Code 128 SVG, and application stylesheet at 320, 375, 768, and 1440 px. Verified nonzero responsive frame dimensions, aspect ratio, loaded contained image, no horizontal overflow, and 70 × 18 mm print area.
- ESLint for component and layout test: passed.
- TypeScript: passed.
- Identifier SVG asset/security-boundary tests: passed.
- Production build: passed.

The layout harness is isolated and does not hydrate a live authenticated page; it does not constitute a full role-workflow rerun or physical thermal-printer/scanner acceptance. The broader page review remains incomplete; the preceding 53-case browser run had 52 passes and an Admin workflow timeout. No production readiness claim is made.
