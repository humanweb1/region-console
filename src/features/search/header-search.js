import { store } from "../../state/store.js";
import { getElements, openDialog } from "../../components/shell.js";
import { fitToCoordinates } from "../map/map.js";

const elements = getElements();
const input = document.getElementById("regionSearch");
const results = document.getElementById("headerSearchResults");
let query = "";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function childItems(item) {
  const groups = [item?.provinces, item?.districts, item?.children];
  const seen = new Set();
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter((child) => {
    const key = child?.id ?? child?.name;
    if (key == null || seen.has(String(key))) return false;
    seen.add(String(key));
    return true;
  });
}

function flattenHierarchy(items, type, parentPath = "") {
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item?.name || item?.properties?.name || "İsimsiz");
    const path = parentPath ? `${parentPath} / ${name}` : name;
    output.push({ type, data: item, name, path });
    const nextType = type === "ülke" ? "il" : "ilçe";
    output.push(...flattenHierarchy(childItems(item), nextType, path));
  }
  return output;
}

function getSearchEntries() {
  const state = store.get();
  const countries = flattenHierarchy(state.regions?.countries || [], "ülke");
  const custom = (state.regions?.custom || []).map((region) => ({
    type: "bölge",
    data: region,
    name: String(region?.name || "İsimsiz"),
    path: String(region?.name || "İsimsiz")
  }));
  return [...countries, ...custom];
}

function matches(entry, normalizedQuery) {
  if (!normalizedQuery) return false;
  const data = entry.data || {};
  const properties = data.properties || {};
  const fields = [
    entry.name,
    entry.path,
    data.code,
    properties.code,
    data.slug,
    properties.slug,
    data.id
  ].filter(Boolean).map(normalize);
  return fields.some((field) => field.includes(normalizedQuery));
}

function iconFor(type) {
  if (type === "ülke") return "Ü";
  if (type === "il") return "İ";
  if (type === "ilçe") return "İ";
  return "B";
}

function geometryCoordinates(data) {
  const geometry = data?.geometry || data?.properties?.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates?.flat() || [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates?.flat(2) || [];
  if (geometry.type === "LineString") return geometry.coordinates || [];
  if (geometry.type === "MultiLineString") return geometry.coordinates?.flat() || [];
  if (geometry.type === "Point") return geometry.coordinates ? [geometry.coordinates] : [];
  return [];
}

function focusEntryOnMap(entry) {
  const mapState = window.__regionConsoleMapState;
  if (!mapState) return;
  const coordinates = geometryCoordinates(entry.data);
  if (coordinates.length) fitToCoordinates(mapState, coordinates, [36, 36]);
}

function showGenericInfo(entry) {
  const data = entry.data || {};
  const properties = data.properties || {};
  const count = Number(data.count || 0);
  const status = data.status === "outside"
    ? "Hizmet dışı"
    : data.status === "campaign" || data.campaign === true || data.campaignId
      ? "Kampanyalı"
      : data.status
        ? "Hizmet veriliyor"
        : "-";
  const fields = [
    ["Tür", entry.type],
    ["Konum", entry.path],
    ["Durum", status],
    count ? ["Kayıt", count] : null,
    data.campaignId ? ["Kampanya ID", data.campaignId] : null,
    data.geometry?.type ? ["Geometri", data.geometry.type] : null,
    properties.code || data.code ? ["Kod", properties.code || data.code] : null
  ].filter(Boolean);

  openDialog(elements, entry.name, `<div class="region-dialog"><div class="info-grid">${fields.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div></div>`);
}

function selectEntry(entry) {
  results.hidden = true;
  input.value = entry.name;
  input.blur();
  focusEntryOnMap(entry);
  showGenericInfo(entry);
}

function renderResults() {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }

  const matchesList = getSearchEntries().filter((entry) => matches(entry, normalizedQuery)).slice(0, 15);
  if (!matchesList.length) {
    results.innerHTML = `<div class="header-search-empty">Sonuç bulunamadı.</div>`;
    results.hidden = false;
    return;
  }

  results.innerHTML = matchesList.map((entry, index) => `
    <button type="button" class="header-search-item" data-search-index="${index}">
      <span class="header-search-icon">${escapeHtml(iconFor(entry.type))}</span>
      <span class="header-search-name">${escapeHtml(entry.name)}</span>
      <span class="header-search-meta">${escapeHtml(entry.type)}</span>
    </button>
  `).join("");

  matchesList.forEach((entry, index) => {
    results.querySelector(`[data-search-index="${index}"]`)?.addEventListener("click", () => selectEntry(entry));
  });
  results.hidden = false;
}

input?.addEventListener("input", (event) => {
  query = event.target.value;
  renderResults();
});

input?.addEventListener("focus", () => {
  if (query.trim()) renderResults();
});

document.addEventListener("click", (event) => {
  if (results.hidden) return;
  if (results.contains(event.target) || input?.contains(event.target)) return;
  results.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !results.hidden) {
    results.hidden = true;
    input?.focus();
  }
});

store.subscribe(() => {
  if (!results.hidden && query.trim()) renderResults();
});
