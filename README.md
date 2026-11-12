# DeshDak

Cross-border shopping, seller, warehouse, inspection, logistics and employee
operations platform built with Next.js, React, PostgreSQL and Prisma.

## Local development

Use Node.js 22, npm 11.6.2 and Docker Desktop.

```sh
npm ci
cp .env.example .env
docker compose up -d postgres
```

Configure the local database URL and a strong development AUTH_SECRET in `.env`.
For a new development database only:

```sh
npm run db:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. Seed data is synthetic; never seed production.
Back up and rehearse migrations before changing an existing database. Compose
credentials are development-only, and the database binds to loopback.

## Website content

Admin → Website Content Manager manages logo/banner image uploads, cropping,
library reuse, protected deletion, section ordering/visibility and promotional
video embeds. Preview and publish changes without redeploying application code.
Production uploads require the configured authenticated malware scanner. Images
currently reside in PostgreSQL. Direct video-file uploads remain unfinished.

## Verification

Run `npm run test:sqa:isolated` for 37 selected workflow suites in an automatically
created disposable local PostgreSQL container. No application database is targeted.
See [the SQA runbook](NIloy/SQA_RUNBOOK.md) for prerequisites and acceptance limits.
This command does not replace the full dependency-audit or production-release gates.

```sh
npm run lint
npm run typecheck
npm run api:contract
npm run test:website-media-safety
npm run test:security-regressions
npm run test:container-security
npm run build
```

Use a disposable local database for `npm run verify:launch:isolated`; the runner
creates, migrates, seeds and removes its own schema. Never target production.
Select media checks with `npm run verify:launch:isolated -- test:website-media`.
Set `WEBSITE_MEDIA_BROWSER=1` for desktop/mobile browser coverage; install
Playwright Chromium first. External video responses are mocked in these tests.
See [E2E testing](docs/E2E_TESTING.md) for full role testing and HTML/JUnit reports.

## Deployment and owner setup

The Dockerfile builds a standalone application running as non-root with a health
check. It does not provision AWS, secrets, HTTPS, scanners or provider accounts.
The Compose database is for development. Deploy reviewed migrations separately.
Never bake environment files or credentials into container images.

- [Owner setup](NIloy/README.md)
- [Deployment and recovery](docs/DEPLOYMENT_RECOVERY_RUNBOOK.md)
- [Content-manager evidence](docs/DESHDAK_CONTENT_MANAGER.md)
- [Required development process](docs/DEVELOPMENT_PROCESS.md)

Admin → System → Live setup guide identifies live-service prerequisites.
Credentials alone do not complete missing adapters or provider certification.
Paid public production launch remains blocked by dependency-security clearance,
real-provider acceptance and remaining production/physical-device operational
checks. Keep unavailable services disabled. Git upload is pending completion and
final review.
