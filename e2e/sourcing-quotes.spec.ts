import { test, expect } from "./fixtures";

test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("sourcing draft recovery and independent review handoff", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SOURCING_QUOTES, "Requires isolated sourcing draft fixtures.");
  test.setTimeout(120_000);
  const fixture = (JSON.parse(process.env.E2E_SOURCING_QUOTES!) as Record<string, { email: string; requestId: string; reference: string }>)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, timezoneId: "Australia/Sydney", storageState: { cookies: [], origins: [] } });
  const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: fixture.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "sourcing" } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/sourcing");
    const card = page.locator(".sourcing-card").filter({ hasText: fixture.reference, visible: true }); const form = card.locator("form");
    const button = form.getByRole("button", { name: "Submit draft for Admin review", exact: true });
    await expect(button).toBeEnabled(); await expect(form).toContainText("Expiry uses Australia/Sydney");
    await expect(page.getByRole("complementary", { name: "Quote preparation steps" })).toBeVisible();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/sourcing");
      const disabled = fallback.locator(".sourcing-card").filter({ hasText: fixture.reference }).locator("form");
      await expect(disabled).toHaveAttribute("method", "post"); for (const control of await disabled.locator("input,textarea,button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    for (const [name, value] of Object.entries({ productCostBdt: "1000", serviceFeeBdt: "100", originDeliveryBdt: "50", estimatedShippingBdt: "200", declaredWeightGrams: "500", fxRate: "16.5", expiresAt: "2000-01-01T12:00" })) await form.locator(`input[name=${name}]`).fill(value);
    const privateNote = `Synthetic private draft note ${info.project.name}`;
    await form.locator("textarea[name=note]").fill(privateNote); await button.click(); await expect(form.getByRole("alert")).toContainText("future expiry");
    await form.locator("input[name=expiresAt]").fill("2061-01-01T12:00");
    const pattern = `**/api/v1/sourcing-agent/requests/${fixture.requestId}/quote`;
    for (const mode of ["abort", "json", "unconfirmed", "wrong-state", "wrong-request", "rejected"]) {
      const quote = { id: crypto.randomUUID(), sourcingRequestId: mode === "wrong-request" ? crypto.randomUUID() : fixture.requestId, status: mode === "wrong-state" ? "SENT" : "DRAFT", version: 1 };
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic draft validation" } } } : { json: { data: mode === "unconfirmed" ? {} : { quote } } }));
      await button.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic draft validation" : "Could not confirm the draft");
      await expect(button).toBeEnabled(); await expect(form.locator("input[name=productCostBdt]")).toHaveValue("1000"); await page.unroute(pattern);
    }
    expect(await form.locator("input").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await form.scrollIntoViewIfNeeded(); await info.attach(`draft-form-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    let commits = 0; let quoteId = "";
    await page.route(pattern, async route => { commits++; const response = await route.fetch(); expect(response.status()).toBe(201); const data = (await response.json()).data.quote; quoteId = data.id; expect(data.status).toBe("DRAFT"); expect(Number(data.totalBdt)).toBe(1350); expect(data.expiresAt).toBe("2061-01-01T01:00:00.000Z"); await route.abort("failed"); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(form.getByRole("alert")).toContainText("Could not confirm the draft"); expect(commits).toBe(1); await page.unroute(pattern);
    await button.click(); await expect(form.getByRole("alert")).toContainText("Refresh the queue before submitting again");
    await form.getByRole("button", { name: "Refresh queue", exact: true }).click();
    await expect(card.getByText("Draft v1 awaiting Admin review", { exact: true })).toBeVisible(); await expect(card.locator("form")).toHaveCount(0);
    expect((await context.request.patch(`/api/v1/admin/sourcing-quotes/${quoteId}/review`, { headers: { Origin: baseURL! }, data: { action: "APPROVE", note: "Must not self-publish this draft." } })).status()).toBe(403);
    const customerPage = await customer.request.get("/buy-ship"); expect(customerPage.status()).toBe(200); expect(await customerPage.text()).not.toContain(privateNote);
    expect((await customer.request.post(`/api/v1/sourcing-agent/requests/${fixture.requestId}/quote`, { headers: { Origin: baseURL! }, data: {} })).status()).toBe(403);
    await card.scrollIntoViewIfNeeded(); await info.attach(`draft-handoff-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
  } finally { expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200); await context.close(); await customer.close(); }
});
