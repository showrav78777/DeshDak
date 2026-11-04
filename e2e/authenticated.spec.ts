import { test, expect } from "./fixtures";

test("saved customer session opens profile without signing in again", async ({ page }) => {
  test.skip(!process.env.E2E_CUSTOMER_EMAIL, "Dedicated customer credentials not supplied.");
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/profile(?:\?|$)/);
  await expect(page.getByRole("main")).toBeVisible();
});
