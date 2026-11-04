# Inspection submission integrity — 20 October 2026

## Requirements and design

The order/logistics and RBAC specifications require assigned Inspector decisions,
auditable transitions and server-side guards. Previously the browser generated a
new key for every attempt while the inspection API ignored it, and checked stage
readiness outside its transaction. Competing requests could both create decisions.

The API now requires trusted origin, an ASCII Idempotency-Key (16–255 characters)
and a strict decision body. Request identity binds Inspector, package, type,
result, normalized notes and private evidence reference. Matching retries return
the original decision with 200/idempotentReplay; new saves return 201. Changed
actor/package/details with the same key fail 409. Existing response fields remain;
request keys/fingerprints are never serialized. Non-Inspector/foreign-warehouse
access still fails before exposing package or prior decision information.

Serializable order locking and conditional active/RECEIVED package updates place
readiness and evidence validation inside the transaction. Every expected parcel
must already be received; held or changed orders cannot be advanced. One transaction
writes the decision, package state, event, order history and audit. Competing keys
receive a safe conflict rather than overwriting the first decision. No automatic
mutation retries or financial postings are introduced.

## Browser behavior

The mounted form retains one key for identical details through network uncertainty,
blocks rapid duplicate submissions, times out save requests after 15 seconds and
disables editing while saving. After confirmed success it disables submission
while the server-rendered task refreshes. A changed payload gets a new key but
cannot overwrite an already inspected package. After a reload the operator must
review the recorded task; keys are not stored with inspection notes in local storage.

## Deployment and boundaries

Review migration `20261020130000_inspection_request_identity`, back up the target,
deploy migrations, regenerate Prisma and restart. Nullable columns preserve legacy
rows without fabricated identities; historical saves cannot be replayed by an
invented key. Update any older client to send trusted origin and a stable key.
The evidence-upload lifecycle, malware scanning/storage providers, inspection
corrections, return inspections and multi-parcel measurement logic are not completed
by this increment. Existing inspection note/customer visibility rules are unchanged.
No owner database is migrated by isolated verification.

## Acceptance

Policy tests cover strict validation and actor/package/payload binding. Disposable
PostgreSQL tests must prove concurrent distinct keys create one decision/event/
audit, and different actor/package replay is rejected. Browser tests deliberately
save then lose the response, retry with the same key and verify 200 replay, no
duplicate database effects, malformed/changed requests, untrusted origin, stage
guards and mobile completion through measurement/delivery. Run Inspector,
Warehouse and Ship for Me API regressions as well as the full browser suite,
schema/lint/type/security/OpenAPI/build checks before handoff.

## Verification — 21 October 2026

Final disposable verification passed Inspector, Warehouse and Ship for Me API
regressions, then all 33 browser tests in 115.15 seconds (zero failures, skips or
errors). Database assertions confirmed a lost-response retry produces exactly one
decision, event and audit. Concurrent competing keys, changed actor/package/body,
outstanding expected parcels, origin validation and strict-body guards passed.
Prisma validation/generation, type/lint, policy/security, 288-operation OpenAPI,
container-security (16 controls), operations-safety and production build passed.

An earlier shared-server API/browser run timed out in one Admin scenario; a
temporary filesystem-cache experiment also stalled and its disposable browser was
force-stopped. That experiment was reverted. The final Compose pipeline separates
API and browser phases into fresh isolated schemas/servers without weakening
assertions or increasing retries. This passing run does not establish the root
cause or globally resolve development-server stalls.

HTML/JUnit reports were exported and temporary containers/network removed. The
owner database was not changed: migration and Prisma regeneration/restart remain
required before deployment. Live storage/scanning and production acceptance remain
outside this verification.
