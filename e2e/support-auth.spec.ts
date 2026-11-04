import { test, expect } from "./fixtures";

// Authentication requests contain process-local credentials: never retain traces/screenshots.
test.use({ trace: "off", screenshot: "off" });
test.describe.configure({ retries: 0 });
test("support sign-in and sign-out request recovery", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_STAFF_ACCOUNTS, "Requires disposable staff accounts.");
  test.setTimeout(90_000);
  const account = (JSON.parse(process.env.E2E_STAFF_ACCOUNTS!) as { portal: string; email: string; password: string }[]).find(item => item.portal === "support")!;
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    // This case verifies auth, not cold development compilation of the homepage.
    // Keep the real destination and the existing navigation assertion deadline.
    expect((await context.request.get("/")).status()).toBe(200);
    const page = await context.newPage();
    await page.route("**/api/v1/advertisements?**", route => route.fulfill({ json: { data: { advertisements: [] } } }));
    await page.goto("/support/login");
    const form = page.locator(".support-login-card");
    const button = form.getByRole("button", { name: "Open Support Portal", exact: true });
    await expect(button).toBeEnabled();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/support/login");
      await expect(fallback.locator(".support-login-card")).toHaveAttribute("method", "post");
      for (const control of await fallback.locator(".support-login-card input,.support-login-card button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    await form.getByLabel("Work account email").fill(account.email);
    await form.getByLabel("Password", { exact: true }).fill(account.password);
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route("**/api/v1/auth/login", route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 401, json: { error: { message: "Synthetic sign-in error" } } } : { json: { data: {} } }));
      await button.click();
      await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic sign-in error" : "Could not confirm sign-in");
      await expect(button).toBeEnabled();
      // Boolean only: do not expose a credential in assertion output.
      expect(await form.getByLabel("Password", { exact: true }).evaluate(element => (element as HTMLInputElement).value.length > 0)).toBe(true);
      await expect(page).toHaveURL(`${baseURL}/support/login`);
      await page.unroute("**/api/v1/auth/login");
    }
    let logins = 0;
    await page.route("**/api/v1/auth/login", async route => { logins++; await route.fulfill({ response: await route.fetch() }); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(page).toHaveURL(`${baseURL}/support/tickets`); expect(logins).toBe(1);
    expect((await context.request.get("/api/v1/support/tickets")).status()).toBe(200);
    const queueNoScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await queueNoScript.newPage(); await fallback.goto("/support/tickets");
      await expect(fallback.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
    } finally { await queueNoScript.close(); }
    const signOut = page.getByRole("button", { name: "Sign out", exact: true });
    const nav = page.locator(".support-portal-nav");
    for (const mode of ["abort", "json", "unconfirmed", "unavailable"]) {
      await page.route("**/api/v1/auth/logout", route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "unavailable" ? { status: 503, json: { error: { message: "Unavailable" } } } : { json: { data: {} } }));
      await signOut.click();
      await expect(nav.getByRole("alert")).toContainText("Could not confirm sign-out");
      await expect(signOut).toBeEnabled(); expect((await context.request.get("/api/v1/support/tickets")).status()).toBe(200);
      await page.unroute("**/api/v1/auth/logout");
    }
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    const oldSession = await browser.newContext({ baseURL, storageState: await context.storageState() });
    try {
      let logouts = 0;
      await page.route("**/api/v1/auth/logout", async route => { logouts++; await route.fulfill({ response: await route.fetch() }); });
      await signOut.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
      await expect(page).toHaveURL(`${baseURL}/`); expect(logouts).toBe(1);
      expect((await oldSession.request.get("/api/v1/support/tickets")).status()).toBe(403);
      await page.goto("/support/tickets"); await expect(page).toHaveURL(/\/support\/login$/);
    } finally { await oldSession.close(); }
  } finally {
    await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } });
    await context.close();
  }
});
