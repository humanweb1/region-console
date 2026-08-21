function isFiniteCoordinatePair(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

// Internal geometry format is always standard GeoJSON: [longitude, latitude].
// Leaflet conversion happens only at the map rendering boundary.
function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;
  const points = ring
    .filter(isFiniteCoordinatePair)
    .map(([lng, lat]) => [Number(lng), Number(lat)]);
  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;

  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates || []).map(normalizeRing).filter(Boolean);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = (geometry.coordinates || [])
      .map((polygon) => (polygon || []).map(normalizeRing).filter(Boolean))
      .filter((polygon) => polygon.length);
    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }

  return null;
}

function geometryCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function buildBounds(geometry) {
  const points = geometryCoordinates(geometry);
  if (!points.length) return null;

  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)]
  ];
}

function featureList(input) {
  if (input?.type === "FeatureCollection" && Array.isArray(input.features)) return input.features;
  if (input?.type === "Feature") return [input];
  if (input?.type === "Polygon" || input?.type === "MultiPolygon") {
    return [{ type: "Feature", geometry: input, properties: {} }];
  }
  if (Array.isArray(input)) return input;
  return [];
}

function isRegionConsoleExport(input) {
  return Boolean(input && typeof input === "object" && input.regions && Array.isArray(input.regions.custom));
}

function stableSourceId(feature, index) {
  const properties = feature?.properties || {};
  return String(
    properties.id
      ?? properties.ID
      ?? properties.code
      ?? properties.Code
      ?? feature?.id
      ?? index
  );
}

export function importRegionData(input, fileName = "") {
  if (isRegionConsoleExport(input)) {
    return {
      mode: "region-console",
      regions: {
        countries: Array.isArray(input.regions.countries) ? input.regions.countries : [],
        custom: Array.isArray(input.regions.custom) ? input.regions.custom : [],
        selectedId: null
      },
      campaigns: Array.isArray(input.campaigns) ? input.campaigns : [],
      importedCount: Array.isArray(input.regions.custom) ? input.regions.custom.length : 0,
      skippedCount: 0
    };
  }

  const features = featureList(input);
  if (!features.length) {
    throw new Error("Dosyada FeatureCollection, Feature, Polygon veya MultiPolygon bulunamadı.");
  }

  const imported = [];
  let skippedCount = 0;

  features.forEach((feature, index) => {
    const geometry = normalizeGeometry(feature?.geometry || feature);
    if (!geometry) {
      skippedCount += 1;
      return;
    }

    const properties = feature?.properties && typeof feature.properties === "object"
      ? feature.properties
      : {};
    const sourceId = stableSourceId(feature, index);
    const name = String(
      properties.name
        ?? properties.NAME
        ?? properties.title
        ?? properties.label
        ?? `İçe Aktarılan Alan ${index + 1}`
    ).trim() || `İçe Aktarılan Alan ${index + 1}`;

    const now = new Date().toISOString();
    imported.push({
      id: `import-${sourceId}-${crypto.randomUUID()}`,
      type: "custom",
      name,
      status: "service",
      geometry,
      bounds: buildBounds(geometry),
      createdAt: now,
      updatedAt: now,
      importMeta: {
        format: "GeoJSON",
        coordinateOrder: "lonlat",
        sourceId,
        sourceFile: fileName || null,
        properties
      }
    });
  });

  if (!imported.length) throw new Error("Geçerli Polygon veya MultiPolygon bulunamadı.");

  return {
    mode: "geojson",
    regions: { countries: [], custom: imported, selectedId: null },
    campaigns: [],
    importedCount: imported.length,
    skippedCount
  };
}
