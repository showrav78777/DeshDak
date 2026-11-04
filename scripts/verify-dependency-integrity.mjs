import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [manifest, lockfile] = await Promise.all([
  readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  readFile(new URL("package-lock.json", root), "utf8").then(JSON.parse),
]);

assert.equal(lockfile.lockfileVersion, 3, "package-lock.json must use lockfile version 3.");
assert.match(manifest.packageManager ?? "", /^npm@\d+\.\d+\.\d+$/, "npm must be pinned to an exact version.");

const declared = manifest.dependencies ?? {};
const lockedRoot = lockfile.packages?.[""]?.dependencies ?? {};
assert.deepEqual(lockedRoot, declared, "Production dependencies in package.json and package-lock.json differ.");

for (const [name, requested] of Object.entries(declared)) {
  assert(!/^(?:file:|link:|git(?:\+|:)|https?:)/i.test(requested), `${name} uses a non-registry dependency source.`);
  const entry = lockfile.packages?.[`node_modules/${name}`];
  assert(entry?.version, `${name} is missing a locked version.`);
  assert.match(entry.integrity ?? "", /^sha512-/, `${name} is not protected by SHA-512 integrity metadata.`);
  assert.match(entry.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${name} is not resolved from the HTTPS npm registry.`);
}

const productionEntries = Object.entries(lockfile.packages ?? {}).filter(
  ([path, entry]) => path.includes("node_modules/") && !entry.dev && !entry.link,
);
for (const [path, entry] of productionEntries) {
  assert.match(entry.integrity ?? "", /^sha512-/, `${path} is not protected by SHA-512 integrity metadata.`);
  assert.match(entry.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${path} has an unapproved package source.`);
}

const installedTree = spawnSync("npm", ["ls", "--omit=dev", "--depth=0"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(installedTree.status, 0, "The installed production dependency tree is invalid. Run npm ci and retry.");

console.log(`Dependency integrity verification passed for ${Object.keys(declared).length} direct and ${productionEntries.length} locked production packages.`);
