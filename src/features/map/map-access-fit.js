import { store } from "../../state/store.js";
import { isRegionVisible } from "../../services/rbac.js";

let scheduled = false;
let attempts = 0;

function toLatLngRing(ring) {
  return (ring || [])
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)]);
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

function childNodes(node) {
  return [
    ...(Array.isArray(node?.provinces) ? node.provinces : []),
    ...(Array.isArray(node?.districts) ? node.districts : []),
    ...(Array.isArray(node?.neighborhoods) ? node.neighborhoods : []),
    ...(Array.isArray(node?.cemeteries) ? node.cemeteries : []),
    ...(Array.isArray(node?.children) ? node.children : [])
  ];
}

function flattenHierarchy(items) {
  const result = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (!node) continue;
      result.push(node);
      walk(childNodes(node));
    }
  };
  walk(items);
  return result;
}

function visibleAccessCoordinates(access) {
  const state = store.get();
  const countries = Array.isArray(state.regions?.countries) ? state.regions.countries : [];
  const custom = Array.isArray(state.regions?.custom) ? state.regions.custom : [];
  const hierarchy = flattenHierarchy(countries);
  const visibleHierarchy = hierarchy.filter((region) => isRegionVisible(access, region));
  const visibleCustom = custom.filter((region) => isRegionVisible(access, region));

  return [...visibleHierarchy, ...visibleCustom]
    .flatMap((region) => outerRings(region?.geometry).flat());
}

function mapHasLayout(mapState) {
  const container = mapState?.map?.getContainer?.();
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  const size = mapState.map.getSize?.();
  return rect.width > 0 && rect.height > 0 && size?.x > 0 && size?.y > 0;
}

function fitWhenReady() {
  scheduled = false;
  const mapState = window.__regionConsoleMapState;
  const access = window.RegionConsoleRBAC?.access || null;
  if (!mapState?.map || mapState.initialAccessFitDone) return true;
  if (!access?.loaded || !mapHasLayout(mapState)) return false;

  const coordinates = visibleAccessCoordinates(access);
  if (!coordinates.length) return false;

  mapState.map.invalidateSize({ pan: false });
  mapState.map.fitBounds(L.latLngBounds(coordinates), {
    padding: [42, 42],
    maxZoom: 13,
    animate: false
  });
  mapState.initialAccessFitDone = true;
  attempts = 0;
  return true;
}

function scheduleFit() {
  if (scheduled) return;
  scheduled = true;
  attempts += 1;
  setTimeout(() => {
    if (fitWhenReady()) return;
    if (attempts < 100) scheduleFit();
  }, 50);
}

window.addEventListener("region-console:rbac-updated", () => {
  const mapState = window.__regionConsoleMapState;
  if (mapState) mapState.initialAccessFitDone = false;
  attempts = 0;
  scheduleFit();
});

window.addEventListener("region-console:startup-ready", () => {
  const mapState = window.__regionConsoleMapState;
  if (mapState) mapState.initialAccessFitDone = false;
  attempts = 0;
  scheduleFit();
});

store.subscribe(() => {
  const mapState = window.__regionConsoleMapState;
  if (!mapState || mapState.initialAccessFitDone) return;
  scheduleFit();
});

scheduleFit();
