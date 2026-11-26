# Private inspection video processing component

This component is not connected to web uploads, private storage, evidence records,
a scheduler or customer delivery. Existing production video capture stays disabled.
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
