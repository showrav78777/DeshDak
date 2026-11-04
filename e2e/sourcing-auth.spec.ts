import { test, expect } from "./fixtures";

test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("sourcing sign-in recovery and dedicated role access", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SOURCING_ACCOUNTS, "Requires isolated sourcing accounts.");
  test.setTimeout(90_000);
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const account = (JSON.parse(process.env.E2E_SOURCING_ACCOUNTS!) as Record<string, { email: string }>)[info.project.name];
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/sourcing/login");
      const form = fallback.locator(".sourcing-login-form"); await expect(form).toHaveAttribute("method", "post");
      for (const control of await form.locator("input,button").all()) await expect(control).toBeDisabled();
      await expect(form).toContainText("No credentials have been submitted");
    } finally { await noScript.close(); }
    const page = await context.newPage(); await page.goto("/sourcing/login");
    const form = page.locator(".sourcing-login-form"); const button = form.getByRole("button", { name: "Sign in securely", exact: true });
    await expect(button).toBeEnabled(); await form.getByLabel("Work account email").fill("synthetic-sourcing@example.test"); await form.getByLabel("Password", { exact: true }).fill("SyntheticNotAnAccountPassword!");
    const pattern = "**/api/v1/auth/login";
    for (const mode of ["abort", "json", "unconfirmed", "wrong-role", "wrong-action", "bad-session", "rejected"]) {
      const data = { user: { roles: [mode === "wrong-role" ? "customer_personal" : "sourcing_agent"] }, session: { id: mode === "bad-session" ? "invalid" : crypto.randomUUID() }, nextAction: mode === "wrong-action" ? "MFA_ENROLLMENT" : "SIGNED_IN" };
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 403, json: { error: { message: "Synthetic sourcing rejection" } } } : { json: { data: mode === "unconfirmed" ? {} : data } }));
      await button.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic sourcing rejection" : "Could not confirm sign-in");
      await expect(button).toBeEnabled(); await expect(form.getByLabel("Password", { exact: true })).toHaveValue("SyntheticNotAnAccountPassword!"); await expect(page).toHaveURL(/\/sourcing\/login$/); await page.unroute(pattern);
    }
    expect(await form.locator("input").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await button.evaluate(element => getComputedStyle(element).minHeight)).toBe("48px");
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await info.attach(`sourcing-login-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    let requests = 0;
    await page.route(pattern, route => { requests++; return route.fulfill({ json: { data: { user: { roles: ["sourcing_agent"] }, session: { id: crypto.randomUUID() }, nextAction: "SIGNED_IN" } } }); });
    await page.route(url => url.pathname === "/sourcing", route => route.fulfill({ contentType: "text/html", body: "<h1>Synthetic sourcing handoff only</h1>" }));
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(page.getByRole("heading", { name: "Synthetic sourcing handoff only" })).toBeVisible(); expect(requests).toBe(1);
  } finally { await context.close(); }

  const real = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    expect((await real.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: process.env.E2E_CUSTOMER_EMAIL, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "sourcing" } })).status()).toBe(403);
    const page = await real.newPage(); await page.goto("/sourcing/login");
    await page.getByLabel("Work account email").fill(account.email); await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_CUSTOMER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in securely", exact: true }).click();
    await expect(page).toHaveURL(/\/sourcing$/); await expect(page.getByRole("heading", { name: "Prepare customer quote drafts." })).toBeVisible();
    await page.reload(); await expect(page).toHaveURL(/\/sourcing$/);
    expect((await real.request.get("/api/v1/sourcing-agent/requests")).status()).toBe(200);
    expect((await real.request.get("/api/v1/admin/users")).status()).toBe(403);
    expect((await real.request.get("/api/v1/finance/payment-reconciliation")).status()).toBe(403);
  } finally {
    expect((await real.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200); await real.close();
  }
});
