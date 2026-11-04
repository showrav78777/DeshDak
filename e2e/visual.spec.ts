import { test, expect } from "./fixtures";

test("@visual sign-in layout matches reviewed baseline", async ({ page }) => {
  test.skip(process.env.E2E_VISUAL !== "1", "Enable only in the pinned baseline environment.");
  await page.goto("/login");
  await expect(page.locator(".seller-login-shell")).toHaveScreenshot("customer-login.png", { stylePath: "e2e/visual.css" });
});
