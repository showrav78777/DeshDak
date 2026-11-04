import assert from "node:assert/strict";
import { isolatedDevArguments, isolatedDevNodeOptions } from "./lib/isolated-dev-arguments.mjs";

assert.deepEqual(isolatedDevArguments(3117), ["node_modules/next/dist/bin/next", "dev", "-p", "3117"]);
assert.deepEqual(isolatedDevArguments(3117, "turbopack"), isolatedDevArguments(3117));
assert.deepEqual(isolatedDevArguments(3118, "webpack"), ["node_modules/next/dist/bin/next", "dev", "--webpack", "--disable-source-maps", "-p", "3118"]);
assert.equal(isolatedDevNodeOptions(), "");
assert.equal(isolatedDevNodeOptions("turbopack", "--trace-warnings"), "--trace-warnings");
assert.equal(isolatedDevNodeOptions("webpack"), "--max-old-space-size=5120");
assert.equal(isolatedDevNodeOptions("webpack", "--trace-warnings"), "--trace-warnings --max-old-space-size=5120");
assert.throws(() => isolatedDevNodeOptions("webpack", "", 5 * 1024 ** 3), /at least 6 GiB/);
assert.equal(isolatedDevNodeOptions("webpack", "", 6 * 1024 ** 3), "--max-old-space-size=5120");
assert.equal(isolatedDevNodeOptions("turbopack", "", 2 * 1024 ** 3), "");
assert.throws(() => isolatedDevNodeOptions("invalid"), /must be turbopack or webpack/);
for (const value of ["", "WEBPACK", "--webpack", "webpack --port 80", "production", null]) assert.throws(() => isolatedDevArguments(3117, value), /must be turbopack or webpack/);
console.log("Isolated bundler arguments: defaults preserved, bounded Webpack heap/source-map policy and invalid values verified.");
