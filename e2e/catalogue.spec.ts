import { test, expect } from "./fixtures";

test("public catalogue exposes search and preserves filters while sorting", async ({ catalogue, page }) => {
  await catalogue.open("?priceBand=1000-2499");
  await expect(page.getByRole("button", { name: "Search products", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search using a product image", exact: true })).toBeVisible();
  await catalogue.sort("price_asc");
  expect(new URL(page.url()).searchParams.get("priceBand")).toBe("1000-2499");
  await catalogue.assertFitsScreen();
});

test("mobile filters toggle; desktop sidebar remains visible", async ({ catalogue, page, isMobile }) => {
  await catalogue.open();
  const filters = page.getByRole("complementary", { name: "Product filters", exact: true });
  if (isMobile) {
    await expect(filters).toBeHidden();
    await page.getByRole("button", { name: "Show filters", exact: false }).click();
    await expect(filters).toBeVisible();
    await page.getByRole("button", { name: "Hide filters", exact: false }).click();
    await expect(filters).toBeHidden();
  } else await expect(filters).toBeVisible();
});

for (const path of ["/login", "/register"]) test(`${path} fits a small phone`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(path);
  await expect(page.getByRole("main").getByRole("link", { name: "DeshDak", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
