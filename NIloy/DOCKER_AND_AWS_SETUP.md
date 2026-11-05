# Production deployment steps requiring your account and approval

Do not launch paid public checkout until the release/security gates and real
provider acceptance are complete. These commands are a reviewed deployment
template, not evidence that AWS or a production service has been provisioned.

## Docker on a Linux host

1. Create a staging environment first, with its own managed PostgreSQL database,
   domain, HTTPS reverse proxy, secrets, backups and scanner. Restrict PostgreSQL
   to the application network and use encrypted connections. Do not use the local
   development Compose database/password in production.
2. Store approved variables from `.env.example` in `/etc/deshdak/production.env`
   outside Git and the build context. Restrict file access to the deployment
   operator (`chmod 600`). Fill the real domain, authentication/encryption keys,
   database and only certified provider settings. Disable unavailable providers.
3. Build two images from the same accepted commit, using a unique release tag:

   ```sh
   docker build --target runtime -t deshdak:RELEASE_TAG .
   docker build --target migrations -t deshdak-migrations:RELEASE_TAG .
   ```

4. Set deployment variables in the operator shell (replace RELEASE_TAG):

   ```sh
   export DESHDAK_IMAGE=deshdak:RELEASE_TAG
   export DESHDAK_MIGRATION_IMAGE=deshdak-migrations:RELEASE_TAG
   export DESHDAK_ENV_FILE=/etc/deshdak/production.env
   docker compose -f compose.production.yml config --quiet
   ```

   Do not print full Compose configuration: resolved configuration can contain
   secrets. Scan the built images before approval. The migration image contains
   build tools and must run only as a short-lived deployment job.

5. Take a verified backup and rehearse migration/restore on staging. Review all
   pending migrations and obtain release approval. Then run the migration job:

   ```sh
   docker compose -f compose.production.yml --profile migration run --rm migrate
   docker compose -f compose.production.yml up -d app
   docker compose -f compose.production.yml ps
   ```

6. Configure the host TLS proxy to `127.0.0.1:3000`. The app port is deliberately
   not publicly exposed. Configure authenticated ingress proof before trusting
   forwarded client IPs. Verify external HTTPS, cookies, MFA, scanner failure,
   backups, notifications, readiness and provider failure behavior.
7. Set `SMOKE_BASE_URL` to your real HTTPS origin and run `npm run ops:smoke` from
   an approved operator environment. Run load tests on staging, not a live store.

   CAPTCHA's public site key is loaded from the runtime server configuration, so
   the same image can use different staging/production site keys. The server secret
   remains private. For a disposable local production runtime only, run
   `WIDGET_BASE_URL=http://127.0.0.1:3000 npm run ops:widget-check` with Playwright
   Chromium installed. This mocks the widget script to test initialization. You
   must separately test real challenges, expiry, rejection and hostname binding
   with your actual Turnstile site before accepting production authentication.

Runtime is non-root with a read-only root filesystem, bounded temporary/cache
storage, dropped capabilities and bounded logs. CPU/memory values are starting
limits requiring load-test acceptance. Docker restart policy does not restart an
unhealthy-but-running process; external monitoring/orchestration must handle it.
Rollback uses the previous reviewed app image only when schema compatibility is
confirmed. Never automatically reverse migrations or restore over live data.

## Repeatable local image acceptance

With Docker Desktop/Engine running locally and the pinned Playwright Chromium
binary installed, run `npm run test:container-runtime` from the project directory.
It builds the current runtime and matching migration target, creates a temporary
private bridge network/database (database port unpublished), runs migrations through the production configuration
gate, and checks production pages/readiness, private-page redirects, runtime-only
public CAPTCHA configuration, UID 1001, read-only root and writable tmp/cache.
Production email receipt checks reject unsigned/tampered requests, retain a
signed duplicate exactly once as pending evidence, reject a conflicting event ID
and deny public access to suppression records. Email sending stays disabled and
the signing keys are synthetic. These checks do not certify provider delivery.
The browser widget check mocks the provider script; it makes no real payment,
email, SMS or CAPTCHA request. It also checks refusal of missing startup settings.

The command accepts no existing database/container target and rejects remote
Docker daemons. It uses random synthetic credentials in private temporary files
and removes its containers/network/image tags on normal success or failure.
Build caches remain. Forced process termination or Docker shutdown may require
manual cleanup: inspect only resources labelled `deshdak.acceptance=true` and
image tags beginning `deshdak-acceptance-`; never prune unrelated resources.
This is an optional local acceptance command, not a replacement for image
vulnerability scans, the release audit gate, staging load/device tests or live
provider acceptance. Rebuild deployable release tags separately after acceptance.

## AWS managed deployment

Use your AWS billing account and approved region. A deployment operator must:

- Create separate staging/production ECR repositories and scan images. Push the
  accepted app/migration images; deploy immutable digests.
- Create ECS/Fargate services in private subnets, an HTTPS ALB with ACM certificate,
  DNS records, restricted security groups and outbound access required by approved
  providers. ALB readiness targets `/api/v1/health/ready`; the app container checks
  `/api/v1/health/live`. Do not use the host-loopback Compose port mapping for ECS.
- Provision private RDS PostgreSQL with encryption, automated backups, point-in-
  time recovery and tested restore procedures. Set TLS and pooling appropriately.
- Store secrets in AWS Secrets Manager and grant least-privilege task roles. Use
  CI OIDC and environment approval rather than long-lived AWS keys in GitHub.
- Run migrations as a one-off task before the compatible service rollout. Configure
  CloudWatch logs/alarms, certificate and database alerts, WAF, budgets and a tested
  rollback. Schedule maintenance jobs with the approved scheduler secret.
- Provision and certify media scanning/object storage separately; a bucket alone
  does not implement scanning, signed private delivery, retention or transcoding.

AWS provisioning, account permissions, costs, DNS changes, provider contracts and
production acceptance have not been performed. Do not paste AWS keys into chat.
