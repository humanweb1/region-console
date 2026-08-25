import { store } from "../../state/store.js";
import { openDialog } from "../../components/shell.js";

const GREEN = "#22c55e";
const RED = "#ef4444";
const TOLERANCE = 1e-7;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function regionKey(region) {
  return String(region?.id ?? region?.importMeta?.sourceId ?? region?.name ?? "");
}

function geometryPoints(geometry) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      points.push([Number(value[0]), Number(value[1])]);
      return;
    }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points;
}

function samePoint(a, b) {
  return Boolean(a && b && Math.abs(a[0] - b[0]) <= TOLERANCE && Math.abs(a[1] - b[1]) <= TOLERANCE);
}

function changedPoints(beforeGeometry, afterGeometry) {
  const before = geometryPoints(beforeGeometry);
  const after = geometryPoints(afterGeometry);
  if (JSON.stringify(beforeGeometry) === JSON.stringify(afterGeometry)) return { before: [], after: [] };

  const beforeChanged = before.filter((point) => !after.some((candidate) => samePoint(point, candidate)));
  const afterChanged = after.filter((point) => !before.some((candidate) => samePoint(point, candidate)));
  return { before: beforeChanged, after: afterChanged };
}

function getRegions(snapshot) {
  return Array.isArray(snapshot?.regions?.custom) ? snapshot.regions.custom : [];
}

function buildDiff(beforeSnapshot, afterSnapshot) {
  const beforeRegions = getRegions(beforeSnapshot);
  const afterRegions = getRegions(afterSnapshot);
  const beforeByKey = new Map(beforeRegions.map((region) => [regionKey(region), region]));
  const afterByKey = new Map(afterRegions.map((region) => [regionKey(region), region]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])];

  const changed = [];
  for (const key of keys) {
    const before = beforeByKey.get(key) || null;
    const after = afterByKey.get(key) || null;
    const geometryChanged = JSON.stringify(before?.geometry || null) !== JSON.stringify(after?.geometry || null);
    const statusChanged = String(before?.status || "service") !== String(after?.status || "service");
    const nameChanged = String(before?.name || "") !== String(after?.name || "");
    if (!geometryChanged && !statusChanged && !nameChanged) continue;
    const points = changedPoints(before?.geometry, after?.geometry);
    changed.push({ key, before, after, geometryChanged, statusChanged, nameChanged, points });
  }
  return changed;
}

function allGeometryLatLngs(regions) {
  return regions.flatMap((region) => geometryPoints(region?.geometry).map(([lng, lat]) => [lat, lng]));
}

