const initialState = {
  auth: {
    status: "unknown",
    session: null,
    user: null,
    profile: null,
    role: null,
    permissions: []
  },
  cloud: {
    status: "idle",
    version: null,
    error: null,
    updatedAt: null
  },
  regions: {
    countries: [],
    custom: [],
    selectedId: null
  },
  map: {
    drawing: false,
    layer: "standard"
  },
  mapSettings: {
    boundaryColor: "#ffffff",
    boundaryWeight: 1.5,
    outsideColor: "#4b5563",
    outsideOpacity: 0.55,
    campaignColor: "#ffd400",
    campaignOpacity: 0.55
  },
  history: {
    entries: [],
    cursor: -1
  },
  campaigns: [],
  importedFiles: [],
  ui: {
    theme: "dark",
    activeTool: "draw"
  }
};

let state = structuredClone(initialState);
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(state));
}

function snapshotData() {
  return structuredClone({
    regions: { ...state.regions, mapSettings: state.mapSettings },
    campaigns: state.campaigns,
    importedFiles: state.importedFiles,
    mapSettings: state.mapSettings
  });
}

function swapPair([first, second]) { return [second, first]; }
function swapGeometryCoordinates(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") return { ...geometry, coordinates: (geometry.coordinates || []).map((ring) => (ring || []).map((point) => Array.isArray(point) ? swapPair(point) : point)) };
  if (geometry.type === "MultiPolygon") return { ...geometry, coordinates: (geometry.coordinates || []).map((polygon) => (polygon || []).map((ring) => (ring || []).map((point) => Array.isArray(point) ? swapPair(point) : point))) };
  return geometry;
}
function migrateCustomRegions(custom) {
  return (Array.isArray(custom) ? custom : []).map((region) => {
    const meta = region?.importMeta;
    if (!meta?.format || meta.format !== "GeoJSON" || meta.coordinateOrder) return region;
    return { ...region, geometry: swapGeometryCoordinates(region.geometry), importMeta: { ...meta, coordinateOrder: "lonlat", migratedAt: new Date().toISOString() } };
  });
}
function regionKey(region) { return String(region?.id ?? region?.importMeta?.sourceId ?? ""); }
function sourceKey(region) { return String(region?.importMeta?.sourceId ?? region?.id ?? ""); }
function findByKeys(items, ...keys) {
  const wanted = keys.filter((value) => value !== null && value !== undefined && String(value) !== "").map(String);
  if (!wanted.length) return null;
  return (items || []).find((item) => wanted.includes(regionKey(item)) || wanted.includes(sourceKey(item))) || null;
}
function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}
function findByHierarchy(items, hierarchy) {
  const byId = findByKeys(items, hierarchy?.parentId);
  if (byId) return byId;
  const parentName = normalizeName(hierarchy?.parentName);
  if (!parentName) return null;
  return (items || []).find((item) => normalizeName(item?.name) === parentName) || null;
}
function normalizeHierarchy(countries, custom) {
  const nextCountries = structuredClone(Array.isArray(countries) ? countries : []);
  const safeCustom = Array.isArray(custom) ? custom : [];
  const countryFor = (region) => {
    const hierarchy = region?.hierarchy || {};
    return nextCountries.find((country) => String(country.id ?? "") === String(hierarchy.countryId ?? "") || normalizeName(country.name) === normalizeName(hierarchy.countryName));
  };
  const ensureUniqueChild = (list, region) => findByKeys(list, region.id, region.importMeta?.sourceId) ? list : [...list, structuredClone(region)];
  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "province").forEach((region) => { const country = countryFor(region); if (!country) return; const list = Array.isArray(country.provinces) ? country.provinces : (Array.isArray(country.children) ? country.children : []); country.provinces = ensureUniqueChild(list, region); country.count = country.provinces.length; });
  const allProvinces = nextCountries.flatMap((country) => Array.isArray(country.provinces) ? country.provinces : []);
  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "district").forEach((region) => { const province = findByHierarchy(allProvinces, region?.hierarchy || {}); if (!province) return; const list = Array.isArray(province.districts) ? province.districts : (Array.isArray(province.children) ? province.children : []); province.districts = ensureUniqueChild(list, region); province.count = Array.isArray(province.districts) ? province.districts.length : 0; });
  const allDistricts = allProvinces.flatMap((province) => Array.isArray(province.districts) ? province.districts : []);
  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "neighborhood").forEach((region) => { const district = findByHierarchy(allDistricts, region?.hierarchy || {}); if (!district) return; const list = Array.isArray(district.neighborhoods) ? district.neighborhoods : (Array.isArray(district.children) ? district.children : []); district.neighborhoods = ensureUniqueChild(list, region); district.count = Array.isArray(district.neighborhoods) ? district.neighborhoods.length : 0; });
  const allNeighborhoods = allDistricts.flatMap((district) => Array.isArray(district.neighborhoods) ? district.neighborhoods : []);
  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "cemetery").forEach((region) => { const neighborhood = findByHierarchy(allNeighborhoods, region?.hierarchy || {}); if (!neighborhood) return; const list = Array.isArray(neighborhood.cemeteries) ? neighborhood.cemeteries : (Array.isArray(neighborhood.children) ? neighborhood.children : []); neighborhood.cemeteries = ensureUniqueChild(list, region); neighborhood.count = Array.isArray(neighborhood.cemeteries) ? neighborhood.cemeteries.length : 0; });
  return nextCountries;
}

