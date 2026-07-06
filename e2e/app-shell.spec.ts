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
  await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
  await expect(page.getByText("Last store visit")).toBeVisible();
  await expect(page.getByText("No completed store visits yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Shop" }).first()).toBeVisible();
});

test("mock user switch lands on the list page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();

  await page.getByLabel("Current user").selectOption("ayelet@example.com");

  await expect(page).toHaveURL(/\/list$/);
  await expect(page.getByLabel("Current user")).toHaveValue("ayelet@example.com");
  await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
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

test("requestor edits an item in the compact editor dialog", async ({ page }) => {
  await page.goto("/list");

  await page.getByLabel("Item").fill("cherry tomatos");
  await page.getByRole("button", { name: "Add item" }).click();

  const row = page.locator("article").filter({ hasText: "cherry tomatos" });
  await expect(row).toContainText("Produce");
  await row.getByLabel("Edit cherry tomatos").click();
  const dialog = page.getByRole("dialog", { name: "Edit request" });
  await dialog.getByLabel("Item name").fill("Cherry tomatoes");
  await dialog.getByLabel("Category").selectOption("Produce");
  await dialog.getByLabel("Store").selectOption({ label: "Whole Foods" });
  await dialog.getByLabel("Recurring item").check();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  const updatedRow = page.locator("article").filter({ hasText: "Cherry tomatoes" });
  await expect(updatedRow).toContainText("Whole Foods");
  await expect(updatedRow.locator(".recurring-indicator")).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("the current List tab refreshes changes made by another household member", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await expect(page.getByText("rice cakes", { exact: true })).toHaveCount(0);

  const otherContext = await browser.newContext();
  await otherContext.addCookies([
    { name: "mock_current_user", value: "ed@example.com", domain: "127.0.0.1", path: "/" }
  ]);
  const otherPage = await otherContext.newPage();
  await otherPage.goto("/list");
  await otherPage.getByLabel("Item").fill("rice cakes");
  await otherPage.getByRole("button", { name: "Add item" }).click();
  await expect(otherPage.getByText("rice cakes", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "List" }).click();
  await expect(page.getByText("rice cakes", { exact: true })).toBeVisible();
  await otherContext.close();
});

test("iPhone list rows remain compact and install metadata is present", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await page.getByLabel("Item").fill("extra long item name that should not force a third line in a grocery request row");
  await page.getByRole("button", { name: "Add item" }).click();

  const row = page.locator("article").filter({ hasText: "extra long item name" });
  const rowBox = await row.boundingBox();
  expect(rowBox?.height).toBeLessThanOrEqual(70);
  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-icon/);

  const manifest = await page.request.get("/manifest.webmanifest");
  await expect(manifest).toBeOK();
  expect(await manifest.json()).toMatchObject({ display: "standalone", start_url: "/list" });
});

test("iPhone shopper rows keep purchase direct and secondary actions compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await page.getByLabel("Item").fill("sparkling water");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator("article").filter({ hasText: "sparkling water" })).toBeVisible();

  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "Shopper Mode" })).toBeVisible();
  await page.getByLabel("Giant").check();
  await page.getByRole("button", { name: "Start shopping" }).click();
  await expect(page.getByRole("heading", { name: "Giant run" })).toBeVisible();

  const summaryCards = page.locator(".summary-card");
  expect(await summaryCards.count()).toBe(4);
  const summaryTopEdges = await summaryCards.evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));
  expect(new Set(summaryTopEdges).size).toBe(1);
  await expect(summaryCards.nth(3)).toContainText("Moved");

  const row = page.locator("article").filter({ hasText: "sparkling water" });
  expect((await row.boundingBox())?.height).toBeLessThanOrEqual(70);
  await expect(row.getByLabel("Mark sparkling water purchased")).toBeVisible();
  await row.getByLabel("More actions for sparkling water").click();
  await expect(row.getByRole("button", { name: "Substitute" })).toBeVisible();
  await expect(row.getByLabel("Reject sparkling water")).toBeVisible();
  await row.getByRole("button", { name: "Substitute" }).click();
  const substituteDialog = page.getByRole("dialog", { name: "Substitute sparkling water" });
  expect((await substituteDialog.boundingBox())?.width).toBeGreaterThanOrEqual(340);
  await substituteDialog.getByRole("button", { name: "Cancel" }).click();
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
  await expect(page.getByRole("heading", { name: "Choose a store" })).toBeVisible();
  await page.goto("/list");
  const lastVisit = page.getByLabel("Last store visit");
  await expect(lastVisit).toContainText("Giant");
  await expect(lastVisit).toContainText("Gina · Today");
  await expect(lastVisit.locator(".last-visit-avatar")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Shopping History" })).toBeVisible();
  await expect(page.getByLabel("Shopping history dashboard")).toContainText("Completed Runs - Past 30 Days");
  await expect(page.getByLabel("Shopping history dashboard")).toContainText("Giant");
  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  const trip = page.locator("details").filter({ hasText: "Giant" });
  await expect(trip).toBeVisible();
  await expect(trip.getByText("1 purchased", { exact: true })).toBeVisible();
  await expect(trip.locator(".disclosure-closed")).toBeVisible();
  await trip.locator("summary").click();
  await expect(trip.locator(".disclosure-open")).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "bananas" })).toContainText("Purchased");
});
