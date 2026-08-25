const REGION_TYPES = {
  country: { label: "Ülke", level: 0, parentType: null },
  province: { label: "İl", level: 1, parentType: "country" },
  district: { label: "İlçe", level: 2, parentType: "province" },
  neighborhood: { label: "Mahalle", level: 3, parentType: "district" },
  cemetery: { label: "Mezarlık", level: 4, parentType: "neighborhood" },
  independent: { label: "Bağımsız Bölge", level: 0, parentType: null }
};

const REGION_TYPE_OPTIONS = [
  ["country", "Ülke"],
  ["province", "İl"],
  ["district", "İlçe"],
  ["neighborhood", "Mahalle"],
  ["cemetery", "Mezarlık"],
  ["independent", "Bağımsız Bölge"]
];

function isFiniteCoordinatePair(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

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

function normalizeRegionType(value) {
  const raw = String(value || "").trim().toLocaleLowerCase("tr-TR");
  const aliases = {
    country: "country", countries: "country", ülke: "country",
    il: "province", province: "province", provinces: "province",
    ilçe: "district", ilce: "district", district: "district",
    mahalle: "neighborhood", neighborhood: "neighborhood",
    mezarlık: "cemetery", mezarlik: "cemetery", cemetery: "cemetery",
    bağımsız: "independent", "bağımsız bölge": "independent",
    bagimsiz: "independent", "bagimsiz bolge": "independent", independent: "independent"
  };
  return aliases[raw] || null;
}

function askRegionType() {
  if (typeof window === "undefined" || typeof window.prompt !== "function") return "independent";

  const options = REGION_TYPE_OPTIONS.map(([value, label], index) => `${index + 1}. ${label}`).join("\n");
  const answer = window.prompt(
    `İçe aktarılan dosyanın bölge tipini seçin:\n\n${options}\n\n1-6 arasında seçim yapın.`,
    "6"
  );

  if (answer === null) throw new Error("İçe aktarma iptal edildi.");

  const normalized = normalizeRegionType(answer);
  if (normalized) return normalized;

  const numeric = Number.parseInt(String(answer).trim(), 10);
  if (numeric >= 1 && numeric <= REGION_TYPE_OPTIONS.length) return REGION_TYPE_OPTIONS[numeric - 1][0];

  throw new Error("Geçersiz bölge tipi seçildi.");
}

function hierarchyMeta(regionType, properties = {}) {
  const definition = REGION_TYPES[regionType] || REGION_TYPES.independent;
  const parentId = properties.parentId
    ?? properties.parent_id
    ?? properties.parentID
    ?? properties.parentCode
    ?? properties.parent_code
    ?? null;

  return {
    type: regionType,
    label: definition.label,
    level: definition.level,
    parentType: definition.parentType,
    parentId: parentId == null || parentId === "" ? null : String(parentId),
    rootType: definition.level === 0 ? regionType : "country"
  };
}

export function getRegionTypeOptions() {
  return REGION_TYPE_OPTIONS.map(([value, label]) => ({ value, label }));
}

export function importRegionData(input, fileName = "", regionType = null) {
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

  const selectedType = normalizeRegionType(regionType) || askRegionType();
  const features = featureList(input);
  if (!features.length) {
    throw new Error("Dosyada FeatureCollection, Feature, Polygon veya MultiPolygon bulunamadı.");
  }

  if (selectedType === "country" && features.length > 1) {
    throw new Error(`Bu dosyada ${features.length} ayrı geometri var. Her geometri Türkiye'nin bir ili ise bölge tipini “İl” seçin. “Ülke” yalnızca ülke geometrisinin içe aktarılması içindir.`);
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
      type: selectedType,
      name,
      status: "service",
      geometry,
      bounds: buildBounds(geometry),
      createdAt: now,
      updatedAt: now,
      hierarchy: hierarchyMeta(selectedType, properties),
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
    regionType: selectedType,
    regionTypeLabel: REGION_TYPES[selectedType].label,
    regions: { countries: [], custom: imported, selectedId: null },
    campaigns: [],
    importedCount: imported.length,
    skippedCount
  };
}
