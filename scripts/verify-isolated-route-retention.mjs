import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const [environment, marker, expected] of [
  ["development", "1", true],
  ["development", "", false],
  ["production", "1", false],
  ["production", "", false],
  ["test", "1", false],
]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import config from './next.config.ts';
    console.log(JSON.stringify(config.onDemandEntries ?? null));
  `], { encoding: "utf8", env: { ...process.env, NODE_ENV: environment, CROSSLY_ISOLATED_ROUTE_RETENTION: marker } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected ? { maxInactiveAge: 900_000, pagesBufferLength: 64 } : null);
}
console.log("Isolated route retention: explicitly enabled dev only; normal dev, production and test defaults preserved.");
