export function isolatedDevArguments(port, bundler = "turbopack") {
  if (!["turbopack", "webpack"].includes(bundler)) throw new Error("ISOLATED_TEST_BUNDLER must be turbopack or webpack.");
  return ["node_modules/next/dist/bin/next", "dev", ...(bundler === "webpack" ? ["--webpack", "--disable-source-maps"] : []), "-p", String(port)];
}

export function isolatedDevNodeOptions(bundler = "turbopack", existing = "", memoryLimitBytes = Infinity) {
  if (!["turbopack", "webpack"].includes(bundler)) throw new Error("ISOLATED_TEST_BUNDLER must be turbopack or webpack.");
  if (bundler === "webpack" && memoryLimitBytes < 6 * 1024 ** 3) throw new Error("Isolated Webpack verification requires at least 6 GiB RAM for its bounded compiler heap, browser and database. Increase test-runner memory; do not disable the restart guard.");
  // Test-runtime only. Keep Next's 80% restart guard, but leave sufficient heap
  // for the multi-role graph and reserve memory for Chromium/PostgreSQL.
  return bundler === "webpack" ? `${existing} --max-old-space-size=5120`.trim() : existing;
}
