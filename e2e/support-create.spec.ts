import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });
test("support creation recovery and lost-response retry", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires disposable customer fixtures.");
  test.setTimeout(90_000);
  const mobile = info.project.name === "mobile";
  const viewport = mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: "e2e/.auth/customer.json" });
  try {
    const page = await context.newPage();
    await page.route("**/api/v1/advertisements?**", route => route.fulfill({ json: { data: { advertisements: [] } } }));
    await page.goto("/support");
    const form = page.locator(".support-create-form");
    const button = form.getByRole("button", { name: "Open support request", exact: true });
    await expect(button).toBeEnabled();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: "e2e/.auth/customer.json" });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/support");
      const disabledForm = fallback.locator(".support-create-form");
      await expect(disabledForm).toHaveAttribute("method", "post");
      for (const control of await disabledForm.locator("input,select,textarea,button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    const subject = `Synthetic support recovery ${mobile ? "mobile" : "desktop"}`;
    const message = "Synthetic request to verify safe uncertain-submission recovery.";
    await form.getByLabel("Subject", { exact: true }).fill(subject);
    await form.getByLabel("Tell us what happened").fill(message);
    const keys: string[] = [];
    for (const mode of ["abort", "json", "unconfirmed", "unsafe", "rejected"]) {
      await page.route("**/api/v1/tickets", route => {
        keys.push(route.request().headers()["idempotency-key"]);
        return mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: { ticket: mode === "unsafe" ? { id: "../../admin" } : {} } } });
      });
      await button.click();
      await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm submission");
      await expect(button).toBeEnabled();
      await expect(form.getByLabel("Subject", { exact: true })).toHaveValue(subject);
      await expect(form.getByLabel("Tell us what happened")).toHaveValue(message);
      await expect(page).toHaveURL(/\/support$/);
      await page.unroute("**/api/v1/tickets");
    }
    expect(new Set(keys).size).toBe(1);
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await info.attach(`support-create-form-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await form.getByLabel("Subject", { exact: true }).fill(`${subject} changed`);
    let committedId = "";
    let calls = 0;
    await page.route("**/api/v1/tickets", async route => {
      calls++; keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committedId = (await response.json()).data.ticket.id;
      await route.abort("failed"); // Real commit, deliberately lost client response.
    });
    await form.evaluate(element => {
      (element as HTMLFormElement).requestSubmit();
      (element as HTMLFormElement).requestSubmit();
    });
    await expect(form.getByRole("alert")).toContainText("Could not confirm submission");
    expect(calls).toBe(1);
    expect(keys.at(-1)).not.toBe(keys[0]);
    await page.unroute("**/api/v1/tickets");
    await page.route("**/api/v1/tickets", async route => {
      expect(route.request().headers()["idempotency-key"]).toBe(keys.at(-1));
      await route.continue();
    });
    await button.click();
    await expect(page).toHaveURL(`${baseURL}/support/${committedId}`);
    const all = (await (await context.request.get("/api/v1/tickets")).json()).data.tickets as { id: string; subject: string }[];
    expect(all.filter(ticket => ticket.subject === `${subject} changed`)).toHaveLength(1);
    const detail = (await (await context.request.get(`/api/v1/tickets/${committedId}`)).json()).data.ticket;
    expect(detail.messages).toHaveLength(1); expect(detail.events).toHaveLength(1);
    expect(detail.messages[0].body).toBe(message);
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await info.attach(`support-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally { await context.close(); }
});
