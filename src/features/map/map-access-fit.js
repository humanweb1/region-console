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

function fitWhenReady() {
  const mapState = window.__regionConsoleMapState;
  const access = window.RegionConsoleRBAC?.access || null;
  if (!mapState?.map || mapState.initialAccessFitDone) return true;
  if (!access?.loaded) return false;

  const regions = store.get().regions?.custom || [];
  const coordinates = regions
    .filter((region) => isRegionVisible(access, region))
    .flatMap((region) => outerRings(region?.geometry).flat());

  if (!coordinates.length) return false;

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
    scheduled = false;
    if (fitWhenReady()) return;
    if (attempts < 40) scheduleFit();
  }, 50);
}

window.addEventListener("region-console:rbac-updated", () => {
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
