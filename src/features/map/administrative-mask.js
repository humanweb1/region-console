import { store } from "../../state/store.js";
import { isRegionVisible } from "../../services/rbac.js";

const MASK_PANE = "region-mask";
const MASK_Z_INDEX = 350;
const LEVELS = ["country", "province", "district", "neighborhood"];

function normalizeType(region) {
  const type = String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
  if (["country", "countries", "ülke"].includes(type)) return "country";
  if (["province", "provinces", "il"].includes(type)) return "province";
  if (["district", "districts", "ilce", "ilçe"].includes(type)) return "district";
  if (["neighborhood", "neighbourhood", "mahalle"].includes(type)) return "neighborhood";
  return "";
}

function toLatLngRing(ring) {
  return (ring || [])
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const ring = toLatLngRing((geometry.coordinates || [])[0]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => toLatLngRing((polygon || [])[0]))
      .filter((ring) => ring.length >= 3);
  }
  return [];
}

function visibleRegions() {
  const access = window.RegionConsoleRBAC?.access || null;
  const regions = store.get().regions?.custom || [];
  return regions.filter((region) => region && region.geometry && isRegionVisible(access, region));
}

function selectMaskBoundaries(regions) {
  for (const level of LEVELS) {
    const selected = regions.filter((region) => normalizeType(region) === level);
    const rings = selected.flatMap((region) => outerRings(region.geometry));
    if (rings.length) return rings;
  }
  return [];
}

function ensurePane(map) {
  const pane = map.getPane(MASK_PANE) || map.createPane(MASK_PANE);
  pane.style.zIndex = String(MASK_Z_INDEX);
  pane.style.pointerEvents = "none";
  return pane;
}

function render(mapState) {
  const map = mapState?.map;
  const mask = mapState?.mask;
  if (!map || !mask) return;

  ensurePane(map);
  mask.clearLayers();

  const rings = selectMaskBoundaries(visibleRegions());
  if (!rings.length) {
    if (map.hasLayer(mask)) map.removeLayer(mask);
    return;
  }

  // The outer ring is the whole world. Every administrative boundary at the
  // highest available level becomes a transparent hole. Region polygons live
  // in their own panes and therefore cannot alter this mask geometry.
  const world = [[89, -180], [89, 180], [-89, 180], [-89, -180], [89, -180]];
  const layer = L.polygon([world, ...rings], {
    pane: MASK_PANE,
    stroke: false,
    fill: true,
    fillRule: "evenodd",
    fillColor: "#4b5563",
    fillOpacity: 0.55,
    interactive: false
  });
  mask.addLayer(layer);
  if (mapState.overlayVisibility?.mask !== false) mask.addTo(map);
}

function install() {
  const mapState = window.__regionConsoleMapState;
  if (!mapState) {
    setTimeout(install, 50);
    return;
  }
  if (window.__regionConsoleAdministrativeMaskInstalled) return;
  window.__regionConsoleAdministrativeMaskInstalled = true;

  const apply = () => requestAnimationFrame(() => render(mapState));
  store.subscribe(apply);
  window.addEventListener("region-console:rbac-updated", apply);
  apply();
}

install();
