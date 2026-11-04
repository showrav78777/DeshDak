import { test, expect } from "./fixtures";

test.describe("staff scanner recovery", () => {
  test.describe.configure({ retries: 0 });
  for (const [portal, endpoint] of [
    ["warehouse", "/api/v1/operations/packages/lookup"],
    ["inspector", "/api/v1/operations/inspections/lookup"],
    ["logistics", "/api/v1/operations/shipments/lookup"],
  ] as const) {
    test(`${portal}: recover from connection and invalid JSON failures`, async ({ browser, baseURL }) => {
      test.skip(!process.env.E2E_STAFF_ACCOUNTS, "Requires disposable staff accounts.");
      const context = await browser.newContext({ baseURL, storageState: `e2e/.auth/${portal}.json` });
      try {
        const page = await context.newPage();
        await page.goto(`/${portal}/scan`);
        const form = page.locator("form.warehouse-manual-scan");
        const error = page.locator(".warehouse-scanner-card").getByRole("alert");
        await form.locator('input[name="code"]').fill("SYNTHETIC-RECOVERY-CODE");
        const button = form.getByRole("button", { name: "Open task" });
        await page.route(`**${endpoint}`, route => route.abort("failed"));
        await button.click();
        await expect(error).toContainText("Check your connection");
        await expect(button).toBeEnabled();
        await page.unroute(`**${endpoint}`);
        await page.route(`**${endpoint}`, route => route.fulfill({ contentType: "application/json", body: "invalid JSON" }));
        await button.click();
        await expect(error).toContainText("Check your connection");
        await expect(button).toBeEnabled();
        await page.unroute(`**${endpoint}`);
        await page.route(`**${endpoint}`, route => route.fulfill({ json: { data: { destination: "https://untrusted.example.test/" } } }));
        await button.click();
        await expect(error).toContainText("incomplete");
        await expect(button).toBeEnabled();
        expect(new URL(page.url()).pathname).toBe(`/${portal}/scan`);
        const fallbackContext = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await context.storageState() });
        try {
          const fallback = await fallbackContext.newPage();
          await fallback.goto(`/${portal}/scan`);
          await expect(fallback.getByRole("button", { name: "Open task" })).toBeDisabled();
          await expect(fallback.locator("form.warehouse-manual-scan")).toHaveAttribute("method", "post");
          await expect(fallback.getByText("Enable JavaScript to look up assigned tasks. No code has been submitted.")).toBeVisible();
        } finally { await fallbackContext.close(); }
        // Hold navigation, so the verified destination remains usable even while
        // its server-rendered page is delayed. No lookup or write is replayed.
        await page.unroute(`**${endpoint}`);
        const destination = `/${portal}/scan?matched=1`;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const navigation = (url: URL) => url.pathname === `/${portal}/scan` && url.searchParams.get("matched") === "1";
        await page.route(navigation, async route => { await gate; await route.continue(); });
        try {
          await page.route(`**${endpoint}`, route => route.fulfill({ json: { data: { destination } } }));
          await button.click();
          await expect(page.getByRole("link", { name: "Open matched task", exact: true })).toHaveAttribute("href", destination);
          await expect(page.locator(".warehouse-scan-message")).toContainText("Task found");
          release(); await expect(page).toHaveURL(new RegExp(`/${portal}/scan\\?matched=1`));
        } finally { release(); await page.unroute(navigation); }
      } finally { await context.close(); }
    });
  }
});
