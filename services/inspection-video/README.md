# Private inspection video processing component

The production runtime does not connect this component to web uploads, evidence
records, a scheduler or customer delivery. Existing production capture stays disabled.
It must run in its dedicated container, never inside the Next.js process.

`POST /process` requires an independent bearer token, uncompressed `video/mp4`,
the complete input SHA-256 in `X-Deshdak-Video-Sha256`, and at most 30 MiB.
There is one active job and a 90-second total deadline. A busy replica returns
503 with Retry-After. No filenames, URLs, paths, FFmpeg flags or profiles are
accepted from callers. Authentication/type/size/digest failures precede decoding.

The processor requires fresh ClamAV definitions and a clean input scan before
probing. Its supported input profile is one H.264/H.265 video track, at most one
mono/stereo AAC/MP3 audio track, 0.2–60 seconds, at most 60 fps, 2,073,600 pixels
and 1920 pixels on each side (portrait allowed). Extra data/subtitle/attachment tracks are rejected.
Output is H.264/yuv420p at 24 fps, bounded to 1280×720 and 8 MiB; existing audio
is converted to AAC. Duration must remain within 250 ms. A JPEG poster is bounded
to 640×360 and 512 KiB. Input, converted video and poster are independently scanned.

FFmpeg stream selection, metadata mappings and restricted MOV demuxing follow
the [FFmpeg command documentation](https://ffmpeg.org/ffmpeg.html) and
[MOV/input format options](https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp).
User metadata and chapters are removed; required technical codec/container tags
can remain. External tracks, absolute external references and network protocols
are disabled. Commands use fixed binaries/arguments without a shell or inherited
provider credentials. Process output is bounded and never exposed to callers.
Aborted/timed-out children are killed and awaited before temporary-file cleanup.

Jobs use random mode-0700 directories under tmpfs. All files are removed on success
or failure; cleanup failure makes that processor refuse further jobs until restart.
The service returns a strict JSON manifest containing source/derivative digests,
bounded base64 video/poster data and profile metadata. Digests bind this transport;
they are not a permanent signed scan certificate or an approval to release media.

`src/modules/private-storage/video-processing.ts` provides a server-only HTTPS
client with strict schema/profile/digest/base64 and response bounds. It rejects
redirects, compression, malformed/tampered replies and unknown fields. The factory
is deliberately unwired: configuring a token does not activate production video.

## Deployment boundary

Build the runtime target of `services/inspection-video/Dockerfile` with an approved
immutable Node base image digest. Scan/sign the resulting image and deploy by digest
with `compose.private-video.yml`. Use a dedicated approved ClamAV engine with the
video policy in `clamd.env`; do not increase the website scanner's 8-MiB limit.
Supply only VIDEO_PROCESSOR_TOKEN and private CLAMD_HOST/CLAMD_PORT to the processor,
never database, AWS or application credentials. The composition has no public ports.
Use approved private HTTPS ingress and restrict networking to its caller/engine.

Keep its root read-only, /tmp bounded/noexec, UID 1000, capabilities dropped,
no-new-privileges, PID/CPU/memory limits and deployment network/LSM policy. ClamAV
definition-update egress belongs only to the engine. Test image vulnerabilities,
decoder containment, signature freshness, failures/cancellation, load and real
devices in staging. A successful local fixture test is not production acceptance.

The remaining application integration must supply durable upload/job identity,
scan provenance, current role/package/hold checks, encryption/versioned storage
of required originals and derivatives, atomic evidence/audit binding, uncertainty
recovery, authorized/range-safe delivery and retention. These outputs are derivatives;
never silently replace original evidence or release a quarantined record.

## Repeatable local acceptance

Run `npm run test:inspection-video-component` with local Docker. It builds an owned
test image and runs actual FFmpeg and the HTTPS client against a local HTTP gateway
inside a networkless, non-root, read-only container with synthetic inputs. ClamAV
responses are simulated. The container and image tag are removed afterward.
Build caches/base images remain. No database or provider credentials are used.

The launch runner includes this optional container check only when the test-only
VERIFY_PRIVATE_VIDEO_COMPONENT=true is set. It is not a feature activation flag.
The always-on website checks do not claim this component's live acceptance.

The dedicated GitHub workflow runs this synthetic component test for relevant
pull requests and pushes with read-only repository permissions. It does not
publish images, access credentials or deploy the service. Remote CI acceptance
must be checked separately from the local result.


## Real-engine local acceptance

`npm run test:inspection-video-engine` uses owned real ClamAV and processor
containers. The processor joins only an internal network; only the engine gets
definition-update egress. It requires fresh definitions, exercises clean video
and poster scans, 9-MiB and exact 30-MiB MP4 inputs, checks standalone EICAR
detection, and rejects a valid MP4 containing an explicit harmless test-only NDB
marker. The NDB is copied only into the disposable test engine, never production.
The standard EICAR string is not expected to be detected at arbitrary offsets in
MP4 padding. Oversized input is rejected; stopping the engine checks failure
behavior. No production account, customer file, database or public port is used.

The wrapper removes its containers, anonymous volumes, networks, tags and temporary
token file. Shared base images/build caches remain. Official definition updates
must work; do not bypass freshness or convert a download/startup failure into a
passing test. The manual GitHub workflow input real_engine can run the same check.
VERIFY_PRIVATE_VIDEO_ENGINE=true optionally includes it in a local launch run;
this is a test flag, not video activation. A successful run does not certify TLS,
image vulnerabilities/signing, decoder containment, live integration or devices.

The dedicated video engine allows a 25-second scan with a 30-second client
inactivity timeout, bounded by the unchanged 90-second processing deadline.
The website/photo engine retains its 8-MiB policy and 9-second default client
timeout. The shorter video scan budget rejected a clean 30-MiB test file with
MaxScanTime; limit alerts remain enabled. Synthetic signature format follows
https://docs.clamav.net/manual/Signatures/ExtendedSignatures.html.

## Private artifact storage boundary

`src/modules/private-storage/video-artifacts.ts` provides an unwired store for
original MP4, normalized MP4 and JPEG poster objects. It uses role-separated
application encryption, opaque keys, private conditional S3 writes, expected
owner/KMS checks, exact-version reads and authenticated integrity checks. A
prepared encrypted object can be reconciled after a lost write acknowledgement;
this is not durable multi-object job recovery. `test:private-video-artifacts`
verifies the SDK protocol with synthetic loopback S3 responses, not live AWS.

The store grants no scan approval or upload/evidence/delivery/deletion authority.
It has no runtime flag. An internal authorized adapter now connects the processor
and storage components for staging only. Required work still
includes a durable pre-transcoding queue, public transport controls, approved
publication, customer delivery and lifecycle/hold recovery.
Production activation remains blocked until that integration and live acceptance
are complete. See docs/verification/20261127-private-video-artifacts.json.

## Durable storage staging

`video-jobs.ts` stages the already-processed original/video/poster bundle in
PrivateVideoJob/PrivateVideoArtifact. Only encrypted candidates are persisted.
The worker journals each write before network I/O, reconciles uncertain writes,
fences expired/replaced leases and checks current account/package state. Five
unsuccessful claims require review; a missing uncertain object is not reuploaded.
All three references must be committed before bundle success clears staged bytes.
The store's SDK may retry conditional requests within its own bounded policy; the
ledger does not call write again after a journaled attempt.

`test:private-video-jobs` requires a generated disposable local PostgreSQL schema.
The dedicated CI job supplies an ephemeral database; local tests must never use
the owner's database. Tests use synthetic bytes/cloud replies and do not certify
media codecs or actual AWS. See docs/verification/20261127-private-video-jobs.json.

Storage completion is not a processing queue, scan certificate or publication
approval. Internal adapters now provide authorized intake, local processing
receipts and STAGED evidence bindings. Public runtime wiring, durable processing,
publication, customer delivery and lifecycle/recovery remain required.

## Authorized internal intake

`video-intake.ts` connects the strict client and durable storage jobs. Only verified
server authentication may supply actor/session IDs; this module is not an HTTP
authentication mechanism. Warehouse workers/inspectors require matching portals,
roles and active package-warehouse assignments. Admin requires MFA within 15
minutes. Database-clock checks under locks run before processing and around
storage commits. Idempotent requests bind the original digest/package/namespace;
replay resumes the existing job without another processor call.

`test:private-video-intake` exercises the actual client and PostgreSQL with
synthetic media and simulated processor/cloud responses. It covers access changes
during processing/storage, recovery, admin MFA, staff assignments, replay, and
redacted errors. It does not verify live TLS/codec conversion, create evidence,
release originals or enable production capture. Durable processing, public
transport controls, publication, customer delivery and lifecycle acceptance
remain required. See docs/verification/20261127-private-video-intake.json.

## Processing receipts and staged evidence

The verified processor handoff records a local receipt in the same transaction
as encrypted staging. It binds the profile, source/video/poster digests and sizes
and uses a database timestamp. Storage completion alone supplies no receipt and cannot approve evidence. Receipts are local provenance, not provider-signed scan
certificates or proof that deployment/service identity has been accepted.

`video-evidence.ts` checks current uploader authorization, the receipt, namespace,
all three exact references and their authentic bytes before atomically creating
InspectionEvidence and its STAGED link. It rechecks authority and references after
storage reads; retries/concurrent requests reuse one binding. A deferred database
constraint rejects external video rows without a complete staged binding and
prevents detaching a link by itself. The schema permits only STAGED links.

Existing list, download, inspection and customer-order paths fail closed for these
records. There is no publication toggle or upload runtime factory. Evidence cannot
be used for a passed inspection or played by a customer until delivery, lifecycle
and live acceptance are implemented. Credentials alone do not activate video.

`test:private-video-evidence` runs against the isolated test web server/database.
It verifies binding/proof failures and real HTTP publication guards with synthetic
media and processor/cloud replies. Local code/DB acceptance does not replace live
TLS/image/scanner, independent security, load or physical-device acceptance.

## Protected staged preview component

`video-preview.ts` and its response adapter implement staff-only normalized
MP4/poster previews. The caller must supply a session ID from verified server
authentication. Current session/account/role/warehouse/MFA and proof/reference/
ownership checks run before and after storage I/O. Originals are never selected.
Owning customers receive an unpublished response; other customers are denied.
No runtime route, UI or activation switch exposes this component.

The HTTP policy follows [RFC 9110 sections 13.1.5 and 14](https://www.rfc-editor.org/rfc/rfc9110.html#name-range):
single open/suffix/clamped ranges use 206; unsatisfiable ranges use 416 after
authorization. Unknown units and multipart requests fall back to full GET. HEAD
ignores Range. No validators are issued, so If-Range cannot match and selects a
full response. Integer parsing is overflow-safe and bounded.

The full encrypted object is authenticated before range bytes are returned,
including for HEAD. Video is bounded to 8 MiB and poster to 512 KiB. Responses use
private/no-store, nosniff and same-origin protections and fixed filenames. Audit
failure blocks output. Ingress admission, cancellation and load acceptance remain
required before wiring any public route. The HTTP fixture uses synthetic media
and credential resolution; it is not live TLS or device/codec acceptance.

The existing isolated evidence suite includes the preview checks. See
docs/verification/20261127-private-video-preview.json. Customer publication,
retention/holds/cleanup and production acceptance remain unfinished.


## Admin quarantine and retention review

Admin → System → Private video safety (`/admin/private-videos`) exposes a
metadata-only queue with fresh MFA. A confirmed controlled case permanently
quarantines the entire bundle; PostgreSQL prevents editing/removing its incident
record. Storage recovery, binding and internal preview check this block before
and after I/O. Files are preserved; this page has no release or delete action.

The review date is conservative: approved policy plus delivery, claim windows,
legal holds, case completion and finance/compliance checks. Incomplete or excessive
history requires review. Even elapsed retention always returns deletionAllowed
false. Existing legal holds apply to uploader/customer accounts, order or package.
The quarantine API requires trusted origin, fresh Admin MFA, a UUID idempotency
header, a reason, controlled case reference and confirmation. A retry must retain
exact payload/key. The form locks both after its first request.

The isolated evidence suite tests the real page/API on desktop/mobile and local
PostgreSQL, with synthetic processor/cloud media transport. Migration
20261127200000_private_video_safety is additive. This increment does not enable
capture, customer playback, linked cleanup or production deployment.
