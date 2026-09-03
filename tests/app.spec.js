import { test, expect } from "@playwright/test";
import path from "node:path";

const fixturePath = path.resolve("tests/fixtures/turkiye-test.geojson");

async function mockAuthenticatedBackend(page) {
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-0000-0000-000000000001", email: "playwright@example.test", role: "authenticated" }) });
  });
  await page.route("**/rest/v1/rpc/get_current_user_rbac_access", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ profile: { id: "00000000-0000-0000-0000-000000000001", is_active: true, email: "playwright@example.test" }, role: { id: "playwright", name: "playwright" }, permissions: ["*"], scopes: [], regionCatalog: [] }]) });
  });
  await page.route("**/rest/v1/region_console_state*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("region-console-session", JSON.stringify({ access_token: "playwright-test-token", refresh_token: "playwright-test-refresh-token", expires_in: 3600, token_type: "bearer" }));
  });
}

async function importFixture(page) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "İçe aktar" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixturePath);
  const dialog = page.locator("#appDialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#importSettingsForm")).toBeVisible();
  await page.locator("#importRegionType").selectOption("independent");
  await page.locator("#importSettingsForm button[type='submit']").click();
  await expect(page.locator("#toast")).toContainText("1 bölge içe aktarıldı", { timeout: 10_000 });
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#statArea")).toHaveText("1");
  await expect(page.locator(".region-row[data-region-id]")).toContainText("Test Bölgesi");
}

async function setMapAccess(page, { scopes, catalog }) {
  await page.evaluate(({ scopes, catalog }) => {
    window.RegionConsoleRBAC.access = { profile: { id: "00000000-0000-0000-0000-000000000001", is_active: true }, role: { id: "scoped-test", name: "scoped_test" }, permissions: ["button.map.view"], scopes, regionCatalog: catalog, loaded: true };
    window.dispatchEvent(new CustomEvent("region-console:rbac-updated"));
  }, { scopes, catalog });
}

async function setTestRegions(page) {
  await page.evaluate(async () => {
    const { store } = await import("/src/state/store.js");
    store.update("regions", {
      custom: [
        { id: "ankara-region", name: "Ankara", hierarchy: { type: "province", provinceId: "province-ankara", countryId: "country-tr" }, geometry: { type: "Polygon", coordinates: [[[32.45, 39.75], [33.15, 39.75], [33.15, 40.20], [32.45, 40.20], [32.45, 39.75]]] } },
        { id: "istanbul-region", name: "İstanbul", hierarchy: { type: "province", provinceId: "province-istanbul", countryId: "country-tr" }, geometry: { type: "Polygon", coordinates: [[[28.45, 40.75], [29.55, 40.75], [29.55, 41.45], [28.45, 41.45], [28.45, 40.75]]] } }
      ]
    });
  });
}

