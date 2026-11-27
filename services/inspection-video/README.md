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
includes durable original/derivative jobs, scan provenance, atomic evidence
binding, current authorization, customer delivery and lifecycle/hold recovery.
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

The job ledger is not a processing queue, a role/session authorization service,
a scan certificate or an evidence approval. It remains unwired. Authorized intake,
processor provenance, evidence binding, customer delivery, retention/holds and
controlled recovery remain required before production activation.

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
release originals or enable production capture. Provenance, durable processing
queue, evidence binding, public transport controls, customer delivery and lifecycle
acceptance remain required. See docs/verification/20261127-private-video-intake.json.
