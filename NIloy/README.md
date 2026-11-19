# Owner setup for DeshDak

This folder contains tasks requiring your accounts, business information, service
approvals or physical equipment. Never put passwords, tokens, identity documents
or production environment files in this folder or Git.

Start with [your ordered next actions](RELEASE_HANDOFF.md#your-next-actions-in-order).
The handoff also identifies unfinished development work and live acceptance.

## 1. Git destination

The approved destination is `https://github.com/showrav78777/DeshDak.git`.
A dedicated application repository has been initialized here, isolated from the
previously inherited home-directory repository. Do not run `git add .` from the
home directory. The verified source was uploaded on 18 November 2026 to the
`codex/deshdak-platform` branch. See [the release handoff](RELEASE_HANDOFF.md)
for verified work and the remaining engineering/account tasks.

## 2. Hosting and domain

Follow [Docker and AWS setup](DOCKER_AND_AWS_SETUP.md) for concrete build,
migration, startup, HTTPS, AWS account and verification steps.

Choose an AWS account/region and billing owner, or another approved Docker host.
Supply the domain and configure DNS and HTTPS. Use managed PostgreSQL, private
network access, a secret manager, encrypted backups and tested restoration.
The application Dockerfile runs as a non-root user and has a health check.
`docker-compose.yml` is for local development; its database password and settings
are not production configuration. See `docs/DEPLOYMENT_RECOVERY_RUNBOOK.md`.

## 3. Production services

Start with [the API connection guide](API_CONNECTION_GUIDE.md) for 1688,
Pinduoduo, Google login/Gmail, OpenAI, email verification, SMS and WhatsApp.
It lists account steps, existing environment names and unfinished adapters.
Your selected messaging approach and researched SMS recommendation are in
[Bangladesh SMS and Meta WhatsApp setup](SMS_WHATSAPP_SETUP.md).
Use [SMS operations](SMS_OPERATIONS.md) for the read-only Admin review and remaining receipt requirements.

Open Admin → System → Live setup guide for the required variables, setup steps and
readiness status. Supply credentials through the deployment secret manager:

- Payment provider: merchant approval, sandbox checkout/refund/webhook and
  settlement acceptance before enabling real money.
- Email: verified sending domain and provider account; configure SPF/DKIM/DMARC.
  Signed delivery/bounce handling and suppression are implemented; provider
  staging certification is still required. Follow [the email setup checklist](EMAIL_LIVE_SETUP.md). Keep live email disabled until certified; Admin's
  "Email accepted" count does not mean recipient delivery was confirmed.
- Google login: OAuth application and exact production redirect URLs.
- Phone verification: contracted SMS service, sender approval and delivery tests.
- Private media: object storage, scanning, access controls and delivery/retention.
  See [private photo infrastructure prerequisites](PRIVATE_PHOTO_STORAGE_SETUP.md);
  photo intake/download routes are connected behind a disabled switch; video and
  lifecycle integration still require engineering. See the selected provisional
  [media retention defaults](MEDIA_RETENTION_POLICY.md); destructive cleanup
  remains disabled pending implementation and verification.
- AI and suppliers: approved accounts, commercial rights, quotas and credentials.

Some adapters still require engineering and certification; keys alone do not
complete them. Do not enable an unavailable service just to clear a readiness item.

## 4. Business and operational acceptance

Follow [the SQA runbook](SQA_RUNBOOK.md) for repeatable local workflow tests and
the real staff/device/provider acceptance that still requires your team.

Supply the registered company identity, address, tax/VAT rules, support contacts,
approved privacy/refund/terms text, licensed catalog and real warehouse/rate data.
Use individual staff accounts with MFA. Test camera capture, phones, label printer,
scanner, receiving, inspection and physical courier handoff with the staff team.

## 5. Website appearance migration

The logo/banner Admin controls require migration
`20261102160000_website_appearance`. Apply reviewed pending migrations with the
deployment migration job after backup and staging acceptance. The migration was
tested on a disposable database; it has not been applied to your database here.

## Release status

This folder is not a completion certificate. Production storage/scanning,
outstanding provider adapters, wider release acceptance and dependency security clearance remain engineering
work. Do not classify these as owner-only tasks or deploy as production-ready.

On 16 November 2026 both the full and production-only npm audits passed with zero
findings. The fix pins minimatch 11.0.4 for the TypeScript ESLint parser dependency
only, addressing [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
This needs no owner configuration and leaves the CI audit threshold in place.

On 18 November the full audit reported 14 high findings from the newly reviewed
picomatch advisory. A fresh full audit on 19 November reports zero findings,
without dependency changes or audit exceptions. The full verification rerun is
recorded in [current release status](../docs/LAUNCH_READINESS_STATUS.md).

### Website image scanner

A deployable authenticated ClamAV gateway and engine-startup wrapper are supplied.
Follow [the scanner deployment checklist](MEDIA_SCANNER_SETUP.md). This does not
complete the private identity/inspection storage and video pipeline.


Production Admin image uploads require `WEBSITE_MEDIA_SCAN_URL` and
`WEBSITE_MEDIA_SCAN_TOKEN` together in the secret manager. Use an independent token
of at least 32 characters. The endpoint must use HTTPS with no embedded credentials,
query parameters or fragment. Startup rejects incomplete/unsafe scanner settings;
leaving both unset keeps production uploads disabled. The HTTPS scanning service must
accept a bearer-authenticated POST of raw file bytes and return JSON
`{"status":"clean"}` only after completing malware scanning. Any other result,
redirect, timeout or unavailable service rejects the upload. Deploy and certify
that service before enabling uploads. Local development re-encodes images without
calling a scanner when these variables are absent; this is not production scan
evidence. Images are currently stored as optimized WebP in PostgreSQL, capped at
200 images of at most 3 MB each; include these tables in backups. High-volume
media and videos still require an object-storage implementation.

Apply `20261102170000_website_media` through the reviewed migration job as well.
Server-side content drafts also require `20261104090000_website_appearance_drafts`.
Apply all pending reviewed migrations before rolling out the matching app image.

### Promotional video content

Provide a licensed company video published to YouTube and paste its watch or
youtu.be link in Admin → Website Content Manager → Promotional video. Set a title,
enable visibility, preview and publish. Confirm that the actual video is available
and permits embedding on the production domain. Local desktop/mobile tests used
a mocked external player; they verify publishing and consent behavior, not video
availability, licensing, playback or provider performance. Direct video-file
uploads remain engineering work and are not an owner-only setup task.
