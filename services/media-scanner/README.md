# Authenticated media scanning service

A dependency-free Node HTTP gateway uses ClamAV's NUL-framed INSTREAM protocol.
It never sends client filenames or stores uploads on disk. Only an exact engine
`stream: OK` reply can produce a clean result. Scan errors, malformed replies,
missing/stale definitions, aborts and timeouts fail closed.

- `POST /scan`: bearer-authenticated, uncompressed application/octet-stream,
  at most 8 MiB, non-empty body, total deadline 10 seconds, at most two concurrent
  operations per replica. Replies: 200 clean, 422 infected/empty, 413 oversized,
  415 unsupported encoding/type/media, 401 unauthorized, 503 busy/unavailable.
- `GET /health/live`: unauthenticated process liveness only.
- `GET /health/ready`: authenticated engine/fresh-definition readiness, 200/503.
- No CORS, URL fetching, arbitrary daemon command, filename/path input, raw engine
  output, threat names or upload/token logging is exposed.
- Engine connections and replies are bounded; malformed or over-4096-byte replies
  are rejected. Definition timestamp must be within 48 hours and no more than
  five minutes in the future. UTC is explicit. This local policy supplements
  automatic signature updates; it does not prove complete malware detection.

Runtime configuration: required independent SCANNER_TOKEN; private CLAMD_HOST
(default clamd), CLAMD_PORT (3310), PORT (8080). Secrets belong only in runtime
secret-manager injection. The scanner listens on HTTP inside a private network;
production callers must use an approved HTTPS ingress, never public HTTP/TCP.

Engine limits in clamd.env enable AlertExceedsMax as defense in depth; the
known archive caveat below prevents treating that flag as a complete guarantee. Definitions are checked every
30 seconds and FreshClam updates run 12 times daily. Retain these limits when
releasing the engine. The engine wrapper completes a tested FreshClam update before invoking the
official entrypoint. An update failure stops startup. This avoids the observed
startup race where an engine retained preloaded definitions after an update.
The deployment template then uses the official engine entrypoint to maintain its
signature volume and process identities. Certify the engine's startup permissions,
image CVEs, memory use, definition updates and TLS/ingress with your infrastructure
operator. The gateway runs non-root/read-only with all Linux capabilities dropped.
The service handles website image bytes; it is not a quarantine/object-storage,
identity review, video transformation or retention implementation.

Checks: `npm run test:media-scanner` uses a simulated daemon on ephemeral loopback
ports. `npm run test:media-scanner-container` tests the real engine in disposable
containers, with explicit AMD64 emulation on ARM hosts. No customer files are used.
For an already-owned disposable local scanner only, the lower-level
`test:media-scanner-engine` uses SCANNER_TEST_BASE_URL and runtime SCANNER_TOKEN.

Owner actions: [NIloy scanner setup](../../NIloy/MEDIA_SCANNER_SETUP.md).
Primary protocol: https://docs.clamav.net/manual/Usage/ClamdProtocol.html
Official images/memory: https://docs.clamav.net/manual/Installing/Docker.html

Known engine limit caveat: real-engine testing on 6 November 2026 reproduced a
clean verdict for a ZIP member truncated above MaxFileSize despite AlertExceedsMax.
The gateway independently rejects non-JPEG/PNG/WebP payloads, including archives,
and the website app must still fully decode/re-encode images before storage.
Header recognition is not complete image validation. This service must not be
reused as a general document/archive/video scanner. Keep the limit alerts enabled,
but do not treat them as complete coverage. Track the upstream fix and repeat the
archive regression before broadening supported formats:
https://github.com/Cisco-Talos/clamav/commit/9f84fb3404b9a66c782e33f3e2b0da5e3d32af76
