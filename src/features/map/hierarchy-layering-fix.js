import { store } from "../../state/store.js";

const PANE_CONFIG = {
  province: { name: "region-province", zIndex: 410 },
  district: { name: "region-district", zIndex: 420 },
  neighborhood: { name: "region-neighborhood", zIndex: 430 },
  cemetery: { name: "region-cemetery", zIndex: 440 },
  special: { name: "region-special", zIndex: 450 }
};

let installedMap = null;
let previousRegions = null;

function ensurePanes(map) {
  for (const config of Object.values(PANE_CONFIG)) {
    const pane = map.getPane(config.name) || map.createPane(config.name);
    pane.style.zIndex = String(config.zIndex);
  }
}

function applyLayerPanes(mapState) {
  const { map, polygons, regionLayers = [] } = mapState;
  ensurePanes(map);

  for (const layer of regionLayers) {
    const kind = layer?._regionLayerKind || "special";
    const pane = PANE_CONFIG[kind]?.name || PANE_CONFIG.special.name;
    layer.options.pane = pane;

    // Leaflet resolves the SVG/Canvas pane when a layer is added. Re-add the
    // layer after assigning the pane so an existing region moves immediately.
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
