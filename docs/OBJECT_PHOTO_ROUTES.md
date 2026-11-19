# Object-backed identity and inspection photos

Implemented 18 November 2026. Production enablement requires migration
20261118120000_object_photo_intake and reviewed storage/scanner configuration.

The existing multipart identity and inspection routes now use the scanned private
object pipeline when PRIVATE_PHOTO_STORAGE_ENABLED=true. Its startup validator
requires a versioned S3 namespace, expected owner, matching KMS key, independent
application encryption keys and a dedicated private HTTPS scanner. The switch is
false by default. Test runners explicitly disable external object storage.

The original and normalized photo receive digest-bound scan proof. Normalization
removes metadata. The encrypted reservation and verified exact-version object
use the existing ledger. Scan/storage I/O runs outside the subject transaction.
Fresh session, role and package assignment checks precede the domain save. The
identity/evidence record, immutable object link and success audit commit together.
A failure preserves the object reservation for review and rolls back the subject.

The Idempotency-Key header must be stable across retries. A confirmed repeat
returns the existing subject, and a changed file or target conflicts. Customer
and staff controls retain request keys across uncertain responses. Existing
DB-backed development uploads and legacy downloads remain supported.

Linked downloads use the protected exact-version reader through the existing
URLs. The reader checks owner/current roles, scan proof, namespace, integrity and
quarantine before and after storage access. Storage failures never fall back to
legacy bytes for a linked object. Compliance sees a document link for new
object-backed submissions. Responses expose subject metadata and bytes only.

Production photo endpoints support JPEG, PNG and WebP. The secure video pipeline,
retention/legal holds/deletion, controlled recovery/release and actual cloud/scanner
acceptance remain due. This increment does not enable production services.

Acceptance includes real PostgreSQL transactions and application encryption with
simulated S3/scanner replies, existing private-photo linking/delivery regressions,
actual legacy multipart/access-change tests and Inspector capture. Live owner,
KMS/IAM, scanner location/logging and retention policy must be accepted in staging.

Verification evidence on this workstation is in /tmp/deshdak-object-final.log
(seven selected suites, including the actual multipart handler with synthetic
storage), /tmp/deshdak-object-migrations.log (clean deploy/drift/repeat deploy),
and the HTML/JUnit folder referenced by /tmp/deshdak-object-browser-path. These
are targeted checks following the earlier full local acceptance; the expanded
launch runner declares 111 gates. Its full run stopped at the dependency audit
on 18 November because of the newly reviewed picomatch advisory. Later gates
were not reached. The audit threshold remains in effect.

On 19 November, scan attestation recording switched to the database clock to
avoid application-clock skew and millisecond rounding invalidating a valid link.
A deterministic regression runs the application clock two seconds behind. Clean
migrations, scanned intake, multipart submissions, binding and protected delivery
passed together in /tmp/deshdak-photo-clock-verification.log. This records the
time verification was persisted; scanner digest/freshness checks remain required.

The subsequent full run passed 108 gates and exposed an obsolete quarantine
fallback assertion. Protected downloads now retain their authorization and
quarantine response before object routing. All five affected suites passed in
/tmp/deshdak-photo-quarantine-current.log, including Admin desktop/mobile review
forms, rescans, download authorization and object submissions. The fresh full npm
audit reports zero findings; no dependency exception or lockfile change was used.

A subsequent fresh full run passed all 111 launch gates in sequence against
fdd181c on 19 November, including the corrected quarantine test and full npm
audit. See LAUNCH_READINESS_STATUS.md for the current result and limits.
