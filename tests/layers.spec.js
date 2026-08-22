import { test, expect } from "@playwright/test";

async function mockAuthenticatedBackend(page) {
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "playwright@example.test",
        role: "authenticated"
      })
    });
  });

  await page.route("**/rest/v1/region_console_state*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]"
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "main",
        version: 1,
        updated_at: new Date().toISOString(),
        state: {}
      }])
    });
  });

  await page.addInitScript(() => {
    sessionStorage.setItem("region-console-session", JSON.stringify({
      access_token: "playwright-test-token",
      refresh_token: "playwright-test-refresh-token",
      expires_in: 3600,
      token_type: "bearer"
    }));
  });
}

test.describe("Map layer chooser", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedBackend(page);
    await page.goto("/", { waitUntil: "commit", timeout: 10_000 });
    await expect(page.locator("#consoleView")).toBeVisible({ timeout: 15_000 });
  });

  test("opens with all nine layers selected", async ({ page }) => {
    await page.getByRole("button", { name: "Katmanlar" }).click();
    await expect(page.locator("#dialogTitle")).toHaveText("Katmanlar");

    const options = page.locator("input[data-layer-key]");
    await expect(options).toHaveCount(9);
    for (let index = 0; index < 9; index += 1) {
      await expect(options.nth(index)).toBeChecked();
    }
  });

  test("changes an individual layer visibility state", async ({ page }) => {
    await page.getByRole("button", { name: "Katmanlar" }).click();

    const special = page.locator('input[data-layer-key="special"]');
    await special.uncheck();
    await expect.poll(() => page.evaluate(() => window.__regionConsoleLayerVisibility?.special)).toBe(false);

    await special.check();
    await expect.poll(() => page.evaluate(() => window.__regionConsoleLayerVisibility?.special)).toBe(true);
  });
});
