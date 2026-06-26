import { expect, test } from "@playwright/test";

test("opens the requestor list as the first screen", async ({ page }) => {
  await page.goto("/list");
  await expect(page.getByRole("heading", { name: "What should go on the next list?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).last()).toContainText("Shop");
});
