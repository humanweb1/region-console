import { store } from "../../state/store.js";
import { getElements, openDialog } from "../../components/shell.js";
import { fitToCoordinates } from "../map/map.js";
import { isRegionVisible } from "../../services/rbac.js";

const elements = getElements();
const input = document.getElementById("regionSearch");
const results = document.getElementById("headerSearchResults");
let query = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıiİI]/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function childItems(item) {
  const groups = [item?.provinces, item?.districts, item?.neighborhoods, item?.cemeteries, item?.children];
  const seen = new Set();
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter((child) => {
    const key = child?.id ?? child?.name;
    if (key == null || seen.has(String(key))) return false;
    seen.add(String(key));
    return true;
  });
}

function inferChildType(parentType, child) {
  const explicit = String(child?.hierarchy?.type || child?.type || "").toLowerCase();
  const aliases = { country: "ülke", province: "il", district: "ilçe", neighborhood: "mahalle", cemetery: "mezarlık", independent: "özel alan" };
  if (explicit) return aliases[explicit] || explicit;
  if (parentType === "ülke") return "il";
  if (parentType === "il") return "ilçe";
  if (parentType === "ilçe") return "mahalle";
  if (parentType === "mahalle") return "mezarlık";
  return "bölge";
}

function flattenHierarchy(items, type, parentPath = "", output = [], visited = new Set()) {
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.id ?? `${type}:${item?.name ?? ""}`);
    if (visited.has(key)) continue;
    visited.add(key);
    const name = String(item?.name || item?.properties?.name || item?.properties?.NAME || "İsimsiz");
    const path = parentPath ? `${parentPath} / ${name}` : name;
    output.push({ type, data: item, name, path });
    for (const child of childItems(item)) flattenHierarchy([child], inferChildType(type, child), path, output, visited);
  }
  return output;
}

function customEntry(region) {
  const hierarchy = region?.hierarchy || {};
  const names = [hierarchy.countryName, hierarchy.provinceName, hierarchy.districtName, hierarchy.neighborhoodName, region?.name]
    .filter(Boolean).map(String);
  const path = [...new Set(names)].join(" / ") || String(region?.name || "İsimsiz");
  const explicitType = String(hierarchy.type || region?.type || "bölge").toLowerCase();
  const aliases = { country: "ülke", province: "il", district: "ilçe", neighborhood: "mahalle", cemetery: "mezarlık", independent: "özel alan" };
  return { type: aliases[explicitType] || explicitType || "bölge", data: region, name: String(region?.name || hierarchy.neighborhoodName || hierarchy.districtName || hierarchy.provinceName || "İsimsiz"), path };
}

function getSearchEntries() {
  const state = store.get();
  const access = window.RegionConsoleRBAC?.access || null;
  const countries = flattenHierarchy(state.regions?.countries || [], "ülke");
  const custom = (state.regions?.custom || []).map(customEntry);
  const entries = [...countries, ...custom];
  const seen = new Set();
  return entries.filter((entry) => {
    const key = String(entry.data?.id ?? `${entry.type}:${entry.path}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return isRegionVisible(access, entry.data);
  });
}

function searchableFields(entry) {
  const data = entry.data || {};
  const properties = data.properties || {};
  const hierarchy = data.hierarchy || {};
  return [entry.name, entry.path, data.code, properties.code, data.slug, properties.slug, data.id, properties.name, properties.NAME, properties.NAME_1, properties.NAME_2, properties.NAME_3, properties.NAME_4, properties.IL, properties.ILCE, properties.ILCE_ADI, properties.MAHALLE, properties.MAHALLE_ADI, hierarchy.countryName, hierarchy.provinceName, hierarchy.districtName, hierarchy.neighborhoodName]
    .filter((value) => value != null && String(value).trim() !== "").map(normalize);
}

function matches(entry, normalizedQuery) { return Boolean(normalizedQuery) && searchableFields(entry).some((field) => field.includes(normalizedQuery)); }
function iconFor(type) { if (type === "ülke") return "Ü"; if (type === "il" || type === "ilçe") return "İ"; if (type === "mahalle" || type === "mezarlık") return "M"; return "B"; }
function geometryCoordinates(data) { const geometry = data?.geometry || data?.properties?.geometry; if (!geometry) return []; if (geometry.type === "Polygon") return geometry.coordinates?.flat() || []; if (geometry.type === "MultiPolygon") return geometry.coordinates?.flat(2) || []; if (geometry.type === "LineString") return geometry.coordinates || []; if (geometry.type === "MultiLineString") return geometry.coordinates?.flat() || []; if (geometry.type === "Point") return geometry.coordinates ? [geometry.coordinates] : []; return []; }
function focusEntryOnMap(entry) { const mapState = window.__regionConsoleMapState; if (!mapState) return; const coordinates = geometryCoordinates(entry.data); if (coordinates.length) fitToCoordinates(mapState, coordinates, [36, 36]); }
function showGenericInfo(entry) { const data = entry.data || {}; const properties = data.properties || {}; const count = Number(data.count || 0); const status = data.status === "outside" ? "Hizmet dışı" : data.status === "campaign" || data.campaign === true || data.campaignId ? "Kampanyalı" : data.status ? "Hizmet veriliyor" : "-"; const fields = [["Tür", entry.type], ["Konum", entry.path], ["Durum", status], count ? ["Kayıt", count] : null, data.campaignId ? ["Kampanya ID", data.campaignId] : null, data.geometry?.type ? ["Geometri", data.geometry.type] : null, properties.code || data.code ? ["Kod", properties.code || data.code] : null].filter(Boolean); openDialog(elements, entry.name, `<div class="region-dialog"><div class="info-grid">${fields.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div></div>`); }
function selectEntry(entry) { results.hidden = true; input.value = entry.name; input.blur(); focusEntryOnMap(entry); showGenericInfo(entry); }
function renderResults() { const normalizedQuery = normalize(query); if (!normalizedQuery) { results.hidden = true; results.innerHTML = ""; return; } const matchesList = getSearchEntries().filter((entry) => matches(entry, normalizedQuery)).slice(0, 15); if (!matchesList.length) { results.innerHTML = `<div class="header-search-empty">Sonuç bulunamadı.</div>`; results.hidden = false; return; } results.innerHTML = matchesList.map((entry, index) => `<button type="button" class="header-search-item" data-search-index="${index}"><span class="header-search-icon">${escapeHtml(iconFor(entry.type))}</span><span class="header-search-name">${escapeHtml(entry.name)}</span><span class="header-search-meta">${escapeHtml(entry.type)} · ${escapeHtml(entry.path)}</span></button>`).join(""); matchesList.forEach((entry, index) => { results.querySelector(`[data-search-index="${index}"]`)?.addEventListener("click", () => selectEntry(entry)); }); results.hidden = false; }
input?.addEventListener("input", (event) => { query = event.target.value; renderResults(); });
input?.addEventListener("focus", () => { if (query.trim()) renderResults(); });
document.addEventListener("click", (event) => { if (results.hidden) return; if (results.contains(event.target) || input?.contains(event.target)) return; results.hidden = true; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !results.hidden) { results.hidden = true; input?.focus(); } });
store.subscribe(() => { if (!results.hidden && query.trim()) renderResults(); });
document.addEventListener("region-console:rbac-updated", () => { if (!results.hidden && query.trim()) renderResults(); });
