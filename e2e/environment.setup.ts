import { test, expect } from "@playwright/test";
import { mkdir, chmod, rm } from "node:fs/promises";

test("local application is healthy", async ({ request }) => {
  test.setTimeout(120_000);
  for (const portal of ["customer", "warehouse", "inspector", "logistics", "support"]) await rm(`e2e/.auth/${portal}.json`, { force: true });
  const response = await request.get("/api/v1/health/live");
  expect(response.ok()).toBeTruthy();
  // Measure workflows on a compiled development route, not a cold compiler.
  // This public read changes no state; cold-start latency remains separate evidence.
  expect((await request.get("/products")).status()).toBe(200);
  const privatePage = await request.get("/warehouse/packages/SYNTHETIC-PREFLIGHT", { maxRedirects: 0 });
  expect(privatePage.status()).toBe(307);
  expect(privatePage.headers().location).toBe("/warehouse/login");
  // Compile protected dev-server handlers before enrolling browser users. This
  // avoids HMR replacing an enrollment screen while one-time codes are displayed.
  // These unauthenticated requests must fail authorization and never mutate data.
  for (const [method, path] of [
    ["POST", "/api/v1/auth/mfa/setup"], ["POST", "/api/v1/auth/mfa/confirm"],
    ["POST", "/api/v1/auth/mfa/verify"], ["GET", "/api/v1/admin/users"],
    ["PATCH", "/api/v1/admin/orders/fixture/purchase-review"],
    ["POST", "/api/v1/admin/orders/fixture/shipping-quote"],
    ["POST", "/api/v1/payments/shipping/wallet"],
    ["POST", "/api/v1/operations/packages/receive"],
    ["POST", "/api/v1/operations/packages/lookup"],
    ["POST", "/api/v1/tickets/fixture/satisfaction"],
    ["POST", "/api/v1/admin/support-shifts"],
    ["POST", "/api/v1/operations/packages/fixture/inspect"],
    ["GET", "/api/v1/operations/packages/fixture/inspection-evidence"],
    ["POST", "/api/v1/operations/packages/fixture/measure"],
    ["POST", "/api/v1/operations/packages/fixture/put-away"],
  ]) {
    const protectedResponse = await request.fetch(path, { method, data: method === "GET" ? undefined : path.endsWith("/lookup") ? { code: "SYNTHETIC-PREFLIGHT" } : {} });
    expect([401, 403]).toContain(protectedResponse.status());
  }
});

test("optional employee authentication states", async ({ playwright, baseURL }) => {
  test.skip(!process.env.E2E_STAFF_ACCOUNTS, "Requires disposable employee fixtures.");
  const accounts = JSON.parse(process.env.E2E_STAFF_ACCOUNTS!) as { portal: string; email: string; password: string }[];
  await mkdir("e2e/.auth", { recursive: true, mode: 0o700 });
  await chmod("e2e/.auth", 0o700);
  for (const account of accounts) {
    if (!["warehouse", "inspector", "logistics", "support"].includes(account.portal)) throw new Error("Unexpected employee portal.");
    const context = await playwright.request.newContext({ baseURL });
    try {
      const response = await context.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: account });
      expect(response.status()).toBe(200);
      const path = `e2e/.auth/${account.portal}.json`;
      await context.storageState({ path });
      await chmod(path, 0o600);
    } finally { await context.dispose(); }
  }
});

test("optional customer authentication state", async ({ request, baseURL }) => {
  test.skip(!process.env.E2E_CUSTOMER_EMAIL, "Provide a dedicated test customer to enable authenticated coverage.");
  if (!process.env.E2E_CUSTOMER_PASSWORD) throw new Error("E2E_CUSTOMER_PASSWORD is required with E2E_CUSTOMER_EMAIL.");
  const response = await request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: process.env.E2E_CUSTOMER_EMAIL, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } });
  // Do not attach response bodies, credentials or cookie values to reports.
  expect(response.status()).toBe(200);
  await mkdir("e2e/.auth", { recursive: true, mode: 0o700 });
  await chmod("e2e/.auth", 0o700);
  await request.storageState({ path: "e2e/.auth/customer.json" });
  await chmod("e2e/.auth/customer.json", 0o600);
});
