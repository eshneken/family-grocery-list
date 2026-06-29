import { expect, test } from "@playwright/test";
import { resetE2EDatabase } from "./helpers/db";

test.beforeEach(async ({ context }) => {
  await resetE2EDatabase();
  await context.addCookies([
    {
      name: "mock_current_user",
      value: "gina@example.com",
      domain: "127.0.0.1",
      path: "/"
    }
  ]);
});

test("opens the requestor list as the first screen", async ({ page }) => {
  await page.goto("/list");
  await expect(page.getByRole("heading", { name: "What should go on the next list?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shop" }).first()).toBeVisible();
});

test("mock user switch lands on the list page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Household access and stores" })).toBeVisible();

  await page.getByLabel("Current user").selectOption("ayelet@example.com");

  await expect(page).toHaveURL(/\/list$/);
  await expect(page.getByLabel("Current user")).toHaveValue("ayelet@example.com");
  await expect(page.getByRole("heading", { name: "What should go on the next list?" })).toBeVisible();
});

test("an unknown mock cookie cannot select or create an arbitrary user", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "mock_current_user",
      value: "attacker@example.com",
      domain: "127.0.0.1",
      path: "/"
    }
  ]);

  await page.goto("/list");
  await expect(page.getByLabel("Current user")).toHaveValue("gina@example.com");
});

test("requestor adds an item and updates its category and recurring flag", async ({ page }) => {
  await page.goto("/list");

  await page.getByLabel("Item").fill("cherry tomatoes");
  await page.getByRole("button", { name: "Add item" }).click();

  const row = page.locator("article").filter({ hasText: "cherry tomatoes" });
  await expect(row).toContainText("Produce");
  await row.getByLabel(/Move cherry tomatoes to category/).selectOption("Produce");
  await row.getByLabel("Recurring").check();
  await row.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");

  await expect(row.getByLabel("Recurring")).toBeChecked();
});

test("shopper starts a store run, purchases an item, and sees history", async ({ page }) => {
  await page.goto("/list");
  await page.getByLabel("Item").fill("bananas");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator("article").filter({ hasText: "bananas" })).toBeVisible();

  await page.goto("/shop");
  await page.getByLabel("Giant").check();
  await page.getByRole("button", { name: "Start shopping" }).click();

  const row = page.locator("article").filter({ hasText: "bananas" });
  await expect(row).toBeVisible();
  await row.getByLabel("Mark bananas purchased").click();
  await expect(row).toContainText("Purchased");

  await page.getByRole("button", { name: "Complete shopping run" }).click();
  await expect(page.getByRole("heading", { name: "Start a shopping run" })).toBeVisible();
  await page.goto("/history");
  const trip = page.locator("details").filter({ hasText: "Giant" });
  await expect(trip).toBeVisible();
  await trip.locator("summary").click();
  await expect(page.locator("article").filter({ hasText: "bananas" })).toContainText("Purchased");
});
