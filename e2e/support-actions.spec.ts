import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });
test("support staff action recovery and stale-save protection", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires disposable support fixtures.");
  test.setTimeout(90_000);
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
  const staff = await browser.newContext({ baseURL, viewport, storageState: "e2e/.auth/support.json" });
  try {
    const opened = await customer.request.post("/api/v1/tickets", { headers: { Origin: baseURL!, "Idempotency-Key": `staff-action-${info.project.name}-${Date.now()}` }, data: { category: "GENERAL", subject: `Synthetic support actions ${info.project.name}`, body: "Synthetic support lifecycle verification request.", attachmentReferences: [] } });
    expect(opened.status()).toBe(201);
    const ticket = (await opened.json()).data.ticket;
    const path = `/support/tickets/${ticket.reference}`;
    const page = await staff.newPage(); await page.goto(path);
    const controls = page.locator(".ticket-action-controls");
    const form = controls.locator("form");
    const note = form.getByLabel("Operational note");
    const confirm = form.getByRole("button", { name: "Confirm update", exact: true });
    await expect(controls.getByRole("button", { name: "Resolve", exact: true })).toBeEnabled();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await staff.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto(path);
      for (const control of await fallback.locator(".ticket-action-controls button,.ticket-action-controls select").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    await controls.getByRole("button", { name: "Resolve", exact: true }).click();
    await note.fill("Canceled synthetic action must not change state.");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await (await staff.request.get(`/api/v1/tickets/${ticket.id}`)).json()).data.ticket.version).toBe(1);
    await controls.getByRole("button", { name: "Resolve", exact: true }).click();
    await note.fill("Synthetic confirmed resolution reason.");
    await expect(controls.getByRole("button", { name: "Escalate", exact: true })).toBeDisabled();
    const pattern = `**/api/v1/support/tickets/${ticket.id}/actions`;
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: { ticket: {} } } }));
      await confirm.click();
      await expect(controls.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm this update");
      await expect(confirm).toBeEnabled(); await expect(note).toHaveValue("Synthetic confirmed resolution reason.");
      await page.unroute(pattern);
    }
    await expect(form).toHaveAttribute("method", "post");
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await info.attach(`action-confirm-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    let commits = 0;
    await page.route(pattern, async route => { commits++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(controls.getByRole("alert")).toContainText("Could not confirm this update"); expect(commits).toBe(1);
    await page.unroute(pattern); await confirm.click();
    await expect(controls.getByRole("alert")).toContainText("changed after the page loaded");
    await expect(note).toHaveValue("Synthetic confirmed resolution reason.");
    await page.reload();
    await expect(controls.getByRole("button", { name: "Reopen", exact: true })).toBeEnabled();
    async function action(label: string, reason: string) {
      await controls.getByRole("button", { name: label, exact: true }).click(); await note.fill(reason); await confirm.click();
      await expect(controls.getByRole("status")).toHaveText("Ticket update saved."); await expect(form).toHaveCount(0);
    }
    await action("Reopen", "Synthetic clarification requires reopening.");
    await expect(controls.getByLabel("Priority")).toBeEnabled();
    await controls.getByLabel("Priority").selectOption("HIGH");
    await expect(controls).toContainText("New priority: HIGH");
    await note.fill("Synthetic high priority for review."); await confirm.click();
    await expect(controls.getByLabel("Priority")).toHaveValue("HIGH");
    await action("Escalate", "Synthetic escalation for support leadership.");
    await expect(controls.getByLabel("Priority")).toHaveValue("URGENT");
    await expect(controls.getByRole("button", { name: "Escalate", exact: true })).toBeDisabled();
    await action("Wait for customer", "Synthetic clarification requested from customer.");
    await action("Resolve", "Synthetic final resolution completed.");
    await expect(controls.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
    await action("Close", "Synthetic case closed after resolution.");
    const saved = (await (await staff.request.get(`/api/v1/tickets/${ticket.id}`)).json()).data.ticket;
    expect(saved.status).toBe("CLOSED"); expect(saved.priority).toBe("URGENT"); expect(saved.version).toBe(8); expect(saved.events).toHaveLength(8);
  } finally { await customer.close(); await staff.close(); }
});
