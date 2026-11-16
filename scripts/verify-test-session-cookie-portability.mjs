import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const currentFile = basename(fileURLToPath(import.meta.url));
const files = (await readdir(scriptsDirectory)).filter((file) => file.startsWith("verify-") && file.endsWith(".mjs") && file !== currentFile);
const developmentOnlyCookie = /(?<!__Host-)crossly_session=\$\{([A-Za-z_][A-Za-z0-9_]*)\}(?!; __Host-crossly_session=\$\{\1\})/g;
const failures = [];

for (const file of files) {
  const source = await readFile(join(scriptsDirectory, file), "utf8");
  if (developmentOnlyCookie.test(source)) failures.push(file);
  developmentOnlyCookie.lastIndex = 0;
}

assert.deepEqual(failures, [], `Verification scripts contain development-only session cookies: ${failures.join(", ")}`);
const packageJson = JSON.parse(await readFile(join(projectDirectory, "package.json"), "utf8"));
const releaseRunner = await readFile(join(scriptsDirectory, "verify-launch-candidate.mjs"), "utf8");
const testCommands = Object.keys(packageJson.scripts).filter((name) => name.startsWith("test:"));
// Browser, standalone Docker, and isolated SQA commands own their environment.
// Interactive tools and report commands also run outside the API release runner.
// Keep this explicit so a newly added test cannot silently escape classification.
const separateCommands = {
  "test:sqa:isolated": "Standalone workflow runner that owns a fresh disposable PostgreSQL container.",
  "test:container-runtime": "Standalone Docker runtime and migration image acceptance with its own database.",
  "test:media-scanner-container": "Standalone Docker scanner gateway acceptance using a disposable ClamAV engine.",
  "test:media-scanner-engine": "Invoked by the scanner container runner with its loopback URL and a synthetic token.",
  "test:e2e": "Invoked by the isolated browser runner and its dedicated CI job.",
  "test:e2e:isolated": "Fresh-schema authenticated browser CI job; separate from API compilation.",
  "test:e2e:ui": "Interactive Playwright UI, not an unattended release check.",
  "test:e2e:debug": "Interactive debugger, not an unattended release check.",
  "test:e2e:report": "Opens already-generated browser evidence.",
  "test:e2e:merge": "Merges sharded CI evidence after browser completion.",
  "test:e2e:visual": "Separate browser visual workflow with reviewed baselines.",
};
for (const [name, reason] of Object.entries(separateCommands)) { assert(testCommands.includes(name), `Stale test classification: ${name}`); assert(reason.length > 20); }
const omittedTests = testCommands.filter((name) => !releaseRunner.includes(`"${name}"`) && !Object.hasOwn(separateCommands, name));
assert.deepEqual(omittedTests, [], `Release runner omits test commands: ${omittedTests.join(", ")}`);

console.log(`Verification infrastructure passed: production-safe cookies across ${files.length} workflow scripts; all ${testCommands.length} test commands explicitly classified for release or separate verification.`);
