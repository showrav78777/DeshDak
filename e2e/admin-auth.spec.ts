import { test, expect } from "./fixtures";

// Synthetic credentials and mocked login responses only. Real MFA authorization
// remains covered by employee.spec.ts and the isolated MFA API regression.
test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("Admin sign-in safely recovers and waits for JavaScript", async ({ browser, baseURL }, info) => {
  test.setTimeout(60_000);
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/admin/login");
      const form = fallback.locator("form"); await expect(form).toHaveAttribute("method", "post");
      for (const control of await form.locator("input[name=email],input[name=password],button[type=submit]").all()) await expect(control).toBeDisabled();
      await expect(form).toContainText("No credentials have been submitted");
    } finally { await noScript.close(); }
    const page = await context.newPage(); await page.goto("/admin/login");
    const form = page.locator("form"); const email = form.getByLabel("Email", { exact: true }); const password = form.getByLabel("Password", { exact: true });
    const button = form.getByRole("button", { name: "Continue", exact: true });
    await expect(button).toBeEnabled(); await email.fill("synthetic-admin@example.test"); await password.fill("SyntheticNotAnAccountPassword!");
    const pattern = "**/api/v1/auth/login";
    for (const mode of ["abort", "json", "unconfirmed", "wrong-role", "rejected"]) {
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 401, json: { error: { message: "Synthetic login rejection" } } } : { json: { data: mode === "wrong-role" ? { user: { roles: ["customer_personal"] }, session: { id: crypto.randomUUID() }, nextAction: "SIGNED_IN" } : {} } }));
      await button.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic login rejection" : "Could not confirm sign-in");
      await expect(button).toBeEnabled(); await expect(email).toHaveValue("synthetic-admin@example.test"); await expect(password).toHaveValue("SyntheticNotAnAccountPassword!");
      await expect(page).toHaveURL(/\/admin\/login$/); await page.unroute(pattern);
    }
    let requests = 0;
    await page.route(pattern, async route => { requests++; expect(route.request().method()).toBe("POST"); expect(route.request().postDataJSON().portal).toBe("admin"); await route.fulfill({ json: { data: { user: { roles: ["admin"] }, session: { id: crypto.randomUUID() }, nextAction: "MFA_ENROLLMENT" } } }); });
    // Next client navigation may request this path with an RSC query string.
    // Keep the synthetic handoff isolated from the real cookie-protected page.
    await page.route(url => url.pathname === "/security/mfa", route => route.fulfill({ contentType: "text/html", body: "<h1>Synthetic MFA handoff only</h1>" }));
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(page).toHaveURL(/\/security\/mfa$/);
    await expect(page.getByRole("heading", { name: "Synthetic MFA handoff only", exact: true })).toBeVisible(); expect(requests).toBe(1);
  } finally { await context.close(); }
});
