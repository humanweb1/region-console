import { store } from "../../state/store.js";

const PANE_CONFIG = {
  country: { name: "region-country", zIndex: 400 },
  province: { name: "region-province", zIndex: 410 },
  district: { name: "region-district", zIndex: 420 },
  neighborhood: { name: "region-neighborhood", zIndex: 430 },
  cemetery: { name: "region-cemetery", zIndex: 440 },
  special: { name: "region-special", zIndex: 450 }
};

let installedMap = null;
let previousRegions = null;

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
}

function regionCategory(region) {
  const type = regionType(region);
  if (["country", "countries", "ülke"].includes(type)) return "country";
  if (["province", "provinces", "il"].includes(type)) return "province";
  if (["district", "districts", "ilce", "ilçe"].includes(type)) return "district";
  if (["neighborhood", "neighbourhood", "mahalle"].includes(type)) return "neighborhood";
  if (["cemetery", "mezarlik", "mezarlık"].includes(type)) return "cemetery";
  return "special";
}

function regionByLayer(layer) {
  const id = layer?._regionId;
  if (!id) return null;
  return (store.get().regions?.custom || []).find((region) => region && String(region.id) === String(id)) || null;
}

function ensurePanes(map) {
  for (const config of Object.values(PANE_CONFIG)) {
    const pane = map.getPane(config.name) || map.createPane(config.name);
    pane.style.zIndex = String(config.zIndex);
  }
}

function hierarchyTooltipText(region) {
  if (!region) return "Alan";
  const hierarchy = region.hierarchy || {};
  const names = [
    hierarchy.countryName,
    hierarchy.provinceName,
    hierarchy.districtName,
    hierarchy.neighborhoodName,
    region.name || region.properties?.name
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const seen = new Set();
  const chain = names.filter((name) => {
    const key = normalizeName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (chain.length > 1) return chain.join("-");
  return chain[0] || "Alan";
}

function isDrawingActive() {
  try {
    return Boolean(window.__regionConsoleDrawing?.isActive?.());
  } catch {
    return false;
  }
}

function applyLayerPanes(mapState) {
  const { map, polygons, regionLayers = [] } = mapState;
  ensurePanes(map);
  const drawingActive = isDrawingActive();

  for (const layer of regionLayers) {
    const region = regionByLayer(layer);
    const kind = region ? regionCategory(region) : (layer?._regionLayerKind || "special");
    const pane = PANE_CONFIG[kind]?.name || PANE_CONFIG.special.name;
    layer.options.pane = pane;
    layer.options.interactive = !drawingActive;

    const tooltipText = hierarchyTooltipText(region);
    if (tooltipText) {
      layer.unbindTooltip();
      layer.bindTooltip(tooltipText, { sticky: true, direction: "top", opacity: 0.96, className: "region-hierarchy-tooltip", interactive: false });
    }

    if (polygons.hasLayer(layer)) {
      polygons.removeLayer(layer);
      polygons.addLayer(layer);
    }
  }
}

export function enableHierarchyLayering(mapState) {
  if (!mapState?.map || !mapState?.polygons) return;

  if (installedMap !== mapState.map) {
    installedMap = mapState.map;
    previousRegions = null;
    ensurePanes(mapState.map);

    store.subscribe((state) => {
      const currentRegions = state?.regions?.custom;
      if (currentRegions === previousRegions) return;
      previousRegions = currentRegions;
      requestAnimationFrame(() => applyLayerPanes(mapState));
    });
  }

  requestAnimationFrame(() => applyLayerPanes(mapState));
}

export function applyHierarchyLayering(mapState) {
  if (!mapState?.map || !mapState?.polygons) return;
  applyLayerPanes(mapState);
}
