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
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") {
        await dialog.accept("6");
        return;
      }
      await dialog.dismiss();
    });
    await page.goto("/", { waitUntil: "commit", timeout: 10_000 });
    await expect(page.locator("#consoleView")).toBeVisible({ timeout: 15_000 });
  });

  test("starts with a usable map and closed regions menu", {
    tag: ["@smoke", "@map", "@cloud", "@auth", "@drawing"]
  }, async ({ page }) => {
    const map = page.locator("#map");
    const box = await map.boundingBox();

    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(250);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#cloudStatus")).toContainText("Bulut bağlı");
  });

  test("opens and closes the regions menu without a duplicate search field", {
    tag: ["@regions", "@ui"]
  }, async ({ page }) => {
    const toggle = page.locator("#regionsToggle");

    await toggle.click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#sidebarSearch")).toHaveCount(0);

    await toggle.click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("regions add button starts the drawing workflow and closes the menu", {
    tag: ["@regions", "@drawing", "@ui"]
  }, async ({ page }) => {
    await page.locator("#regionsToggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();

    await page.locator("#addRegionButton").click();

    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#regionsToggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('.tool[data-tool="draw"]')).toHaveClass(/active/);
    await expect(page.locator("#editBar")).toBeVisible();
    await expect(page.locator("#selectedArea")).toContainText("0 nokta");
  });

  test("numbers every drawing point and avoids an extra point on finish", {
    tag: ["@drawing", "@map", "@ui"]
  }, async ({ page }) => {
    await page.locator('.tool[data-tool="draw"]').click();
    const map = page.locator("#map");
    const box = await map.boundingBox();
    expect(box).not.toBeNull();

    const points = [
      { x: 220, y: 180 },
      { x: 420, y: 180 },
      { x: 420, y: 360 }
    ];

    for (const point of points) {
      await map.click({ position: point });
      await page.waitForTimeout(240);
    }

    await expect(page.locator(".draw-point-marker")).toHaveCount(3);
    await expect(page.locator(".draw-point-marker").nth(0)).toHaveText("1");
    await expect(page.locator(".draw-point-marker").nth(1)).toHaveText("2");
    await expect(page.locator(".draw-point-marker").nth(2)).toHaveText("3");
    await expect(page.locator("#selectedArea")).toHaveText("3 nokta");

    await map.dblclick({ position: points[2], delay: 80 });
    await expect(page.locator(".draw-point-marker")).toHaveCount(3);
    await expect(page.locator("#selectedArea")).toHaveText("3 nokta");
  });

  test("imports a GeoJSON region and renders it in the region list", {
    tag: ["@regions", "@import"]
  }, async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);

    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.locator("#statArea")).toHaveText("1");
    await expect(page.locator(".region-row[data-region-id]")).toContainText("Test Bölgesi");
  });

  test("opens the same region information panel from the regions menu", {
    tag: ["@regions", "@ui"]
  }, async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);
    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });
    await expect(page.locator("#sidebar")).toBeVisible();

    await page.locator(".region-row[data-region-id]").click();
    await expect(page.locator("#regionActionPanel")).toBeVisible();
    await expect(page.locator("#regionNameInput")).toHaveValue("Test Bölgesi");
    await expect(page.locator("#regionDeleteButton")).toBeVisible();
  });

  test("deletes the selected region from the information panel", {
    tag: ["@regions"]
  }, async ({ page }) => {
    await page.locator("#regionsToggle").click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "İçe aktar" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath);
    await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });
    await expect(page.locator("#sidebar")).toBeVisible();

    await page.locator(".region-row[data-region-id]").click();
    await expect(page.locator("#regionActionPanel")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#regionDeleteButton").click();

    await expect(page.locator("#regionActionPanel")).toBeHidden();
    await expect(page.locator(".region-row[data-region-id]")).toHaveCount(0);
    await expect(page.locator("#statArea")).toHaveText("0");
  });

  test("searches from the header, focuses the selected region, and opens its info dialog", {
    tag: ["@regions", "@search", "@map"]
  }, async ({ page }) => {
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
    await expect(page.locator("#appDialog")).toBeVisible();
    await expect(page.locator("#dialogTitle")).toHaveText("Test Bölgesi");
    await expect(page.locator("#dialogBody")).toContainText("bölge");

    await expect.poll(async () => page.evaluate(() => {
      const map = window.__regionConsoleMapState?.map;
      const center = map?.getCenter?.();
      return center ? [Number(center.lat.toFixed(1)), Number(center.lng.toFixed(1))] : null;
    })).toEqual([38.5, 26.5]);
  });

  test("toggles map overlay layers without changing the base map", {
    tag: ["@map", "@ui"]
  }, async ({ page }) => {
    await page.locator("#satelliteLayerButton").click();
    await expect(page.locator("#satelliteLayerButton")).toHaveClass(/active/);
    await expect(page.locator("#mapLayerButton")).not.toHaveClass(/active/);

    await page.locator("#mapLayerButton").click();
    await expect(page.locator("#mapLayerButton")).toHaveClass(/active/);
    await expect(page.locator("#satelliteLayerButton")).not.toHaveClass(/active/);
  });
});
