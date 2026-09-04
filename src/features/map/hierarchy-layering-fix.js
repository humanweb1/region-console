import { store } from "../../state/store.js";

const PANE_CONFIG = {
  mask: { name: "region-mask", zIndex: 350 },
  country: { name: "region-country", zIndex: 400 },
  province: { name: "region-province", zIndex: 410 },
  district: { name: "region-district", zIndex: 420 },
  neighborhood: { name: "region-neighborhood", zIndex: 430 },
  cemetery: { name: "region-cemetery", zIndex: 440 },
  special: { name: "region-special", zIndex: 450 }
};

let installedMap = null;
let previousRegions = null;

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

function isDrawingActive() {
  try {
    return Boolean(window.__regionConsoleDrawing?.isActive?.());
  } catch {
    return false;
  }
}

function ensurePanes(map) {
  for (const config of Object.values(PANE_CONFIG)) {
    const pane = map.getPane(config.name) || map.createPane(config.name);
    pane.style.zIndex = String(config.zIndex);
    if (config.name === "region-mask") pane.style.pointerEvents = "none";
  }
}

function movePathToPane(layer, paneElement) {
  if (!layer?._path || !paneElement) return;
  if (layer._path.parentNode !== paneElement) paneElement.appendChild(layer._path);
}

function moveMaskToPane(mapState) {
  const pane = mapState?.map?.getPane?.(PANE_CONFIG.mask.name);
  if (!pane || !mapState?.mask?._layers) return;
  Object.values(mapState.mask._layers).forEach((layer) => movePathToPane(layer, pane));
}

function applyLayerPanes(mapState) {
  const { map, polygons, regionLayers = [] } = mapState;
  ensurePanes(map);
  const drawingActive = isDrawingActive();

  for (const layer of regionLayers) {
    const region = regionByLayer(layer);
    const kind = region ? regionCategory(region) : (layer?._regionLayerKind || "special");
    const paneName = PANE_CONFIG[kind]?.name || PANE_CONFIG.special.name;
    const pane = map.getPane(paneName);
    layer.options.pane = paneName;
    layer.options.interactive = !drawingActive;
    movePathToPane(layer, pane);

    // map.js owns the canonical cursor tooltip. Do not replace it here.
    // The hierarchy panel has its own normalization fix for the selected region.

    if (polygons.hasLayer(layer)) {
      polygons.removeLayer(layer);
      polygons.addLayer(layer);
    }
  }

  moveMaskToPane(mapState);
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
