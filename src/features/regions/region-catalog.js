import { store } from "../../state/store.js";

const API_BASE = "https://api.turkiyeapi.dev/v2/datasets";
const CACHE_KEY = "region-console:administrative-catalog:v1";
let loading = null;
let ready = false;

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function idFor(type, id) { return `catalog-${type}-${String(id)}`; }

function findCanonical(type, name, parentId = null) {
  const catalog = Array.isArray(window.RegionConsoleRBAC?.access?.regionCatalog) ? window.RegionConsoleRBAC.access.regionCatalog : [];
  const wanted = normalizeName(name);
  return catalog.find((item) => {
    if (String(item?.type || "").toLowerCase() !== type) return false;
    if (normalizeName(item?.name) !== wanted) return false;
    if (!parentId) return true;
    return String(item?.parent_id ?? item?.parentId ?? "") === String(parentId);
  }) || null;
}

function turkeyId() {
  return store.get().regions?.countries?.find((item) => normalizeName(item?.name) === "turkey")?.id
    || Array.isArray(window.RegionConsoleRBAC?.access?.regionCatalog)
      ? (window.RegionConsoleRBAC.access.regionCatalog.find((item) => item?.type === "country" && normalizeName(item?.name) === "turkey")?.id || "catalog-country-turkey")
      : "catalog-country-turkey";
}

function catalogRegion(type, item) {
  const provinceId = item?.provinceId ?? item?.province_id ?? null;
  const districtId = item?.districtId ?? item?.district_id ?? null;
  const canonicalProvince = type === "province" ? findCanonical("province", item.name) : findCanonical("province", item.provinceName || "", null);
  const canonicalDistrict = type === "district" ? findCanonical("district", item.name, canonicalProvince?.id) : findCanonical("district", item.districtName || "", null);
  const resolvedProvinceId = canonicalProvince?.id || idFor("province", provinceId);
  const resolvedDistrictId = canonicalDistrict?.id || idFor("district", districtId);
  const countryId = turkeyId();
  return {
    id: idFor(type, item.id),
    name: String(item.name || "").trim(),
    type: "custom",
    status: "service",
    geometry: null,
    bounds: null,
    catalogOnly: true,
    geometryStatus: "missing",
    geometrySource: "catalog",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hierarchy: {
      type,
      label: type === "province" ? "İl" : type === "district" ? "İlçe" : "Mahalle",
      level: type === "province" ? 1 : type === "district" ? 2 : 3,
      parentType: type === "province" ? "country" : type === "district" ? "province" : "district",
      parentId: type === "province" ? countryId : type === "district" ? resolvedProvinceId : resolvedDistrictId,
      parentName: null,
      countryId,
      countryName: "Turkey",
      provinceId: type === "province" ? resolvedProvinceId : resolvedProvinceId,
      provinceName: item?.provinceName || null,
      districtId: type === "district" ? resolvedDistrictId : type === "neighborhood" ? resolvedDistrictId : null,
      districtName: item?.districtName || null,
      externalCatalogId: String(item.id)
    },
    importMeta: { source: "catalog", sourceId: String(item.id), format: "Catalog" }
  };
}

function readCache() {
  try {
    const value = sessionStorage.getItem(CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function writeCache(value) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* optional cache */ }
}

async function fetchDataset(name) {
  const response = await fetch(`${API_BASE}/${name}.json`, { headers: { Accept: "application/json" }, cache: "force-cache" });
  if (!response.ok) throw new Error(`Katalog verisi alınamadı: ${name} (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

function stripCatalogOnly(value) {
  if (Array.isArray(value)) return value.filter((item) => !item?.catalogOnly).map(stripCatalogOnly);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "catalogOnly") continue;
    result[key] = stripCatalogOnly(child);
  }
  return result;
}

function installSnapshotFilter() {
  if (store.dataSnapshot.__catalogFiltered) return;
  const original = store.dataSnapshot.bind(store);
  const filtered = () => stripCatalogOnly(original());
  filtered.__catalogFiltered = true;
  store.dataSnapshot = filtered;
}

function mergeCatalog(provinces, districts, neighborhoods) {
  const current = store.get();
  const custom = Array.isArray(current.regions?.custom) ? current.regions.custom : [];
  const existing = new Set(custom.map((item) => String(item?.id || "")));
  const additions = [];
  for (const item of provinces) if (item?.id != null && item?.name && !existing.has(idFor("province", item.id))) additions.push(catalogRegion("province", item));
  for (const item of districts) if (item?.id != null && item?.name && !existing.has(idFor("district", item.id))) additions.push(catalogRegion("district", item));
  for (const item of neighborhoods) if (item?.id != null && item?.name && !existing.has(idFor("neighborhood", item.id))) additions.push(catalogRegion("neighborhood", item));
  if (additions.length) store.update("regions", { custom: [...custom, ...additions] });
}

export async function ensureAdministrativeCatalog() {
  if (ready) return true;
  if (loading) return loading;
  installSnapshotFilter();
  loading = (async () => {
    const cached = readCache();
    if (cached?.provinces?.length && cached?.districts?.length && cached?.neighborhoods?.length) {
      mergeCatalog(cached.provinces, cached.districts, cached.neighborhoods);
      ready = true;
      return true;
    }
    const [provinces, districts, neighborhoods] = await Promise.all([
      fetchDataset("provinces"),
      fetchDataset("districts"),
      fetchDataset("neighborhoods")
    ]);
    writeCache({ provinces, districts, neighborhoods, fetchedAt: new Date().toISOString() });
    mergeCatalog(provinces, districts, neighborhoods);
    ready = true;
    return true;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function catalogStatus() { return { ready, loading: Boolean(loading) }; }

if (typeof document !== "undefined") {
  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("#saveButton");
    if (!button || button.disabled || button.dataset.catalogReady === "true" || button.dataset.catalogLoading === "true") return;
    button.dataset.catalogLoading = "true";
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await ensureAdministrativeCatalog();
      button.dataset.catalogReady = "true";
      button.click();
    } catch (error) {
      console.error("[Region Console] Administrative catalog load failed:", error);
      window.dispatchEvent(new CustomEvent("region-console:toast", { detail: { message: "Bölge kataloğu yüklenemedi. Mevcut kayıtlarla devam edebilirsiniz." } }));
    } finally {
      delete button.dataset.catalogLoading;
      delete button.dataset.catalogReady;
    }
  }, true);
}

if (typeof window !== "undefined") window.RegionConsoleRegionCatalog = { ensureAdministrativeCatalog, catalogStatus, normalizeName };
