import { test, expect } from "./fixtures";

test("mocked image-search network failure releases upload control", async ({ page }) => {
  await page.route("**/api/v1/search/image", (route) => route.abort("failed"));
  await page.goto("/products");
  await page.getByLabel("Choose a product image to search", { exact: true }).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("synthetic browser-only fixture") });
  await expect(page.getByText("Image search could not reach the server. Check your connection and try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search using a product image", exact: true })).toBeEnabled();
});
