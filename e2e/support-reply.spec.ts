import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });
test("support reply recovery and private staff note", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated synthetic support accounts.");
  test.setTimeout(90_000);
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const customer = await browser.newContext({ baseURL, viewport, storageState: "e2e/.auth/customer.json" });
  const staff = await browser.newContext({ baseURL, viewport, storageState: "e2e/.auth/support.json" });
  try {
    const opened = await customer.request.post("/api/v1/tickets", { headers: { Origin: baseURL!, "Idempotency-Key": `support-reply-${info.project.name}-${Date.now()}` }, data: { category: "GENERAL", subject: `Synthetic support reply ${info.project.name}`, body: "Synthetic support conversation for recovery verification.", attachmentReferences: [] } });
    expect(opened.status()).toBe(201);
    const ticket = (await opened.json()).data.ticket;
    for (const [context, internal] of [[customer, false], [staff, true]] as const) {
      const page = await context.newPage();
      await page.route("**/api/v1/advertisements?**", route => route.fulfill({ json: { data: { advertisements: [] } } }));
      const path = internal ? `/support/tickets/${ticket.reference}` : `/support/${ticket.id}`;
      await page.goto(path);
      const form = page.locator(".ticket-message-form");
      const input = form.locator("textarea");
      const button = form.getByRole("button", { name: "Send message", exact: true });
      await expect(button).toBeEnabled();
      const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
      try {
        const fallback = await noScript.newPage(); await fallback.goto(path);
        await expect(fallback.locator(".ticket-message-form")).toHaveAttribute("method", "post");
        for (const control of await fallback.locator(".ticket-message-form textarea,.ticket-message-form input,.ticket-message-form button").all()) await expect(control).toBeDisabled();
      } finally { await noScript.close(); }
      const body = internal ? "Synthetic private staff note must stay hidden from the customer." : "Synthetic customer reply for uncertain-response retry.";
      await input.fill(body);
      if (internal) await form.getByRole("checkbox").check();
      const pattern = `**/api/v1/tickets/${ticket.id}/messages`;
      const keys: string[] = [];
      for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
        await page.route(pattern, route => {
          keys.push(route.request().headers()["idempotency-key"]);
          return mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: { message: {} } } });
        });
        await button.click();
        await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm this message");
        await expect(button).toBeEnabled(); await expect(input).toHaveValue(body);
        if (internal) await expect(form.getByRole("checkbox")).toBeChecked();
        await page.unroute(pattern);
      }
      let commits = 0;
      await page.route(pattern, async route => {
        commits++; keys.push(route.request().headers()["idempotency-key"]);
        const saved = await route.fetch(); expect(saved.status()).toBe(201);
        await route.abort("failed");
      });
      await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
      await expect(form.getByRole("alert")).toContainText("Could not confirm this message");
      expect(commits).toBe(1); expect(new Set(keys).size).toBe(1);
      await page.unroute(pattern);
      await page.route(pattern, async route => { expect(route.request().headers()["idempotency-key"]).toBe(keys[0]); await route.continue(); });
      await button.click();
      await expect(form.getByRole("status")).toHaveText("Message saved.");
      await expect(input).toHaveValue("");
      if (internal) await expect(form.getByRole("checkbox")).not.toBeChecked();
      await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
      await info.attach(`support-reply-${internal ? "staff" : "customer"}-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    const customerDetail = (await (await customer.request.get(`/api/v1/tickets/${ticket.id}`)).json()).data.ticket;
    expect(customerDetail.messages).toHaveLength(2);
    expect(JSON.stringify(customerDetail)).not.toContain("Synthetic private staff note");
    const staffDetail = (await (await staff.request.get(`/api/v1/tickets/${ticket.id}`)).json()).data.ticket;
    expect(staffDetail.messages).toHaveLength(3);
    expect(staffDetail.messages.filter((message: { internalNote: boolean }) => message.internalNote)).toHaveLength(1);
    expect(staffDetail.events).toHaveLength(2);
  } finally { await customer.close(); await staff.close(); }
});
