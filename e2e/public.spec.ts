import { expect, test } from "@playwright/test";

test("homepage explains the product and has working primary navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your databases/i })).toBeVisible();
  await expect(page.getByText("Supabase", { exact: true }).first()).toBeVisible();
  await page.locator('a[href="/docs"]:visible').first().click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { name: /One logical backend/i })).toBeVisible();
});

test("security page makes no unsupported certification claims", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: /Your infrastructure/i })).toBeVisible();
  await expect(page.getByText(/does not claim SOC 2/i)).toBeVisible();
});

test("signup form is keyboard accessible", async ({ page }) => {
  await page.goto("/signup");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(page.getByLabel(/name/i)).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test("mobile marketing layout does not overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only assertion");
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await expect(page.getByRole("link", { name: /Start building/i }).first()).toBeVisible();
});
