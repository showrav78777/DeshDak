import { createHmac } from "node:crypto";
import { test, expect } from "./fixtures";

function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("sourcing staff control recovery", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SOURCING_STAFF_ADMINS, "Requires isolated Admin fixtures.");
  const admin = JSON.parse(process.env.E2E_SOURCING_STAFF_ADMINS!)[info.project.name];
  const context = await browser.newContext({ baseURL, viewport: info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/sourcing");
    const form = page.locator(".sourcing-staff-form").filter({ visible: true }); const email = form.getByRole("textbox");
    await email.fill("synthetic-agent@example.test");
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route("**/api/v1/admin/sourcing-staff", async route => {
        if (mode === "abort") await route.abort();
        else if (mode === "json") await route.fulfill({ status: 200, body: "not json" });
        else await route.fulfill({ status: mode === "rejected" ? 422 : 200, json: mode === "rejected" ? { error: { message: "Synthetic grant validation" } } : { data: {} } });
      });
      await form.getByRole("button", { name: "Grant Sourcing Agent role", exact: true }).click();
      await expect(form.getByRole("alert")).toBeVisible(); await expect(email).toHaveValue("synthetic-agent@example.test");
      await expect(form.getByRole("button", { name: "Grant Sourcing Agent role", exact: true })).toBeEnabled();
      await page.unroute("**/api/v1/admin/sourcing-staff");
    }
    let grants = 0;
    await page.route("**/api/v1/admin/sourcing-staff", async route => { grants++; await new Promise(r => setTimeout(r, 100)); await route.fulfill({ status: 201, json: { data: { staff: { id: "synthetic", email: "synthetic-agent@example.test" } } } }); });
    await form.evaluate((element: HTMLFormElement) => { element.requestSubmit(); element.requestSubmit(); });
    await expect(form.getByRole("status")).toContainText("Sourcing access granted"); expect(grants).toBe(1); await expect(email).toHaveValue("");
    const removal = page.locator(".sourcing-staff-revoke").filter({ visible: true }).first();
    await expect(removal).toBeVisible(); page.on("dialog", dialog => dialog.accept());
    await page.route("**/api/v1/admin/sourcing-staff/*", route => route.abort());
    await removal.getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(removal.getByRole("alert")).toContainText("Could not confirm removal");
    await expect(removal.getByRole("button", { name: "Remove access", exact: true })).toBeEnabled();
    await page.unroute("**/api/v1/admin/sourcing-staff/*");
    await page.route("**/api/v1/admin/sourcing-staff/*", route => route.fulfill({ json: { data: { staff: { email: "synthetic@example.test" }, revokedSessions: 2 } } }));
    await removal.getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(removal.getByRole("status")).toContainText("sessions revoked");
    await expect(removal.getByRole("button", { name: "Access removed" })).toBeDisabled();
    expect(await email.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await form.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
    expect(await removal.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
    await info.attach(`sourcing-staff-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close();
  }
});