function renderMap(container, regions, changedEntries, side) {
  const map = L.map(container, { zoomControl: true, attributionControl: true, doubleClickZoom: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const boundaryLayer = L.featureGroup().addTo(map);
  const markerLayer = L.featureGroup().addTo(map);
  const changedByKey = new Map(changedEntries.map((entry) => [entry.key, entry]));
  const boundsPoints = [];

  for (const region of regions) {
    const points = geometryPoints(region.geometry);
    if (points.length < 3) continue;
    const latLngs = points.map(([lng, lat]) => [lat, lng]);
    L.polygon(latLngs, {
      color: GREEN,
      weight: 2,
      opacity: 0.95,
      fill: false,
      interactive: false
    }).addTo(boundaryLayer);
    boundsPoints.push(...latLngs);

    const diff = changedByKey.get(regionKey(region));
    const changedPointsForSide = diff?.points?.[side] || [];
    for (const [lng, lat] of changedPointsForSide) {
      L.circleMarker([lat, lng], {
        radius: 6,
        color: RED,
        weight: 2,
        fillColor: RED,
        fillOpacity: 1,
        interactive: false
      }).addTo(markerLayer);
    }
  }

  if (boundsPoints.length) {
    map.fitBounds(L.latLngBounds(boundsPoints), { padding: [24, 24], maxZoom: 12, animate: false });
  } else {
    map.setView([39, 35], 5);
  }

  requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  return map;
}

function destroySimulationMaps() {
  document.querySelectorAll(".history-sim-map[data-leaflet-initialized]").forEach((container) => {
    const map = container._historyMap;
    if (map) map.remove();
    delete container._historyMap;
    container.removeAttribute("data-leaflet-initialized");
  });
}

function renderSimulation(elements, entry) {
  destroySimulationMaps();
  const changed = buildDiff(entry.before, entry.after);
  const beforeRegions = getRegions(entry.before);
  const afterRegions = getRegions(entry.after);
  const changedBefore = changed.map((item) => item.before).filter(Boolean);
  const changedAfter = changed.map((item) => item.after).filter(Boolean);
  const changedGeometryCount = changed.filter((item) => item.geometryChanged).length;
  const changedPointCount = changed.reduce((sum, item) => sum + item.points.before.length + item.points.after.length, 0);

  openDialog(elements, `Harita karşılaştırması · ${entry.label || "Güncelleme"}`, `
    <div class="history-sim">
      <div class="history-sim-toolbar">
        <button id="historySimBack" class="button" type="button">← Geçmişe dön</button>
        <div class="history-sim-summary"><strong>${escapeHtml(entry.label || "Güncelleme")}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span></div>
        <div class="history-sim-legend"><span><i class="history-sim-dot green"></i> Sınır</span><span><i class="history-sim-dot red"></i> Değişen nokta</span></div>
      </div>
      <div class="history-sim-stats"><span>${changed.length} değişen alan</span><span>${changedGeometryCount} sınır güncellemesi</span><span>${changedPointCount} değişen nokta</span></div>
      <div class="history-sim-grid">
        <section class="history-sim-panel"><header><strong>BEFORE</strong><span>Önce</span></header><div id="historySimBefore" class="history-sim-map"></div></section>
        <section class="history-sim-panel"><header><strong>AFTER</strong><span>Sonra</span></header><div id="historySimAfter" class="history-sim-map"></div></section>
      </div>
      ${changed.length ? `<div class="history-sim-changes"><strong>Değişen alanlar</strong>${changed.map((item) => `<span>${escapeHtml(item.after?.name || item.before?.name || "Adsız alan")}</span>`).join("")}</div>` : `<p class="dialog-muted">Bu işlemde harita geometrisi değişmemiş.</p>`}
    </div>
  `);

  document.getElementById("historySimBack")?.addEventListener("click", () => {
    document.querySelector('.tool[data-tool="history"]')?.click();
  });

  const beforeMapElement = document.getElementById("historySimBefore");
  const afterMapElement = document.getElementById("historySimAfter");
  if (!beforeMapElement || !afterMapElement) return;

  const beforeMap = renderMap(beforeMapElement, beforeRegions, changed, "before");
  const afterMap = renderMap(afterMapElement, afterRegions, changed, "after");
  beforeMapElement._historyMap = beforeMap;
  afterMapElement._historyMap = afterMap;
  beforeMapElement.dataset.leafletInitialized = "true";
  afterMapElement.dataset.leafletInitialized = "true";

  // Both panes use the exact same viewport so the boundary movement is visually comparable.
  const combined = [...allGeometryLatLngs(changedBefore), ...allGeometryLatLngs(changedAfter)];
  if (combined.length) {
    const combinedBounds = L.latLngBounds(combined);
    beforeMap.fitBounds(combinedBounds, { padding: [24, 24], maxZoom: 12, animate: false });
    afterMap.fitBounds(combinedBounds, { padding: [24, 24], maxZoom: 12, animate: false });
  }
  requestAnimationFrame(() => {
    beforeMap.invalidateSize({ pan: false });
    afterMap.invalidateSize({ pan: false });
  });
}

function historyEntryFromItem(item) {
  const list = item.closest(".history-list");
  if (!list) return null;
  const index = [...list.children].indexOf(item);
  const entries = store.get().history.entries.slice().reverse();
  return entries[index] || null;
}

function injectHistorySimulationButtons() {
  document.querySelectorAll(".history-item").forEach((item) => {
    if (item.querySelector(".history-sim-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-sim-open button";
    button.textContent = "Haritada simüle et";
    item.appendChild(button);
  });
}

function installStyles() {
  if (document.getElementById("historySimulationStyles")) return;
  const style = document.createElement("style");
  style.id = "historySimulationStyles";
  style.textContent = `
    .history-list { display:grid; gap:7px; }
    .history-item { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:3px 10px; padding:9px; border:1px solid var(--border); border-radius:7px; background:var(--panel-2); }
    .history-item > strong { grid-column:1; font-size:11px; }
    .history-item > span { grid-column:1; color:var(--muted); font-size:9px; }
    .history-item > small { grid-column:2; grid-row:1 / span 2; color:var(--muted); font-size:9px; }
    .history-sim-open { grid-column:1 / -1; justify-self:start; min-height:27px; padding:0 9px; font-size:10px; }
    .history-sim { display:grid; gap:9px; }
    .history-sim-toolbar { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
    .history-sim-summary { display:grid; gap:2px; min-width:0; flex:1; }
    .history-sim-summary strong { font-size:11px; }
    .history-sim-summary span { color:var(--muted); font-size:9px; }
    .history-sim-legend { display:flex; gap:9px; color:var(--muted); font-size:9px; }
    .history-sim-legend span { display:inline-flex; align-items:center; gap:4px; }
    .history-sim-dot { width:8px; height:8px; display:inline-block; border-radius:50%; }
    .history-sim-dot.green { background:${GREEN}; }
    .history-sim-dot.red { background:${RED}; }
    .history-sim-stats { display:flex; gap:7px; flex-wrap:wrap; color:var(--muted); font-size:9px; }
    .history-sim-stats span { padding:4px 7px; border:1px solid var(--border); border-radius:5px; background:var(--panel-2); }
    .history-sim-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; min-width:0; }
    .history-sim-panel { min-width:0; overflow:hidden; border:1px solid var(--border); border-radius:8px; background:var(--panel-2); }
    .history-sim-panel > header { display:flex; align-items:center; justify-content:space-between; padding:7px 9px; border-bottom:1px solid var(--border); }
    .history-sim-panel > header strong { font-size:10px; }
    .history-sim-panel > header span { color:var(--muted); font-size:9px; }
    .history-sim-map { height:min(58vh,520px); min-height:320px; background:#dbe4e8; }
    .history-sim-map .leaflet-control-attribution { font-size:8px; }
    .history-sim-changes { display:flex; align-items:center; gap:5px; flex-wrap:wrap; color:var(--muted); font-size:9px; }
    .history-sim-changes strong { color:var(--text); margin-right:3px; }
    .history-sim-changes span { padding:4px 6px; border:1px solid color-mix(in srgb, ${RED} 35%, var(--border)); border-radius:5px; color:var(--text); background:color-mix(in srgb, ${RED} 8%, var(--panel-2)); }
    @media (max-width:720px) { .history-sim-grid { grid-template-columns:1fr; } .history-sim-map { height:330px; min-height:280px; } }
  `;
  document.head.appendChild(style);
}

if (typeof document !== "undefined") {
  installStyles();
  const observer = new MutationObserver(injectHistorySimulationButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".history-sim-open");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const item = button.closest(".history-item");
    const entry = item ? historyEntryFromItem(item) : null;
    if (!entry) return;
    const elements = {
      appDialog: document.getElementById("appDialog"),
      dialogTitle: document.getElementById("dialogTitle"),
      dialogBody: document.getElementById("dialogBody")
    };
    renderSimulation(elements, entry);
  }, true);

  document.getElementById("dialogClose")?.addEventListener("click", destroySimulationMaps);
}
