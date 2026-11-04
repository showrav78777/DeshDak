import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { libpqEnvironment, runPostgresCommand as run, safeDatabaseLabel, validateBackupConfiguration } from "./lib/postgres-operations.mjs";

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const configuration = validateBackupConfiguration(process.env);
process.umask(0o077);
await mkdir(configuration.outputDirectory, { recursive: true, mode: 0o700 });
const directory = await lstat(configuration.outputDirectory);
if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 || (process.getuid && directory.uid !== process.getuid())) throw new Error("Backup directory must be an owned, private directory (0700), not a symbolic link.");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const safeName = configuration.connection.databaseName.replace(/[^a-zA-Z0-9_-]/g, "_");
const backupFile = path.join(configuration.outputDirectory, `${safeName}-${timestamp}-${randomUUID()}.dump`);
const commandEnvironment = libpqEnvironment(process.env, configuration.connection);

// Reserve an unpredictable path exclusively before invoking the external tool.
const reserved = await open(backupFile, "wx", 0o600);
await reserved.close();
let checksumReserved = false;
try {
  run("pg_dump", ["--format=custom", "--compress=9", "--no-owner", "--no-privileges", "--file", backupFile], commandEnvironment);
  const archive = await lstat(backupFile);
  if (!archive.isFile() || archive.isSymbolicLink() || (archive.mode & 0o077) !== 0) throw new Error("Backup archive permissions are unsafe.");
  run("pg_restore", ["--list", backupFile], commandEnvironment);
  const checksum = await sha256(backupFile);
  const sidecar = await open(`${backupFile}.sha256`, "wx", 0o600);
  checksumReserved = true;
  try { await sidecar.writeFile(`${checksum}  ${path.basename(backupFile)}\n`, "utf8"); }
  finally { await sidecar.close(); }
} catch (error) {
  await unlink(backupFile).catch(() => {});
  if (checksumReserved) await unlink(`${backupFile}.sha256`).catch(() => {});
  throw error;
}

console.log(`Verified PostgreSQL backup created for ${safeDatabaseLabel(configuration.connection)}.`);
console.log(`Archive: ${backupFile}`);
console.log(`Checksum: ${backupFile}.sha256`);
