import { createHmac } from "node:crypto";
import { test, expect } from "./fixtures";

function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("support calendar settings recovery and responsive workflow", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_CALENDAR_ADMINS, "Requires dedicated isolated Admin fixtures.");
  test.setTimeout(120_000);
  const admin = (JSON.parse(process.env.E2E_CALENDAR_ADMINS!) as Record<string, { email: string; agentId: string }>)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, timezoneId: "Australia/Sydney", storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    expect((await context.request.get("/api/v1/admin/support-policy")).status()).toBe(403);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/support/settings");
    const policy = page.locator(".support-policy-form").filter({ visible: true });
    const holiday = page.locator(".support-holiday-form").filter({ visible: true });
    const shift = page.locator(".support-shift-form").filter({ visible: true });
    await expect(policy.getByRole("button")).toBeEnabled();
    await expect(page.getByRole("complementary", { name: "Calendar setup steps" }).filter({ visible: true })).toContainText("Set up in this order");
    await expect(shift).toContainText("Australia/Sydney");
    const calendar = await context.request.get("/api/v1/admin/support-policy"); expect(calendar.status()).toBe(200);
    if (!(await calendar.json()).data.shifts.length) await expect(page.getByText("No upcoming shifts.", { exact: false }).filter({ visible: true })).toBeVisible();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/admin/support/settings");
      for (const form of await fallback.locator(".support-admin-settings form").filter({ visible: true }).all()) {
        await expect(form).toHaveAttribute("method", "post");
        for (const control of await form.locator("input,select,button").all()) await expect(control).toBeDisabled();
      }
    } finally { await noScript.close(); }
    await holiday.getByLabel("Date", { exact: true }).fill(info.project.name === "mobile" ? "2060-06-02" : "2060-06-01");
    const holidayName = `Synthetic calendar ${info.project.name}`;
    await holiday.getByLabel("Name", { exact: true }).fill(holidayName);
    await shift.getByRole("combobox", { name: "Agent", exact: true }).selectOption(admin.agentId);
    await shift.getByLabel("Starts", { exact: true }).fill("2060-06-01T09:00");
    await shift.getByLabel("Ends", { exact: true }).fill("2060-06-01T08:00");
    await shift.getByRole("button").click(); await expect(shift.getByRole("alert")).toContainText("end time after");
    await shift.getByLabel("Ends", { exact: true }).fill("2060-06-01T17:00");
    for (const [form, pattern] of [[policy, "**/api/v1/admin/support-policy"], [holiday, "**/api/v1/admin/support-holidays"], [shift, "**/api/v1/admin/support-shifts"]] as const) {
      for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
        await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic calendar validation" } } } : { json: { data: {} } }));
        await form.getByRole("button").click();
        await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic calendar validation" : "Could not confirm the change");
        await expect(form.getByRole("button")).toBeEnabled();
        await page.unroute(pattern);
      }
      expect(await form.locator("input,select").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await form.getByRole("button").evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await expect(holiday.getByLabel("Name", { exact: true })).toHaveValue(holidayName);
    let requests = 0;
    await page.route("**/api/v1/admin/support-policy", async route => { requests++; await route.fulfill({ status: 409, json: { error: { message: "The support policy changed after the page loaded. Refresh before saving." } } }); });
    await policy.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(policy.getByRole("alert")).toContainText("changed after the page loaded"); expect(requests).toBe(1);
    await page.unroute("**/api/v1/admin/support-policy");
    // Real API writes in the disposable schema; the other recovery requests above are mocked.
    await policy.getByRole("button").click(); await expect(policy.getByRole("status")).toContainText("Operating policy saved");
    await holiday.getByRole("button").click(); await expect(holiday.getByRole("status")).toHaveText("Closed date added.");
    const row = page.locator(".support-schedule-list > div").filter({ hasText: holidayName, visible: true });
    await expect(row).toBeVisible();
    const remove = row.getByRole("button", { name: "Remove", exact: true });
    page.on("dialog", dialog => dialog.accept());
    await page.route("**/api/v1/admin/support-holidays/*", route => route.abort("failed"));
    await remove.click(); await expect(row.getByRole("alert")).toContainText("Could not confirm"); await expect(remove).toBeEnabled();
    await page.unroute("**/api/v1/admin/support-holidays/*");
    await remove.click(); await expect(row).toHaveCount(0);
    await shift.getByRole("button").click(); await expect(shift.getByRole("status")).toHaveText("Shift scheduled.");
    const scheduled = page.locator(".support-schedule-list > div").filter({ hasText: `Synthetic workforce target ${info.project.name}`, visible: true });
    await expect(scheduled).toContainText("SCHEDULED");
    await scheduled.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(scheduled).toContainText("CANCELLED");
    expect((await context.request.put("/api/v1/admin/support-policy", { headers: { Origin: "https://untrusted.example.test" }, data: {} })).status()).toBe(403);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await info.attach(`calendar-rota-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.evaluate(() => {
      document.querySelector(".admin-workspace-main")?.scrollTo({ top: 0, behavior: "instant" });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await info.attach(`calendar-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close();
  }
});