test.describe("Region Console smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedBackend(page);
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") { await dialog.accept("6"); return; }
      await dialog.dismiss();
    });
    await page.goto("/", { waitUntil: "commit", timeout: 10_000 });
    await expect(page.locator("#consoleView")).toBeVisible({ timeout: 15_000 });
  });

  test("shows a post-login preparation screen before revealing the console", { tag: ["@smoke", "@auth", "@ui"] }, async ({ page }) => {
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#startupView")).toBeVisible({ timeout: 2_000 });
    await expect(page.locator("#consoleView")).toBeHidden();
    await expect(page.locator("#startupTitle")).toContainText("Hoş geldiniz");
    await expect(page.locator("[data-startup-step='access']")).toBeVisible();
    await expect(page.locator("[data-startup-step='data']")).toBeVisible();
    await expect(page.locator("#consoleView")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#startupView")).toBeHidden();
  });

  test("starts with a usable map and closed regions menu", { tag: ["@smoke", "@map", "@cloud", "@auth", "@drawing"] }, async ({ page }) => {
    const map = page.locator("#map");
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(250);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#cloudStatus")).toContainText("Bulut bağlı");
  });

  test("opens and closes the regions menu without a duplicate search field", { tag: ["@regions", "@ui"] }, async ({ page }) => {
    await page.locator("#regionsToggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.locator("#sidebar input[placeholder='Bölge ara']")).toHaveCount(0);
    await expect(page.locator("#regionSearch")).toHaveCount(1);
    await page.locator("#regionsToggle").click();
    await expect(page.locator("#sidebar")).toBeHidden();
  });

  test("imports a GeoJSON region and renders it in the region list", { tag: ["@regions", "@import"] }, async ({ page }) => {
    await page.locator("#regionsToggle").click();
    await importFixture(page);
  });

  test("opens the same region information panel from the regions menu", { tag: ["@regions", "@ui"] }, async ({ page }) => {
    await page.locator("#regionsToggle").click();
    await importFixture(page);
    await page.locator(".region-row[data-region-id]").click();
    await expect(page.locator("#regionActionPanel")).toBeVisible();
    await expect(page.locator("#regionNameInput")).toHaveValue("Test Bölgesi");
    await expect(page.locator("#regionDeleteButton")).toBeVisible();
  });

  test("edits boundary vertices and adds a vertex between existing pins", { tag: ["@regions", "@map", "@boundary-edit"] }, async ({ page }) => {
    await page.locator("#regionsToggle").click();
    await importFixture(page);
    await page.locator(".region-row[data-region-id]").click();
    await page.locator("#regionBoundaryButton").click();
    const vertices = page.locator(".boundary-vertex-marker");
    const midpoints = page.locator(".boundary-midpoint-marker");
    const midpointHitTargets = page.locator(".boundary-midpoint-marker-wrap").filter({ has: page.locator(".boundary-midpoint-marker") });
    const initialVertexCount = await vertices.count();
    expect(initialVertexCount).toBeGreaterThanOrEqual(3);
    await expect(midpoints).toHaveCount(initialVertexCount);
    const first = vertices.nth(0);
    await expect(first).toBeVisible();
    await first.click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(vertices).toHaveCount(initialVertexCount);
    await midpointHitTargets.nth(0).click();
    await expect(vertices).toHaveCount(initialVertexCount + 1);
    await expect(midpoints).toHaveCount(initialVertexCount + 1);
  });

  test("fits the map to a province-scoped user's accessible region", { tag: ["@smoke", "@map", "@rbac", "@scope"] }, async ({ page }) => {
    await setTestRegions(page);
    await setMapAccess(page, {
      scopes: [{ country_id: "country-tr", province_id: "province-ankara", district_id: null }],
      catalog: [
        { id: "country-tr", type: "country", parent_id: null },
        { id: "province-ankara", type: "province", parent_id: "country-tr" },
        { id: "province-istanbul", type: "province", parent_id: "country-tr" }
      ]
    });
    await expect.poll(async () => page.evaluate(() => {
      const center = window.__regionConsoleMapState?.map?.getCenter?.();
      return { lat: center?.lat ?? 0, lng: center?.lng ?? 0 };
    }), { timeout: 5_000 }).toSatisfy(({ lat, lng }) => lat > 39.7 && lat < 40.3 && lng > 32.3 && lng < 33.3);
    const view = await page.evaluate(() => { const map = window.__regionConsoleMapState.map; const center = map.getCenter(); return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }; });
    expect(view.lat).toBeGreaterThan(39.7);
    expect(view.lat).toBeLessThan(40.3);
    expect(view.lng).toBeGreaterThan(32.3);
    expect(view.lng).toBeLessThan(33.3);
    expect(view.zoom).toBeGreaterThan(8);
    expect(view.zoom).toBeLessThanOrEqual(13);
  });

  test("fits the map to all accessible regions for a global user", { tag: ["@smoke", "@map", "@rbac", "@scope"] }, async ({ page }) => {
    await setTestRegions(page);
    await setMapAccess(page, { scopes: [], catalog: [] });
    await page.evaluate(() => {
      window.RegionConsoleRBAC.access.permissions = ["*"];
      window.dispatchEvent(new CustomEvent("region-console:rbac-updated"));
    });
    await expect.poll(async () => page.evaluate(() => {
      const center = window.__regionConsoleMapState?.map?.getCenter?.();
      return { lat: center?.lat ?? 0, lng: center?.lng ?? 0 };
    }), { timeout: 5_000 }).toSatisfy(({ lat, lng }) => lat > 40.0 && lat < 41.0 && lng > 29.0 && lng < 32.5);
    const view = await page.evaluate(() => { const map = window.__regionConsoleMapState.map; const center = map.getCenter(); return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }; });
    expect(view.lat).toBeGreaterThan(40.0);
    expect(view.lat).toBeLessThan(41.0);
    expect(view.lng).toBeGreaterThan(29.0);
    expect(view.lng).toBeLessThan(32.5);
    expect(view.zoom).toBeGreaterThan(5);
    expect(view.zoom).toBeLessThanOrEqual(13);
  });
});
