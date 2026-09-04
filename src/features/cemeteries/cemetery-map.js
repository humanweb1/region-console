import { store } from "../../state/store.js";
import { listCemeteries, updateCemetery } from "./cemetery-service.js";

let mapState = null;
let layer = null;
let activeId = null;

function colorFor(item) { return item.geometry ? "#2563eb" : "#94a3b8"; }
function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return (geometry.coordinates?.[0] || []).map(([lng, lat]) => [Number(lat), Number(lng)]);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flatMap((p) => (p?.[0] || []).map(([lng, lat]) => [Number(lat), Number(lng)]));
  return [];
}

function draw() {
  if (!mapState?.map || !window.L) return;
  layer?.clearLayers();
  if (!layer) layer = window.L.featureGroup().addTo(mapState.map);
  for (const item of (window.RegionConsoleCemeteriesData || [])) {
    const points = geometryToLatLngs(item.geometry);
    if (points.length < 3) continue;
    const polygon = window.L.polygon(points, { color: colorFor(item), weight: 2, fillOpacity: 0.16, interactive: true });
    polygon.bindTooltip(item.name || "Mezarlık");
    polygon.on("click", () => { activeId = item.id; mapState.map.fitBounds(polygon.getBounds(), { padding: [40, 40], maxZoom: 17 }); });
    layer.addLayer(polygon);
  }
}

export function attachCemeteryMap(nextMapState) {
  mapState = nextMapState;
  draw();
}

export function setCemeteryMapData(items) {
  window.RegionConsoleCemeteriesData = Array.isArray(items) ? items : [];
  draw();
}

export function getSelectedCemeteryId() { return activeId; }
