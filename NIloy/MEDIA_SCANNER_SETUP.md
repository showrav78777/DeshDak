# Website image scanner deployment

This is the owner/deployment work remaining after the scanner service was added.
It is separate from the unfinished private identity/inspection object-storage and
video pipelines. Do not enable production identity or inspection intake based on
this service alone.

1. Select approved, scanned Node and official ClamAV image digests. Build the
   scanner from the accepted commit:

   ```sh
   docker build -f services/media-scanner/Dockerfile -t deshdak-scanner:RELEASE_TAG .
   docker build --platform linux/amd64 -f services/media-scanner/Engine.Dockerfile --build-arg CLAMAV_BASE_IMAGE=clamav/clamav@APPROVED_DIGEST -t deshdak-engine:RELEASE_TAG .
   ```

   The ClamAV 1.4 image inspected here is AMD64. Use an x86 deployment or separately
   certify an ARM-compatible engine. Local engine acceptance on ARM uses explicit
   AMD64 emulation; this is not native ARM certification.
2. Inject an independent cryptographically random `SCANNER_TOKEN` of 32–256
   non-whitespace characters through the secret manager. For Compose only, put it
   in a private external env file with operator-only access; never put the value
   in Git, image build arguments, shell history, tickets or evidence.
3. Set `DESHDAK_SCANNER_IMAGE`, `DESHDAK_CLAMAV_IMAGE` (the engine-wrapper image) to the reviewed immutable
   image references and `DESHDAK_SCANNER_ENV_FILE` to that external file. Review
   `compose.scanner.yml` with the infrastructure operator. It publishes no host
   ports. The official engine needs provisioned RAM (4 GB in the template),
   persistent definition storage and controlled egress for signature updates.
   Retain services/media-scanner/clamd.env limits, including AlertExceedsMax. The
   engine wrapper completes a tested FreshClam update before daemon startup; a
   failed update stops startup. This prevents loading stale definitions during a
   startup update race. Keep automatic updates enabled. Monitor the volume.
4. Expose only the scanner's `/scan` through approved private HTTPS ingress.
   Connect that ingress to the scanner network or use a private load balancer.
   Do not expose scanner plaintext HTTP or clamd TCP to the internet. Clamd has
   no authentication or TLS; network isolation is mandatory. Add ingress request
   limits and authenticated-client rate limits. Do not log Authorization or bodies.
5. Set application `WEBSITE_MEDIA_SCAN_URL=https://<approved-private-host>/scan`
   and `WEBSITE_MEDIA_SCAN_TOKEN` to the same scanner token, through the app's
   secret manager. The HTTPS endpoint cannot contain credentials, query or hash.
6. Certify a clean image, rejected test content, incorrect token, scanner outage,
   stale definitions, timeouts and over-limit uploads in staging. A valid scan
   returns only `{"status":"clean"}`; all other outcomes must reject the upload.
   No malware scanner guarantees that all possible threats will be detected.
7. Monitor authenticated `/health/ready` and liveness `/health/live`. Readiness
   refuses missing/unreadable or more-than-48-hour-old definitions. A future
   definition timestamp beyond five minutes is also rejected; synchronize clocks.
   Readiness failure must stop uploads, not trigger a bypass. Keep the app's
   fail-closed behavior enabled during outages.
8. Record reviewed deployment, privacy/logging, signature-update, security and
   on-call acceptance in Admin → Live setup / launch evidence. Rotate the scanner
   token in both services through a controlled rollout; an inconsistent rollout
   intentionally rejects uploads until both ends match.

Local optional acceptance: `npm run test:media-scanner-container` owns randomly
named containers/network and a temporary token, accepts no existing database,
uses the official ClamAV base through the startup wrapper and tests a harmless image plus the standard
antivirus test string in memory. It removes only its resources. Shared images
and build caches remain. It requires Docker, image download access and sufficient
RAM; it is not a production image scan, load test or deployment certification.

Known engine limit caveat: real-engine testing on 6 November 2026 reproduced a
clean verdict for a ZIP member truncated above MaxFileSize despite AlertExceedsMax.
The gateway independently rejects non-JPEG/PNG/WebP payloads, including archives,
and the website app must still fully decode/re-encode images before storage.
Header recognition is not complete image validation. This service must not be
reused as a general document/archive/video scanner. Keep the limit alerts enabled,
but do not treat them as complete coverage. Track the upstream fix and repeat the
archive regression before broadening supported formats:
https://github.com/Cisco-Talos/clamav/commit/9f84fb3404b9a66c782e33f3e2b0da5e3d32af76
