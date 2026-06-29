import { expect, test } from "@playwright/test";

test("Google mode redirects protected routes to login and exposes only Google auth", async ({ page, request }) => {
  await page.goto("/list");

  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Flist$/);
  await expect(page.getByRole("heading", { name: "Sign in to your household" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Current user")).toHaveCount(0);

  const providers = await request.get("/api/auth/providers");
  expect(providers.ok()).toBe(true);
  await expect(providers.json()).resolves.toMatchObject({
    google: {
      id: "google",
      callbackUrl: "http://127.0.0.1:3200/api/auth/callback/google"
    }
  });
});
