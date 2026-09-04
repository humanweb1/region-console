import { store } from "../../state/store.js";

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

function hierarchyText(region) {
  if (!region) return "";
  const h = region.hierarchy || {};
  const values = [h.countryName, h.provinceName, h.districtName, h.neighborhoodName, region.name || region.properties?.name];
  const seen = new Set();
  return values.map((value) => String(value ?? "").trim()).filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("-");
}

function selectedRegion() {
  const state = store.get();
  const id = state.regions?.selectedId;
  if (!id) return null;
  return (state.regions?.custom || []).find((region) => region && String(region.id) === String(id)) || null;
}

function patchPanel() {
  const panel = document.querySelector("#regionActionPanel");
  const region = selectedRegion();
  if (!panel || !region) return;
  const value = hierarchyText(region);
  if (!value) return;

  const labels = [...panel.querySelectorAll("*")].filter((element) => {
    return element.children.length === 0 && element.textContent.trim() === "Hiyerarşi";
  });

  for (const label of labels) {
    const row = label.parentElement;
    if (!row) continue;
    const candidates = [...row.children].filter((child) => child !== label);
    const target = candidates.at(-1);
    if (!target) continue;
    if (target.textContent.trim() !== value) target.textContent = value;
  }
}

let scheduled = false;
function schedulePatch() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    patchPanel();
  });
}

store.subscribe(schedulePatch);
new MutationObserver(schedulePatch).observe(document.body, { childList: true, subtree: true });
schedulePatch();
