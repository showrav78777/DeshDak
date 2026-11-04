import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBackupConfiguration, validateRestoreConfiguration } from "./lib/postgres-operations.mjs";

const databaseUrl = "postgresql://operator:private-value@database.crossly.internal:5432/crossly?sslmode=require";
assert.equal(validateBackupConfiguration({ DATABASE_URL: databaseUrl, BACKUP_CONFIRM_DATABASE_HOST: "database.crossly.internal", BACKUP_OUTPUT_DIR: "/var/backups/crossly" }, "/srv/crossly").connection.databaseName, "crossly");
assert.throws(() => validateBackupConfiguration({ DATABASE_URL: databaseUrl, BACKUP_CONFIRM_DATABASE_HOST: "wrong.internal", BACKUP_OUTPUT_DIR: "/var/backups/crossly" }, "/srv/crossly"), /exactly match/);
assert.throws(() => validateBackupConfiguration({ DATABASE_URL: databaseUrl, BACKUP_CONFIRM_DATABASE_HOST: "database.crossly.internal", BACKUP_OUTPUT_DIR: "/srv/crossly" }, "/srv/crossly"), /too broad/);
assert.throws(() => validateBackupConfiguration({ DATABASE_URL: databaseUrl, BACKUP_CONFIRM_DATABASE_HOST: "database.crossly.internal", BACKUP_OUTPUT_DIR: "/srv/crossly/public/backups" }, "/srv/crossly"), /outside the application/);

const validRestore = {
  RESTORE_DRILL_DATABASE_URL: "postgresql://operator:private-value@database.crossly.internal:5432/crossly_restore_drill_20260831?sslmode=require",
  RESTORE_CONFIRM_DATABASE_HOST: "database.crossly.internal",
  RESTORE_CONFIRM_DATABASE_NAME: "crossly_restore_drill_20260831",
  RESTORE_DRILL_BACKUP_FILE: "/var/backups/crossly/crossly.dump",
};
assert.equal(validateRestoreConfiguration(validRestore).connection.databaseName, validRestore.RESTORE_CONFIRM_DATABASE_NAME);
assert.throws(() => validateRestoreConfiguration({ ...validRestore, RESTORE_DRILL_DATABASE_URL: databaseUrl, RESTORE_CONFIRM_DATABASE_NAME: "crossly" }), /dedicated database/);
assert.throws(() => validateRestoreConfiguration({ ...validRestore, RESTORE_CONFIRM_DATABASE_HOST: "wrong.internal" }), /exactly match/);
assert.throws(() => validateRestoreConfiguration({ ...validRestore, RESTORE_CONFIRM_DATABASE_NAME: "crossly_restore_drill_wrong" }), /exactly match/);

const temporary = await mkdtemp(path.join(tmpdir(), "duar-backup-safety-"));
try {
  const bin = path.join(temporary, "bin"); await mkdir(bin, { mode: 0o700 });
  const marker = "synthetic-diagnostic-password-do-not-log";
  const fakeTool = `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const tool = path.basename(process.argv[1]);
if (process.env.SYNTHETIC_FAIL_TOOL === tool) { console.error(process.env.SYNTHETIC_SECRET); console.log(process.env.DATABASE_URL); process.exit(1); }
if (tool === 'pg_dump') {
 const file = process.argv[process.argv.indexOf('--file') + 1];
 if ((fs.statSync(file).mode & 0o077) !== 0) process.exit(2);
 fs.writeFileSync(file, 'synthetic archive content');
} else if (tool === 'pg_restore' && process.argv.includes('--dbname')) {
 if (!process.argv.includes('--single-transaction')) process.exit(3);
 fs.writeFileSync(process.env.SYNTHETIC_RESTORE_MARKER, 'transaction requested');
} else if (tool === 'psql') console.log(process.env.SYNTHETIC_EXISTING_OBJECTS || (process.env.SYNTHETIC_RESTORE_MARKER && fs.existsSync(process.env.SYNTHETIC_RESTORE_MARKER) ? '1' : '0'));
`;
  for (const name of ["pg_dump", "pg_restore", "psql"]) await writeFile(path.join(bin, name), fakeTool, { mode: 0o700 });
  const output = path.join(temporary, "archives");
  const environment = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DATABASE_URL: databaseUrl, BACKUP_CONFIRM_DATABASE_HOST: "database.crossly.internal", BACKUP_OUTPUT_DIR: output, SYNTHETIC_SECRET: marker };
  const run = (script, extra = {}) => spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { env: { ...environment, ...extra }, encoding: "utf8", timeout: 30_000 });
  const created = run("./create-database-backup.mjs"); assert.equal(created.status, 0, created.stderr);
  assert.equal((await lstat(output)).mode & 0o777, 0o700);
  const files = await readdir(output); assert.equal(files.length, 2);
  for (const file of files) assert.equal((await lstat(path.join(output, file))).mode & 0o777, 0o600);
  for (const failedTool of ["pg_dump", "pg_restore"]) {
    const failed = run("./create-database-backup.mjs", { SYNTHETIC_FAIL_TOOL: failedTool });
    assert.notEqual(failed.status, 0); assert.match(failed.stderr, /output was withheld/);
    assert(!`${failed.stderr}${failed.stdout}`.includes(marker)); assert(!`${failed.stderr}${failed.stdout}`.includes(databaseUrl));
    assert.deepEqual(await readdir(output), files, "Failed backup left a partial archive or changed existing evidence.");
  }
  const dump = path.join(output, files.find(file => file.endsWith(".dump")));
  const restored = run("./restore-database-drill.mjs", { ...validRestore, RESTORE_DRILL_BACKUP_FILE: dump, SYNTHETIC_RESTORE_MARKER: path.join(temporary, "restored") });
  assert.equal(restored.status, 0, restored.stderr);
  const blockedMarker = path.join(temporary, "must-not-restore");
  const occupied = run("./restore-database-drill.mjs", { ...validRestore, RESTORE_DRILL_BACKUP_FILE: dump, SYNTHETIC_EXISTING_OBJECTS: "1", SYNTHETIC_RESTORE_MARKER: blockedMarker });
  assert.notEqual(occupied.status, 0); assert.match(occupied.stderr, /target is not empty/);
  await assert.rejects(lstat(blockedMarker), { code: "ENOENT" });
  const restoreFailed = run("./restore-database-drill.mjs", { ...validRestore, RESTORE_DRILL_BACKUP_FILE: dump, SYNTHETIC_FAIL_TOOL: "psql" });
  assert.notEqual(restoreFailed.status, 0); assert.match(restoreFailed.stderr, /output was withheld/);
  assert(!`${restoreFailed.stderr}${restoreFailed.stdout}`.includes(marker));
  assert(!`${restoreFailed.stderr}${restoreFailed.stdout}`.includes(databaseUrl));
  const link = path.join(temporary, "linked-archives"); await symlink(output, link);
  assert.match(run("./create-database-backup.mjs", { BACKUP_OUTPUT_DIR: link }).stderr, /private directory/);
  await chmod(output, 0o755);
  assert.match(run("./create-database-backup.mjs").stderr, /private directory/);
  assert.deepEqual(await readdir(output), files);
} finally { await rm(temporary, { recursive: true, force: true }); }

console.log("Backup/restore safety passed: target guards, private archive permissions, symlink rejection, diagnostic redaction and partial-backup cleanup (synthetic commands; no database connection).");
