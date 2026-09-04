import { store } from "../../state/store.js";

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

function hierarchyText(region) {
  const hierarchy = region?.hierarchy || {};
  const values = [
    hierarchy.countryName,
    hierarchy.provinceName,
    hierarchy.districtName,
    hierarchy.neighborhoodName,
    region?.name || region?.properties?.name
  ];
  const seen = new Set();
  return values.map((value) => String(value ?? "").trim()).filter((value) => {
    const key = normalizeName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("-");
}

function currentRegion(layer) {
  const id = layer?._regionId;
  if (!id) return null;
  return (store.get().regions?.custom || []).find((item) => item && String(item.id) === String(id)) || null;
}

function patchTooltips(mapState) {
  for (const layer of mapState?.regionLayers || []) {
    const region = currentRegion(layer);
    const text = hierarchyText(region);
    if (!text) continue;
    layer.unbindTooltip();
    layer.bindTooltip(text, {
      sticky: true,
      direction: "top",
      opacity: 0.96,
      className: "region-hierarchy-tooltip",
      interactive: false
    });
  }
}

function apply() {
  const mapState = window.__regionConsoleMapState;
  if (!mapState) return;
  patchTooltips(mapState);
}

function schedule() {
  requestAnimationFrame(apply);
}

function install() {
  if (!window.__regionConsoleMapState) {
    setTimeout(install, 50);
    return;
  }
  if (window.__regionConsoleMapVisualConsistencyInstalled) return;
  window.__regionConsoleMapVisualConsistencyInstalled = true;
  store.subscribe(schedule);
  window.addEventListener("region-console:rbac-updated", schedule);
  schedule();
}

install();
