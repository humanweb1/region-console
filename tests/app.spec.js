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

    // Do not wait for DOMContentLoaded here. The app currently loads Leaflet
    // from an external CDN with a classic script tag, so a slow/offline CDN
    // can delay DOMContentLoaded even though the local app is already being
    // served correctly. `commit` gives the test a deterministic navigation
    // boundary; app readiness is asserted explicitly below.
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

  test("opens and closes the regions menu", async ({ page }) => {
    const toggle = page.locator("#regionsToggle");

    await toggle.click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

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
