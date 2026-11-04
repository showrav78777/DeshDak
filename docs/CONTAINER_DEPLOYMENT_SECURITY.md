# Crossly production container and image gate

Status: local container definition implemented; registry, deployed infrastructure, and independent image scanning remain external production gates.

Last local image verification: 1 September 2026, Asia/Dhaka.

## What is enforced in the repository

- Next.js builds the officially supported `standalone` runtime rather than shipping the complete development dependency tree.
- The multi-stage Docker build uses the locked npm dependency graph and copies only public assets, the traced runtime, static assets, and the fail-closed production configuration validator into the final image.
- The final process runs as the unprivileged `nextjs` user. It does not run Prisma migrations, seed data, or administrative setup during application startup.
- The runtime refuses to start unless `scripts/verify-production-config.mjs` accepts the secret-manager-provided environment.
- Docker checks `/api/v1/health/live`; orchestrator readiness must separately check `/api/v1/health/ready` before sending traffic.
- `.dockerignore` excludes local dependencies, compiled output, Git metadata, backups, logs, and `.env` files from the build context. Secrets must never be supplied through `ARG`, image layers, source files, or image labels.
- `npm run test:container-security` guards these properties in local verification and CI.

## Local image evidence

- A clean `docker build` completed successfully with the real Turbopack production command, TypeScript validation, and all 147 static-generation tasks.
- The clean image install reported zero npm vulnerabilities and generated Prisma Client with OpenSSL available.
- The resulting standalone image is approximately 128 MB and declares the non-root `nextjs` runtime user.
- Image metadata contains the `/api/v1/health/live` health check.
- A deliberate start without secrets exited non-zero at the configuration gate, listed only missing variable names, and printed no secret values.

This evidence validates the local image definition only. It is not a registry scan, signature, production deployment, penetration test, or capacity certification.

## Controlled build and release sequence

1. Run the full repository quality gate and build the image from a reviewed commit: `docker build --pull --tag <private-registry>/crossly:<immutable-release> .`.
2. Scan the final image with the approved container scanner and generate/store its SBOM. Block critical or high findings unless the security owner records a time-bounded, evidence-backed exception.
3. Push by immutable digest to a private registry. Production deployment must reference that digest, not `latest` or another mutable tag.
4. Run reviewed, forward-only Prisma migrations as a separate least-privilege release job after a verified backup. Never grant schema-migration privileges to the web runtime identity.
5. Inject environment-specific secrets at runtime from the approved secret manager. Mount the root filesystem read-only where the hosting platform permits, provide only a bounded temporary filesystem, drop Linux capabilities, disable privilege escalation, and enforce CPU/memory/process limits.
6. Keep PostgreSQL and internal services on private networks. The approved ingress must terminate HTTPS, block direct-origin traffic, strip caller-supplied forwarding/proof headers, inject the trusted client-IP header and proxy proof, and apply WAF/DDoS controls.
7. Wait for readiness, run `npm run ops:smoke` from the release controller, observe alerts, and retain the previous immutable image for rollback.

## Owner/infrastructure work still required

Choose the production container platform, private registry, scanner/SBOM/signing system, secret manager, CDN/WAF, managed PostgreSQL and pooling, cache/queue, object storage, monitoring, alert routing, and deployment approval process. Pin and regularly refresh the approved Node base-image digest, define vulnerability remediation SLAs, sign images/provenance, restrict deploy IAM, test rollback, and provide independent penetration and load-test evidence before paid launch.

The repository test checks container policy in source; it is not a substitute for building and scanning the exact released image. No production capacity, security certification, or active scanner is claimed.
