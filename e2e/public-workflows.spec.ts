import { test, expect } from "./fixtures";

test.describe("recovery without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const path of ["/forgot-password", "/reset-password", "/verify-email"]) test(`${path} cannot submit sensitive fields through native GET`, async ({ page }) => {
    await page.goto(path);
    const forms = page.locator("form.seller-login-card");
    expect(await forms.count()).toBeGreaterThan(0);
    for (const form of await forms.all()) {
      await expect(form).toHaveAttribute("method", "post");
      await expect(form.getByRole("button", { name: /./ })).toBeDisabled();
    }
    await fits(page);
    if (path === "/forgot-password") await test.info().attach("Recovery initial layout", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});

async function fits(page: import("@playwright/test").Page) {
  await expect(async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }).toPass({ timeout: 10_000 });
}

for (const entry of [
  { path: "/forgot-password", endpoint: "/api/v1/auth/password-reset/request", button: "Email secure reset link" },
  { path: "/verify-email", endpoint: "/api/v1/auth/email-verification/request", button: "Email new verification link" },
]) test(`${entry.path} recovers from network failure and confirms a generic request`, async ({ page }) => {
  await page.goto(entry.path);
  const submit = page.getByRole("button", { name: entry.button, exact: true });
  await page.getByLabel("Email", { exact: true }).fill("synthetic-recovery@example.test");
  await page.route(`**${entry.endpoint}`, route => route.abort("failed"));
  await submit.click();
  await expect(page.locator("form.seller-login-card").getByRole("alert")).toContainText("could not be confirmed");
  await expect(submit).toBeEnabled();
  await page.unroute(`**${entry.endpoint}`);
  // Presentation recovery only: no real email or account lookup is performed.
  await page.route(`**${entry.endpoint}`, route => route.fulfill({ json: { data: { message: "If an eligible account exists, a secure link will be sent." } } }));
  await submit.click();
  await expect(page.getByRole("status")).toContainText("If an eligible account exists");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(submit).toBeEnabled();
  await fits(page);
});

test("reset-password rejects a missing token without a network mutation", async ({ page }) => {
  let mutations = 0;
  await page.route("**/api/v1/auth/password-reset/confirm", async route => { mutations++; await route.abort(); });
  await page.goto("/reset-password");
  await page.getByLabel("New password", { exact: true }).fill("Synthetic-password-123!");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic-password-123!");
  await page.getByRole("button", { name: "Reset password and sign out sessions" }).click();
  await expect(page.locator("form.seller-login-card").getByRole("alert")).toContainText("missing or invalid");
  expect(mutations).toBe(0);
  await fits(page);
});

test("verify-email rejects a missing token without a network mutation", async ({ page }) => {
  let mutations = 0;
  await page.route("**/api/v1/auth/email-verification/confirm", async route => { mutations++; await route.abort(); });
  await page.goto("/verify-email");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator("form.seller-login-card").getByRole("alert")).toContainText("missing or invalid");
  expect(mutations).toBe(0);
  await fits(page);
});

test("Help search handles empty results and preserves language", async ({ page }) => {
  await page.goto("/help?lang=bn");
  await page.getByLabel("Search Help Centre", { exact: true }).fill("no-such-synthetic-help-article-88291");
  await page.locator(".help-search").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No published guidance matched." })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("lang")).toBe("bn");
  await expect(page.getByRole("link", { name: "Sign in for support", exact: true })).toHaveAttribute("href", "/login?next=/support");
  await fits(page);
});

test("Store search exposes a useful empty state", async ({ page }) => {
  await page.goto("/stores");
  await page.getByLabel("Search stores", { exact: true }).fill("no-such-synthetic-store-88291");
  await page.locator(".stores-hero form").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No public stores found", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("no-such-synthetic-store-88291");
  await fits(page);
});

test("Trust Centre protection navigation reaches its section", async ({ page }) => {
  await page.goto("/trust");
  await page.getByRole("link", { name: "Understand protection", exact: true }).click();
  await expect(page).toHaveURL(/\/trust#protection-boundaries$/);
  await expect(page.locator("#protection-boundaries")).toBeInViewport();
  await fits(page);
});
