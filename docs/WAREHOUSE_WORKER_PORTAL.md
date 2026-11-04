# Dedicated Warehouse Worker portal

## Business outcome

Warehouse employees now work through `/warehouse`, a separate high-contrast, scanner-first web/PWA surface. The Admin portal remains the configuration and supervision surface. Inspector and Logistics actions remain separate roles as required by the binding RBAC and logistics documents.

## Administrator workflow

1. Create warehouses and their zones, shelves, bins, or staging locations in Admin → Warehouses.
2. Enter an existing active, verified Crossly account email and choose a warehouse.
3. The server assigns the `warehouse_worker` role and an active warehouse-specific assignment in one audited transaction.
4. Admin can deactivate or reactivate each warehouse assignment from the same page. Existing passwords are never displayed or replaced.

## Warehouse Worker workflow

1. Sign in at `/warehouse/login`. The session is bound to the `warehouse` portal.
2. Open `/warehouse/scan` and scan a QR/Code 128 value with the device camera or a handheld scanner. Manual entry remains available.
3. Scan an inbound order to confirm physical receipt and create its package at an assigned origin warehouse.
4. Scan a package, order code, or inbound tracking value to reopen the assigned package task.
5. After the separate Inspector role records a pass, record actual weight and dimensions. The backend selects the configured origin lane, calculates volumetric weight, and stores the maximum as chargeable weight.
6. Preview and print the fixed-width 80 mm variable-length label, then put the package into an assigned zone/shelf/bin/staging location.
7. Add timestamped internal operational notes when required.

## Server-side controls

- `WarehouseStaffAssignment` restricts row access to active user/warehouse pairs.
- A Customer, Seller, unassigned Warehouse Worker, or worker assigned elsewhere cannot resolve or mutate the package.
- Warehouse pages and APIs omit customer names, email, phone, address, payment details, private supplier costs, and margin.
- Warehouse Worker cannot perform Inspector actions or Logistics shipment-event transitions.
- `PackageEvent` is append-only operational history for receipt, scan, measurement, put-away, note, and label-print events.
- Formal order transitions also write immutable order history and transactional customer notifications where applicable.
- Mutations use the existing HttpOnly session, strict SameSite cookie, trusted-origin/CSRF boundary, validation, and audit logs.

## API surface

- `GET|POST /api/v1/operations/packages/lookup`
- `POST /api/v1/operations/packages/receive`
- `POST /api/v1/operations/packages/{packageId}/measure`
- `POST /api/v1/operations/packages/{packageId}/put-away`
- `POST /api/v1/operations/packages/{packageId}/note`
- `POST /api/v1/operations/packages/{packageId}/label/print-log`
- `POST|PATCH /api/v1/admin/warehouse-staff`

The APIs retain the standard Crossly envelopes and are available for the future Flutter field application without placing business rules in the web pages.

## Verification

`npm run test:warehouse-portal` creates isolated users, assignments, warehouses, a shipping lane, and an inbound order; verifies assigned-only access, scan/receive, Inspector separation, measurement, put-away, notes, print logging, PII minimization, label rendering, and all immutable package events; then removes the fixtures.

Physical camera/scanner compatibility and 80 mm printer calibration remain real-world pre-launch acceptance items in `idea.txt`.
