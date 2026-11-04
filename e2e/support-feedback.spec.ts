import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });
test("support feedback recovery and immutable retry", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated synthetic accounts.");
  test.setTimeout(90_000);
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: "e2e/.auth/customer.json" });
  const staff = await browser.newContext({ baseURL, storageState: "e2e/.auth/support.json" });
  try {
    const created = await context.request.post("/api/v1/tickets", { headers: { Origin: baseURL!, "Idempotency-Key": `feedback-${info.project.name}-${Date.now()}` }, data: { category: "GENERAL", subject: `Synthetic support feedback ${info.project.name}`, body: "Synthetic support feedback verification conversation.", attachmentReferences: [] } });
    expect(created.status()).toBe(201);
    const ticket = (await created.json()).data.ticket;
    expect((await staff.request.patch(`/api/v1/support/tickets/${ticket.id}/actions`, { headers: { Origin: baseURL! }, data: { action: "RESOLVE", version: 1, note: "Synthetic resolution for feedback verification." } })).status()).toBe(200);
    const page = await context.newPage();
    await page.route("**/api/v1/advertisements?**", route => route.fulfill({ json: { data: { advertisements: [] } } }));
    await page.goto(`/support/${ticket.id}`);
    const form = page.locator(".support-satisfaction-form");
    const button = form.getByRole("button", { name: "Submit feedback", exact: true });
    await expect(button).toBeEnabled();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto(`/support/${ticket.id}`);
      await expect(fallback.locator(".support-satisfaction-form")).toHaveAttribute("method", "post");
      for (const control of await fallback.locator(".support-satisfaction-form input,.support-satisfaction-form textarea,.support-satisfaction-form button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    await form.getByRole("radio", { name: "2", exact: true }).check();
    await form.getByRole("radio", { name: "No", exact: true }).check();
    expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
    const input = form.locator("textarea");
    const comment = "Synthetic unresolved issue requiring private support follow-up.";
    await input.fill(comment);
    const pattern = `**/api/v1/tickets/${ticket.id}/satisfaction`;
    const keys: string[] = [];
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(pattern, route => {
        keys.push(route.request().headers()["idempotency-key"]);
        return mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: { rating: {} } } });
      });
      await button.click();
      await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm your feedback");
      await expect(button).toBeEnabled(); await expect(input).toHaveValue(comment);
      await expect(form.getByRole("radio", { name: "2", exact: true })).toBeChecked();
      await expect(form.getByRole("radio", { name: "No", exact: true })).toBeChecked();
      await page.unroute(pattern);
    }
    expect(new Set(keys).size).toBe(1);
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await info.attach(`feedback-form-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await input.fill(`${comment} Changed.`);
    let commits = 0;
    let finishCommit!: () => void; let failCommit!: (error: unknown) => void;
    const commitFinished = new Promise<void>((resolve, reject) => { finishCommit = resolve; failCommit = reject; });
    await page.route(pattern, async route => {
      try {
        commits++; keys.push(route.request().headers()["idempotency-key"]);
        expect((await route.fetch()).status()).toBe(201); await route.abort("failed"); finishCommit();
      } catch (error) { failCommit(error); }
    });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await Promise.all([commitFinished, expect(form.getByRole("alert")).toContainText("Could not confirm your feedback")]);
    expect(commits).toBe(1); expect(keys.at(-1)).not.toBe(keys[0]);
    await page.unroute(pattern);
    await page.route(pattern, async route => { expect(route.request().headers()["idempotency-key"]).toBe(keys.at(-1)); await route.continue(); });
    await button.click();
    await expect(page.locator(".support-satisfaction-summary")).toContainText("2/5 stars");
    await expect(page.locator(".support-satisfaction-summary")).toContainText("Further attention requested");
    await expect(form).toHaveCount(0);
    const saved = (await (await context.request.get(`/api/v1/tickets/${ticket.id}`)).json()).data.ticket.satisfactionRating;
    expect(saved.score).toBe(2); expect(saved.issueResolved).toBe(false); expect(saved.comment).toBe(`${comment} Changed.`);
    expect((await context.request.post(`/api/v1/tickets/${ticket.id}/satisfaction`, { headers: { Origin: baseURL!, "Idempotency-Key": `feedback-change-${info.project.name}-${Date.now()}` }, data: { score: 5, issueResolved: true, comment: "Changed feedback must not overwrite evidence." } })).status()).toBe(409);
    await page.reload(); await expect(page.locator(".support-satisfaction-summary")).toContainText("2/5 stars");
  } finally { await context.close(); await staff.close(); }
});
