import { updateCemetery } from "./cemetery-service.js";
import { updateSection, createSection } from "./cemetery-structure-service.js";
import { store } from "../../state/store.js";
import { getElements, toast } from "../../components/shell.js";

const elements = getElements();
let mapState = null;
let mode = null;
let context = null;
let points = [];
let line = null;
let markers = null;
let previousDoubleClickZoom = true;

function token() { return store.get().auth.session?.access_token || null; }
function finishCleanup() {
  if (!mapState?.map) return;
  mapState.map.off("click", onMapClick); mapState.map.off("dblclick", onDoubleClick);
  if (previousDoubleClickZoom) mapState.map.doubleClickZoom.enable(); else mapState.map.doubleClickZoom.disable();
  line?.remove(); line = null; markers?.clearLayers(); mode = null; context = null; points = [];
}
function showPreview() {
  if (!mapState?.map || !window.L) return;
  if (!markers) markers = window.L.featureGroup().addTo(mapState.map); else markers.clearLayers();
  points.forEach((point) => window.L.circleMarker(point, { radius: 5, weight: 2 }).addTo(markers));
  line?.remove(); line = points.length >= 2 ? window.L.polyline(points, { weight: 3, dashArray: "6 5" }).addTo(mapState.map) : null;
}
function onMapClick(event) {
  if (mode === "grave") { const callback = context?.onGravePoint; finishCleanup(); callback?.(event.latlng); return; }
  if (!mode) return; points.push([event.latlng.lat, event.latlng.lng]); showPreview();
}
async function onDoubleClick() {
  if (!mode || mode === "grave" || points.length < 3) return;
  const geometry = { type: "Polygon", coordinates: [[...points.map(([lat, lng]) => [lng, lat]), [points[0][1], points[0][0]]]] };
  try {
    if (mode === "cemetery") await updateCemetery(token(), context.id, { geometry, geometryStatus: "manual", geometrySource: "manual" });
    else if (mode === "section") {
      if (context.id) await updateSection(token(), context.id, { geometry, geometryStatus: "manual", geometrySource: "manual" });
      else await createSection(token(), { cemeteryId: context.cemeteryId, name: context.name, code: context.code, geometry, geometrySource: "manual" });
    }
    toast(elements, mode === "cemetery" ? "Mezarlık sınırı kaydedildi." : "Bölüm sınırı kaydedildi.");
    const callback = context?.onSaved; finishCleanup(); callback?.();
  } catch (error) { toast(elements, error.message); }
}
export function startCemeteryBoundaryDrawing(cemetery, onSaved) { start("cemetery", { id: cemetery.id, onSaved }); }
export function startSectionBoundaryDrawing(cemeteryId, section = null, onSaved) { start("section", { cemeteryId, id: section?.id || null, name: section?.name || "Yeni bölüm", code: section?.code || null, onSaved }); }
export function startGravePlacement(onGravePoint) { start("grave", { onGravePoint }); }
function start(nextMode, nextContext) {
  finishCleanup(); mapState = window.__regionConsoleMapState || null;
  if (!mapState?.map) return toast(elements, "Harita henüz hazır değil.");
  mode = nextMode; context = nextContext; points = []; previousDoubleClickZoom = mapState.map.doubleClickZoom.enabled(); mapState.map.doubleClickZoom.disable();
  mapState.map.on("click", onMapClick); mapState.map.on("dblclick", onDoubleClick);
  toast(elements, nextMode === "grave" ? "Mezar konumunu haritada seçin." : "Noktaları haritada tıklayın; bitirmek için çift tıklayın.");
}
window.RegionConsoleCemeteryGeometry = { startCemeteryBoundaryDrawing, startSectionBoundaryDrawing, startGravePlacement, cancel: finishCleanup };
