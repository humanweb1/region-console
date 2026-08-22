import { test, expect } from "@playwright/test";
import path from "node:path";

const fixturePath = path.resolve("tests/fixtures/turkiye-test.geojson");

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

test.describe("Region Console smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedBackend(page);
    await page.goto("/", { waitUntil: "commit", timeout: 10_000 });
    await expect(page.locator("#consoleView")).toBeVisible({ timeout: 15_000 });
  });

  test("starts with a usable map and closed regions menu", async ({ page }) => {
    const map = page.locator("#map");
    const box = await map.boundingBox();

    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(250);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#cloudStatus")).toContainText("Bulut bağlı");
  });

  test("opens and closes the regions menu without a duplicate search field", async ({ page }) => {
    const toggle = page.locator("#regionsToggle");

    await toggle.click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#sidebarSearch")).toHaveCount(0);

    await toggle.click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("imports a GeoJSON region and renders it in the region list", async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);

    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });
    await expect(page.locator("#statArea")).toHaveText("1");
    await expect(page.locator(".region-row[data-region-id]")).toContainText("Test Bölgesi");
  });

  test("opens the same region information panel from the regions menu", async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);
    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });

    await page.locator(".region-row[data-region-id]").click();
    await expect(page.locator("#regionActionPanel")).toBeVisible();
    await expect(page.locator("#regionNameInput")).toHaveValue("Test Bölgesi");
    await expect(page.locator("#regionDeleteButton")).toBeVisible();
  });

  test("deletes the selected region from the information panel", async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);
    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });

    await page.locator(".region-row[data-region-id]").click();
    await expect(page.locator("#regionActionPanel")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#regionDeleteButton").click();

    await expect(page.locator("#regionActionPanel")).toBeHidden();
    await expect(page.locator(".region-row[data-region-id]")).toHaveCount(0);
    await expect(page.locator("#statArea")).toHaveText("0");
  });

  test("searches from the header and opens the selected region information panel", async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);
    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });

    await page.locator("#regionsToggle").click();
    await page.locator("#regionSearch").fill("Test");

    await expect(page.locator("#headerSearchResults")).toBeVisible();
    await expect(page.locator(".header-search-item")).toContainText("Test Bölgesi");

    await page.locator(".header-search-item").first().click();
    await expect(page.locator("#headerSearchResults")).toBeHidden();
    await expect(page.locator("#regionActionPanel")).toBeVisible();
    await expect(page.locator("#regionNameInput")).toHaveValue("Test Bölgesi");
  });

  test("toggles map overlay layers without changing the base map", async ({ page }) => {
    await page.locator("#layersButton").click();
    await expect(page.locator("#layersPopover")).toBeVisible();

    const mask = page.locator('input[data-layer-id="mask"]');
    await expect(mask).toBeChecked();
    await mask.uncheck();

    await expect.poll(async () => page.evaluate(() => window.__regionConsoleMapState?.overlayVisibility?.mask)).toBe(false);
    await mask.check();
    await expect.poll(async () => page.evaluate(() => window.__regionConsoleMapState?.overlayVisibility?.mask)).toBe(true);
  });

  test("switches theme without losing the application view", async ({ page }) => {
    const before = await page.locator("html").getAttribute("data-theme");

    await page.locator("#themeButton").click();

    const after = await page.locator("html").getAttribute("data-theme");
    expect(after).not.toBe(before);
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator(".tool-panel")).toBeVisible();
    await expect(page.locator("#logoutButton")).toBeVisible();
  });
});
