import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This command owns only randomly named local acceptance resources. It never
// reads application .env files or accepts an existing database/container target.
const root = fileURLToPath(new URL("../", import.meta.url));
let docker = "docker";
if (process.platform === "darwin") {
  const bundled = "/Applications/Docker.app/Contents/Resources/bin/docker";
  try { await access(bundled); docker = bundled; } catch { /* Use PATH. */ }
}
const id = randomBytes(8).toString("hex");
const prefix = `deshdak-acceptance-${id}`;
const runtimeImage = `${prefix}:runtime`;
const migrationImage = `${prefix}:migrations`;
const network = `${prefix}-network`;
const database = `${prefix}-db`;
const application = `${prefix}-app`;
const directory = await mkdtemp(join(tmpdir(), "deshdak-acceptance-"));
await chmod(directory, 0o700);
const containers = new Set();
let networkCreated = false;
let localDaemonVerified = false;
const commandEnvironment = { ...process.env, PATH: docker.includes("/") ? `${dirname(docker)}:${process.env.PATH ?? ""}` : process.env.PATH };

function run(args, { allowFailure = false, timeout = 60_000, env = commandEnvironment } = {}) {
  const result = spawnSync(docker, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && (result.error || result.status !== 0)) {
    const safeOutput = output.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]").slice(-3000);
    throw new Error(`Container acceptance command failed (${args[0]}): ${result.error?.code ?? result.status}\n${safeOutput}`);
  }
  return { status: result.status, output };
}
async function until(action, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(message);
}
async function secretFile(name, values) {
  const path = join(directory, name);
  await writeFile(path, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  return path;
}

try {
  const daemon = process.env.DOCKER_HOST || JSON.parse(run(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"] ).output);
  if (!/^(?:unix|npipe):/.test(daemon)) throw new Error("Acceptance requires a local Docker daemon socket, never a remote Docker host.");
  localDaemonVerified = true;
  run(["info", "--format", "{{.OSType}}"]);
  console.log("Building the current runtime and matching migration images (no application environment files).");
  run(["build", "--target", "runtime", "--tag", runtimeImage, "."], { timeout: 600_000 });
  run(["build", "--target", "migrations", "--tag", migrationImage, "."], { timeout: 300_000 });

  const password = randomBytes(32).toString("hex");
  const siteKey = randomBytes(20).toString("hex");
  const emailSigningKey = randomBytes(32);
  const dbFile = await secretFile("database.env", { POSTGRES_PASSWORD: password, POSTGRES_DB: "acceptance" });
  const envFile = await secretFile("application.env", {
    DATABASE_URL: `postgresql://postgres:${password}@database.internal:5432/acceptance`,
    APP_BASE_URL: "https://acceptance.deshdak.invalid", AUTH_ISSUER: "https://acceptance.deshdak.invalid",
    AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString("base64"), MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAINTENANCE_JOB_SECRET: randomBytes(32).toString("hex"), TRUSTED_PROXY_SHARED_SECRET: randomBytes(32).toString("hex"),
    TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for", NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey,
    TURNSTILE_SECRET_KEY: randomBytes(20).toString("hex"), TURNSTILE_EXPECTED_HOSTNAME: "acceptance.deshdak.invalid",
    EMAIL_DELIVERY_ENABLED: "false", PAYMENT_ADAPTERS_ENABLED: "",
    RESEND_WEBHOOK_SECRET: `whsec_${emailSigningKey.toString("base64")}`,
    EMAIL_SUPPRESSION_HASH_KEY: randomBytes(32).toString("base64"),
  });
  // A private bridge with no published DB port keeps the database isolated;
  // Docker internal networks do not support the host port needed by Playwright.
  run(["network", "create", "--label", "deshdak.acceptance=true", network]);
  networkCreated = true;
  containers.add(database);
  run(["run", "--detach", "--name", database, "--label", "deshdak.acceptance=true", "--network", network,
    "--network-alias", "database.internal", "--tmpfs", "/var/lib/postgresql/data:rw", "--env-file", dbFile, "postgres:16-alpine"]);
  await until(() => run(["exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "acceptance"], { allowFailure: true }).status === 0, "Disposable database did not become ready.");

  console.log("Applying production migrations to the disposable database through the gated migration image.");
  const migration = `${prefix}-migrate`;
  containers.add(migration);
  run(["run", "--rm", "--name", migration, "--network", network, "--env-file", envFile, migrationImage], { timeout: 120_000 });
  containers.delete(migration);

  console.log("Starting the production runtime as UID 1001 with a read-only root and bounded writable mounts.");
  containers.add(application);
  run(["run", "--detach", "--name", application, "--label", "deshdak.acceptance=true", "--network", network,
    "--env-file", envFile, "--read-only", "--user", "1001:1001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256", "--memory", "2g", "--cpus", "2", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001",
    "--tmpfs", "/app/.next/cache:rw,noexec,nosuid,size=256m,uid=1001,gid=1001", "--publish", "127.0.0.1::3000", runtimeImage]);
  let address;
  await until(() => {
    const result = run(["port", application, "3000/tcp"], { allowFailure: true });
    if (result.status === 0 && /^127\.0\.0\.1:\d+$/.test(result.output.trim())) { address = result.output.trim(); return true; }
    const state = run(["inspect", "--format", "{{.State.Status}}", application]).output.trim();
    if (["exited", "dead"].includes(state)) throw new Error("Production runtime exited before publishing its host port.");
    return false;
  }, "Docker did not publish the loopback application port.", 10_000);
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${address}`;
  await until(async () => {
    try { return (await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  }, "Production runtime did not become ready.");
  for (const path of ["/", "/login", "/register", "/manifest.webmanifest", "/api/v1/health/live", "/api/v1/health/ready", "/api/v1/website-appearance"]) {
    assert.equal((await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) })).status, 200, `Unexpected response for ${path}`);
  }
  const privatePage = await fetch(`${origin}/admin/website-content`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  assert([307, 308].includes(privatePage.status));
  assert.equal(new URL(privatePage.headers.get("location"), origin).pathname, "/admin/login");
  const config = await fetch(`${origin}/api/v1/auth/human-verification`, { signal: AbortSignal.timeout(10_000) });
  assert.match(config.headers.get("cache-control"), /no-store/);
  assert.deepEqual((await config.json()).data, { siteKey });

  console.log("Checking signed email receipts in the production runtime without enabling email sends.");
  const receiptUrl = `${origin}/api/v1/notifications/email-events`;
  const messageId = `msg_acceptance_${id}`;
  const emailReference = `synthetic_acceptance_${id}`;
  const raw = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: emailReference, to: ["never-sent@example.test"], subject: "SYNTHETIC_PRIVATE_RECEIPT" } });
  const signature = body => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { "Content-Type": "application/json", "svix-id": messageId, "svix-timestamp": timestamp,
      "svix-signature": `v1,${createHmac("sha256", emailSigningKey).update(`${messageId}.${timestamp}.${body}`).digest("base64")}` };
  };
  const postReceipt = (body, headers) => fetch(receiptUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  assert.equal((await postReceipt(raw, { "Content-Type": "application/json" })).status, 401, "Unsigned production receipt was accepted.");
  const headers = signature(raw);
  assert.equal((await postReceipt(`${raw} `, headers)).status, 401, "Tampered production receipt was accepted.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const receipt = await postReceipt(raw, signature(raw));
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers.get("cache-control"), /no-store/);
    assert.deepEqual((await receipt.json()).data, { received: true });
  }
  const conflict = JSON.stringify({ type: "email.failed", created_at: new Date().toISOString(), data: { email_id: emailReference } });
  assert.equal((await postReceipt(conflict, signature(conflict))).status, 409, "Conflicting signed receipt identity was accepted.");
  // This reference was never sent. It must stay pending, not invent a delivery.
  const ledger = run(["exec", database, "psql", "-U", "postgres", "-d", "acceptance", "-Atc",
    `SELECT count(*) FROM "EmailWebhookEvent" WHERE "messageId"='${messageId}' AND "processedAt" IS NULL AND "outcome"='PENDING' AND length("payloadHash")=64;`]);
  assert.equal(ledger.output.trim(), "1", "Production receipt replay duplicated or misclassified pending evidence.");
  assert.equal((await fetch(`${origin}/api/v1/admin/email-suppressions`, { signal: AbortSignal.timeout(10_000) })).status, 403, "Production suppression records were publicly accessible.");

  assert.equal(run(["exec", application, "node", "-p", "process.getuid()" ]).output.trim(), "1001");
  run(["exec", application, "node", "-e", "const fs=require('fs');for(const p of ['/tmp/acceptance-write','/app/.next/cache/acceptance-write']){fs.writeFileSync(p,'ok');fs.unlinkSync(p)}try{fs.writeFileSync('/app/acceptance-write','blocked');process.exit(1)}catch(e){if(e.code!=='EROFS')throw e}if(fs.readdirSync('/app').some(n=>n==='.env'||n.startsWith('.env.')))process.exit(1)"]);
  await until(() => run(["inspect", "--format", "{{.State.Health.Status}}", application]).output.trim() === "healthy", "Docker health check did not become healthy.");

  console.log("Checking browser widgets against the production bundle with a synthetic provider script.");
  const widget = spawnSync(process.execPath, ["scripts/verify-production-widget.mjs"], {
    cwd: root, env: { ...process.env, WIDGET_BASE_URL: origin }, encoding: "utf8", timeout: 90_000,
  });
  assert.equal(widget.status, 0, "Production widget browser check failed; no real provider was contacted.");
  const missingConfig = `${prefix}-missing-config`;
  containers.add(missingConfig);
  const rejected = run(["run", "--rm", "--name", missingConfig, "--network", "none", runtimeImage], { allowFailure: true, timeout: 15_000 });
  assert.notEqual(rejected.status, 0, "Runtime accepted missing production settings.");
  assert.match(rejected.output, /DATABASE_URL is required/);
  containers.delete(missingConfig);
  console.log("Container acceptance passed: migrations, health/pages, private-page guard, runtime-only public key, UID/filesystem restrictions, signed email receipt authentication/replay/privacy, synthetic widgets and missing-configuration rejection.");
  console.log("No live provider, cloud deployment, vulnerability scan, load test or physical device was certified.");
} catch (error) {
  if (containers.has(application)) {
    const logs = run(["logs", "--tail", "40", application], { allowFailure: true }).output;
    console.error(logs.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]").slice(-3000));
  }
  throw error;
} finally {
  let cleanupFailed = false;
  for (const name of [...containers].reverse()) {
    const result = run(["rm", "--force", name], { allowFailure: true });
    if (result.status !== 0 && run(["inspect", name], { allowFailure: true }).status === 0) { cleanupFailed = true; console.error(`Could not remove acceptance container ${name}.`); }
  }
  if (networkCreated && run(["network", "rm", network], { allowFailure: true }).status !== 0) { cleanupFailed = true; console.error(`Could not remove acceptance network ${network}.`); }
  // Removing these unique tags preserves shared layers and build caches.
  if (localDaemonVerified) {
    run(["image", "rm", runtimeImage, migrationImage], { allowFailure: true });
    for (const tag of [runtimeImage, migrationImage]) {
      if (run(["image", "inspect", tag], { allowFailure: true }).status === 0) { cleanupFailed = true; console.error(`Could not remove acceptance image tag ${tag}.`); }
    }
  }
  await rm(directory, { recursive: true, force: true });
  if (cleanupFailed) throw new Error("Acceptance resource cleanup needs attention; see generated resource names above.");
  console.log("Cleaned up owned acceptance resources and temporary credential files; shared build caches remain.");
}
