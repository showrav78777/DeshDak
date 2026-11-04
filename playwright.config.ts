import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("E2E runs require a local test environment; never point this suite at production.");
export default defineConfig({
  testDir: "./e2e", fullyParallel: true, forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0, workers: process.env.E2E_WORKERS === "1" ? 1 : 2, timeout: 30_000, globalTimeout: 600_000,
  failOnFlakyTests: Boolean(process.env.CI),
  expect: { timeout: 10_000, toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.01 } },
  outputDir: "test-results", globalTeardown: "./e2e/teardown.ts",
  reporter: process.env.E2E_BLOB === "1" ? [["line"], ["blob", { outputDir: process.env.E2E_BLOB_DIR ?? "blob-report" }]] : [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", video: "off", serviceWorkers: "block" },
  projects: [
    { name: "setup", fullyParallel: false, testMatch: /environment\.setup\.ts/, use: { trace: "off", screenshot: "off" } },
    { name: "desktop", testMatch: /.*\.spec\.ts/, testIgnore: /(?:authenticated|account-review|employee|scanner-recovery)\.spec\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", testMatch: /.*\.spec\.ts/, testIgnore: /(?:authenticated|account-review|employee|scanner-recovery)\.spec\.ts/, use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
    { name: "employee", testMatch: /(?:employee|scanner-recovery)\.spec\.ts/, use: { ...devices["Desktop Chrome"], trace: "off", screenshot: "off" }, dependencies: ["setup"] },
    { name: "customer", testMatch: /(?:authenticated|account-review)\.spec\.ts/, use: { ...devices["Desktop Chrome"], ...(process.env.E2E_CUSTOMER_EMAIL ? { storageState: "e2e/.auth/customer.json" } : {}), trace: "off", screenshot: "off" }, dependencies: ["setup"] },
  ],
  // Start the app separately. No automatic seeding, schema reset or live payment.
});
