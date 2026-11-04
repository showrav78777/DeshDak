import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required for migration verification.");

const parsedBaseUrl = new URL(baseDatabaseUrl);
if (!parsedBaseUrl.protocol.startsWith("postgres")) throw new Error("Migration verification requires PostgreSQL.");

const schemaSource = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const expectedApplicationTables = schemaSource.match(/^model\s+\w+\s+\{/gm)?.length ?? 0;
const expectedMigrations = readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const baselineSql = readFileSync(join(process.cwd(), "prisma", "migrations", "20260825170000_initial_baseline", "migration.sql"), "utf8");
if (/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(baselineSql)) throw new Error("The initial baseline unexpectedly contains destructive SQL.");
if (!expectedApplicationTables || !expectedMigrations.length) throw new Error("The schema or committed migration history is empty.");

const schemaName = `crossly_migration_verify_${randomBytes(8).toString("hex")}`;
if (!/^crossly_migration_verify_[a-f0-9]{16}$/.test(schemaName)) throw new Error("Unsafe temporary schema name.");

const verificationUrl = new URL(parsedBaseUrl);
verificationUrl.searchParams.set("schema", schemaName);
const admin = new PrismaClient({ datasources: { db: { url: parsedBaseUrl.toString() } } });
let verification;
let createdSchema = false;

function sanitize(output) {
  return String(output ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]").slice(-3000);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: verificationUrl.toString() },
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    const diagnostic = sanitize(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    throw new Error(`Migration verification command failed (${command} ${args.join(" ")}).\n${diagnostic}`);
  }
  return result;
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  createdSchema = true;

  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["prisma", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  run("node", ["--env-file-if-exists=.env", "prisma/seed.mjs"]);
  run("npx", ["prisma", "migrate", "deploy"]);

  verification = new PrismaClient({ datasources: { db: { url: verificationUrl.toString() } } });
  const tables = await verification.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
    schemaName,
  );
  const migrations = await verification.$queryRawUnsafe(
    'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC',
  );
  const [roles, categories] = await Promise.all([verification.role.count(), verification.category.count()]);

  if (tables[0]?.count !== expectedApplicationTables + 1) throw new Error(`Expected ${expectedApplicationTables} application tables plus migration history, found ${tables[0]?.count ?? 0}.`);
  const appliedMigrationNames = migrations.map((migration) => migration.migration_name);
  if (JSON.stringify(appliedMigrationNames) !== JSON.stringify(expectedMigrations) || migrations.some((migration) => !migration.finished_at || migration.rolled_back_at)) throw new Error("The applied migration history is incomplete or inconsistent.");
  if (roles !== 12 || categories !== 8) throw new Error(`Reference seed verification failed (roles=${roles}, categories=${categories}).`);

  console.log("Database migration verification passed: clean deploy, zero schema drift, reference seed, repeat deploy, and isolated cleanup.");
} finally {
  try {
    await verification?.$disconnect();
  } finally {
    try {
      if (createdSchema) {
        // This schema was generated and created only by this verification run. No application schema or user data is targeted.
        await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
        const remaining = await admin.$queryRawUnsafe(
          "SELECT COUNT(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1",
          schemaName,
        );
        if (remaining[0]?.count !== 0) throw new Error("Temporary migration-verification schema cleanup failed.");
      }
    } finally {
      await admin.$disconnect();
    }
  }
}