export const store = {
  get() { return state; },
  set(patch) { state = { ...state, ...patch }; notify(); },
  update(key, patch) { state = { ...state, [key]: { ...state[key], ...patch } }; notify(); },
  replaceData(data, { recordHistory = false, label = "Güncelleme" } = {}) {
    const before = snapshotData();
    const regions = structuredClone(data.regions || state.regions);
    regions.countries = normalizeHierarchy(regions.countries, regions.custom);
    state = { ...state, regions, campaigns: structuredClone(data.campaigns || state.campaigns), importedFiles: structuredClone(data.importedFiles || state.importedFiles), mapSettings: structuredClone(data.mapSettings || state.mapSettings) };
    if (recordHistory) this.recordHistory(label, before, snapshotData());
    notify();
  },
  loadPersisted(data) {
    const incoming = structuredClone(data || {});
    const regions = structuredClone(incoming.regions || {});
    regions.custom = migrateCustomRegions(regions.custom || []);
    regions.countries = normalizeHierarchy(regions.countries || [], regions.custom);
    state = { ...state, regions: { countries: regions.countries || [], custom: regions.custom || [], selectedId: regions.selectedId || null }, campaigns: incoming.campaigns || [], importedFiles: incoming.importedFiles || [], mapSettings: incoming.mapSettings || state.mapSettings, history: { entries: incoming.history || [], cursor: Array.isArray(incoming.history) ? incoming.history.length - 1 : -1 } };
    notify();
  },
  dataSnapshot() { return snapshotData(); },
  recordHistory(label, before, after) {
    const entries = state.history.entries.slice(0, state.history.cursor + 1);
    entries.push({ id: crypto.randomUUID(), label, createdAt: new Date().toISOString(), before, after });
    state = { ...state, history: { entries, cursor: entries.length - 1 } };
    notify();
  },
  undo() {
    if (state.history.cursor < 0) return false;
    const entry = state.history.entries[state.history.cursor];
    if (!entry) return false;
    const regions = structuredClone(entry.before.regions);
    regions.countries = normalizeHierarchy(regions.countries, regions.custom);
    state = { ...state, regions, campaigns: structuredClone(entry.before.campaigns || []), importedFiles: structuredClone(entry.before.importedFiles || []), mapSettings: structuredClone(entry.before.mapSettings || state.mapSettings), history: { ...state.history, cursor: state.history.cursor - 1 } };
    notify(); return true;
  },
  redo() {
    const nextCursor = state.history.cursor + 1;
    const entry = state.history.entries[nextCursor];
    if (!entry) return false;
    const regions = structuredClone(entry.after.regions);
    regions.countries = normalizeHierarchy(regions.countries, regions.custom);
    state = { ...state, regions, campaigns: structuredClone(entry.after.campaigns || []), importedFiles: structuredClone(entry.after.importedFiles || []), mapSettings: structuredClone(entry.after.mapSettings || state.mapSettings), history: { ...state.history, cursor: nextCursor } };
    notify(); return true;
  },
  reset() { state = structuredClone(initialState); notify(); },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
};
