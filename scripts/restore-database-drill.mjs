import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { libpqEnvironment, restoreTargetObjectCountSql, runPostgresCommand as run, safeDatabaseLabel, validateRestoreConfiguration } from "./lib/postgres-operations.mjs";

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const configuration = validateRestoreConfiguration(process.env);
await access(configuration.backupFile);
const checksumFile = `${configuration.backupFile}.sha256`;
const expectedChecksum = (await readFile(checksumFile, "utf8")).trim().split(/\s+/)[0];
const actualChecksum = await sha256(configuration.backupFile);
if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || !timingSafeEqual(Buffer.from(expectedChecksum), Buffer.from(actualChecksum))) throw new Error("Backup checksum verification failed.");

const commandEnvironment = libpqEnvironment(process.env, configuration.connection);
const existingObjectCount = Number(run("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--command", restoreTargetObjectCountSql], commandEnvironment));
if (!Number.isInteger(existingObjectCount) || existingObjectCount !== 0) throw new Error("Restore drill target is not empty; no restore was attempted.");

run("pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname", configuration.connection.databaseName, configuration.backupFile], commandEnvironment);
const restoredTableCount = Number(run("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--command", "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"], commandEnvironment));
const successfulMigrations = Number(run("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--command", "SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) END;"], commandEnvironment));
if (!Number.isInteger(restoredTableCount) || restoredTableCount < 1) throw new Error("Restore completed without application tables.");
if (!Number.isInteger(successfulMigrations) || successfulMigrations < 1) throw new Error("Restore completed without successful Prisma migration evidence.");

console.log(`Restore drill passed for ${safeDatabaseLabel(configuration.connection)}.`);
console.log(`Restored application tables: ${restoredTableCount}; successful migrations: ${successfulMigrations}.`);
console.log("The script does not delete the drill database. The operator must retain evidence, then remove it using the approved infrastructure procedure.");
