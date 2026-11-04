import { readFile } from "node:fs/promises";

const [dockerfile, dockerignore, nextConfig, sitemap, productionCompose] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/sitemap.ts", import.meta.url), "utf8"),
  readFile(new URL("../compose.production.yml", import.meta.url), "utf8"),
]);

const checks = [
  ["separate non-root migration image", /FROM dependencies AS migrations[\s\S]*USER node[\s\S]*prisma migrate deploy/.test(dockerfile)],
  ["production app read-only filesystem", /read_only:\s*true/.test(productionCompose)],
  ["production host app port bound to loopback", /127\.0\.0\.1:3000:3000/.test(productionCompose)],
  ["production drops Linux capabilities", /cap_drop:\s*\[ALL\]/.test(productionCompose)],
  ["production prevents privilege escalation", /no-new-privileges:true/.test(productionCompose)],
  ["production migrations require explicit profile", /profiles:\s*\[migration\]/.test(productionCompose)],
  ["production has bounded logs", /max-size:\s*"10m"/.test(productionCompose) && /max-file:\s*"3"/.test(productionCompose)],
  ["Prisma runtime TLS dependency", /apt-get install[^\n]*ca-certificates openssl/.test(dockerfile)],
  ["database-backed sitemap generated at request time", /export const dynamic\s*=\s*["']force-dynamic["']/.test(sitemap)],
  ["pinned package manager", /npm install --global npm@11\.6\.2/.test(dockerfile)],
  ["locked dependency installation", /npm ci\b/.test(dockerfile)],
  ["standalone Next.js build output", /output:\s*["']standalone["']/.test(nextConfig)],
  ["production-only runtime environment", /ENV\s+NODE_ENV=production\b/.test(dockerfile)],
  ["unprivileged runtime user", /USER\s+nextjs\b/.test(dockerfile)],
  ["production configuration gate before server startup", /node scripts\/verify-production-config\.mjs\s+&&\s+exec node server\.js/.test(dockerfile)],
  ["container liveness health check", /HEALTHCHECK[\s\S]*\/api\/v1\/health\/live/.test(dockerfile)],
  ["minimal standalone runtime copy", /\/\.next\/standalone\s+\.\//.test(dockerfile)],
  ["build context excludes dependencies", /^node_modules$/m.test(dockerignore)],
  ["build context excludes compiled output", /^\.next$/m.test(dockerignore)],
  ["build context excludes Git metadata", /^\.git$/m.test(dockerignore)],
  ["build context excludes environment files", /^\.env\*$/m.test(dockerignore)],
  ["Dockerfile does not copy an environment file", !/^COPY\s+.*\.env(?:\s|$)/mi.test(dockerfile)],
  ["Dockerfile has no secret build arguments", !/^ARG\s+.*(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|API_KEY)/mi.test(dockerfile)],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error("Container security verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Container security verification passed ${checks.length} controls.`);
