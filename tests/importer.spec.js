import { test, expect } from "@playwright/test";
import { importRegionData } from "../src/features/regions/importer.js";

test.describe("GeoJSON import normalization", () => {
  test("keeps persisted geometry in standard [longitude, latitude] order", {
    tag: "@import"
  }, () => {
    const result = importRegionData({
      type: "Feature",
      id: "TR-TEST",
      properties: { name: "Koordinat Testi" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [26, 38],
          [27, 38],
          [27, 39],
          [26, 39],
          [26, 38]
        ]]
      }
    }, "coordinate-test.geojson");

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(0);

    const region = result.regions.custom[0];
    expect(region.geometry.coordinates[0][0]).toEqual([26, 38]);
    expect(region.geometry.coordinates[0][2]).toEqual([27, 39]);
    expect(region.bounds).toEqual([[38, 26], [39, 27]]);
    expect(region.importMeta.coordinateOrder).toBe("lonlat");
  });
});
