import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { totalmem } from "node:os";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { isolatedDevArguments, isolatedDevNodeOptions } from "./lib/isolated-dev-arguments.mjs";

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required.");

const parsedBaseUrl = new URL(baseDatabaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
  throw new Error("Isolated launch verification may run only against a local PostgreSQL host.");
}

const schemaName = `crossly_launch_verify_${randomBytes(8).toString("hex")}`;
const isolatedDistDir = `.next-${schemaName}`;
if (!/^crossly_launch_verify_[a-f0-9]{16}$/.test(schemaName)) throw new Error("Unsafe verification schema name.");

const verificationUrl = new URL(parsedBaseUrl);
verificationUrl.searchParams.set("schema", schemaName);
const testPort = Number(process.env.ISOLATED_TEST_PORT ?? "3117");
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error("ISOLATED_TEST_PORT must be a safe non-privileged port.");
const testBaseUrl = `http://localhost:${testPort}`;
const devArguments = isolatedDevArguments(testPort, process.env.ISOLATED_TEST_BUNDLER);
const requestedChecks = process.argv.slice(2);
if (requestedChecks.some((check) => !/^(?:test|db):[a-z0-9:-]+$/.test(check))) throw new Error("Only explicit test:* or db:* npm scripts may be selected.");
const testEnvironment = {
  ...process.env,
  DATABASE_URL: verificationUrl.toString(),
  APP_BASE_URL: testBaseUrl,
  TEST_BASE_URL: testBaseUrl,
  // Per-run synthetic callback/recipient keys are shared by the test server and
  // child checks. Never require real provider secrets for isolated acceptance.
  RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString("base64")}`,
  EMAIL_SUPPRESSION_HASH_KEY: randomBytes(32).toString("base64"),
  // Workflow tests run against the development runtime so external CAPTCHA is
  // not falsely required. The optimized production bundle is verified by the
  // separate build gate before this isolated workflow suite is started.
  NODE_ENV: "development",
  KYC_DOCUMENT_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  INSPECTION_EVIDENCE_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ALLOW_DEV_KYC_DOCUMENT_UPLOADS: "true",
  ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS: "true",
  CROSSLY_ISOLATED_ROUTE_RETENTION: "1",
  CROSSLY_ISOLATED_DIST_DIR: isolatedDistDir,
  NODE_OPTIONS: isolatedDevNodeOptions(process.env.ISOLATED_TEST_BUNDLER ?? "turbopack", process.env.NODE_OPTIONS ?? "", Math.min(totalmem(), process.constrainedMemory() || Infinity)),
};

const admin = new PrismaClient({ datasources: { db: { url: parsedBaseUrl.toString() } } });
let server;
let createdSchema = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: testEnvironment,
    // Always capture output so a failed child gate is diagnosable from this
    // wrapper. Successful commands are replayed when the caller did not ask
    // for quiet output, preserving the normal launch-verification transcript.
    stdio: "pipe",
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!options.quiet && output) process.stdout.write(output);
  if (result.error || result.status !== 0) {
    const safeOutput = output
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
      .slice(-4000);
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${safeOutput || "No child-process output was produced."}`);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server && (server.exitCode !== null || server.signalCode !== null)) throw new Error(`Verification server exited before health verification (code ${server.exitCode ?? server.signalCode}).`);
    try {
      const response = await fetch(`${testBaseUrl}/api/v1/health/live`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the isolated production server.");
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  createdSchema = true;
  console.log(`Created isolated verification schema ${schemaName}.`);

  run("npx", ["prisma", "migrate", "deploy"], { quiet: true });
  run("node", ["--env-file-if-exists=.env", "prisma/seed.mjs"], { quiet: true });

  console.log(`Isolated development bundler: ${process.env.ISOLATED_TEST_BUNDLER ?? "turbopack"}.`);
  server = spawn(process.execPath, devArguments, {
    cwd: process.cwd(),
    env: testEnvironment,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitForHealth();
  console.log(`Isolated workflow-test server is healthy at ${testBaseUrl}.`);


  if (requestedChecks.length) {
    for (const check of requestedChecks) run("npm", ["run", check]);
  } else {
    run("npm", ["run", "verify:launch", "--", "--skip-build"]);
  }
  console.log("Isolated launch verification completed successfully.");
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once("exit", resolve));
      server.kill("SIGKILL"); await exited;
    }
  }
  try {
    if (createdSchema) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      console.log("Removed the isolated verification schema.");
    }
  } finally {
    await admin.$disconnect();
    await rm(resolve(process.cwd(), isolatedDistDir), { recursive: true, force: true });
  }
}
