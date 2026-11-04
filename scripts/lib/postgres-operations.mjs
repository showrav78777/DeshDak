import path from "node:path";
import { spawnSync } from "node:child_process";

export function runPostgresCommand(command, arguments_, environment) {
  const result = spawnSync(command, arguments_, { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // Driver diagnostics can contain connection strings, passwords or row data.
  // Never include either output stream (or the spawn error) in an exception.
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Database command output was withheld to protect credentials and private data.`);
  return result.stdout.trim();
}

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

// A drill target must contain no user objects, including objects without tables.
export const restoreTargetObjectCountSql = `SELECT
  (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_') +
  (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_') +
  (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_') +
  (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_');`;

export function parsePostgresUrl(raw, label) {
  if (!raw) throw new Error(`${label} is required.`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} must be a valid PostgreSQL URL.`); }
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) throw new Error(`${label} must use PostgreSQL.`);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !databaseName) throw new Error(`${label} must include a host and database name.`);
  return { url, host: url.hostname.toLowerCase(), databaseName };
}

export function libpqEnvironment(baseEnvironment, connection) {
  const sslMode = connection.url.searchParams.get("sslmode");
  return {
    ...baseEnvironment,
    PGHOST: connection.url.hostname,
    PGPORT: connection.url.port || "5432",
    PGDATABASE: connection.databaseName,
    PGUSER: decodeURIComponent(connection.url.username),
    PGPASSWORD: decodeURIComponent(connection.url.password),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

export function validateBackupConfiguration(environment, currentDirectory = process.cwd()) {
  const connection = parsePostgresUrl(environment.DATABASE_URL, "DATABASE_URL");
  const confirmedHost = environment.BACKUP_CONFIRM_DATABASE_HOST?.trim().toLowerCase();
  if (!confirmedHost || confirmedHost !== connection.host) throw new Error("BACKUP_CONFIRM_DATABASE_HOST must exactly match the database host.");
  const rawDirectory = environment.BACKUP_OUTPUT_DIR?.trim();
  if (!rawDirectory || !path.isAbsolute(rawDirectory)) throw new Error("BACKUP_OUTPUT_DIR must be an explicit absolute path.");
  const outputDirectory = path.resolve(rawDirectory);
  const forbidden = new Set([path.parse(outputDirectory).root, path.resolve(currentDirectory), path.resolve(currentDirectory, "..")]);
  if (forbidden.has(outputDirectory)) throw new Error("BACKUP_OUTPUT_DIR is too broad; choose a dedicated backup directory.");
  const relative = path.relative(path.resolve(currentDirectory), outputDirectory);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) throw new Error("BACKUP_OUTPUT_DIR must be outside the application directory to prevent accidental publication.");
  return { connection, outputDirectory };
}

export function validateRestoreConfiguration(environment) {
  const connection = parsePostgresUrl(environment.RESTORE_DRILL_DATABASE_URL, "RESTORE_DRILL_DATABASE_URL");
  const confirmedHost = environment.RESTORE_CONFIRM_DATABASE_HOST?.trim().toLowerCase();
  const confirmedName = environment.RESTORE_CONFIRM_DATABASE_NAME?.trim();
  if (!confirmedHost || confirmedHost !== connection.host) throw new Error("RESTORE_CONFIRM_DATABASE_HOST must exactly match the restore target host.");
  if (!confirmedName || confirmedName !== connection.databaseName) throw new Error("RESTORE_CONFIRM_DATABASE_NAME must exactly match the restore target database.");
  if (!/^crossly_restore_drill_[a-z0-9_]{4,50}$/.test(connection.databaseName)) throw new Error("Restore target must be a dedicated database named crossly_restore_drill_<identifier>.");
  if (!environment.RESTORE_DRILL_BACKUP_FILE?.trim() || !path.isAbsolute(environment.RESTORE_DRILL_BACKUP_FILE.trim())) throw new Error("RESTORE_DRILL_BACKUP_FILE must be an explicit absolute path.");
  return { connection, backupFile: path.resolve(environment.RESTORE_DRILL_BACKUP_FILE.trim()) };
}

export function safeDatabaseLabel(connection) {
  return `${connection.host}/${connection.databaseName}`;
}
