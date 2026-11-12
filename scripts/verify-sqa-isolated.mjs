import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";

// Workflow acceptance only. Production build, full dependency audit and live
// provider/device acceptance remain separate required release gates.
const checks = [
  "test:admin-mfa", "test:auth-recovery", "test:session-management", "test:session-authorization", "test:logout-atomicity",
  "test:customer-account", "test:customer-markets", "test:wishlist", "test:cart", "test:coupon-workflow",
  "test:seller-product-revisions", "test:seller-store-revisions", "test:seller-catalog-imports", "test:seller-catalog-connections",
  "test:compliance-portal", "test:finance-portal", "test:sourcing-portal", "test:warehouse-portal", "test:inspector-portal", "test:logistics-portal",
  "test:ship-for-me", "test:rma-workflow", "test:support-workflow", "test:support-policy", "test:ai-chat-handoff", "test:sales-kam", "test:identifier-workflow",
  "test:admin-shell", "test:admin-audit-log", "test:launch-readiness", "test:notification-preferences", "test:notification-read-actions",
  "test:phone-code-binding", "test:phone-verification-availability", "test:phone-otp-jobs", "test:phone-otp-operations",
];
if (process.argv.length > 2) throw new Error("This SQA runner accepts no external database, container or script arguments.");
let docker = "docker";
if (process.platform === "darwin") {
  try { await access("/Applications/Docker.app/Contents/Resources/bin/docker"); docker = "/Applications/Docker.app/Contents/Resources/bin/docker"; } catch { /* Use PATH. */ }
}
function runDocker(args) {
  const result = spawnSync(docker, args, { encoding: "utf8", timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(`Disposable Docker operation failed (${args[0]}). Check that local Docker is running and the PostgreSQL image is available.`);
  return result.stdout.trim();
}
// A named context takes precedence over DOCKER_HOST in Docker's CLI.
const contextHost = () => JSON.parse(runDocker(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"]));
const host = process.env.DOCKER_CONTEXT ? contextHost() : process.env.DOCKER_HOST || contextHost();
if (typeof host !== "string" || !/^(?:unix|npipe):/.test(host)) throw new Error("SQA acceptance requires a local Docker daemon; remote contexts are rejected.");
const name = `deshdak-sqa-${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("hex");
let created = false;
async function testPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const address = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === "string" || address.port < 1024) throw new Error("No safe local application port is available.");
  return address.port;
}
try {
  console.log(`Starting ${checks.length} isolated workflow suites with synthetic users and live providers disabled.`);
  runDocker(["run", "--detach", "--name", name, "--label", "deshdak.acceptance=true", "--publish", "127.0.0.1::5432", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=sqa_test", "postgres:16-alpine"]);
  created = true;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnSync(docker, ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "sqa_test"], { stdio: "ignore", timeout: 5000 }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Disposable PostgreSQL TCP startup timed out.");
  const address = runDocker(["port", name, "5432/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("The disposable database must bind only to loopback.");
  const port = await testPort();
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${password}@${address}/sqa_test`,
    AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString("base64"), MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    AUTH_ISSUER: `http://localhost:${port}`, APP_BASE_URL: `http://localhost:${port}`, ISOLATED_TEST_PORT: String(port),
    ALLOW_DEV_AUTH_LINKS: "true", MAINTENANCE_JOB_SECRET: randomBytes(32).toString("hex"),
    PRIVATE_PHOTO_RESCAN_ENABLED: "false", WEBSITE_MEDIA_SCAN_URL: "", WEBSITE_MEDIA_SCAN_TOKEN: "",
    EMAIL_DELIVERY_ENABLED: "false", RESEND_API_KEY: "", EMAIL_FROM: "", OPENAI_API_KEY: "",
    PAYMENT_ADAPTERS_ENABLED: "", SSLCOMMERZ_STORE_ID: "", SSLCOMMERZ_STORE_PASSWORD: "",
    SOURCE_1688_API_KEY: "", PINDUODUO_API_KEY: "", ALIBABA_API_KEY: "", SMS_PROVIDER_API_KEY: "", SMS_PROVIDER_SENDER_ID: "",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_OAUTH_REDIRECT_URI: "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "", TURNSTILE_EXPECTED_HOSTNAME: "",
    AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_SESSION_TOKEN: "", AWS_EC2_METADATA_DISABLED: "true",
  };
  const result = spawnSync(process.execPath, ["scripts/verify-launch-isolated.mjs", ...checks], { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Isolated SQA stopped on a failed workflow. Inspect the preceding check; no release gate has been waived.");
  console.log(`All ${checks.length} selected workflow suites passed. This is not full release, audit, cloud/provider or physical-device certification.`);
} finally {
  if (created) { runDocker(["rm", "-f", name]); console.log("Removed the owned disposable SQA database container. No owner database was targeted."); }
}
